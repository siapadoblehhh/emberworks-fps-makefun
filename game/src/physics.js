// A single moving body: it accelerates toward its wish direction, brakes with
// friction on the ground, falls under gravity, and can crouch and jump. The
// world is a list of boxes; the body is a box too, and each axis is resolved
// on its own, so a wall can stop the body sideways without swallowing it.
// The player and every bot run through this same code — only the wish
// direction changes. The probe box and the wish vector are allocated once and
// reused, so a step never allocates.
import * as THREE from 'three';

const BODY_RADIUS = 0.34;
const HEIGHT_STAND = 1.72;
const HEIGHT_CROUCH = 1.12;
const EYE_STAND = 1.6;
const EYE_CROUCH = 1.02;
const ACCEL_GROUND = 42;
const ACCEL_AIR = 9;
const BRAKE = 9;
const PULL = 20;
const HOP = 6.2;

export const EYE_STAND_HEIGHT = EYE_STAND;
export const EYE_CROUCH_HEIGHT = EYE_CROUCH;

export function createBody(colliders, x, z, walkSpeed = 5.2, crouchSpeed = 2.4) {
  const pose = {
    position: new THREE.Vector3(x, 0, z),
    velocity: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    eye: EYE_STAND,
    onGround: true,
    crouching: false,
    height: HEIGHT_STAND,
    walkSpeed,
    crouchSpeed,
  };
  const probe = new THREE.Box3();
  const wish = new THREE.Vector3();

  // lift trims the feet and the crown out of the sideways tests, so standing
  // on the floor is never mistaken for walking into a wall.
  function hits(x, y, z, height, lift) {
    probe.min.set(x - BODY_RADIUS, y + lift, z - BODY_RADIUS);
    probe.max.set(x + BODY_RADIUS, y + height - lift, z + BODY_RADIUS);
    for (let i = 0; i < colliders.length; i += 1) {
      if (probe.intersectsBox(colliders[i])) return colliders[i];
    }
    return null;
  }

  function look(dx, dy, sensitivity = 0.0022) {
    pose.yaw -= dx * sensitivity;
    const next = pose.pitch - dy * sensitivity;
    pose.pitch = next > 1.45 ? 1.45 : next < -1.45 ? -1.45 : next;
  }

  function recoil(pitchKick, yawKick) {
    pose.pitch = Math.min(1.45, pose.pitch + pitchKick);
    pose.yaw += yawKick;
  }

  function settleCrouch(crouch) {
    if (crouch && !pose.crouching) {
      pose.crouching = true;
      pose.height = HEIGHT_CROUCH;
      return;
    }
    if (crouch || !pose.crouching) return;
    if (hits(pose.position.x, pose.position.y, pose.position.z, HEIGHT_STAND, 0.02)) return;
    pose.crouching = false;
    pose.height = HEIGHT_STAND;
  }

  // wishX/wishZ are a world-space direction (already normalised, or zero).
  function step(dt, wishX, wishZ, crouch, jump) {
    settleCrouch(crouch);
    const eyeGoal = pose.crouching ? EYE_CROUCH : EYE_STAND;
    pose.eye += (eyeGoal - pose.eye) * Math.min(1, dt * 12);

    wish.set(wishX, 0, wishZ);
    const top = pose.crouching ? pose.crouchSpeed : pose.walkSpeed;
    const rate = pose.onGround ? ACCEL_GROUND : ACCEL_AIR;
    const blend = Math.min(1, (rate * dt) / top);
    pose.velocity.x += (wish.x * top - pose.velocity.x) * blend;
    pose.velocity.z += (wish.z * top - pose.velocity.z) * blend;
    if (pose.onGround && wish.lengthSq() === 0) {
      const slow = Math.max(0, 1 - BRAKE * dt);
      pose.velocity.x *= slow;
      pose.velocity.z *= slow;
    }

    if (jump && pose.onGround) {
      pose.velocity.y = HOP;
      pose.onGround = false;
    }
    pose.velocity.y -= PULL * dt;

    const tryX = pose.position.x + pose.velocity.x * dt;
    if (!hits(tryX, pose.position.y, pose.position.z, pose.height, 0.04)) {
      pose.position.x = tryX;
    } else {
      pose.velocity.x = 0;
    }
    const tryZ = pose.position.z + pose.velocity.z * dt;
    if (!hits(pose.position.x, pose.position.y, tryZ, pose.height, 0.04)) {
      pose.position.z = tryZ;
    } else {
      pose.velocity.z = 0;
    }

    pose.position.y += pose.velocity.y * dt;
    pose.onGround = false;
    const under = hits(pose.position.x, pose.position.y, pose.position.z, pose.height, 0);
    if (under && pose.velocity.y <= 0) {
      pose.position.y = under.max.y;
      pose.velocity.y = 0;
      pose.onGround = true;
    } else if (under) {
      pose.position.y = under.min.y - pose.height;
      pose.velocity.y = 0;
    }
    if (pose.position.y < 0) {
      pose.position.y = 0;
      pose.velocity.y = 0;
      pose.onGround = true;
    }
    if (pose.velocity.y < -30) pose.velocity.y = -30;
  }

  return {
    state: pose,
    step,
    look,
    recoil,
    overlaps: hits,
    groundSpeed() {
      return Math.hypot(pose.velocity.x, pose.velocity.z);
    },
    eyeY() {
      return pose.position.y + pose.eye;
    },
  };
}
