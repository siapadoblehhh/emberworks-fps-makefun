// The bomb: the one objective beyond killing. The attacking carrier plants it
// at a site (3 s, standing in the zone); it ticks for 35 s and then goes off.
// A defender defuses it in 5 s. If the carrier dies the bomb drops where he
// fell and a teammate picks it up by walking over it. One state object owns
// the timers; no other module touches them.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const PLANT_SECONDS = 3;
const DEFUSE_SECONDS = 5;
const FUSE_SECONDS = 35;

export function createBomb(scene) {
  const shell = new THREE.BoxGeometry(0.34, 0.24, 0.22);
  const shellMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.danger), roughness: 0.5, metalness: 0.3 });
  const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.danger) });
  const mesh = new THREE.Mesh(shell, shellMat);
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.05), lampMat);
  lamp.position.set(0, 0.14, 0);
  mesh.add(lamp);
  mesh.castShadow = true;
  mesh.visible = false;
  scene.add(mesh);

  const state = {
    carrier: 'player', // 'player' | bot | null (dropped)
    planted: false,
    site: null,
    position: new THREE.Vector3(0, 0, 0),
    plantProgress: 0,
    defuseProgress: 0,
    timer: FUSE_SECONDS,
    beepAt: 0,
  };

  function hide() {
    mesh.visible = false;
  }

  return {
    state,
    plantTime: PLANT_SECONDS,
    defuseTime: DEFUSE_SECONDS,
    reset(carrier) {
      state.carrier = carrier;
      state.planted = false;
      state.site = null;
      state.plantProgress = 0;
      state.defuseProgress = 0;
      state.timer = FUSE_SECONDS;
      state.beepAt = 0;
      hide();
    },
    dropAt(x, z) {
      state.carrier = null;
      state.position.set(x, 0.12, z);
      mesh.position.copy(state.position);
      mesh.visible = true;
    },
    pickUpByPlayer() {
      state.carrier = 'player';
      hide();
    },
    pickUpByBot(bot) {
      state.carrier = bot;
      bot.hasBomb = true;
      hide();
    },
    plant(site, x, z) {
      state.planted = true;
      state.site = site;
      state.position.set(x, 0.12, z);
      state.timer = FUSE_SECONDS;
      state.beepAt = 0;
      mesh.position.copy(state.position);
      mesh.visible = true;
    },
    // Ticks the planted timer; returns 'explode' once, else null. The beeps
    // get faster as the timer runs down.
    step(dt, onBeep) {
      if (!state.planted) return null;
      state.timer -= dt;
      if (state.timer <= 10 && state.timer > 0) {
        state.beepAt -= dt;
        if (state.beepAt <= 0) {
          state.beepAt = state.timer <= 5 ? 0.5 : 1;
          lamp.material.color.setHex(0xffffff);
          if (onBeep) onBeep();
          setTimeout(() => lamp.material.color.setHex(0xe5484d), 90);
        }
      }
      if (state.timer <= 0) {
        state.planted = false;
        return 'explode';
      }
      return null;
    },
  };
}
