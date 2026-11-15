// The armoury: four guns and a grenade. Every gun owns its numbers — damage,
// headshot multiplier, fire gap, magazine, reload, spread — and the view
// model the player sees. The game owns the ray and the damage; this module
// owns the weapon. Grenades live here too: an arcing projectile that bounces
// once and bursts after its fuse.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', slot: 1, name: 'P9 Kestrel', price: 0, damage: 34, headMult: 4,
    fireGap: 0.16, auto: false, magSize: 12, reserve: 36, reloadTime: 1.4,
    spreadStill: 0.003, spreadMoving: 0.02, range: 60,
  },
  smg: {
    id: 'smg', slot: 2, name: 'Vixen SMG', price: 1500, damage: 25, headMult: 4,
    fireGap: 0.075, auto: true, magSize: 25, reserve: 100, reloadTime: 2.0,
    spreadStill: 0.006, spreadMoving: 0.03, range: 45,
  },
  rifle: {
    id: 'rifle', slot: 3, name: 'Cinder AR', price: 2700, damage: 32, headMult: 4,
    fireGap: 0.096, auto: true, magSize: 30, reserve: 90, reloadTime: 2.2,
    spreadStill: 0.0022, spreadMoving: 0.028, range: 80,
  },
  sniper: {
    id: 'sniper', slot: 4, name: 'Longshot DMR', price: 4750, damage: 115, headMult: 4,
    fireGap: 1.25, auto: false, magSize: 5, reserve: 15, reloadTime: 2.8,
    spreadStill: 0.0008, spreadMoving: 0.05, range: 120,
  },
};
export const GRENADE_PRICE = 300;
const FUSE = 1.6;
const BLAST_RADIUS = 5.5;
const BLAST_DAMAGE = 120;

export function createArsenal(camera) {
  const gripMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#20242a'), roughness: 0.6, metalness: 0.3 });

  const rig = new THREE.Group();
  rig.position.set(0.24, -0.2, -0.42);
  camera.add(rig);

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.18, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  const state = {
    current: 'pistol', owned: { pistol: true }, mag: 12, reserve: 36,
    cooldown: 0, reloadLeft: 0, flash: 0, kick: 0, grenades: 0,
  };

  function barrelLength(id) {
    if (id === 'pistol') return 0.22;
    if (id === 'smg') return 0.4;
    if (id === 'sniper') return 0.72;
    return 0.5;
  }

  function rebuildModel() {
    while (rig.children.length) rig.remove(rig.children[0]);
    const def = WEAPONS[state.current];
    const len = barrelLength(def.id);
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, len), bodyMat);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, len * 0.7), gripMat);
    barrel.position.set(0, 0.03, -len * 0.6);
    rig.add(receiver, barrel);
    if (def.id === 'sniper') {
      const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.16, 10), darkMat);
      scope.rotation.x = Math.PI / 2;
      scope.position.set(0, 0.09, -0.05);
      rig.add(scope);
    }
    if (def.id === 'smg' || def.id === 'rifle') {
      const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.08), darkMat);
      mag.position.set(0, -0.11, 0.02);
      rig.add(mag);
    }
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.2), gripMat);
    stock.position.set(0, -0.02, len / 2 + 0.06);
    rig.add(stock);
  }
  rebuildModel();

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    rig.position.z = -0.42 + state.kick;
    rig.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    const def = WEAPONS[state.current];
    if (state.reloadLeft <= 0) return;
    state.reloadLeft = Math.max(0, state.reloadLeft - dt);
    rig.rotation.x = -0.55 * Math.min(1, (def.reloadTime - state.reloadLeft) * 2);
    if (state.reloadLeft !== 0) return;
    const need = def.magSize - state.mag;
    const take = Math.min(need, state.reserve);
    state.mag += take;
    state.reserve -= take;
  }

  return {
    state,
    def() {
      return WEAPONS[state.current];
    },
    step,
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      state.cooldown = WEAPONS[state.current].fireGap;
      state.flash = 0.06;
      state.kick = 0.055;
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    reload() {
      const def = WEAPONS[state.current];
      if (state.reloadLeft > 0 || state.mag === def.magSize || state.reserve === 0) return false;
      state.reloadLeft = def.reloadTime;
      return true;
    },
    spread(speed) {
      const def = WEAPONS[state.current];
      const moving = Math.min(1, speed / 5.2);
      return def.spreadStill + moving * def.spreadMoving;
    },
    select(id) {
      if (!state.owned[id] || state.current === id) return false;
      state.current = id;
      const def = WEAPONS[id];
      state.mag = def.magSize;
      state.reserve = def.reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      rebuildModel();
      return true;
    },
    buy(id) {
      if (state.owned[id]) return false;
      state.owned[id] = true;
      return true;
    },
    refill() {
      const def = WEAPONS[state.current];
      state.mag = def.magSize;
      state.reserve = def.reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
    },
    addGrenade() {
      state.grenades += 1;
    },
  };
}

export function createGrenades(scene, colliders) {
  const live = [];
  const geometry = new THREE.SphereGeometry(0.09, 10, 8);
  const material = new THREE.MeshStandardMaterial({ color: new THREE.Color('#2a2f36'), roughness: 0.5, metalness: 0.6 });
  const probe = new THREE.Box3();

  function blockedAt(x, y, z) {
    probe.min.set(x - 0.09, y - 0.09, z - 0.09);
    probe.max.set(x + 0.09, y + 0.09, z + 0.09);
    for (let i = 0; i < colliders.length; i += 1) {
      if (probe.intersectsBox(colliders[i])) return true;
    }
    return false;
  }

  return {
    list: live,
    throw(origin, direction) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(origin);
      mesh.castShadow = true;
      scene.add(mesh);
      live.push({
        mesh,
        velocity: direction.clone().multiplyScalar(16).add(new THREE.Vector3(0, 4.5, 0)),
        fuse: FUSE,
        bounced: false,
      });
    },
    // Steps every live grenade; returns the positions of the ones that burst.
    step(dt) {
      const bursts = [];
      for (let i = live.length - 1; i >= 0; i -= 1) {
        const g = live[i];
        g.fuse -= dt;
        g.velocity.y -= 18 * dt;
        const next = g.mesh.position.clone().addScaledVector(g.velocity, dt);
        if (blockedAt(next.x, next.y, next.z)) {
          if (!g.bounced) {
            g.bounced = true;
            g.velocity.multiplyScalar(0.45);
            g.velocity.y = Math.abs(g.velocity.y) * 0.5 + 2;
          } else {
            g.velocity.multiplyScalar(0.2);
          }
        } else {
          g.mesh.position.copy(next);
        }
        if (g.mesh.position.y < 0.09) {
          g.mesh.position.y = 0.09;
          g.velocity.y = Math.abs(g.velocity.y) * 0.4;
          g.velocity.x *= 0.7;
          g.velocity.z *= 0.7;
        }
        if (g.fuse <= 0) {
          bursts.push(g.mesh.position.clone());
          scene.remove(g.mesh);
          live.splice(i, 1);
        }
      }
      return bursts;
    },
    clear() {
      for (let i = 0; i < live.length; i += 1) scene.remove(live[i].mesh);
      live.length = 0;
    },
    radius() {
      return BLAST_RADIUS;
    },
    maxDamage() {
      return BLAST_DAMAGE;
    },
  };
}
