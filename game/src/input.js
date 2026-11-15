// Keyboard and mouse, plus the pointer lock that turns the mouse into look.
// Browser APIs only. Besides the held keys it records pressed edges — buy
// menu, weapon slots, grenade, use — so the game can act on a single keypress,
// and it leaves the raw key set readable so the game can test held keys
// like Tab for the scoreboard.
export function createInput(canvas, onLockChange) {
  const held = new Set();
  const edges = new Set();
  const state = { keys: held, locked: false, firing: false, lookX: 0, lookY: 0 };

  function press(event, down) {
    if (down) {
      if (!held.has(event.code)) edges.add(event.code);
      held.add(event.code);
    } else {
      held.delete(event.code);
    }
    if (event.code === 'Space' || event.code === 'Tab') event.preventDefault();
  }

  window.addEventListener('keydown', (event) => press(event, true));
  window.addEventListener('keyup', (event) => press(event, false));
  window.addEventListener('blur', () => held.clear());
  window.addEventListener('mousemove', (event) => {
    if (!state.locked) return;
    state.lookX += event.movementX;
    state.lookY += event.movementY;
  });
  window.addEventListener('mousedown', (event) => {
    if (state.locked && event.button === 0) state.firing = true;
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) state.firing = false;
  });
  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) {
      held.clear();
      state.firing = false;
    }
    onLockChange(state.locked);
  });

  return {
    state,
    requestLock() {
      canvas.requestPointerLock();
    },
    takeLook() {
      const out = { x: state.lookX, y: state.lookY };
      state.lookX = 0;
      state.lookY = 0;
      return out;
    },
    // True once per keydown since the last call; the game drains it each frame.
    takePressed(code) {
      if (!edges.has(code)) return false;
      edges.delete(code);
      return true;
    },
    clearPressed() {
      edges.clear();
    },
  };
}
