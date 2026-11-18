/**
 * On-screen touch controls for phones and tablets (Player 1 only).
 * Left side: floating analog lean — touch anywhere, drag left/right; the lean is proportional to the drag.
 * Right side: GAS and BRAKE pedals (a thumb can slide between them) plus a TUCK toggle.
 */

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function isTouchDevice() {
  if (typeof window === 'undefined') return false;
  const forced = new URLSearchParams(window.location.search).get('touch');
  if (forced === '1') return true;
  if (forced === '0') return false;
  return Boolean(window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches);
}

/**
 * @param {object} opts
 * @param {HTMLElement} opts.root #touch-controls container
 * @param {{ setTouchState: (s: object) => void }} opts.input
 */
export function createTouchControls({ root, input }) {
  if (!root) return { reset() {} };

  const steerZone = root.querySelector('[data-touch-zone="steer"]');
  const steerBase = root.querySelector('.touch-steer-base');
  const steerKnob = root.querySelector('.touch-steer-knob');
  const pedalZone = root.querySelector('[data-touch-zone="pedals"]');
  const gasBtn = root.querySelector('[data-touch="gas"]');
  const brakeBtn = root.querySelector('[data-touch="brake"]');
  const tuckBtn = root.querySelector('[data-touch="tuck"]');

  const state = { throttle: 0, brake: 0, steer: 0, tuck: false };
  let steerPointer = null; // { id, originX }
  const pedalPointers = new Map(); // pointerId -> { x, y }

  function push() {
    input.setTouchState(state);
    if (gasBtn) gasBtn.classList.toggle('pressed', state.throttle > 0);
    if (brakeBtn) brakeBtn.classList.toggle('pressed', state.brake > 0);
    if (tuckBtn) tuckBtn.classList.toggle('pressed', state.tuck);
  }

  // Full lean after this many CSS pixels of horizontal drag (scaled to the screen)
  function steerRange() {
    return clamp(window.innerWidth * 0.09, 55, 95);
  }

  function setKnob(dx) {
    if (steerKnob) steerKnob.style.transform = `translate(${dx}px, 0)`;
  }

  function onSteerDown(e) {
    if (steerPointer) return;
    e.preventDefault();
    steerZone.setPointerCapture?.(e.pointerId);
    steerPointer = { id: e.pointerId, originX: e.clientX };
    const rect = steerZone.getBoundingClientRect();
    if (steerBase) {
      steerBase.style.left = `${e.clientX - rect.left}px`;
      steerBase.style.top = `${e.clientY - rect.top}px`;
      steerBase.classList.add('active');
    }
    setKnob(0);
  }

  function onSteerMove(e) {
    if (!steerPointer || e.pointerId !== steerPointer.id) return;
    e.preventDefault();
    const range = steerRange();
    let dx = e.clientX - steerPointer.originX;
    // Let the origin follow the thumb once it overshoots, so reversing the lean is always immediate
    if (Math.abs(dx) > range) {
      steerPointer.originX = e.clientX - Math.sign(dx) * range;
      dx = Math.sign(dx) * range;
      if (steerBase) {
        const rect = steerZone.getBoundingClientRect();
        steerBase.style.left = `${steerPointer.originX - rect.left}px`;
      }
    }
    const dead = 4;
    const mag = Math.max(0, Math.abs(dx) - dead) / (range - dead);
    state.steer = clamp(Math.sign(dx) * mag, -1, 1);
    setKnob(dx);
    push();
  }

  function onSteerUp(e) {
    if (!steerPointer || e.pointerId !== steerPointer.id) return;
    steerPointer = null;
    state.steer = 0;
    setKnob(0);
    if (steerBase) steerBase.classList.remove('active');
    push();
  }

  function centerOf(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  // Each pedal finger presses whichever pedal centre is nearest, so sliding the thumb across works
  function refreshPedals() {
    let gas = false;
    let brake = false;
    if (gasBtn && brakeBtn) {
      const g = centerOf(gasBtn);
      const b = centerOf(brakeBtn);
      for (const p of pedalPointers.values()) {
        const dg = Math.hypot(p.x - g.x, p.y - g.y);
        const db = Math.hypot(p.x - b.x, p.y - b.y);
        if (dg <= db) gas = true;
        else brake = true;
      }
    }
    state.throttle = gas ? 1 : 0;
    state.brake = brake ? 1 : 0;
    if (brake) state.tuck = false;
    push();
  }

  function onPedalDown(e) {
    if (e.target === tuckBtn) return;
    e.preventDefault();
    pedalZone.setPointerCapture?.(e.pointerId);
    pedalPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    refreshPedals();
  }

  function onPedalMove(e) {
    if (!pedalPointers.has(e.pointerId)) return;
    e.preventDefault();
    pedalPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    refreshPedals();
  }

  function onPedalUp(e) {
    if (!pedalPointers.delete(e.pointerId)) return;
    refreshPedals();
  }

  function onTuck(e) {
    e.preventDefault();
    e.stopPropagation();
    state.tuck = !state.tuck;
    push();
  }

  if (steerZone) {
    steerZone.addEventListener('pointerdown', onSteerDown);
    steerZone.addEventListener('pointermove', onSteerMove);
    steerZone.addEventListener('pointerup', onSteerUp);
    steerZone.addEventListener('pointercancel', onSteerUp);
    steerZone.addEventListener('lostpointercapture', onSteerUp);
  }
  if (pedalZone) {
    pedalZone.addEventListener('pointerdown', onPedalDown);
    pedalZone.addEventListener('pointermove', onPedalMove);
    pedalZone.addEventListener('pointerup', onPedalUp);
    pedalZone.addEventListener('pointercancel', onPedalUp);
    pedalZone.addEventListener('lostpointercapture', onPedalUp);
  }
  if (tuckBtn) tuckBtn.addEventListener('pointerdown', onTuck);
  // Long-press on iOS/Android must not open the callout or select text
  root.addEventListener('contextmenu', (e) => e.preventDefault());

  function reset() {
    steerPointer = null;
    pedalPointers.clear();
    state.throttle = 0;
    state.brake = 0;
    state.steer = 0;
    state.tuck = false;
    setKnob(0);
    if (steerBase) steerBase.classList.remove('active');
    push();
  }

  return { reset };
}

/** Fullscreen + landscape lock where the browser allows it (Android Chrome); iOS Safari ignores both. */
export function enterLandscapeFullscreen() {
  const el = document.documentElement;
  const lock = () => {
    try {
      const p = screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape');
      if (p && p.catch) p.catch(() => {});
    } catch (_) {
      // orientation lock unsupported
    }
  };
  if (document.fullscreenElement || !el.requestFullscreen) {
    lock();
    return;
  }
  try {
    const p = el.requestFullscreen({ navigationUI: 'hide' });
    if (p && p.then) p.then(lock).catch(() => {});
  } catch (_) {
    // fullscreen refused (not in a user gesture, or unsupported)
  }
}
