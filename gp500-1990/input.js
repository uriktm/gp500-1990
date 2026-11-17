/**
 * Dual-Player Input Manager for 500cc Grand Prix '90
 * Supports simultaneous 2-Player Keyboard (conflict-free layout, no Shift/Ctrl/Alt) + Dual Gamepad API + Haptic Rumble.
 *
 * Player 1 Keyboard: KeyW (throttle), KeyS (brake), KeyA / KeyD (lean left/right), Space (tuck-in), KeyC (camera cycle)
 * Player 2 Keyboard: ArrowUp (throttle), ArrowDown (brake), ArrowLeft / ArrowRight (lean left/right), Enter / Numpad0 (tuck-in), Period (camera cycle)
 * Gamepad: Left Stick / D-Pad (lean), RT / A (throttle), LT / B (brake), X / RB (tuck-in), Y / Button 3 (camera cycle), Start / Button 9 (pause)
 * Shortcut Keys: KeyV (split orientation), KeyP / Escape (pause), KeyM (audio mute)
 */

export const PLAYER_KEYMAPS = [
  {
    throttle: ['KeyW'],
    brake: ['KeyS'],
    left: ['KeyA'],
    right: ['KeyD'],
    tuck: ['Space'],
    camera: ['KeyC']
  },
  {
    throttle: ['ArrowUp'],
    brake: ['ArrowDown'],
    left: ['ArrowLeft'],
    right: ['ArrowRight'],
    tuck: ['Enter', 'Numpad0', 'NumpadEnter'],
    camera: ['Period']
  }
];

export const SHORTCUT_KEYS = {
  splitToggle: ['KeyV'],
  pauseToggle: ['KeyP', 'Escape'],
  muteToggle: ['KeyM'],
  p1CameraCycle: ['KeyC'],
  p2CameraCycle: ['Period']
};

const GAME_CONTROL_CODES = new Set([
  'KeyW', 'KeyS', 'KeyA', 'KeyD', 'Space', 'KeyC',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Numpad0', 'NumpadEnter', 'Period',
  'KeyV', 'KeyP', 'Escape', 'KeyM'
]);

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

function applyDeadzone(value, deadzone = 0.12) {
  const abs = Math.abs(value);
  if (abs < deadzone) return 0;
  const sign = value < 0 ? -1 : 1;
  return sign * clamp((abs - deadzone) / (1 - deadzone), 0, 1);
}

/**
 * Creates the input manager for P1 (index 0) and P2 (index 1).
 * @param {object} [callbacks]
 * @param {() => void} [callbacks.onToggleSplit]
 * @param {() => void} [callbacks.onTogglePause]
 * @param {() => void} [callbacks.onToggleMute]
 * @param {(slot: number) => void} [callbacks.onCycleCamera]
 */
export function createInputManager(callbacks = {}) {
  const pressedKeys = new Set();
  const pendingActions = {
    toggleSplit: false,
    togglePause: false,
    toggleMute: false,
    cycleCameraP1: false,
    cycleCameraP2: false
  };

  let handlers = {
    onToggleSplit: callbacks.onToggleSplit || null,
    onTogglePause: callbacks.onTogglePause || null,
    onToggleMute: callbacks.onToggleMute || null,
    onCycleCamera: callbacks.onCycleCamera || null
  };

  // Previous gamepad button states for edge-triggered pause (btn 9) and camera cycle (btn 3 = Y)
  const prevPadPause = [false, false];
  const prevPadCamera = [false, false];
  const lastRumbleTime = [0, 0];

  function isAnyKeyDown(codes) {
    for (let i = 0; i < codes.length; i++) {
      if (pressedKeys.has(codes[i])) return true;
    }
    return false;
  }

  function triggerCameraCycle(slot) {
    if (slot === 0) {
      pendingActions.cycleCameraP1 = true;
    } else if (slot === 1) {
      pendingActions.cycleCameraP2 = true;
    }
    if (typeof handlers.onCycleCamera === 'function') {
      handlers.onCycleCamera(slot);
    }
  }

  function onKeyDown(event) {
    const code = event.code;
    if (!code) return;

    // Avoid hijacking browser shortcuts when typing in an input element
    const tag = event.target && event.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
      return;
    }

    if (GAME_CONTROL_CODES.has(code)) {
      event.preventDefault();
    }

    const wasDown = pressedKeys.has(code);
    pressedKeys.add(code);

    if (!wasDown && !event.repeat) {
      if (SHORTCUT_KEYS.splitToggle.includes(code)) {
        pendingActions.toggleSplit = true;
        if (typeof handlers.onToggleSplit === 'function') {
          handlers.onToggleSplit();
        }
      } else if (SHORTCUT_KEYS.pauseToggle.includes(code)) {
        pendingActions.togglePause = true;
        if (typeof handlers.onTogglePause === 'function') {
          handlers.onTogglePause();
        }
      } else if (SHORTCUT_KEYS.muteToggle.includes(code)) {
        pendingActions.toggleMute = true;
        if (typeof handlers.onToggleMute === 'function') {
          handlers.onToggleMute();
        }
      } else if (SHORTCUT_KEYS.p1CameraCycle.includes(code)) {
        triggerCameraCycle(0);
      } else if (SHORTCUT_KEYS.p2CameraCycle.includes(code)) {
        triggerCameraCycle(1);
      }
    }
  }

  function onKeyUp(event) {
    if (event && event.code) {
      pressedKeys.delete(event.code);
    }
  }

  function onWindowBlur() {
    pressedKeys.clear();
  }

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('keydown', onKeyDown, { passive: false });
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onWindowBlur);
  }

  function getConnectedGamepads() {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') {
      return [null, null];
    }
    try {
      const pads = navigator.getGamepads();
      if (!pads) return [null, null];
      // Map connected pads in order to Pad 0 (P1) and Pad 1 (P2)
      const active = [];
      for (let i = 0; i < pads.length; i++) {
        if (pads[i] && pads[i].connected) {
          active.push(pads[i]);
        }
      }
      return [pads[0] || active[0] || null, pads[1] || active[1] || null];
    } catch (_) {
      return [null, null];
    }
  }

  function readGamepadInput(playerIndex) {
    const pads = getConnectedGamepads();
    const pad = pads[playerIndex];
    if (!pad || !pad.connected) {
      prevPadPause[playerIndex] = false;
      prevPadCamera[playerIndex] = false;
      return { throttle: 0, brake: 0, steer: 0, tuck: false, connected: false, id: '' };
    }

    const buttons = pad.buttons || [];
    const axes = pad.axes || [];

    const btnVal = (idx) => {
      const b = buttons[idx];
      if (!b) return 0;
      if (typeof b === 'number') return clamp(b, 0, 1);
      return b.pressed ? Math.max(b.value || 1, 1) : clamp(b.value || 0, 0, 1);
    };

    const btnPressed = (idx) => {
      const b = buttons[idx];
      if (!b) return false;
      return typeof b === 'object' ? Boolean(b.pressed || b.value > 0.5) : b > 0.5;
    };

    // Left Stick X (axes[0]) or D-Pad Left (14) / Right (15)
    const stickSteer = applyDeadzone(axes[0] || 0, 0.12);
    const dpadSteer = (btnPressed(15) ? 1 : 0) - (btnPressed(14) ? 1 : 0);
    const steer = clamp(Math.abs(stickSteer) >= Math.abs(dpadSteer) ? stickSteer : dpadSteer, -1, 1);

    // RT / Button 7 or A (Button 0) for throttle
    const throttle = clamp(Math.max(btnVal(7), btnVal(0)), 0, 1);

    // LT / Button 6 or B (Button 1) for brake
    const brake = clamp(Math.max(btnVal(6), btnVal(1)), 0, 1);

    // X (Button 2) or RB (Button 5) for tuck-in
    const tuck = btnPressed(2) || btnPressed(5);

    // Y button (Button 3) edge-triggered camera mode cycle
    const camNow = btnPressed(3);
    if (camNow && !prevPadCamera[playerIndex]) {
      triggerCameraCycle(playerIndex);
    }
    prevPadCamera[playerIndex] = camNow;

    // Start button (Button 9) edge-triggered pause
    const startNow = btnPressed(9);
    if (startNow && !prevPadPause[playerIndex]) {
      pendingActions.togglePause = true;
      if (typeof handlers.onTogglePause === 'function') {
        handlers.onTogglePause();
      }
    }
    prevPadPause[playerIndex] = startNow;

    return {
      throttle,
      brake,
      steer,
      tuck,
      connected: true,
      id: pad.id || `Gamepad ${playerIndex + 1}`
    };
  }

  /**
   * Triggers gamepad haptic rumble if gamepad.vibrationActuator is supported.
   * @param {number} playerIndex 0 or 1
   * @param {{ duration?: number, weakMagnitude?: number, strongMagnitude?: number }} [effect]
   */
  function triggerGamepadRumble(playerIndex = 0, effect = {}) {
    const idx = playerIndex === 1 ? 1 : 0;
    const pads = getConnectedGamepads();
    const pad = pads[idx];
    if (!pad || !pad.vibrationActuator) return false;

    const actuator = pad.vibrationActuator;
    const duration = clamp(Number(effect.duration) || 80, 20, 500);
    const weakMagnitude = clamp(Number(effect.weakMagnitude) || 0, 0, 1);
    const strongMagnitude = clamp(Number(effect.strongMagnitude) || 0, 0, 1);
    if (weakMagnitude <= 0.01 && strongMagnitude <= 0.01) return false;

    try {
      if (typeof actuator.playEffect === 'function') {
        const type = actuator.type || 'dual-rumble';
        const res = actuator.playEffect(type, {
          startDelay: 0,
          duration,
          weakMagnitude,
          strongMagnitude
        });
        if (res && typeof res.catch === 'function') {
          res.catch(() => {});
        }
        return true;
      }
      if (typeof actuator.pulse === 'function') {
        const res = actuator.pulse(Math.max(weakMagnitude, strongMagnitude), duration);
        if (res && typeof res.catch === 'function') {
          res.catch(() => {});
        }
        return true;
      }
    } catch (_) {
      // Ignore browser permission or unsupported actuator errors
    }
    return false;
  }

  /**
   * Evaluates rider telemetry (kerbs, highside, powerslide) and triggers gamepad vibrationActuator rumble.
   * @param {number} playerIndex 0 or 1
   * @param {object} rider
   * @param {number} [nowMs]
   */
  function updateRiderRumble(playerIndex = 0, rider = null, nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now()) {
    if (!rider) return false;
    const idx = playerIndex === 1 ? 1 : 0;
    if (nowMs - lastRumbleTime[idx] < 55) return false;

    const highside = (rider.highsideTimer || 0) > 0;
    const rearSlip = rider.rearSlip || 0;
    const powerslide = rearSlip > 0.28;
    const onKerb = Boolean(rider.onKerb && (rider.speed || 0) > 5);

    if (!highside && !powerslide && !onKerb) {
      return false;
    }

    let strongMagnitude = 0;
    let weakMagnitude = 0;
    let duration = 75;

    if (highside) {
      strongMagnitude = 1.0;
      weakMagnitude = 0.9;
      duration = 130;
    } else if (powerslide) {
      const slipIntensity = clamp((rearSlip - 0.25) / 0.75, 0.25, 1.0);
      strongMagnitude = clamp(0.35 + slipIntensity * 0.55, 0.3, 0.9);
      weakMagnitude = clamp(0.25 + slipIntensity * 0.5, 0.25, 0.75);
      duration = 90;
    } else if (onKerb) {
      const speedNorm = clamp((rider.speed || 0) / 70, 0.2, 1.0);
      strongMagnitude = 0.22 * speedNorm;
      weakMagnitude = clamp(0.3 + speedNorm * 0.5, 0.25, 0.8);
      duration = 65;
    }

    lastRumbleTime[idx] = nowMs;
    return triggerGamepadRumble(idx, { duration, weakMagnitude, strongMagnitude });
  }

  /**
   * Returns combined Keyboard + Gamepad input for a player.
   * @param {number} playerIndex 0 for Player 1, 1 for Player 2
   * @returns {{ throttle: number, brake: number, steer: number, tuck: boolean }}
   */
  function getPlayerInput(playerIndex = 0) {
    const idx = playerIndex === 1 ? 1 : 0;
    const map = PLAYER_KEYMAPS[idx];

    const keyThrottle = isAnyKeyDown(map.throttle) ? 1 : 0;
    const keyBrake = isAnyKeyDown(map.brake) ? 1 : 0;
    const keyLeft = isAnyKeyDown(map.left) ? 1 : 0;
    const keyRight = isAnyKeyDown(map.right) ? 1 : 0;
    const keySteer = keyRight - keyLeft;
    const keyTuck = isAnyKeyDown(map.tuck);

    const pad = readGamepadInput(idx);

    const throttle = clamp(Math.max(keyThrottle, pad.throttle), 0, 1);
    const brake = clamp(Math.max(keyBrake, pad.brake), 0, 1);
    const steer = Math.abs(keySteer) > 0 ? keySteer : clamp(pad.steer, -1, 1);
    const tuck = Boolean(keyTuck || pad.tuck);

    return { throttle, brake, steer, tuck };
  }

  function getGamepadStatus() {
    const pads = getConnectedGamepads();
    return {
      p1Connected: Boolean(pads[0] && pads[0].connected),
      p2Connected: Boolean(pads[1] && pads[1].connected),
      p1Name: pads[0] && pads[0].id ? pads[0].id : '',
      p2Name: pads[1] && pads[1].id ? pads[1].id : ''
    };
  }

  function consumeActions() {
    const snapshot = {
      toggleSplit: pendingActions.toggleSplit,
      togglePause: pendingActions.togglePause,
      toggleMute: pendingActions.toggleMute,
      cycleCameraP1: pendingActions.cycleCameraP1,
      cycleCameraP2: pendingActions.cycleCameraP2
    };
    pendingActions.toggleSplit = false;
    pendingActions.togglePause = false;
    pendingActions.toggleMute = false;
    pendingActions.cycleCameraP1 = false;
    pendingActions.cycleCameraP2 = false;
    return snapshot;
  }

  function setCallbacks(newCallbacks = {}) {
    handlers = {
      ...handlers,
      ...newCallbacks
    };
  }

  function setKeyState(code, isDown) {
    if (isDown) {
      const wasDown = pressedKeys.has(code);
      pressedKeys.add(code);
      if (!wasDown) {
        if (SHORTCUT_KEYS.p1CameraCycle.includes(code)) {
          triggerCameraCycle(0);
        } else if (SHORTCUT_KEYS.p2CameraCycle.includes(code)) {
          triggerCameraCycle(1);
        }
      }
    } else {
      pressedKeys.delete(code);
    }
  }

  function reset() {
    pressedKeys.clear();
    pendingActions.toggleSplit = false;
    pendingActions.togglePause = false;
    pendingActions.toggleMute = false;
    pendingActions.cycleCameraP1 = false;
    pendingActions.cycleCameraP2 = false;
  }

  function dispose() {
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onWindowBlur);
    }
    pressedKeys.clear();
  }

  return {
    getPlayerInput,
    getGamepadStatus,
    triggerGamepadRumble,
    updateRiderRumble,
    consumeActions,
    setCallbacks,
    setKeyState,
    isKeyDown: (code) => pressedKeys.has(code),
    reset,
    dispose
  };
}
