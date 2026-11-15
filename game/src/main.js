// EMBERWORKS: a round-based tactical FPS. Boot and the one loop: a fixed 60 Hz
// simulation feeding a render at the display's rate. The match runs
// menu -> freeze (buy) -> live -> round end -> next round, first to 5 rounds
// takes the match. One state object holds it all; the sim never allocates in
// its hot loops beyond a reused raycaster and tracer pool.
// ?shot=start|play|bomb|end with &seed=N sets up a deterministic frame for a
// capture, renders it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld, SITES } from './world.js';
import { createBody } from './physics.js';
import { createInput } from './input.js';
import { createArsenal, createGrenades, WEAPONS, GRENADE_PRICE } from './weapons.js';
import { createBots } from './bots.js';
import { createBomb } from './bomb.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';

const STEP = 1 / 60;
const BUY_SECONDS = 8;
const ROUND_LEN = 100;
const ROUNDS_TO_WIN = 5;
const ROUND_CAP = 9;
const KILL_PAY = 300;
const WIN_PAY = 3250;
const LOSS_PAY = 1900;
const PLANT_PAY = 300;
const VEST_PRICE = 650;
const VEST_POINTS = 50;
const RAIDERS = 'Embers';
const WARDENS = 'Nightwatch';

const query = new URLSearchParams(window.location.search);
const shot = query.get('shot');
const seed = Number.parseInt(query.get('seed') ?? '1', 10) || 1;

function rng32(initial) {
  let a = initial;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = rng32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 45, 120);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const audio = createAudio();
const hud = createHud();
const grenades = createGrenades(scene, world.colliders);
const bomb = createBomb(scene);
const arsenal = createArsenal(camera);

const heroBody = createBody(world.colliders, 0, 18, 5.2, 2.4);
const hero = {
  body: heroBody,
  health: 100,
  armor: 0,
  alive: true,
  money: 800,
  kills: 0,
  deaths: 0,
  roundKills: 0,
  stepAcc: 0,
};

// Invisible hitboxes for the player, so bot shots can hit them with the same ray.
const ghostMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
const heroTorso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.78, 0.3), ghostMat);
const heroHead = new THREE.Mesh(new THREE.SphereGeometry(0.155, 12, 10), ghostMat);
heroTorso.userData.player = true;
heroTorso.userData.part = 'torso';
heroHead.userData.player = true;
heroHead.userData.part = 'head';
scene.add(heroTorso, heroHead);

const match = {
  phase: 'menu', // menu | freeze | live | roundEnd | matchEnd
  round: 1,
  scoreA: 0,
  scoreD: 0,
  phaseTime: 0,
  roundWinner: null,
  roundReason: '',
  spectate: null,
  time: 0,
  bomb: bomb.state,
};

const caster = new THREE.Raycaster();
caster.far = 130;
const aim = new THREE.Vector3();
const scratch = new THREE.Vector3();

// Streak pool: four reused lines, each shown for one frame-plus.
const streaks = [];
for (let i = 0; i < 4; i += 1) {
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9 }));
  line.visible = false;
  line.frustumCulled = false;
  scene.add(line);
  streaks.push({ line, left: 0 });
}
let streakAt = 0;

function drawStreak(from, to) {
  const streak = streaks[streakAt];
  streakAt = (streakAt + 1) % streaks.length;
  const pos = streak.line.geometry.attributes.position;
  pos.setXYZ(0, from.x, from.y, from.z);
  pos.setXYZ(1, to.x, to.y, to.z);
  pos.needsUpdate = true;
  streak.line.visible = true;
  streak.left = 0.07;
}

function placeHitboxes() {
  const p = heroBody.state.position;
  heroTorso.position.set(p.x, p.y + 1.0, p.z);
  heroHead.position.set(p.x, p.y + 1.53, p.z);
  heroTorso.rotation.y = heroBody.state.yaw;
  heroHead.rotation.y = heroBody.state.yaw;
}

function placeCamera() {
  if (hero.alive) {
    camera.position.set(heroBody.state.position.x, heroBody.eyeY(), heroBody.state.position.z);
    camera.rotation.set(heroBody.state.pitch, heroBody.state.yaw, 0, 'YXZ');
  } else if (match.spectate) {
    const b = match.spectate.body.state;
    camera.position.set(b.position.x, b.position.y + b.eye, b.position.z);
    camera.rotation.set(b.pitch, b.yaw, 0, 'YXZ');
  }
}

// Enemy views for the bots' scans: live references, rebuilt each frame.
const raiderView = [];
const wardenView = [];
function refreshViews() {
  raiderView.length = 0;
  wardenView.length = 0;
  if (hero.alive) {
    raiderView.push({
      alive: true, ref: 'player', pos: heroBody.state.position,
      eyeY: heroBody.eyeY(), speed: heroBody.groundSpeed(), team: 'A',
    });
  }
  for (let i = 0; i < bots.bots.length; i += 1) {
    const bot = bots.bots[i];
    if (!bot.alive) continue;
    const entry = {
      alive: true, ref: bot, pos: bot.body.state.position,
      eyeY: bot.body.eyeY(), speed: bot.body.groundSpeed(), team: bot.team,
    };
    if (bot.team === 'A') raiderView.push(entry);
    else wardenView.push(entry);
  }
}

function fireRay(origin, dir, damage, headMult, shooterBot, shooterIsPlayer) {
  caster.set(origin, dir);
  const targets = world.shootables.concat(bots.hitMeshes, [heroTorso, heroHead]);
  const hits = caster.intersectObjects(targets, false);
  for (let i = 0; i < hits.length; i += 1) {
    const hit = hits[i];
    const obj = hit.object;
    if (shooterBot && obj.userData.bot === shooterBot) continue;
    if (shooterIsPlayer && obj.userData.player) continue;
    const end = hit.point.clone();
    drawStreak(origin, end);
    if (obj.userData.bot) {
      const part = obj.userData.part;
      const mult = part === 'head' ? headMult : 1;
      const from = shooterIsPlayer ? { pos: heroBody.state.position } : { pos: origin };
      const killed = bots.damage(obj.userData.bot, damage * mult, part, from);
      return { hit: 'bot', bot: obj.userData.bot, killed, headshot: part === 'head', point: end };
    }
    if (obj.userData.player) {
      const part = obj.userData.part;
      hurtHero(damage * (part === 'head' ? headMult : 1), part === 'head', origin);
      return { hit: 'player', headshot: part === 'head', point: end };
    }
    return { hit: 'world', point: end };
  }
  const far = origin.clone().addScaledVector(dir, 60);
  drawStreak(origin, far);
  return { hit: null, point: far };
}

function hurtHero(amount, headshot, fromPos) {
  if (!hero.alive || match.phase !== 'live') return;
  let dealt = amount;
  if (hero.armor > 0) {
    const soaked = Math.min(hero.armor, dealt * 0.5);
    hero.armor -= soaked;
    dealt -= soaked;
  }
  hero.health -= dealt;
  audio.hurt();
  const p = heroBody.state.position;
  const angle = Math.atan2(fromPos.x - p.x, fromPos.z - p.z) - heroBody.state.yaw;
  hud.damageFlash((angle * 180) / Math.PI);
  hud.setHealth(hero.health, hero.armor);
  if (hero.health > 0) return;
  hero.health = 0;
  hero.alive = false;
  hero.deaths += 1;
  if (document.pointerLockElement) document.exitPointerLock();
  // Drop the bomb where the player fell; a teammate picks it up.
  if (bomb.state.carrier === 'player') {
    bomb.dropAt(p.x, p.z);
    const carrier = bots.dropBombCarrier();
    if (carrier) {
      bomb.pickUpByBot(carrier);
      const plant = SITES[carrier.lane === 0 ? 'A' : carrier.lane === 2 ? 'B' : 'A'].plant;
      bots.setRoute(carrier, plant[0], plant[1]);
    }
  }
  const mate = bots.bots.find((b) => b.alive && b.team === 'A');
  match.spectate = mate || null;
  maybeRoundEnd();
}

function heroShoot() {
  const def = arsenal.def();
  if (!arsenal.takeRound()) {
    audio.dryFire();
    return;
  }
  camera.getWorldDirection(aim);
  const spread = shot ? 0 : arsenal.spread(heroBody.groundSpeed());
  aim.x += (random() * 2 - 1) * spread;
  aim.y += (random() * 2 - 1) * spread;
  aim.z += (random() * 2 - 1) * spread;
  aim.normalize();
  const result = fireRay(camera.position, aim, def.damage, def.headMult, null, true);
  if (result.hit === 'bot') {
    audio.hit(result.killed);
    hud.hitMarker(result.killed, shot ? 4000 : 90);
    if (result.killed) {
      hero.kills += 1;
      hero.roundKills += 1;
      hero.money += KILL_PAY;
      hud.setMoney(hero.money);
      hud.killfeed('You', result.bot.name, result.headshot, 'A');
    }
  }
  arsenal.pullTrigger();
  heroBody.recoil(0.009 + random() * 0.004, (random() * 2 - 1) * 0.004);
  audio.shot(def.id, 0);
  bots.hearShot(heroBody.state.position, 'A');
  hud.setAmmo(arsenal.state.mag, arsenal.state.reserve, def.name);
}

function botFire(bot, origin, dir, damage, headMult) {
  const result = fireRay(origin, dir, damage, headMult, bot, false);
  const dist = origin.distanceTo(heroBody.state.position);
  audio.shot(bot.gun, dist);
  bots.hearShot(origin, bot.team);
  if (result.hit === 'player') {
    hud.killfeed(bot.name, 'You', result.headshot, bot.team);
  } else if (result.hit === 'bot') {
    hud.killfeed(bot.name, result.bot.name, result.headshot, bot.team);
  }
}

function onBotDown(attacker, victim, headshot) {
  // Credit the killer for the scoreboard and the round MVP.
  if (attacker && attacker !== 'player' && attacker.name) {
    attacker.kills += 1;
    attacker.roundKills += 1;
  }
  if (!victim.hasBomb) {
    maybeRoundEnd();
    return;
  }
  victim.hasBomb = false;
  bomb.dropAt(victim.body.state.position.x, victim.body.state.position.z);
  const carrier = bots.dropBombCarrier();
  if (carrier) {
    bomb.pickUpByBot(carrier);
    const plant = SITES[carrier.lane === 0 ? 'A' : carrier.lane === 2 ? 'B' : 'A'].plant;
    bots.setRoute(carrier, plant[0], plant[1]);
  }
  maybeRoundEnd();
}

function maybeRoundEnd() {
  if (match.phase !== 'live') return;
  const aliveA = (hero.alive ? 1 : 0) + bots.aliveCount('A');
  const aliveD = bots.aliveCount('D');
  if (aliveA === 0) closeRound('D', `${WARDENS} eliminated ${RAIDERS}`);
  else if (aliveD === 0) closeRound('A', bomb.state.planted ? 'Bomb detonated' : `${RAIDERS} eliminated ${WARDENS}`);
}

function roundMvp() {
  let best = null;
  let bestKills = 0;
  const contenders = [{ name: 'You', roundKills: hero.roundKills }].concat(bots.bots);
  for (let i = 0; i < contenders.length; i += 1) {
    const c = contenders[i];
    if (c.roundKills <= bestKills) continue;
    bestKills = c.roundKills;
    best = c;
  }
  if (!best || bestKills <= 0) return null;
  return `${best.name} — ${bestKills} kill${bestKills > 1 ? 's' : ''} this round`;
}

function closeRound(winner, reason) {
  if (match.phase !== 'live') return;
  match.phase = 'roundEnd';
  match.phaseTime = 0;
  match.roundWinner = winner;
  match.roundReason = reason;
  if (winner === 'A') {
    match.scoreA += 1;
    hero.money += WIN_PAY;
  } else {
    match.scoreD += 1;
    hero.money += LOSS_PAY;
  }
  hud.setScore(match.scoreA, match.scoreD);
  hud.setMoney(hero.money);
  const mvp = roundMvp();
  const title = winner === 'A' ? `${RAIDERS} win the round` : `${WARDENS} win the round`;
  const sub = mvp ? `${reason} · MVP: ${mvp}` : reason;
  hud.showBanner(title, sub, 3400);
  audio.round(winner === 'A');
  if (document.pointerLockElement) document.exitPointerLock();
}

function openRound() {
  match.phase = 'freeze';
  match.phaseTime = 0;
  hero.alive = true;
  hero.health = 100;
  hero.armor = 0;
  hero.roundKills = 0;
  hero.stepAcc = 0;
  heroBody.state.position.set((random() * 4 - 2), 0, 18);
  heroBody.state.velocity.set(0, 0, 0);
  heroBody.state.yaw = 0;
  heroBody.state.pitch = 0;
  arsenal.refill();
  grenades.clear();
  bomb.reset('player');
  bots.spawnAll(match.round);
  hud.setHealth(100, 0);
  hud.setAmmo(arsenal.state.mag, arsenal.state.reserve, arsenal.def().name);
  hud.setScore(match.scoreA, match.scoreD);
  hud.setRound(match.round, ROUND_CAP);
  hud.setMoney(hero.money);
  hud.setBombStatus('');
  hud.hideBanner();
  hud.setTeams(5, 5);
  match.spectate = null;
}

function openMatch() {
  match.round = 1;
  match.scoreA = 0;
  match.scoreD = 0;
  hero.money = 800;
  hero.kills = 0;
  hero.deaths = 0;
  hero.roundKills = 0;
  arsenal.state.owned = { pistol: true };
  arsenal.state.grenades = 0;
  arsenal.select('pistol');
  openRound();
}

const bots = createBots(scene, world, {
  fireWeapon: botFire,
  onKill: onBotDown,
  onPlant(bot, site) {
    bomb.plant(site, bot.body.state.position.x, bot.body.state.position.z);
    hud.setBombStatus(`Bomb planted at ${site} — 0:35`);
    hud.showBanner('Bomb planted', `${WARDENS} must defuse at site ${site}`, 3000);
    audio.plantDone();
  },
  onDefuse() {
    bomb.state.planted = false;
    closeRound('D', 'Bomb defused');
  },
  onFootstep(bot) {
    if (!hero.alive) return;
    const dist = bot.body.state.position.distanceTo(heroBody.state.position);
    if (dist < 18) audio.footstep(dist);
  },
});

const input = createInput(renderer.domElement, onLockChange);
hud.onPlay(() => {
  if (shot) return;
  if (match.phase === 'menu' || match.phase === 'matchEnd') {
    openMatch();
    input.requestLock();
  } else if (match.phase === 'roundEnd') {
    input.requestLock();
  }
});

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    audio.unlock();
    hud.hideOverlay();
  } else if (match.phase === 'menu') {
    hud.showOverlay('start', 0);
  } else if (match.phase === 'matchEnd') {
    hud.showOverlay('match', `${match.scoreA} — ${match.scoreD}`);
  } else if (match.phase !== 'roundEnd') {
    hud.showOverlay('paused', 0);
  }
}

const SHOP = [
  { id: 'smg', key: '1', name: 'Vixen SMG', desc: 'Fast, close quarters', price: 1500 },
  { id: 'rifle', key: '2', name: 'Cinder AR', desc: 'Accurate, all-round', price: 2700 },
  { id: 'sniper', key: '3', name: 'Longshot DMR', desc: 'One shot, long range', price: 4750 },
  { id: 'grenade', key: '4', name: 'HE Grenade', desc: 'Throw with G', price: GRENADE_PRICE },
  { id: 'armor', key: '5', name: 'Kevlar Vest', desc: '50 armor this round', price: VEST_PRICE },
];

function purchase(id) {
  const item = SHOP.find((i) => i.id === id);
  if (!item || match.phase !== 'freeze') return;
  if (item.id === 'grenade') {
    if (hero.money < GRENADE_PRICE || arsenal.state.grenades >= 2) {
      audio.denied();
      return;
    }
    hero.money -= GRENADE_PRICE;
    arsenal.addGrenade();
  } else if (item.id === 'armor') {
    if (hero.money < VEST_PRICE || hero.armor > 0) {
      audio.denied();
      return;
    }
    hero.money -= VEST_PRICE;
    hero.armor = VEST_POINTS;
    hud.setHealth(hero.health, hero.armor);
  } else {
    if (hero.money < item.price || arsenal.state.owned[item.id]) {
      audio.denied();
      return;
    }
    hero.money -= item.price;
    arsenal.buy(item.id);
    arsenal.select(item.id);
  }
  audio.buy();
  hud.setMoney(hero.money);
  hud.setAmmo(arsenal.state.mag, arsenal.state.reserve, arsenal.def().name);
  repaintShop();
}

function repaintShop() {
  const items = SHOP.map((item) => {
    let owned;
    if (item.id === 'armor') owned = hero.armor > 0;
    else if (item.id === 'grenade') owned = arsenal.state.grenades >= 2;
    else owned = !!arsenal.state.owned[item.id];
    return { ...item, owned };
  });
  hud.showBuyMenu(items, hero.money, purchase);
}

function clock(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function boardRows() {
  const rows = [{
    name: 'You', team: 'A', kills: hero.kills, deaths: hero.deaths, alive: hero.alive, you: true,
  }];
  for (let i = 0; i < bots.bots.length; i += 1) {
    const bot = bots.bots[i];
    rows.push({
      name: bot.name, team: bot.team, kills: bot.kills, deaths: bot.deaths, alive: bot.alive, you: false,
    });
  }
  rows.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  return rows;
}

let elapsed = 0;
let accumulator = 0;
let lastTime = performance.now();
let frozen = false;

function tick(dt) {
  elapsed += dt;
  match.time = elapsed;
  refreshViews();
  const keys = input.state.keys;

  // Phase timers.
  if (match.phase === 'freeze') {
    match.phaseTime += dt;
    if (match.phaseTime >= BUY_SECONDS) {
      match.phase = 'live';
      match.phaseTime = 0;
      hud.hideBuyMenu();
      hud.showBanner(`Round ${match.round}`, 'Plant the bomb at A or B', 2200);
    }
  } else if (match.phase === 'live') {
    match.phaseTime += dt;
    const left = ROUND_LEN - match.phaseTime;
    if (left <= 0 && !bomb.state.planted) {
      closeRound('D', 'Time expired — bomb never planted');
    }
  } else if (match.phase === 'roundEnd') {
    match.phaseTime += dt;
    if (match.phaseTime >= 4) {
      const done = match.scoreA >= ROUNDS_TO_WIN || match.scoreD >= ROUNDS_TO_WIN || match.round >= ROUND_CAP;
      if (done) {
        match.phase = 'matchEnd';
        hud.showOverlay('match', `${match.scoreA} — ${match.scoreD}`);
        if (document.pointerLockElement) document.exitPointerLock();
      } else {
        match.round += 1;
        openRound();
      }
    }
  }

  // Player movement (frozen during menu / round end / match end).
  const canMove = match.phase === 'freeze' || match.phase === 'live';
  if (hero.alive && canMove) {
    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    let wx = 0;
    let wz = 0;
    if (forward !== 0 || strafe !== 0) {
      const sin = Math.sin(heroBody.state.yaw);
      const cos = Math.cos(heroBody.state.yaw);
      wx = -sin * forward + cos * strafe;
      wz = -cos * forward - sin * strafe;
      const len = Math.hypot(wx, wz) || 1;
      wx /= len;
      wz /= len;
    }
    const crouch = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    heroBody.step(dt, wx, wz, crouch, keys.has('Space'));
    // Footsteps every 2.4 m on the ground, so movement has a sound.
    hero.stepAcc += heroBody.groundSpeed() * dt;
    if (hero.stepAcc > 2.4 && heroBody.state.onGround) {
      hero.stepAcc = 0;
      audio.footstep(0);
    }
  }

  // Weapon input.
  if (hero.alive && match.phase === 'live') {
    const def = arsenal.def();
    const trigger = def.auto ? input.state.firing : input.state.firing && arsenal.state.cooldown === 0;
    if (trigger && arsenal.ready()) heroShoot();
    if (keys.has('KeyR') && arsenal.reload()) audio.reload();
  }
  arsenal.step(dt);

  // Weapon slots and grenade.
  if (hero.alive && (match.phase === 'freeze' || match.phase === 'live')) {
    const slots = ['pistol', 'smg', 'rifle', 'sniper'];
    for (let i = 0; i < slots.length; i += 1) {
      const id = slots[i];
      if (!input.takePressed(`Digit${WEAPONS[id].slot}`)) continue;
      if (arsenal.select(id)) {
        hud.setAmmo(arsenal.state.mag, arsenal.state.reserve, arsenal.def().name);
        audio.reload();
      }
    }
    if (input.takePressed('KeyG') && arsenal.state.grenades > 0 && match.phase === 'live') {
      arsenal.state.grenades -= 1;
      camera.getWorldDirection(aim);
      scratch.copy(camera.position).addScaledVector(aim, 0.5);
      scratch.y -= 0.1;
      grenades.throw(scratch, aim);
      audio.shot('pistol', 0);
    }
  }

  // Buy menu.
  if (input.takePressed('KeyB') && match.phase === 'freeze') {
    if (hud.buyMenuOpen()) hud.hideBuyMenu();
    else repaintShop();
  }
  if (match.phase !== 'freeze' && hud.buyMenuOpen()) hud.hideBuyMenu();

  // Scoreboard while Tab is held.
  const inGame = match.phase === 'freeze' || match.phase === 'live' || match.phase === 'roundEnd';
  if (keys.has('Tab') && inGame) hud.showScoreboard(boardRows());
  else hud.hideScoreboard();

  // Bomb plant by the player (attackers plant).
  if (hero.alive && match.phase === 'live') {
    const site = world.siteAt(heroBody.state.position.x, heroBody.state.position.z);
    if (bomb.state.carrier === 'player' && site && !bomb.state.planted && keys.has('KeyE')) {
      bomb.state.plantProgress += dt;
      hud.showProgress(`Planting at site ${site}`, bomb.state.plantProgress / bomb.plantTime);
      if (bomb.state.plantProgress >= bomb.plantTime) {
        bomb.plant(site, heroBody.state.position.x, heroBody.state.position.z);
        hero.money += PLANT_PAY;
        hud.setMoney(hero.money);
        hud.setBombStatus(`Bomb planted at ${site} — 0:35`);
        hud.showBanner('Bomb planted', `Defend site ${site} until it detonates`, 3000);
        hud.hideProgress();
        audio.plantDone();
      }
    } else {
      bomb.state.plantProgress = 0;
      hud.hideProgress();
    }
  }

  // Bomb timer.
  const burst = bomb.step(dt, () => audio.beep(true));
  if (burst === 'explode') {
    audio.explosion(heroBody.state.position.distanceTo(bomb.state.position));
    closeRound('A', 'Bomb detonated');
  }
  if (bomb.state.planted) {
    hud.setBombStatus(`Bomb planted at ${bomb.state.site} — ${clock(bomb.state.timer)}`);
  }

  // Grenades.
  const bursts = grenades.step(dt);
  for (let i = 0; i < bursts.length; i += 1) {
    const pos = bursts[i];
    audio.explosion(heroBody.state.position.distanceTo(pos));
    const victims = [];
    if (hero.alive) victims.push({ pos: heroBody.state.position, eyeY: heroBody.eyeY(), isPlayer: true });
    for (let j = 0; j < bots.bots.length; j += 1) {
      const bot = bots.bots[j];
      if (bot.alive) victims.push({ pos: bot.body.state.position, eyeY: bot.body.eyeY(), bot });
    }
    for (let j = 0; j < victims.length; j += 1) {
      const t = victims[j];
      const d = Math.hypot(t.pos.x - pos.x, t.pos.z - pos.z);
      if (d >= grenades.radius()) continue;
      const behind = world.blocksLos(pos.x, pos.z, t.pos.x, t.pos.z);
      const dmg = grenades.maxDamage() * (1 - d / grenades.radius()) * (behind ? 0.5 : 1);
      if (t.isPlayer) hurtHero(dmg, false, pos);
      else if (t.bot) bots.damage(t.bot, dmg, 'torso', { pos });
    }
    // Screen shake for the player.
    if (hero.alive && heroBody.state.position.distanceTo(pos) < 20) {
      heroBody.recoil(0.03, (random() * 2 - 1) * 0.02);
    }
    maybeRoundEnd();
  }

  // Dropped bomb pickup by a teammate.
  if (bomb.state.carrier === null && !bomb.state.planted) {
    for (let i = 0; i < bots.bots.length; i += 1) {
      const bot = bots.bots[i];
      if (!bot.alive || bot.team !== 'A' || bot.hasBomb) continue;
      const p = bot.body.state.position;
      if (Math.hypot(p.x - bomb.state.position.x, p.z - bomb.state.position.z) >= 1.6) continue;
      bomb.pickUpByBot(bot);
      const plant = SITES[bot.lane === 0 ? 'A' : bot.lane === 2 ? 'B' : 'A'].plant;
      bots.setRoute(bot, plant[0], plant[1]);
      break;
    }
    const p = heroBody.state.position;
    if (hero.alive && Math.hypot(p.x - bomb.state.position.x, p.z - bomb.state.position.z) < 1.6) {
      bomb.pickUpByPlayer();
      hud.setBombStatus('');
    }
  }

  // Bots: attackers scan the defenders, defenders scan the attackers.
  bots.step(dt, elapsed, raiderView, wardenView, match);

  // Streaks fade.
  for (let i = 0; i < streaks.length; i += 1) {
    const streak = streaks[i];
    if (streak.left <= 0) continue;
    streak.left -= dt;
    if (streak.left <= 0) streak.line.visible = false;
  }

  // HUD readouts.
  let timerText;
  let timerHot = false;
  if (match.phase === 'freeze') timerText = `Buy — ${clock(BUY_SECONDS - match.phaseTime)}`;
  else if (match.phase === 'live') {
    timerText = bomb.state.planted ? clock(bomb.state.timer) : clock(ROUND_LEN - match.phaseTime);
    timerHot = ROUND_LEN - match.phaseTime < 15;
  } else if (match.phase === 'roundEnd') timerText = `ROUND ${match.round} OVER`;
  else timerText = 'EMBERWORKS';
  hud.setTimer(timerText, timerHot);
  hud.setTeams((hero.alive ? 1 : 0) + bots.aliveCount('A'), bots.aliveCount('D'));
  hud.setCrosshairSpread(shot ? 0 : arsenal.spread(heroBody.groundSpeed()));
  placeHitboxes();
  placeCamera();
}

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    if (hero.alive && (match.phase === 'freeze' || match.phase === 'live')) {
      heroBody.look(look.x, look.y);
    }
    accumulator += dt;
    let steps = 0;
    while (accumulator >= STEP && steps < 5) {
      tick(STEP);
      accumulator -= STEP;
      steps += 1;
    }
    if (accumulator > STEP * 5) accumulator = 0;
  }
  renderer.render(scene, camera);
}

function advance(steps) {
  for (let i = 0; i < steps; i += 1) tick(STEP);
}

function capture(name) {
  hud.hideOverlay();
  hud.hideBuyMenu();
  openMatch();
  if (name === 'start') {
    heroBody.state.position.set(0.6, 0, 17);
    heroBody.state.yaw = 0;
    heroBody.state.pitch = 0;
    advance(20);
    hud.showOverlay('start', 0);
  } else if (name === 'play') {
    // Mid-round: player at mid aiming at a defender, one kill already scored.
    match.phase = 'live';
    match.phaseTime = 12;
    heroBody.state.position.set(0, 0, 8);
    heroBody.state.yaw = 0;
    heroBody.state.pitch = 0.02;
    advance(90);
    const target = bots.bots.find((b) => b.alive && b.team === 'D');
    if (target) {
      const p = heroBody.state.position;
      const tp = target.body.state.position;
      heroBody.state.yaw = Math.atan2(-(tp.x - p.x), -(tp.z - p.z));
      // Aim at the head: a headshot drops the bot and the kill feed tells the
      // story. (No render has run yet in shot mode, so the hitboxes still sit
      // at the origin in their world matrices — refresh them first, or the
      // ray passes through the bot.)
      heroBody.state.pitch = Math.atan2(
        (tp.y + 1.53) - heroBody.eyeY(),
        Math.hypot(tp.x - p.x, tp.z - p.z),
      );
      placeCamera();
      scene.updateMatrixWorld(true);
      heroShoot();
      advance(6);
    }
    hero.kills = 1;
    hero.money = 1100;
    hud.setMoney(1100);
  } else if (name === 'bomb') {
    // Planting at site A: progress bar up, defenders visible down the lane.
    match.phase = 'live';
    match.phaseTime = 40;
    heroBody.state.position.set(-21, 0, -12);
    heroBody.state.yaw = Math.PI;
    heroBody.state.pitch = -0.05;
    advance(120);
    bomb.state.plantProgress = 1.8;
    hud.showProgress('Planting at site A', 0.6);
    hud.setBombStatus('Plant the bomb at A');
  } else {
    // Round won: banner up, score 1-0, bomb timer gone.
    match.phase = 'roundEnd';
    match.phaseTime = 1;
    match.scoreA = 1;
    match.roundReason = `${WARDENS} eliminated`;
    heroBody.state.position.set(-8, 0, -4);
    heroBody.state.yaw = -0.6;
    advance(30);
    hud.setScore(1, 0);
    hud.showBanner(`${RAIDERS} win the round`, `${WARDENS} eliminated`, 4000);
  }
  hud.setAmmo(arsenal.state.mag, arsenal.state.reserve, arsenal.def().name);
  hud.setHealth(hero.health, hero.armor);
  hud.setScore(match.scoreA, match.scoreD);
  hud.setRound(match.round, ROUND_CAP);
  hud.setTeams((hero.alive ? 1 : 0) + bots.aliveCount('A'), bots.aliveCount('D'));
  renderTwice();
}

function renderTwice() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    placeCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

hud.setAmmo(arsenal.state.mag, arsenal.state.reserve, arsenal.def().name);
hud.setHealth(100, 0);
hud.setMoney(800);
hud.setScore(0, 0);
hud.setRound(1, ROUND_CAP);
hud.setTeams(5, 5);
hud.setTimer('EMBERWORKS', false);
placeCamera();
if (shot) capture(shot);
else requestAnimationFrame(loop);
