// The bots: nine soldiers, five a side, each with one job. They walk the
// waypoint graph (BFS routes, never straight lines), hold angles, and react
// to what they see and hear. A bot spots an enemy only with line of sight
// inside its view cone, waits out a reaction delay, then fires in bursts
// with an aim error that grows with distance and target speed — so stopping
// to aim pays, for them too. While engaging they strafe, so a standing
// target is not a free one. Attackers push a lane and plant; defenders hold
// sites and retake to defuse.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createBody } from './physics.js';
import { WAYPOINTS, findRoute, SITES } from './world.js';

const FULL_HP = 100;
const PACE = 4.3;
const LOOK_EVERY = 0.15;
const VIEW_RANGE = 42;
const VIEW_COS = 0.5;
const BURST_LO = 3;
const BURST_HI = 5;
const SHOT_GAP = 0.11;
const HIT_DAMAGE = 26;
const SKULL_MULT = 4;
const STRAFE_PACE = 1.4;

const RAIDERS = ['Rowan', 'Sable', 'Tariq', 'Voss'];
const WARDENS = ['Mira', 'Noor', 'Oskar', 'Petra', 'Quinn'];

function rng32(seed) {
  let a = seed;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createBots(scene, world, hooks) {
  const bots = [];
  const hitMeshes = [];
  const sight = new THREE.Raycaster();
  sight.far = 120;
  const dir = new THREE.Vector3();
  const spot = new THREE.Vector3();

  const torsoGeo = new THREE.BoxGeometry(0.52, 0.78, 0.3);
  const headGeo = new THREE.SphereGeometry(0.155, 12, 10);
  const legGeo = new THREE.BoxGeometry(0.2, 0.62, 0.22);
  const gunGeo = new THREE.BoxGeometry(0.07, 0.09, 0.55);
  const bandGeo = new THREE.BoxGeometry(0.54, 0.1, 0.32);

  function assemble(team, name, x, z, skill, seed) {
    const color = team === 'A' ? PALETTE.attacker : PALETTE.defender;
    const cloth = new THREE.MeshStandardMaterial({ color: new THREE.Color('#3a4048'), roughness: 0.7, metalness: 0.1 });
    const teamMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.5, metalness: 0.1 });
    const skinMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#c9a184'), roughness: 0.8 });

    const group = new THREE.Group();
    const torso = new THREE.Mesh(torsoGeo, cloth);
    torso.position.y = 1.0;
    const head = new THREE.Mesh(headGeo, skinMat);
    head.position.y = 1.53;
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), teamMat);
    helmet.position.y = 1.55;
    const band = new THREE.Mesh(bandGeo, teamMat);
    band.position.y = 1.28;
    const legL = new THREE.Mesh(legGeo, cloth);
    legL.position.set(-0.13, 0.31, 0);
    const legR = new THREE.Mesh(legGeo, cloth);
    legR.position.set(0.13, 0.31, 0);
    const gun = new THREE.Mesh(gunGeo, teamMat);
    gun.position.set(0.2, 1.05, -0.3);
    group.add(torso, head, helmet, band, legL, legR, gun);
    group.traverse((mesh) => {
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    scene.add(group);

    const body = createBody(world.colliders, x, z, PACE, 2.2);
    const bot = {
      id: bots.length, team, name, body, group, torso, head,
      health: FULL_HP, armor: 0, alive: true, skill, random: rng32(seed),
      state: 'advance', route: [], routeIndex: 0, holdNode: -1,
      target: null, reactionAt: 0, burstLeft: 0, burstPause: 0, cooldown: 0,
      nextScan: 0, aimError: 0, hasBomb: false, actionProgress: 0, action: null,
      fall: 0, walkPhase: 0, kills: 0, deaths: 0, roundKills: 0,
      gun: 'rifle', strafeDir: 1, strafeAt: 0, stepAcc: 0,
    };
    torso.userData.bot = bot;
    torso.userData.part = 'torso';
    head.userData.bot = bot;
    head.userData.part = 'head';
    hitMeshes.push(torso, head);
    bots.push(bot);
    return bot;
  }

  function spawnAll(round) {
    for (let i = 0; i < bots.length; i += 1) scene.remove(bots[i].group);
    bots.length = 0;
    hitMeshes.length = 0;
    const shuffle = rng32(1000 + round * 77);
    // Attackers: four bots, lanes A / mid / B spread by a shuffle.
    const lanes = [1, 0, 2, 1].sort(() => shuffle() - 0.5);
    const destForLane = { 0: 5, 1: 10, 2: 16 }; // plant node per lane: A, mid, B
    for (let i = 0; i < 4; i += 1) {
      const bot = assemble('A', RAIDERS[i], -4.5 + i * 3, 18 + (i % 2) * 1.5, 0.35 + shuffle() * 0.4, 2000 + i * 13 + round);
      bot.lane = lanes[i];
      bot.destNode = destForLane[lanes[i]];
      bot.route = findRoute(bot.body.state.position.x, bot.body.state.position.z, WAYPOINTS[bot.destNode][0], WAYPOINTS[bot.destNode][1]);
      bot.routeIndex = 0;
      bot.gun = i % 2 === 0 ? 'rifle' : 'smg';
    }
    // Defenders: two to A, two to B, one mid.
    const posts = [20, 21, 22, 6, 17];
    for (let i = 0; i < 5; i += 1) {
      const bot = assemble('D', WARDENS[i], -6 + i * 3, -18 + (i % 2) * 1.5, 0.35 + shuffle() * 0.4, 3000 + i * 17 + round);
      bot.holdNode = posts[i];
      bot.route = findRoute(bot.body.state.position.x, bot.body.state.position.z, WAYPOINTS[bot.holdNode][0], WAYPOINTS[bot.holdNode][1]);
      bot.routeIndex = 0;
      bot.gun = i % 3 === 0 ? 'smg' : 'rifle';
    }
  }

  function nearestNode(x, z) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < WAYPOINTS.length; i += 1) {
      const d = (WAYPOINTS[i][0] - x) ** 2 + (WAYPOINTS[i][1] - z) ** 2;
      if (d >= bestD) continue;
      bestD = d;
      best = i;
    }
    return best;
  }

  function sees(bot, enemyPos, enemyEyeY) {
    const p = bot.body.state.position;
    const dx = enemyPos.x - p.x;
    const dz = enemyPos.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist > VIEW_RANGE) return false;
    const fx = -Math.sin(bot.body.state.yaw);
    const fz = -Math.cos(bot.body.state.yaw);
    if ((dx * fx + dz * fz) / (dist || 1) < VIEW_COS) return false;
    return !world.blocksLos(p.x, p.z, enemyPos.x, enemyPos.z);
  }

  function lookAround(bot, time, enemies) {
    bot.nextScan = time + LOOK_EVERY;
    let best = null;
    let bestDist = Infinity;
    for (let i = 0; i < enemies.length; i += 1) {
      const enemy = enemies[i];
      if (!enemy.alive) continue;
      const p = bot.body.state.position;
      const dist = Math.hypot(enemy.pos.x - p.x, enemy.pos.z - p.z);
      if (dist >= bestDist) continue;
      if (!sees(bot, enemy.pos, enemy.eyeY)) continue;
      best = enemy;
      bestDist = dist;
    }
    if (best && best !== bot.target) {
      bot.target = best;
      bot.reactionAt = time + 0.25 + bot.random() * 0.35 * (1 - bot.skill * 0.5);
      bot.burstLeft = 0;
      bot.burstPause = 0;
    } else if (!best) {
      bot.target = null;
    }
  }

  function wrapAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  function track(bot, dt, target) {
    const p = bot.body.state.position;
    const dx = target.pos.x - p.x;
    const dy = target.eyeY - (p.y + bot.body.state.eye);
    const dz = target.pos.z - p.z;
    const dist = Math.hypot(dx, dy, dz) || 1;
    const wantYaw = Math.atan2(-dx, -dz);
    const wantPitch = Math.asin(Math.max(-1, Math.min(1, dy / dist)));
    const turn = Math.min(1, dt * 7);
    bot.body.state.yaw += wrapAngle(wantYaw - bot.body.state.yaw) * turn;
    bot.body.state.pitch += (wantPitch - bot.body.state.pitch) * turn;
  }

  function shoot(bot, target) {
    const p = bot.body.state.position;
    const error = 0.012 + target.dist * 0.0009 + target.speed * 0.004 + bot.random() * 0.008;
    bot.body.state.yaw += (bot.random() * 2 - 1) * error;
    bot.body.state.pitch += (bot.random() * 2 - 1) * error * 0.6;
    dir.set(-Math.sin(bot.body.state.yaw), 0, -Math.cos(bot.body.state.yaw));
    dir.y = Math.tan(bot.body.state.pitch);
    dir.normalize();
    const origin = new THREE.Vector3(p.x, p.y + bot.body.state.eye, p.z);
    hooks.fireWeapon(bot, origin, dir, HIT_DAMAGE, SKULL_MULT, target);
  }

  function strideTo(bot, dt, tx, tz) {
    const p = bot.body.state.position;
    const dx = tx - p.x;
    const dz = tz - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.6) return true;
    const wantYaw = Math.atan2(-dx, -dz);
    bot.body.state.yaw += wrapAngle(wantYaw - bot.body.state.yaw) * Math.min(1, dt * 5);
    bot.body.step(dt, dx / dist, dz / dist, false, false);
    bot.walkPhase += dt * 9;
    return false;
  }

  // Footsteps: every 2.4 m a bot walks, tell the game so it can play a quiet
  // thud when the bot is near the player.
  function noteStep(bot, dt) {
    bot.stepAcc += bot.body.groundSpeed() * dt;
    if (bot.stepAcc <= 2.4) return;
    bot.stepAcc = 0;
    if (hooks.onFootstep) hooks.onFootstep(bot);
  }

  function setRoute(bot, tx, tz) {
    const p = bot.body.state.position;
    bot.route = findRoute(p.x, p.z, tx, tz);
    bot.routeIndex = 0;
  }

  function syncGroup(bot) {
    const st = bot.body.state;
    bot.group.position.set(st.position.x, st.position.y, st.position.z);
    bot.group.rotation.set(0, st.yaw, 0);
  }

  function tickBot(bot, dt, time, enemies, game) {
    const st = bot.body.state;
    if (!bot.alive) {
      bot.fall = Math.min(1, bot.fall + dt / 0.4);
      bot.group.rotation.x = -bot.fall * 1.45;
      return;
    }
    if (time >= bot.nextScan) lookAround(bot, time, enemies);
    bot.cooldown = Math.max(0, bot.cooldown - dt);

    // The bomb carrier plants once it reaches its plant spot and the site
    // looks clear.
    if (bot.hasBomb && bot.team === 'A' && !bot.target && game.phase === 'live' && !game.bomb.planted) {
      const site = world.siteAt(st.position.x, st.position.z);
      if (site) {
        bot.action = 'plant';
        bot.actionProgress += dt;
        if (bot.actionProgress >= 3) {
          bot.action = null;
          bot.actionProgress = 0;
          hooks.onPlant(bot, site);
        }
        syncGroup(bot);
        return;
      }
    }
    // A defender retakes to defuse once the bomb is down.
    if (bot.team === 'D' && game.bomb.planted && game.phase === 'live') {
      const bp = game.bomb.position;
      const dist = Math.hypot(bp.x - st.position.x, bp.z - st.position.z);
      if (dist < 1.6 && !bot.target) {
        bot.action = 'defuse';
        bot.actionProgress += dt;
        if (bot.actionProgress >= 5) {
          bot.action = null;
          bot.actionProgress = 0;
          hooks.onDefuse(bot);
        }
        syncGroup(bot);
        return;
      }
      if (bot.state !== 'retake') {
        bot.state = 'retake';
        setRoute(bot, bp.x, bp.z);
      }
    }
    bot.action = null;
    bot.actionProgress = 0;

    if (bot.target && time >= bot.reactionAt) {
      // Engage: stand, aim, strafe sideways, fire in bursts, then pause.
      const target = bot.target;
      target.dist = Math.hypot(target.pos.x - st.position.x, target.pos.z - st.position.z);
      track(bot, dt, target);
      if (time >= bot.strafeAt) {
        bot.strafeDir = bot.random() < 0.5 ? -1 : 1;
        bot.strafeAt = time + 0.7 + bot.random() * 0.7;
      }
      const sideX = Math.cos(st.yaw) * bot.strafeDir;
      const sideZ = -Math.sin(st.yaw) * bot.strafeDir;
      const ratio = STRAFE_PACE / PACE;
      bot.body.step(dt, sideX * ratio, sideZ * ratio, false, false);
      bot.walkPhase += dt * 7;
      noteStep(bot, dt);
      if (bot.burstLeft > 0) {
        if (bot.cooldown === 0) {
          shoot(bot, target);
          bot.burstLeft -= 1;
          bot.cooldown = SHOT_GAP;
          if (bot.burstLeft === 0) bot.burstPause = 0.4 + bot.random() * 0.5;
        }
      } else if (bot.burstPause > 0) {
        bot.burstPause -= dt;
      } else {
        bot.burstLeft = BURST_LO + Math.floor(bot.random() * (BURST_HI - BURST_LO + 1));
      }
      syncGroup(bot);
      return;
    }

    // No target: walk the route, or hold the assigned angle.
    if (bot.state === 'retake' || bot.routeIndex < bot.route.length) {
      const node = WAYPOINTS[bot.route[bot.routeIndex]];
      if (strideTo(bot, dt, node[0], node[1])) {
        bot.routeIndex += 1;
        if (bot.routeIndex >= bot.route.length) {
          bot.state = bot.team === 'D' ? 'hold' : 'advance';
          if (bot.team === 'D') bot.holdYaw = Math.atan2(-(0 - st.position.x), -(-14 - st.position.z));
        }
      }
      noteStep(bot, dt);
    } else if (bot.state === 'hold') {
      if (bot.holdYaw != null) {
        st.yaw += wrapAngle(bot.holdYaw - st.yaw) * Math.min(1, dt * 2);
      }
    } else if (bot.team === 'A' && bot.state === 'advance') {
      // Reached the site: hold the plant spot and watch the approaches.
      bot.state = 'hold';
      bot.holdYaw = Math.atan2(-(0 - st.position.x), -(18 - st.position.z));
    }
    syncGroup(bot);
    // Walk-cycle legs, cheap and readable at a glance.
    const swing = bot.body.groundSpeed() > 0.5 ? Math.sin(bot.walkPhase) * 0.35 : 0;
    bot.group.children[4].rotation.x = swing;
    bot.group.children[5].rotation.x = -swing;
  }

  function damage(bot, amount, part, attacker) {
    if (!bot.alive) return false;
    let dealt = amount;
    if (bot.armor > 0) {
      const absorbed = Math.min(bot.armor, dealt * 0.5);
      bot.armor -= absorbed;
      dealt -= absorbed;
    }
    bot.health -= dealt;
    if (bot.health <= 0) {
      bot.alive = false;
      bot.health = 0;
      bot.fall = 0;
      bot.deaths += 1;
      hooks.onKill(attacker, bot, part === 'head');
      return true;
    }
    // Being shot turns the bot toward the shooter: it heard the shot.
    if (attacker && attacker.pos) {
      const st = bot.body.state;
      st.yaw = Math.atan2(-(attacker.pos.x - st.position.x), -(attacker.pos.z - st.position.z));
      bot.target = null;
      bot.nextScan = 0;
    }
    return false;
  }

  function hearShot(pos, team) {
    // A shot heard nearby makes a bot re-scan at once: it turns toward the
    // sound sooner than its next scheduled scan.
    for (let i = 0; i < bots.length; i += 1) {
      const bot = bots[i];
      if (!bot.alive || bot.team === team || bot.target) continue;
      const p = bot.body.state.position;
      if (Math.hypot(pos.x - p.x, pos.z - p.z) < 25) bot.nextScan = 0;
    }
  }

  function aliveCount(team) {
    let n = 0;
    for (let i = 0; i < bots.length; i += 1) {
      if (bots[i].alive && bots[i].team === team) n += 1;
    }
    return n;
  }

  function dropBombCarrier() {
    for (let i = 0; i < bots.length; i += 1) {
      const bot = bots[i];
      if (bot.hasBomb && bot.alive && bot.team === 'A') return bot;
    }
    return null;
  }

  return {
    bots,
    hitMeshes,
    spawnAll,
    damage,
    hearShot,
    aliveCount,
    dropBombCarrier,
    step(dt, time, attackersView, defendersView, game) {
      for (let i = 0; i < bots.length; i += 1) {
        const bot = bots[i];
        const foes = bot.team === 'A' ? defendersView : attackersView;
        tickBot(bot, dt, time, foes, game);
      }
    },
    reset() {
      for (let i = 0; i < bots.length; i += 1) {
        const bot = bots[i];
        bot.health = FULL_HP;
        bot.armor = 0;
        bot.alive = true;
        bot.fall = 0;
        bot.target = null;
        bot.action = null;
        bot.actionProgress = 0;
        bot.group.rotation.set(0, 0, 0);
      }
    },
    aimPoint(bot) {
      spot.set(bot.body.state.position.x, bot.body.state.position.y + 1.0, bot.body.state.position.z);
      return spot;
    },
    setRoute,
    nearestNode,
  };
}
