// The map: EMBERWORKS, a foundry yard on the night shift. Two bombsites
// (A Slag Pit west, B Kiln east), three lanes (A-long, mid, B-long), attacker
// spawn south, defender spawn north. Every box is a collider for movement and
// a surface a bullet stops on. Waypoints form the graph the bots walk: BFS
// over it, never a straight line.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Waypoint nodes [x, z]; edges are bidirectional pairs of node indices.
export const WAYPOINTS = [
  [0, 18], [-24, 12], [-24, 0], [-24, -9], [-20, -12], [-21, -15], [-15, -16],
  [-25, -18], [0, 12], [0, 2], [0, -8], [3, -13], [24, 12], [24, 0], [24, -9],
  [20, -12], [21, -15], [15, -16], [25, -18], [0, -18], [-13, -13], [13, -13],
  [-2, -15], [-24, -15], [24, -15],
];
const EDGES = [
  [0, 1], [0, 8], [0, 12], [1, 2], [2, 3], [3, 4], [4, 5], [4, 6], [5, 23],
  [6, 7], [3, 7], [8, 9], [9, 10], [10, 11], [10, 4], [10, 15], [10, 20],
  [10, 21], [12, 13], [13, 14], [14, 15], [15, 16], [15, 17], [16, 24],
  [17, 18], [14, 18], [19, 20], [19, 21], [19, 22], [20, 6], [21, 17],
  [22, 11], [20, 4], [21, 15], [11, 22], [6, 20], [17, 21],
];
const LINKS = WAYPOINTS.map(() => []);
for (let e = 0; e < EDGES.length; e += 1) {
  const [a, b] = EDGES[e];
  LINKS[a].push(b);
  LINKS[b].push(a);
}

// Breadth-first route from the node nearest (x, z) to the node nearest (tx, tz).
export function findRoute(x, z, tx, tz) {
  let start = 0;
  let goal = 0;
  let near = Infinity;
  let nearGoal = Infinity;
  for (let i = 0; i < WAYPOINTS.length; i += 1) {
    const d = (WAYPOINTS[i][0] - x) ** 2 + (WAYPOINTS[i][1] - z) ** 2;
    if (d < near) {
      near = d;
      start = i;
    }
    const dg = (WAYPOINTS[i][0] - tx) ** 2 + (WAYPOINTS[i][1] - tz) ** 2;
    if (dg < nearGoal) {
      nearGoal = dg;
      goal = i;
    }
  }
  const came = new Array(WAYPOINTS.length).fill(-1);
  const queue = [start];
  came[start] = start;
  while (queue.length > 0) {
    const node = queue.shift();
    if (node === goal) break;
    for (const next of LINKS[node]) {
      if (came[next] !== -1) continue;
      came[next] = node;
      queue.push(next);
    }
  }
  const route = [];
  let node = goal;
  while (node !== start && node !== -1) {
    route.unshift(node);
    node = came[node];
  }
  return route;
}

export const SITES = {
  A: { minX: -26, maxX: -16, minZ: -19, maxZ: -8, plant: [-21, -15], name: 'Slag Pit' },
  B: { minX: 16, maxX: 26, minZ: -19, maxZ: -8, plant: [21, -15], name: 'Kiln' },
};

function letterTexture(text, color, size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0)';
  g.clearRect(0, 0, size, size);
  g.fillStyle = color;
  g.font = `700 ${size * 0.72}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, size / 2, size / 2 + size * 0.04);
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  return texture;
}

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const mats = {};
  for (const name of Object.keys(PALETTE)) {
    mats[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.55 : 0.92,
      metalness: 0.03,
    });
  }
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x3d4c5c, roughness: 0.8, metalness: 0.25 });
  const rustMat = new THREE.MeshStandardMaterial({ color: 0x6b4a35, roughness: 0.9, metalness: 0.15 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1d222b, roughness: 0.85, metalness: 0.1 });

  const colliders = [];
  const shootables = [];

  function put(w, h, d, x, y, z, mat, solid = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (!solid) return mesh;
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  // Floor and perimeter: 56 x 44 m, 5 m walls, open to the night sky.
  put(56.4, 0.4, 44.4, 0, -0.2, 0, mats.surface);
  put(0.4, 5, 44.4, -28.2, 2.5, 0, mats.surface);
  put(0.4, 5, 44.4, 28.2, 2.5, 0, mats.surface);
  put(56.4, 5, 0.4, 0, 2.5, -22.2, mats.surface);
  put(56.4, 5, 0.4, 0, 2.5, 22.2, mats.surface);

  // Mid choke: two pillars and a low wall with a door gap at the centre.
  put(1.4, 3.4, 1.4, -3.2, 1.7, 2, mats.hairline);
  put(1.4, 3.4, 1.4, 3.2, 1.7, 2, mats.hairline);
  put(7, 1.1, 0.8, -8.5, 0.55, 2, mats.hairline);
  put(7, 1.1, 0.8, 8.5, 0.55, 2, mats.hairline);
  put(2.2, 1.1, 2.2, 0, 0.55, -6, mats.hairline);

  // A-long cover: containers and crates down the west lane.
  put(6, 2.6, 2.4, -24.5, 1.3, 6, steelMat);
  put(2.4, 2.6, 6, -25.5, 1.3, -4, steelMat);
  put(1.2, 1.1, 1.2, -21, 0.55, -2, mats.hairline);
  put(1.2, 1.1, 1.2, -22.2, 0.55, -1, mats.hairline);
  put(1.2, 1.1, 1.2, -21.6, 1.65, -1.5, mats.hairline);
  // A site: the Slag Pit, a big rusted block with a glowing molten slit.
  put(4, 3.4, 3, -24, 1.7, -15, rustMat);
  put(1.2, 1.1, 1.2, -17.5, 0.55, -10.5, mats.hairline);
  put(1.2, 1.1, 1.2, -18.7, 0.55, -9.5, mats.hairline);
  put(2.4, 1.1, 1.2, -19, 0.55, -17.5, mats.hairline);

  // B-long cover: containers and crates down the east lane.
  put(6, 2.6, 2.4, 24.5, 1.3, 6, steelMat);
  put(2.4, 2.6, 6, 25.5, 1.3, -4, steelMat);
  put(1.2, 1.1, 1.2, 21, 0.55, -2, mats.hairline);
  put(1.2, 1.1, 1.2, 22.2, 0.55, -1, mats.hairline);
  // B site: the Kiln base and a raised platform to hold from.
  put(2, 4.6, 2, 24.5, 2.3, -16, darkMat);
  put(6, 0.5, 3, 20, 0.25, -17.5, mats.surface);
  put(1.2, 1.1, 1.2, 17.5, 0.55, -10.5, mats.hairline);
  put(2.4, 1.1, 1.2, 19, 0.55, -17.5, mats.hairline);

  // Defender-side cover and spawn dressing.
  put(3.6, 1.1, 1.2, -8, 0.55, -13, mats.hairline);
  put(3.6, 1.1, 1.2, 8, 0.55, -13, mats.hairline);
  put(1.2, 3.2, 1.2, -12, 1.6, -18.5, mats.hairline);
  put(1.2, 3.2, 1.2, 12, 1.6, -18.5, mats.hairline);
  // Attacker-side cover.
  put(3.6, 1.1, 1.2, -8, 0.55, 13, mats.hairline);
  put(3.6, 1.1, 1.2, 8, 0.55, 13, mats.hairline);

  // Glowing site strips on the floor and floating site letters.
  const stripA = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.attacker) });
  const stripB = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.defender) });
  function floorStrip(x, z, mat) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(9, 0.35), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.02, z);
    group.add(mesh);
  }
  floorStrip(-21, -8.2, stripA);
  floorStrip(21, -8.2, stripB);
  function floatingLetter(text, color, x, y, z) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 2.4),
      new THREE.MeshBasicMaterial({ map: letterTexture(text, color), transparent: true, side: THREE.DoubleSide }),
    );
    mesh.position.set(x, y, z);
    group.add(mesh);
  }
  floatingLetter('A', PALETTE.attacker, -21, 4.4, -19.5);
  floatingLetter('B', PALETTE.defender, 21, 4.4, -19.5);

  // Molten glow slit on the Slag Pit, a gantry beam over the Kiln, and a
  // glowing channel across mid: landmarks the eye reads at a glance.
  const slit = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 0.5),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff7a1a') }),
  );
  slit.position.set(-22, 1.4, -14.9);
  group.add(slit);
  const channel = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 0.3),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff7a1a') }),
  );
  channel.rotation.x = -Math.PI / 2;
  channel.position.set(0, 0.02, -1.5);
  group.add(channel);
  put(0.5, 0.5, 9, 24.5, 5.2, -13, darkMat, false);
  put(0.5, 5.4, 0.5, 24.5, 2.7, -9, darkMat, false);

  // Light: cold moonlight from above, warm molten glow from the sites, dim
  // enough to feel like night and bright enough to read the yard at a glance.
  scene.add(new THREE.HemisphereLight(new THREE.Color(0x8fa8c8), new THREE.Color(0x1a2029), 1.5));
  const moon = new THREE.DirectionalLight(new THREE.Color(0xaec6e8), 2.2);
  moon.position.set(-10, 18, 8);
  moon.target.position.set(4, 0, -6);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  moon.shadow.camera.left = -32;
  moon.shadow.camera.right = 32;
  moon.shadow.camera.top = 32;
  moon.shadow.camera.bottom = -32;
  moon.shadow.camera.far = 70;
  moon.shadow.bias = -0.0006;
  scene.add(moon, moon.target);
  const glowA = new THREE.PointLight(new THREE.Color(0xff7a1a), 26, 22);
  glowA.position.set(-21, 2.5, -15);
  scene.add(glowA);
  const glowB = new THREE.PointLight(new THREE.Color(0xff7a1a), 18, 18);
  glowB.position.set(21, 2.5, -15);
  scene.add(glowB);
  const fill = new THREE.DirectionalLight(new THREE.Color(0x6b8aa8), 1.0);
  fill.position.set(20, 10, 14);
  scene.add(fill);

  // 2D line-of-sight: a segment is blocked when it crosses a collider taller
  // than 1.2 m. Slab test per axis, the way a ray-box test clips a segment.
  const tall = colliders.filter((c) => c.max.y > 1.2);
  function blocksLos(ax, az, bx, bz) {
    for (let i = 0; i < tall.length; i += 1) {
      const c = tall[i];
      const loX = ax < bx ? ax : bx;
      const hiX = ax < bx ? bx : ax;
      if (c.max.x < loX || c.min.x > hiX) continue;
      const loZ = az < bz ? az : bz;
      const hiZ = az < bz ? bz : az;
      if (c.max.z < loZ || c.min.z > hiZ) continue;
      const dx = bx - ax;
      const dz = bz - az;
      let t0 = 0;
      let t1 = 1;
      let ok = true;
      if (Math.abs(dx) < 1e-9) {
        if (ax < c.min.x || ax > c.max.x) ok = false;
      } else {
        let ta = (c.min.x - ax) / dx;
        let tb = (c.max.x - ax) / dx;
        if (ta > tb) {
          const tmp = ta;
          ta = tb;
          tb = tmp;
        }
        if (ta > t0) t0 = ta;
        if (tb < t1) t1 = tb;
        if (t0 > t1) ok = false;
      }
      if (!ok) continue;
      if (Math.abs(dz) < 1e-9) {
        if (az < c.min.z || az > c.max.z) ok = false;
      } else {
        let ta = (c.min.z - az) / dz;
        let tb = (c.max.z - az) / dz;
        if (ta > tb) {
          const tmp = ta;
          ta = tb;
          tb = tmp;
        }
        if (ta > t0) t0 = ta;
        if (tb < t1) t1 = tb;
        if (t0 > t1) ok = false;
      }
      if (ok) return true;
    }
    return false;
  }

  function siteAt(x, z) {
    const keys = ['A', 'B'];
    for (let i = 0; i < keys.length; i += 1) {
      const s = SITES[keys[i]];
      if (x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ) return keys[i];
    }
    return null;
  }

  return { colliders, shootables, group, blocksLos, siteAt };
}
