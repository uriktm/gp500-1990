/**
 * Dual-Player Input Manager for 500cc Grand Prix '90
 * Supports simultaneous 2-Player Keyboard (conflict-free layout) + Dual Gamepad API.
 *
 * Player 1 Keyboard: KeyW (throttle), KeyS (brake), KeyA / KeyD (lean left/right), Space (tuck-in)
 * Player 2 Keyboard: ArrowUp (throttle), ArrowDown (brake), ArrowLeft / ArrowRight (lean left/right), Enter / Numpad0 (tuck-in)
 * Shortcut Keys: KeyV (split orientation), KeyP / Escape (pause), KeyM (audio mute)
 */

export const PLAYER_KEYMAPS = [
  {
    throttle: ['KeyW'],
    brake: ['KeyS'],
    left: ['KeyA'],
    right: ['KeyD'],
    tuck: ['Space']
  },
  {
    throttle: ['ArrowUp'],
    brake: ['ArrowDown'],
    left: ['ArrowLeft'],
    right: ['ArrowRight'],
    tuck: ['Enter', 'Numpad0', 'NumpadEnter']
  }
];

export const SHORTCUT_KEYS = {
  splitToggle: ['KeyV'],
  pauseToggle: ['KeyP', 'Escape'],
  muteToggle: ['KeyM']
};

const GAME_CONTROL_CODES = new Set([
  'KeyW', 'KeyS', 'KeyA', 'KeyD', 'Space',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Numpad0', 'NumpadEnter',
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
 */
export function createInputManager(callbacks = {}) {
  const pressedKeys = new Set();
  const pendingActions = {
    toggleSplit: false,
    togglePause: false,
    toggleMute: false
  };

  let handlers = {
    onToggleSplit: callbacks.onToggleSplit || null,
    onTogglePause: callbacks.onTogglePause || null,
    onToggleMute: callbacks.onToggleMute || null
  };

  // Previous gamepad button states for edge-triggered pause/split shortcuts if needed
  const prevPadPause = [false, false];

  function isAnyKeyDown(codes) {
    for (let i = 0; i < codes.length; i++) {
      if (pressedKeys.has(codes[i])) return true;
    }
    return false;
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
    let stickSteer = applyDeadzone(axes[0] || 0, 0.12);
    const dpadSteer = (btnPressed(15) ? 1 : 0) - (btnPressed(14) ? 1 : 0);
    const steer = clamp(Math.abs(stickSteer) >= Math.abs(dpadSteer) ? stickSteer : dpadSteer, -1, 1);

    // RT / Button 7 or A (Button 0) for throttle
    const throttle = clamp(Math.max(btnVal(7), btnVal(0)), 0, 1);

    // LT / Button 6 or B (Button 1) for brake
    const brake = clamp(Math.max(btnVal(6), btnVal(1)), 0, 1);

    // X (Button 2) or RB (Button 5) for tuck-in
    const tuck = btnPressed(2) || btnPressed(5);

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
      toggleMute: pendingActions.toggleMute
    };
    pendingActions.toggleSplit = false;
    pendingActions.togglePause = false;
    pendingActions.toggleMute = false;
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
      pressedKeys.add(code);
    } else {
      pressedKeys.delete(code);
    }
  }

  function reset() {
    pressedKeys.clear();
    pendingActions.toggleSplit = false;
    pendingActions.togglePause = false;
    pendingActions.toggleMute = false;
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
    consumeActions,
    setCallbacks,
    setKeyState,
     isKeyDown: (code) => pressedKeys.has(code),
    reset,
    dispose
  };
}
