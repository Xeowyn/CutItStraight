// Relative-drag steering. The player's finger never has to be over the plank — any
// drag in the lower area moves the plank by the delta, which keeps the plank visible
// on small screens and works the same for mouse and touch.

export function createInput(canvas, getScale) {
  const state = { dx: 0, keyLeft: false, keyRight: false, active: false };
  let lastX = 0;
  let pointerId = null;

  const down = (x, id) => {
    pointerId = id;
    lastX = x;
    state.active = true;
  };
  const move = (x) => {
    if (!state.active) return;
    state.dx += (x - lastX) / getScale();
    lastX = x;
  };
  const up = () => {
    state.active = false;
    pointerId = null;
  };

  if (window.PointerEvent) {
    canvas.addEventListener('pointerdown', (e) => {
      // Capture is a nicety, not a requirement — and it throws if the pointer is
      // already gone. An exception here would abort the listener and drop the
      // steering input entirely, so it must never escape.
      try { canvas.setPointerCapture?.(e.pointerId); } catch (err) { /* not capturable */ }
      down(e.clientX, e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (pointerId !== null && e.pointerId !== pointerId) return;
      move(e.clientX);
    });
    // Only the finger that is steering ends the drag. With two thumbs on a phone, the
    // first one lifting used to stop steering while the second was still dragging.
    const end = (e) => { if (pointerId === null || e.pointerId === pointerId) up(); };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  } else {
    canvas.addEventListener('touchstart', (e) => down(e.touches[0].clientX, 0), { passive: true });
    canvas.addEventListener('touchmove', (e) => move(e.touches[0].clientX), { passive: true });
    canvas.addEventListener('touchend', up);
    canvas.addEventListener('mousedown', (e) => down(e.clientX, 0));
    window.addEventListener('mousemove', (e) => move(e.clientX));
    window.addEventListener('mouseup', up);
  }

  // iOS Safari ignores `user-scalable=no`, and `touch-action: none` on the canvas
  // does not stop a pinch that lands partly outside it, so a second finger mid-cut
  // could zoom the whole page. Safari's own gesture events are the reliable stop.
  // Non-standard, iOS-only: elsewhere these never fire, so this is inert.
  for (const ev of ['gesturestart', 'gesturechange']) {
    document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
  }

  // Arrow keys plus both WASD and ZQSD, so AZERTY works with no configuration.
  const LEFT = new Set(['ArrowLeft', 'KeyA', 'KeyQ']);
  const RIGHT = new Set(['ArrowRight', 'KeyD']);
  window.addEventListener('keydown', (e) => {
    if (LEFT.has(e.code)) { state.keyLeft = true; e.preventDefault(); }
    if (RIGHT.has(e.code)) { state.keyRight = true; e.preventDefault(); }
  });
  window.addEventListener('keyup', (e) => {
    if (LEFT.has(e.code)) state.keyLeft = false;
    if (RIGHT.has(e.code)) state.keyRight = false;
  });
  window.addEventListener('blur', () => {
    state.keyLeft = state.keyRight = false;
    up();
  });

  return {
    state,
    // Consume accumulated drag; keyboard contributes a steady rate.
    take(dt) {
      let d = state.dx;
      state.dx = 0;
      const KEY_SPEED = 430;
      if (state.keyLeft) d -= KEY_SPEED * dt;
      if (state.keyRight) d += KEY_SPEED * dt;
      return d;
    },
    reset() {
      state.dx = 0;
    },
  };
}
