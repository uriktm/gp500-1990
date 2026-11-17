/**
 * 60 Hz Race Telemetry & Broadcast Replay System for 500cc Grand Prix '90
 * Records per-rider render state at 60 Hz (up to 10 minutes = 36,000 frames)
 * and drives full-screen TV / Chase replay playback with variable speed and scrubbing.
 */

export const REPLAY_HZ = 60;
export const REPLAY_DT = 1 / REPLAY_HZ;
export const MAX_REPLAY_DURATION = 600; // 10 minutes cap
export const MAX_REPLAY_FRAMES = REPLAY_HZ * MAX_REPLAY_DURATION; // 36,000 frames
export const REPLAY_SPEEDS = [0.25, 0.5, 1, 2];
export const REPLAY_FOCUS_MODES = ['p1', 'p2', 'leader'];

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

function wrapAngle(a) {
  let r = (a + Math.PI) % (2 * Math.PI);
  if (r < 0) r += 2 * Math.PI;
  return r - Math.PI;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpAngle(a, b, t) {
  return a + wrapAngle(b - a) * t;
}

/**
 * Captures a clean snapshot of a single rider's render and telemetry state.
 * @param {object} r
 */
export function snapshotRider(r) {
  if (!r) return null;
  const w = r.world || {};
  return {
    id: r.id ?? 'rider',
    name: r.name ?? 'Rider',
    isAI: Boolean(r.isAI),
    playerIndex: r.playerIndex ?? -1,
    bike: r.bike ? { ...r.bike } : null,
    s: Number(r.s) || 0,
    d: Number(r.d) || 0,
    psi: Number(r.psi) || 0,
    speed: Number(r.speed) || 0,
    rpm: Number(r.rpm) || 4000,
    gear: Number(r.gear) || 1,
    lean: Number(r.lean) || 0,
    wheelieAngle: Number(r.wheelieAngle) || 0,
    rearSlip: Number(r.rearSlip) || 0,
    brake: Number(r.brake) || 0,
    throttle: Number(r.throttle) || 0,
    tuck: Boolean(r.tuck),
    onKerb: Boolean(r.onKerb),
    offTrack: Boolean(r.offTrack),
    highsideTimer: Number(r.highsideTimer) || 0,
    slipstreamBoost: Number(r.slipstreamBoost) || 0,
    lap: Number(r.lap) || 1,
    position: Number(r.position) || 1,
    totalDistance: Number(r.totalDistance) || 0,
    lapTime: Number(r.lapTime) || 0,
    bestLapTime: r.bestLapTime ?? null,
    finished: Boolean(r.finished),
    world: {
      x: Number(w.x) || 0,
      y: Number(w.y) || 0,
      z: Number(w.z) || 0,
      heading: Number(w.heading) || 0,
      pitch: Number(w.pitch) || 0,
      roll: Number(w.roll ?? r.lean) || 0
    }
  };
}

/**
 * Captures an array of rider snapshots.
 * @param {Array<object>} riders
 */
export function snapshotRiders(riders = []) {
  const arr = [];
  for (let i = 0; i < riders.length; i++) {
    if (riders[i]) {
      arr.push(snapshotRider(riders[i]));
    }
  }
  return arr;
}

/**
 * Interpolates between two rider state snapshots for smooth slow-motion playback.
 * When alpha === 0, returns an exact clone of rider a.
 */
export function interpolateRiderSnapshot(a, b, alpha, totalLength = 0) {
  if (!a) return b ? snapshotRider(b) : null;
  if (!b || alpha <= 1e-6) return snapshotRider(a);
  if (alpha >= 1 - 1e-6) return snapshotRider(b);

  const t = clamp(alpha, 0, 1);
  let interpS = lerp(a.s, b.s, t);
  if (totalLength > 0 && Math.abs(b.s - a.s) > totalLength * 0.5) {
    const deltaS = ((b.s - a.s + totalLength * 1.5) % totalLength) - totalLength * 0.5;
    interpS = ((a.s + deltaS * t) % totalLength + totalLength) % totalLength;
  }

  const wa = a.world || {};
  const wb = b.world || {};

  return {
    id: a.id,
    name: a.name,
    isAI: a.isAI,
    playerIndex: a.playerIndex,
    bike: a.bike ? { ...a.bike } : null,
    s: interpS,
    d: lerp(a.d, b.d, t),
    psi: lerpAngle(a.psi, b.psi, t),
    speed: lerp(a.speed, b.speed, t),
    rpm: lerp(a.rpm, b.rpm, t),
    gear: t < 0.5 ? a.gear : b.gear,
    lean: lerp(a.lean, b.lean, t),
    wheelieAngle: lerp(a.wheelieAngle, b.wheelieAngle, t),
    rearSlip: lerp(a.rearSlip, b.rearSlip, t),
    brake: lerp(a.brake, b.brake, t),
    throttle: lerp(a.throttle, b.throttle, t),
    tuck: t < 0.5 ? a.tuck : b.tuck,
    onKerb: t < 0.5 ? a.onKerb : b.onKerb,
    offTrack: t < 0.5 ? a.offTrack : b.offTrack,
    highsideTimer: lerp(a.highsideTimer || 0, b.highsideTimer || 0, t),
    slipstreamBoost: lerp(a.slipstreamBoost || 0, b.slipstreamBoost || 0, t),
    lap: t < 0.5 ? a.lap : b.lap,
    position: t < 0.5 ? a.position : b.position,
    totalDistance: lerp(a.totalDistance || 0, b.totalDistance || 0, t),
    lapTime: lerp(a.lapTime || 0, b.lapTime || 0, t),
    bestLapTime: t < 0.5 ? a.bestLapTime : b.bestLapTime,
    finished: t < 0.5 ? a.finished : b.finished,
    world: {
      x: lerp(wa.x || 0, wb.x || 0, t),
      y: lerp(wa.y || 0, wb.y || 0, t),
      z: lerp(wa.z || 0, wb.z || 0, t),
      heading: lerpAngle(wa.heading || 0, wb.heading || 0, t),
      pitch: lerp(wa.pitch || 0, wb.pitch || 0, t),
      roll: lerp(wa.roll || 0, wb.roll || 0, t)
    }
  };
}

function attachFrameMetadata(riderArray, time, index, focusIndex = 0) {
  Object.defineProperty(riderArray, 'time', { value: time, enumerable: false, writable: true, configurable: true });
  Object.defineProperty(riderArray, 'index', { value: index, enumerable: false, writable: true, configurable: true });
  Object.defineProperty(riderArray, 'riders', { value: riderArray, enumerable: false, writable: true, configurable: true });
  Object.defineProperty(riderArray, 'focusIndex', { value: focusIndex, enumerable: false, writable: true, configurable: true });
  Object.defineProperty(riderArray, 'focusedRider', { value: riderArray[focusIndex] || riderArray[0] || null, enumerable: false, writable: true, configurable: true });
  return riderArray;
}

/**
 * Creates a 60 Hz race replay recorder and playback controller.
 * @param {object} [options]
 * @param {number} [options.hz=60]
 * @param {number} [options.maxDuration=600]
 * @param {number} [options.maxFrames]
 */
export function createReplayRecorder(options = {}) {
  const hz = Number(options.hz) > 0 ? Number(options.hz) : REPLAY_HZ;
  const sampleDt = 1 / hz;
  const maxDuration = Number(options.maxDuration) > 0 ? Number(options.maxDuration) : MAX_REPLAY_DURATION;
  const maxFrames = Number(options.maxFrames) > 0 ? Number(options.maxFrames) : Math.round(hz * maxDuration);

  let frames = [];
  let recordAccumulator = sampleDt; // Start ready so the first call at t=0 records immediately
  let elapsedRecordTime = 0;
  let trackTotalLength = 0;
  let trackId = 'sakura';

  // Playback state
  let playing = true;
  let playbackSpeed = 1.0;
  let playbackTime = 0;
  let focusMode = 'p1'; // 'p1' | 'p2' | 'leader'
  let tvMode = true;    // true = Trackside TV cams, false = Chase cam

  function reset(meta = {}) {
    frames = [];
    recordAccumulator = sampleDt;
    elapsedRecordTime = 0;
    if (meta && meta.trackLength) trackTotalLength = Number(meta.trackLength) || 0;
    if (meta && meta.trackId) trackId = String(meta.trackId);
    playing = true;
    playbackSpeed = 1.0;
    playbackTime = 0;
    focusMode = 'p1';
    tvMode = true;
  }

  /**
   * Unconditionally records a single 60 Hz snapshot frame.
   * @param {Array<object>} riders
   * @param {number} [explicitTime]
   */
  function recordFrame(riders = [], explicitTime) {
    if (!Array.isArray(riders) || riders.length === 0) return null;
    if (frames.length >= maxFrames) {
      return frames[frames.length - 1];
    }
    const frameIndex = frames.length;
    const frameTime = explicitTime !== undefined && Number.isFinite(explicitTime)
      ? Number(explicitTime)
      : frameIndex * sampleDt;

    const snap = snapshotRiders(riders);
    attachFrameMetadata(snap, frameTime, frameIndex, resolveFocusIndex(snap));
    frames.push(snap);
    return snap;
  }

  /**
   * Records rider states at 60 Hz when called from a variable or fixed timestep (e.g. 120 Hz).
   * If dt is omitted, records a frame immediately.
   * @param {Array<object>} riders
   * @param {number} [dt]
   */
  function record(riders = [], dt) {
    if (!Array.isArray(riders) || riders.length === 0) return false;
    if (dt === undefined || dt === null) {
      recordFrame(riders);
      return true;
    }

    const stepDt = Math.max(0, Number(dt) || 0);
    // On first call after reset, recordAccumulator === sampleDt so frame 0 is captured at t = 0
    if (frames.length === 0 && recordAccumulator >= sampleDt - 1e-7) {
      recordFrame(riders, 0);
      recordAccumulator = 0;
      elapsedRecordTime = 0;
      // Still advance elapsed time by stepDt for subsequent steps
      recordAccumulator += stepDt;
      elapsedRecordTime += stepDt;
      return true;
    }

    recordAccumulator += stepDt;
    elapsedRecordTime += stepDt;

    let recordedAny = false;
    while (recordAccumulator >= sampleDt - 1e-7) {
      recordAccumulator -= sampleDt;
      if (frames.length < maxFrames) {
        recordFrame(riders, frames.length * sampleDt);
        recordedAny = true;
      } else {
        break;
      }
    }
    return recordedAny;
  }

  function getFrameCount() {
    return frames.length;
  }

  function getDuration() {
    if (frames.length <= 1) return 0;
    return (frames.length - 1) * sampleDt;
  }

  function getFrame(index = 0) {
    if (frames.length === 0) return [];
    const idx = clamp(Math.floor(Number(index) || 0), 0, frames.length - 1);
    const cloned = snapshotRiders(frames[idx]);
    const focusIdx = resolveFocusIndex(cloned);
    return attachFrameMetadata(cloned, frames[idx].time ?? idx * sampleDt, idx, focusIdx);
  }

  /**
   * Resolves which rider index in the snapshot array matches the current focusMode ('p1' | 'p2' | 'leader').
   * @param {Array<object>} riderList
   * @param {string} [modeOverride]
   */
  function resolveFocusIndex(riderList = [], modeOverride = focusMode) {
    if (!Array.isArray(riderList) || riderList.length === 0) return 0;
    const mode = String(modeOverride || focusMode).toLowerCase();

    if (mode === 'leader') {
      let bestIdx = 0;
      let bestPos = Infinity;
      let bestDist = -Infinity;
      for (let i = 0; i < riderList.length; i++) {
        const r = riderList[i];
        if (!r) continue;
        const pos = Number(r.position) || 99;
        const dist = Number(r.totalDistance) || Number(r.s) || 0;
        if (pos < bestPos || (pos === bestPos && dist > bestDist)) {
          bestPos = pos;
          bestDist = dist;
          bestIdx = i;
        }
      }
      return bestIdx;
    }

    if (mode === 'p2') {
      const p2Idx = riderList.findIndex((r) => r && (r.id === 'p2' || r.playerIndex === 1));
      if (p2Idx >= 0) return p2Idx;
      return riderList.length > 1 ? 1 : 0;
    }

    // Default 'p1'
    const p1Idx = riderList.findIndex((r) => r && (r.id === 'p1' || r.playerIndex === 0));
    return p1Idx >= 0 ? p1Idx : 0;
  }

  /**
   * Samples or interpolates all riders at a given replay timestamp in seconds.
   * @param {number} timeSec
   */
  function getSnapshotAtTime(timeSec = playbackTime) {
    if (frames.length === 0) {
      return attachFrameMetadata([], 0, 0, 0);
    }
    const duration = getDuration();
    const clampedTime = clamp(Number(timeSec) || 0, 0, duration);
    const exactIndex = clampedTime / sampleDt;
    const idxA = clamp(Math.floor(exactIndex), 0, frames.length - 1);
    const idxB = clamp(idxA + 1, 0, frames.length - 1);
    const alpha = exactIndex - idxA;

    const frameA = frames[idxA];
    const frameB = frames[idxB];
    const count = frameA.length;
    const interpolated = new Array(count);

    for (let i = 0; i < count; i++) {
      interpolated[i] = interpolateRiderSnapshot(
        frameA[i],
        frameB ? frameB[i] : frameA[i],
        alpha,
        trackTotalLength
      );
    }

    const focusIdx = resolveFocusIndex(interpolated);
    return attachFrameMetadata(interpolated, clampedTime, idxA, focusIdx);
  }

  function startPlayback() {
    playbackTime = 0;
    playing = true;
    return getSnapshotAtTime(playbackTime);
  }

  function play() {
    playing = true;
  }

  function pause() {
    playing = false;
  }

  function togglePlay() {
    playing = !playing;
    return playing;
  }

  function setSpeed(mult) {
    const num = Number(mult);
    if (REPLAY_SPEEDS.includes(num)) {
      playbackSpeed = num;
    } else if (Number.isFinite(num) && num > 0) {
      playbackSpeed = clamp(num, 0.1, 4.0);
    }
    return playbackSpeed;
  }

  function cycleSpeed() {
    const idx = REPLAY_SPEEDS.indexOf(playbackSpeed);
    const nextIdx = (idx + 1) % REPLAY_SPEEDS.length;
    playbackSpeed = REPLAY_SPEEDS[nextIdx];
    return playbackSpeed;
  }

  function seek(timeSec) {
    const duration = getDuration();
    playbackTime = clamp(Number(timeSec) || 0, 0, duration);
    return getSnapshotAtTime(playbackTime);
  }

  function seekProgress(progress0to1) {
    const duration = getDuration();
    const ratio = clamp(Number(progress0to1) || 0, 0, 1);
    playbackTime = ratio * duration;
    return getSnapshotAtTime(playbackTime);
  }

  function setFocusMode(mode) {
    const m = String(mode || 'p1').toLowerCase();
    if (REPLAY_FOCUS_MODES.includes(m)) {
      focusMode = m;
    }
    return focusMode;
  }

  function cycleFocusMode(currentRiders = null) {
    const list = currentRiders || (frames.length > 0 ? frames[0] : []);
    const hasP2 = Array.isArray(list) && list.some((r) => r && (r.id === 'p2' || r.playerIndex === 1));
    const modes = hasP2 ? ['p1', 'p2', 'leader'] : ['p1', 'leader'];
    const curIdx = modes.indexOf(focusMode);
    focusMode = modes[(curIdx + 1) % modes.length];
    return focusMode;
  }

  function setTvMode(enabled) {
    tvMode = Boolean(enabled);
    return tvMode;
  }

  function toggleCameraMode() {
    tvMode = !tvMode;
    return tvMode ? 'tv' : 'chase';
  }

  /**
   * Advances replay playback by real dt * playbackSpeed and returns the current snapshot & UI state.
   * @param {number} dt
   */
  function stepPlayback(dt = REPLAY_DT) {
    const duration = getDuration();
    if (playing && duration > 0) {
      playbackTime += Math.max(0, Number(dt) || 0) * playbackSpeed;
      if (playbackTime > duration) {
        playbackTime = playbackTime % duration;
      }
    }

    const riders = getSnapshotAtTime(playbackTime);
    const focusIndex = riders.focusIndex ?? 0;
    const focusedRider = riders[focusIndex] || riders[0] || null;
    const progress = duration > 0 ? clamp(playbackTime / duration, 0, 1) : 0;

    return {
      riders,
      focusIndex,
      focusedRider,
      focusMode,
      tvMode,
      cameraMode: tvMode ? 'tv' : 'chase',
      currentTime: playbackTime,
      duration,
      progress,
      playing,
      speed: playbackSpeed,
      frameCount: frames.length
    };
  }

  return {
    get frames() {
      return frames;
    },
    get maxFrames() {
      return maxFrames;
    },
    get hz() {
      return hz;
    },
    get trackId() {
      return trackId;
    },
    reset,
    clear: reset,
    startRecording: reset,
    record,
    stepRecord: record,
    recordFrame,
    getFrameCount,
    getDuration,
    getFrame,
    getRidersAtFrame: getFrame,
    getSnapshotAtTime,
    getFrameAtTime: getSnapshotAtTime,
    sampleAtTime: getSnapshotAtTime,
    getRidersAtTime: getSnapshotAtTime,
    resolveFocusIndex,
    startPlayback,
    play,
    pause,
    togglePlay,
    isPlaying: () => playing,
    setSpeed,
    cycleSpeed,
    getSpeed: () => playbackSpeed,
    seek,
    seekProgress,
    getCurrentTime: () => playbackTime,
    getProgress: () => {
      const d = getDuration();
      return d > 0 ? clamp(playbackTime / d, 0, 1) : 0;
    },
    setFocusMode,
    cycleFocusMode,
    getFocusMode: () => focusMode,
    setTvMode,
    toggleCameraMode,
    isTvMode: () => tvMode,
    getCameraMode: () => (tvMode ? 'tv' : 'chase'),
    stepPlayback,
    update: stepPlayback
  };
}

export const createReplaySystem = createReplayRecorder;
export const createReplay = createReplayRecorder;
export class ReplayRecorder {
  constructor(options) {
    return createReplayRecorder(options);
  }
}
