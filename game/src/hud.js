// The DOM HUD: crosshair, hit marker, health, ammo, money, timer, score,
// team dots, kill feed, banners, the buy menu, the plant bar and the Tab
// scoreboard. It never touches the simulation; the game pushes numbers in
// and reads callbacks out.
import { PALETTE } from './palette.js';

const TEXTS = {
  start: {
    title: 'EMBERWORKS',
    copy: 'Five on five at a foundry yard on the night shift. Plant the bomb at A or B, or eliminate the Nightwatch. Click to play.',
    action: 'Click to play',
  },
  paused: {
    title: 'EMBERWORKS',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
  match: {
    title: 'Match over',
    copy: 'The foundry goes quiet.',
    action: 'Play again',
  },
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const overlayTitle = $('overlay-title');
  const overlayCopy = $('overlay-copy');
  const playBtn = $('play');
  const magEl = $('ammo-mag');
  const reserveEl = $('ammo-reserve');
  const weaponEl = $('weapon-name');
  const ammoBox = $('ammo');
  const hpFill = $('health-fill');
  const hpNum = $('health-num');
  const armorNum = $('armor-num');
  const moneyNum = $('money-num');
  const timerNum = $('timer-num');
  const scoreA = $('score-a');
  const scoreD = $('score-d');
  const roundNum = $('round-num');
  const dotsA = $('team-a');
  const dotsD = $('team-d');
  const feed = $('killfeed');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const buyMenu = $('buy-menu');
  const buyItems = $('buy-items');
  const buyMoney = $('buy-money');
  const progress = $('progress');
  const progressFill = $('progress-fill');
  const progressLabel = $('progress-label');
  const crosshair = $('crosshair');
  const hitmarker = $('hitmarker');
  const vignette = $('vignette');
  const damageDir = $('damage-dir');
  const bombStatus = $('bomb-status');
  const board = $('scoreboard');
  const boardRows = $('score-rows');
  let hitTimer = 0;
  let bannerTimer = 0;
  let seenAmmo = '';
  let seenHealth = -1;
  let seenMoney = -1;
  let seenTimer = '';
  let seenScore = '';
  let seenRound = '';

  function paintDots(box, alive, total, color) {
    let html = '';
    for (let i = 0; i < total; i += 1) {
      const on = i < alive;
      html += `<i style="background:${on ? color : 'transparent'};border-color:${color}"></i>`;
    }
    box.innerHTML = html;
  }

  return {
    setAmmo(mag, reserve, name) {
      const key = `${mag}/${reserve}/${name}`;
      if (key === seenAmmo) return;
      seenAmmo = key;
      magEl.textContent = String(mag);
      reserveEl.textContent = `/ ${reserve}`;
      weaponEl.textContent = name;
      ammoBox.classList.toggle('empty', mag === 0);
    },
    setHealth(health, armor) {
      if (health === seenHealth) return;
      seenHealth = health;
      const hp = Math.max(0, health);
      hpFill.style.width = `${hp}%`;
      hpFill.style.background = health > 50 ? PALETTE.money : health > 25 ? PALETTE.accent : PALETTE.danger;
      hpNum.textContent = String(Math.max(0, Math.ceil(health)));
      armorNum.textContent = armor > 0 ? `⛨ ${Math.ceil(armor)}` : '';
    },
    setMoney(value) {
      if (value === seenMoney) return;
      seenMoney = value;
      moneyNum.textContent = `$${value}`;
      buyMoney.textContent = `$${value}`;
    },
    setTimer(text, danger) {
      if (text === seenTimer) return;
      seenTimer = text;
      timerNum.textContent = text;
      timerNum.classList.toggle('danger', !!danger);
    },
    setScore(a, d) {
      const key = `${a}-${d}`;
      if (key === seenScore) return;
      seenScore = key;
      scoreA.textContent = String(a);
      scoreD.textContent = String(d);
    },
    setRound(round, maxRounds) {
      const key = `${round}/${maxRounds}`;
      if (key === seenRound) return;
      seenRound = key;
      roundNum.textContent = `ROUND ${round} / ${maxRounds}`;
    },
    setTeams(aliveA, aliveD) {
      paintDots(dotsA, aliveA, 5, PALETTE.attacker);
      paintDots(dotsD, aliveD, 5, PALETTE.defender);
    },
    setBombStatus(text) {
      bombStatus.textContent = text;
      bombStatus.hidden = !text;
    },
    setCrosshairSpread(spread) {
      crosshair.style.setProperty('--gap', `${4 + spread * 260}px`);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      if (killed) hitmarker.style.transform = 'translate(-50%, -50%) rotate(45deg) scale(1.25)';
      else hitmarker.style.transform = '';
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => {
        hitmarker.classList.remove('on');
        hitmarker.style.transform = '';
      }, holdMs);
    },
    damageFlash(angleDeg) {
      vignette.classList.add('on');
      setTimeout(() => vignette.classList.remove('on'), 220);
      if (angleDeg == null) return;
      damageDir.style.transform = `translate(-50%, -50%) rotate(${angleDeg}deg)`;
      damageDir.classList.add('on');
      setTimeout(() => damageDir.classList.remove('on'), 700);
    },
    killfeed(killer, victim, headshot, killerTeam) {
      const row = document.createElement('div');
      row.className = 'feed-row';
      const color = killerTeam === 'A' ? PALETTE.attacker : PALETTE.defender;
      row.innerHTML = `<span style="color:${color}">${killer}</span> ${headshot ? '◉' : '✕'} <span>${victim}</span>`;
      feed.prepend(row);
      while (feed.children.length > 5) feed.removeChild(feed.lastChild);
      setTimeout(() => row.remove(), 6000);
    },
    showBanner(titleText, sub, ms = 2600) {
      bannerTitle.textContent = titleText;
      bannerSub.textContent = sub;
      banner.hidden = false;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => {
        banner.hidden = true;
      }, ms);
    },
    hideBanner() {
      banner.hidden = true;
    },
    showProgress(label, fraction) {
      progress.hidden = false;
      progressLabel.textContent = label;
      progressFill.style.width = `${Math.round(fraction * 100)}%`;
    },
    hideProgress() {
      progress.hidden = true;
    },
    showBuyMenu(items, money, onBuy) {
      buyMenu.hidden = false;
      buyMoney.textContent = `$${money}`;
      buyItems.innerHTML = '';
      for (const item of items) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'buy-row';
        row.disabled = item.owned || money < item.price;
        const price = item.owned ? 'OWNED' : '$' + item.price;
        row.innerHTML = `<span class="buy-key">${item.key}</span><span class="buy-name">${item.name}</span><span class="buy-desc">${item.desc}</span><span class="buy-price">${price}</span>`;
        row.addEventListener('click', () => onBuy(item.id));
        buyItems.appendChild(row);
      }
    },
    hideBuyMenu() {
      buyMenu.hidden = true;
    },
    buyMenuOpen() {
      return !buyMenu.hidden;
    },
    // The scoreboard lists every combatant with kills and deaths, attackers
    // in amber, defenders in teal. The game rebuilds it while Tab is held.
    showScoreboard(rows) {
      board.hidden = false;
      let html = '';
      for (const row of rows) {
        const color = row.team === 'A' ? PALETTE.attacker : PALETTE.defender;
        const dim = row.alive ? 1 : 0.45;
        const who = row.you ? `${row.name} (You)` : row.name;
        html += `<div class="score-row" style="opacity:${dim}">`
          + `<span style="color:${color}">${who}</span>`
          + `<span>${row.kills} K</span><span>${row.deaths} D</span></div>`;
      }
      boardRows.innerHTML = html;
    },
    hideScoreboard() {
      board.hidden = true;
    },
    showOverlay(mode, score) {
      const text = TEXTS[mode];
      overlayTitle.textContent = text.title;
      overlayCopy.textContent = mode === 'match' ? `${text.copy} Final score ${score}.` : text.copy;
      playBtn.textContent = text.action;
      overlay.hidden = false;
      playBtn.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      playBtn.addEventListener('click', handler);
    },
  };
}
