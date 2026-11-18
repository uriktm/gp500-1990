// Pure JS Netcode Core + Browser WebRTC Session for 500cc Grand Prix '90
// Zero external dependencies; pure-JS functions run identically in Node.js and browsers.

export const DEFAULT_MAX_EXTRAP_MS = 150;
export const ICE_GATHER_TIMEOUT_MS = 3000;
export const CONNECT_TIMEOUT_MS = 15000;
export const SIGNAL_POLL_INTERVAL_MS = 1000;
export const CLOCK_SYNC_INTERVAL_MS = 1000;
export const CLOCK_SAMPLE_WINDOW = 5;

const DEFAULT_ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }
];

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

function finiteNum(val, fallback = 0) {
  if (val === undefined || val === null || val === '') return fallback;
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

function finiteNumOrNull(val) {
  if (val === undefined || val === null || val === '') return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

function toBool(val) {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') {
    const s = val.trim().toLowerCase();
    if (s === 'false' || s === '0' || s === '') return false;
    return true;
  }
  return Boolean(val);
}

function wrapS(s, trackLength) {
  if (!(trackLength > 0)) return s;
  let res = s % trackLength;
  if (res < 0) res += trackLength;
  if (res >= trackLength || Object.is(res, -0)) res = 0;
  return res;
}

function wrapAngle(angle) {
  let a = (angle + Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a - Math.PI;
}

function lerp(a, b, alpha) {
  return a + (b - a) * alpha;
}

function lerpAngle(a, b, alpha) {
  return wrapAngle(a + wrapAngle(b - a) * alpha);
}

function medianOf(values) {
  if (!values || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) * 0.5;
}

function normalizePacketFields(src, seqOverride, tOverride) {
  const sObj = src && typeof src === 'object' ? src : {};
  return {
    seq: Math.trunc(finiteNum(seqOverride !== undefined ? seqOverride : sObj.seq, 0)),
    t: finiteNum(tOverride !== undefined ? tOverride : sObj.t, 0),
    s: finiteNum(sObj.s, 0),
    d: finiteNum(sObj.d, 0),
    psi: finiteNum(sObj.psi, 0),
    speed: finiteNum(sObj.speed, 0),
    rpm: finiteNum(sObj.rpm, 4000),
    gear: Math.trunc(finiteNum(sObj.gear, 1)),
    lean: finiteNum(sObj.lean, 0),
    wheelieAngle: finiteNum(sObj.wheelieAngle, 0),
    rearSlip: finiteNum(sObj.rearSlip, 0),
    brake: finiteNum(sObj.brake, 0),
    throttle: finiteNum(sObj.throttle, 0),
    tuck: toBool(sObj.tuck),
    onKerb: toBool(sObj.onKerb),
    offTrack: toBool(sObj.offTrack),
    lap: Math.trunc(finiteNum(sObj.lap, 1)),
    lapTime: finiteNum(sObj.lapTime, 0),
    bestLapTime: finiteNumOrNull(sObj.bestLapTime),
    totalTime: finiteNum(sObj.totalTime, 0),
    finished: toBool(sObj.finished)
  };
}

/**
 * Encodes a rider state object into a compact network telemetry packet.
 * @param {object} rider
 * @param {number} [seq=0]
 * @param {number} [t=0]
 * @returns {object}
 */
export function encodeRiderState(rider, seq = 0, t = 0) {
  return normalizePacketFields(rider, seq, t);
}

/**
 * Safely parses a JSON string or raw object into a normalized rider telemetry packet.
 * Returns null if the payload is not a valid JSON object.
 * @param {string|object} raw
 * @returns {object|null}
 */
export function decodeRiderState(raw) {
  if (raw === null || raw === undefined) return null;
  let parsed = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      parsed = JSON.parse(trimmed);
    } catch (_err) {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  const source =
    parsed.s === undefined && parsed.payload && typeof parsed.payload === 'object' && !Array.isArray(parsed.payload)
      ? parsed.payload
      : parsed;
  return normalizePacketFields(source);
}

/**
 * Interpolates or extrapolates a remote rider's state from a time-sorted snapshot buffer.
 * Handles circular track wraparound on `s` and caps extrapolation at `maxExtrapMs`.
 * @param {Array<object>} buffer
 * @param {number} renderTime
 * @param {number} trackLength
 * @param {number} [maxExtrapMs=150]
 * @returns {object|null}
 */
export function interpolateRider(buffer, renderTime, trackLength, maxExtrapMs = DEFAULT_MAX_EXTRAP_MS) {
  if (!Array.isArray(buffer) || buffer.length === 0) {
    return null;
  }

  let sorted = buffer;
  for (let i = 1; i < buffer.length; i++) {
    if (finiteNum(buffer[i]?.t, 0) < finiteNum(buffer[i - 1]?.t, 0)) {
      sorted = [...buffer].sort((a, b) => finiteNum(a?.t, 0) - finiteNum(b?.t, 0));
      break;
    }
  }

  const len = finiteNum(trackLength, 0);
  const latestRaw = sorted[sorted.length - 1];
  const targetTime = Number.isFinite(Number(renderTime)) ? Number(renderTime) : finiteNum(latestRaw?.t, 0);

  // Before or at earliest snapshot
  const first = normalizePacketFields(sorted[0]);
  if (targetTime <= first.t) {
    first.s = wrapS(first.s, len);
    first.t = targetTime;
    return first;
  }

  // Extrapolate smoothly past latest snapshot, capped at maxExtrapMs
  const latest = normalizePacketFields(latestRaw);
  if (targetTime >= latest.t) {
    const capMs = Math.max(0, finiteNum(maxExtrapMs, DEFAULT_MAX_EXTRAP_MS));
    const extrapMs = Math.min(Math.max(0, targetTime - latest.t), capMs);
    const dtSec = extrapMs / 1000;
    const ds = latest.speed * Math.cos(latest.psi) * dtSec;
    const dd = latest.speed * Math.sin(latest.psi) * dtSec;

    return {
      ...latest,
      t: latest.t + extrapMs,
      s: wrapS(latest.s + ds, len),
      d: latest.d + dd
    };
  }

  // Find bracketing snapshots [a, b] where a.t <= targetTime <= b.t
  let idx = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    if (finiteNum(sorted[i + 1]?.t, 0) >= targetTime) {
      idx = i;
      break;
    }
  }

  const a = normalizePacketFields(sorted[idx]);
  const b = normalizePacketFields(sorted[idx + 1]);
  const span = b.t - a.t;
  const alpha = span > 0 ? clamp((targetTime - a.t) / span, 0, 1) : 1;

  const sa = wrapS(a.s, len);
  const sb = wrapS(b.s, len);
  let interpS;
  let crossedLapLine = false;

  if (len > 0) {
    const deltaS = ((sb - sa) % len + len * 1.5) % len - len * 0.5;
    const rawS = sa + deltaS * alpha;
    interpS = wrapS(rawS, len);
    if (b.lap > a.lap && deltaS > 0 && sa > len * 0.7 && sb < len * 0.3) {
      crossedLapLine = rawS >= len;
    }
  } else {
    interpS = lerp(a.s, b.s, alpha);
  }

  const nearest = alpha < 0.5 ? a : b;
  const lap =
    len > 0 && b.lap > a.lap && sa > len * 0.7 && sb < len * 0.3
      ? (crossedLapLine ? b.lap : a.lap)
      : nearest.lap;

  const lapTime = a.lap === b.lap ? lerp(a.lapTime, b.lapTime, alpha) : nearest.lapTime;

  return {
    seq: nearest.seq,
    t: targetTime,
    s: interpS,
    d: lerp(a.d, b.d, alpha),
    psi: lerpAngle(a.psi, b.psi, alpha),
    speed: lerp(a.speed, b.speed, alpha),
    rpm: lerp(a.rpm, b.rpm, alpha),
    gear: nearest.gear,
    lean: lerp(a.lean, b.lean, alpha),
    wheelieAngle: lerp(a.wheelieAngle, b.wheelieAngle, alpha),
    rearSlip: lerp(a.rearSlip, b.rearSlip, alpha),
    brake: lerp(a.brake, b.brake, alpha),
    throttle: lerp(a.throttle, b.throttle, alpha),
    tuck: nearest.tuck,
    onKerb: nearest.onKerb,
    offTrack: nearest.offTrack,
    lap,
    lapTime,
    bestLapTime: nearest.bestLapTime,
    totalTime: lerp(a.totalTime, b.totalTime, alpha),
    finished: nearest.finished
  };
}

/**
 * Computes median-filtered RTT and clock offset from up to the last 5 `{ rtt, offset }` samples.
 * @param {Array<{ rtt: number, offset: number }>} samples
 * @returns {{ rttMs: number, offsetMs: number }}
 */
export function estimateClockOffset(samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    return { rttMs: 0, offsetMs: 0 };
  }

  const valid = [];
  for (let i = 0; i < samples.length; i++) {
    const item = samples[i];
    if (!item || typeof item !== 'object') continue;
    const rtt = finiteNumOrNull(item.rtt ?? item.rttMs);
    const offset = finiteNumOrNull(item.offset ?? item.offsetMs);
    if (rtt !== null && offset !== null) {
      valid.push({ rtt: Math.max(0, rtt), offset });
    }
  }

  if (valid.length === 0) {
    return { rttMs: 0, offsetMs: 0 };
  }

  const recent = valid.slice(-CLOCK_SAMPLE_WINDOW);
  return {
    rttMs: medianOf(recent.map((s) => s.rtt)),
    offsetMs: medianOf(recent.map((s) => s.offset))
  };
}

/**
 * Waits for WebRTC non-trickle ICE gathering to complete or reach `timeoutMs` (default 3000ms).
 * @param {RTCPeerConnection} pc
 * @param {number} [timeoutMs=3000]
 * @returns {Promise<void>}
 */
export function waitForIceGatheringComplete(pc, timeoutMs = ICE_GATHER_TIMEOUT_MS) {
  if (!pc || pc.iceGatheringState === 'complete' || pc.signalingState === 'closed') {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let settled = false;
    let timer = null;

    const cleanup = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (typeof pc.removeEventListener === 'function') {
        pc.removeEventListener('icegatheringstatechange', onStateChange);
        pc.removeEventListener('icecandidate', onCandidate);
      }
    };

    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    const onStateChange = () => {
      if (pc.iceGatheringState === 'complete' || pc.signalingState === 'closed') {
        finish();
      }
    };

    const onCandidate = (event) => {
      if (event && event.candidate === null) {
        finish();
      }
    };

    if (typeof pc.addEventListener === 'function') {
      pc.addEventListener('icegatheringstatechange', onStateChange);
      pc.addEventListener('icecandidate', onCandidate);
    } else {
      pc.onicegatheringstatechange = onStateChange;
      pc.onicecandidate = onCandidate;
    }

    timer = setTimeout(finish, Math.max(0, finiteNum(timeoutMs, ICE_GATHER_TIMEOUT_MS)));
  });
}

function resolveUrlRelayFlag() {
  if (typeof window === 'undefined' || !window.location || !window.location.search) {
    return false;
  }
  try {
    return new URLSearchParams(window.location.search).get('relay') === '1';
  } catch (_err) {
    return false;
  }
}

function defaultNow() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function serializeDescription(desc) {
  if (!desc) return null;
  return { type: desc.type, sdp: desc.sdp };
}

/**
 * Creates a browser WebRTC online 1v1 session using non-trickle HTTP room signaling
 * and dual DataChannels (`gp500-reliable` and `gp500-fast`) with median clock sync.
 * @param {object} [opts]
 */
export function createOnlineSession(opts = {}) {
  const role = opts.role === 'guest' ? 'guest' : 'host';
  const apiBase = opts.apiBase || '/api/room';
  const relayOnly = Boolean(opts.relayOnly || resolveUrlRelayFlag());
  const fetchImpl = opts.fetchFn || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  const PeerConn =
    opts.RTCPeerConnectionClass ||
    (typeof RTCPeerConnection === 'function' ? RTCPeerConnection : null);
  const nowFn = opts.nowFn || defaultNow;

  const iceGatherTimeoutMs = finiteNum(opts.iceGatherTimeoutMs, ICE_GATHER_TIMEOUT_MS);
  const connectTimeoutMs = finiteNum(opts.connectTimeoutMs, CONNECT_TIMEOUT_MS);
  const pollIntervalMs = finiteNum(opts.pollIntervalMs, SIGNAL_POLL_INTERVAL_MS);
  const pingIntervalMs = finiteNum(opts.pingIntervalMs, CLOCK_SYNC_INTERVAL_MS);

  let roomCode = opts.code ? String(opts.code).trim().toUpperCase() : null;
  let hostMeta = opts.hostMeta || null;
  let guestMeta = opts.guestMeta || null;

  let pc = null;
  let reliableChannel = null;
  let fastChannel = null;
  let reliableOpen = false;
  let fastOpen = false;

  let closed = false;
  let started = false;
  let hasConnected = false;
  let disconnectedNotified = false;
  let errorNotified = false;

  let transportType = null;
  let statsRttMs = null;
  let clockSamples = [];
  let peerSync = { rttMs: 0, offsetMs: 0 };
  let clockSync = { rttMs: 0, offsetMs: 0 };

  let pollTimer = null;
  let connectTimer = null;
  let pingTimer = null;
  const auxTimers = [];

  function clearAllTimers() {
    if (pollTimer !== null) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    if (connectTimer !== null) {
      clearTimeout(connectTimer);
      connectTimer = null;
    }
    if (pingTimer !== null) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
    while (auxTimers.length > 0) {
      clearTimeout(auxTimers.pop());
    }
  }

  function effectiveRttMs() {
    if (clockSamples.length > 0) {
      return Math.round(clockSync.rttMs);
    }
    return statsRttMs !== null ? Math.round(statsRttMs) : 0;
  }

  function emitStatus(phase, extra = {}) {
    if (typeof opts.onStatus !== 'function') return;
    opts.onStatus({
      phase,
      role,
      code: roomCode,
      transportType,
      rttMs: effectiveRttMs(),
      hostMeta,
      guestMeta,
      ...extra
    });
  }

  function emitError(message) {
    if (closed || errorNotified) return;
    errorNotified = true;
    clearAllTimers();
    const msg = message instanceof Error ? message.message : String(message || 'Connection error');
    emitStatus('error', { error: msg });
    if (typeof opts.onError === 'function') {
      opts.onError(msg);
    }
    cleanupPeerConnection();
  }

  function cleanupPeerConnection() {
    try {
      if (reliableChannel) reliableChannel.close();
    } catch (_e) {
      // ignore close errors
    }
    try {
      if (fastChannel) fastChannel.close();
    } catch (_e) {
      // ignore close errors
    }
    try {
      if (pc) pc.close();
    } catch (_e) {
      // ignore close errors
    }
    reliableChannel = null;
    fastChannel = null;
    pc = null;
    reliableOpen = false;
    fastOpen = false;
  }

  function startConnectTimeout() {
    if (connectTimer !== null || hasConnected || closed) return;
    connectTimer = setTimeout(() => {
      connectTimer = null;
      if (!hasConnected && !closed) {
        emitError('Connection timed out (15s) while establishing WebRTC DataChannel.');
      }
    }, Math.max(100, connectTimeoutMs));
  }

  function clearConnectTimeout() {
    if (connectTimer !== null) {
      clearTimeout(connectTimer);
      connectTimer = null;
    }
  }

  async function inspectTransportStats() {
    if (!pc || typeof pc.getStats !== 'function' || closed) return null;
    try {
      const stats = await pc.getStats();
      let selectedPair = null;
      const pairs = [];

      for (const report of stats.values()) {
        if (report.type === 'transport' && report.selectedCandidatePairId) {
          selectedPair = stats.get(report.selectedCandidatePairId) || null;
        } else if (report.type === 'candidate-pair') {
          pairs.push(report);
        }
      }

      if (!selectedPair) {
        selectedPair =
          pairs.find((p) => p.selected && p.state === 'succeeded') ||
          pairs.find((p) => p.nominated && p.state === 'succeeded') ||
          pairs.find((p) => p.state === 'succeeded') ||
          null;
      }
      if (!selectedPair) return null;

      const localCand = selectedPair.localCandidateId ? stats.get(selectedPair.localCandidateId) : null;
      const remoteCand = selectedPair.remoteCandidateId ? stats.get(selectedPair.remoteCandidateId) : null;
      const localType = localCand?.candidateType || null;
      const remoteType = remoteCand?.candidateType || null;

      let detected = localType || remoteType || null;
      if (localType === 'relay' || remoteType === 'relay') {
        detected = 'relay';
      }

      const pairRtt = Number.isFinite(selectedPair.currentRoundTripTime)
        ? selectedPair.currentRoundTripTime * 1000
        : null;

      return { transportType: detected, rttMs: pairRtt };
    } catch (_err) {
      return null;
    }
  }

  function sendReliableRaw(obj) {
    if (closed || !reliableChannel || reliableChannel.readyState !== 'open') {
      return false;
    }
    try {
      reliableChannel.send(JSON.stringify(obj));
      return true;
    } catch (_err) {
      return false;
    }
  }

  function sendPing() {
    sendReliableRaw({ type: 'ping', t0: nowFn() });
  }

  function startClockSyncLoop() {
    if (pingTimer !== null || closed) return;
    sendPing();
    auxTimers.push(setTimeout(() => !closed && sendPing(), 60));
    auxTimers.push(setTimeout(() => !closed && sendPing(), 160));
    pingTimer = setInterval(() => {
      if (!closed && reliableChannel && reliableChannel.readyState === 'open') {
        sendPing();
      }
    }, Math.max(100, pingIntervalMs));
  }

  function handleClockPong(msg) {
    const t0 = finiteNumOrNull(msg.t0);
    const t1 = finiteNumOrNull(msg.t1);
    if (t0 === null || t1 === null) return;
    const t2 = nowFn();
    const rtt = Math.max(0, t2 - t0);
    const rawOffset = (t0 + t2) * 0.5 - t1;

    clockSamples.push({ rtt, offset: rawOffset });
    if (clockSamples.length > CLOCK_SAMPLE_WINDOW) {
      clockSamples = clockSamples.slice(-CLOCK_SAMPLE_WINDOW);
    }

    const prevRtt = Math.round(clockSync.rttMs);
    peerSync = estimateClockOffset(clockSamples);
    clockSync = {
      rttMs: peerSync.rttMs,
      offsetMs: role === 'host' ? 0 : peerSync.offsetMs
    };

    if (hasConnected && Math.abs(Math.round(clockSync.rttMs) - prevRtt) >= 2) {
      emitStatus('connected');
    }
  }

  function handlePeerDisconnected(reason) {
    if (closed || disconnectedNotified || !hasConnected) return;
    disconnectedNotified = true;
    clearAllTimers();
    emitStatus('disconnected', { reason: reason || 'Peer disconnected' });
  }

  async function onBothChannelsReady() {
    if (closed || hasConnected) return;
    hasConnected = true;
    clearConnectTimeout();

    const initialStats = await inspectTransportStats();
    if (closed) return;

    if (initialStats?.transportType) {
      transportType = initialStats.transportType;
    } else {
      transportType = relayOnly ? 'relay' : 'host';
      // Retry stats shortly in case Chromium populates selectedCandidatePair slightly after open
      auxTimers.push(
        setTimeout(async () => {
          const retryStats = await inspectTransportStats();
          if (closed || !retryStats) return;
          let updated = false;
          if (retryStats.transportType && retryStats.transportType !== transportType) {
            transportType = retryStats.transportType;
            updated = true;
          }
          if (retryStats.rttMs !== null) {
            statsRttMs = retryStats.rttMs;
            updated = true;
          }
          if (updated && !disconnectedNotified) {
            emitStatus('connected');
          }
        }, 200)
      );
    }

    if (initialStats?.rttMs !== null && initialStats?.rttMs !== undefined) {
      statsRttMs = initialStats.rttMs;
    }

    startClockSyncLoop();
    emitStatus('connected');
  }

  function checkChannelsOpen() {
    if (reliableOpen && fastOpen && !hasConnected && !closed) {
      onBothChannelsReady();
    }
  }

  function attachReliableChannel(ch) {
    reliableChannel = ch;
    reliableOpen = ch.readyState === 'open';

    ch.onopen = () => {
      reliableOpen = true;
      checkChannelsOpen();
    };

    ch.onmessage = (event) => {
      if (closed) return;
      let msg;
      try {
        msg = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      } catch (_err) {
        return;
      }
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === 'ping') {
        sendReliableRaw({ type: 'pong', t0: msg.t0, t1: nowFn() });
        return;
      }
      if (msg.type === 'pong') {
        handleClockPong(msg);
        return;
      }
      if (msg._nc === 'lobby') {
        if (typeof opts.onLobby === 'function') opts.onLobby(msg.payload);
        return;
      }
      if (msg._nc === 'race') {
        if (typeof opts.onRaceEvent === 'function') opts.onRaceEvent(msg.payload);
        return;
      }
    };

    ch.onclose = () => {
      reliableOpen = false;
      handlePeerDisconnected('Reliable channel closed');
    };

    ch.onerror = () => {
      if (!hasConnected && !closed) {
        emitError('Reliable DataChannel error');
      }
    };

    if (reliableOpen) {
      checkChannelsOpen();
    }
  }

  function attachFastChannel(ch) {
    fastChannel = ch;
    fastOpen = ch.readyState === 'open';

    ch.onopen = () => {
      fastOpen = true;
      checkChannelsOpen();
    };

    ch.onmessage = (event) => {
      if (closed) return;
      const packet = decodeRiderState(event.data);
      if (packet && typeof opts.onPeerState === 'function') {
        const receivedAt = nowFn();
        const localTime = clockSamples.length > 0 ? packet.t + peerSync.offsetMs : receivedAt;
        opts.onPeerState(packet, { localTime, receivedAt });
      }
    };

    ch.onclose = () => {
      fastOpen = false;
      handlePeerDisconnected('Fast channel closed');
    };

    ch.onerror = () => {
      if (!hasConnected && !closed) {
        emitError('Fast DataChannel error');
      }
    };

    if (fastOpen) {
      checkChannelsOpen();
    }
  }

  function createPeerConnection(iceServers) {
    if (!PeerConn) {
      throw new Error('WebRTC RTCPeerConnection is unavailable in this environment.');
    }
    const resolvedIce =
      Array.isArray(iceServers) && iceServers.length > 0 ? iceServers : DEFAULT_ICE_SERVERS;
    const rtcConfig = relayOnly
      ? { iceServers: resolvedIce, iceTransportPolicy: 'relay' }
      : { iceServers: resolvedIce };

    const conn = new PeerConn(rtcConfig);
    conn.onconnectionstatechange = () => {
      if (closed) return;
      if (conn.connectionState === 'failed') {
        if (!hasConnected) {
          emitError('WebRTC peer connection failed.');
        } else {
          handlePeerDisconnected('Peer connection lost');
        }
      } else if (conn.connectionState === 'closed' && hasConnected) {
        handlePeerDisconnected('Peer connection closed');
      }
    };

    conn.oniceconnectionstatechange = () => {
      if (closed) return;
      if (conn.iceConnectionState === 'failed') {
        if (!hasConnected) {
          emitError('ICE connectivity check failed.');
        } else {
          handlePeerDisconnected('ICE connection lost');
        }
      }
    };

    return conn;
  }

  async function fetchJson(url, fetchOpts = {}) {
    if (!fetchImpl) {
      throw new Error('Fetch API is unavailable.');
    }
    const res = await fetchImpl(url, fetchOpts);
    let data = {};
    try {
      data = await res.json();
    } catch (_err) {
      data = {};
    }
    if (!res.ok) {
      const errMsg = data?.error || `Signaling request failed (${res.status})`;
      const err = new Error(errMsg);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  async function startHost() {
    emitStatus('signaling');
    const iceData = await fetchJson(`${apiBase}?action=ice`);
    if (closed) return { ok: false, error: 'Session closed' };

    pc = createPeerConnection(iceData.iceServers);
    const chReliable = pc.createDataChannel('gp500-reliable', { ordered: true });
    const chFast = pc.createDataChannel('gp500-fast', { ordered: false, maxRetransmits: 0 });
    attachReliableChannel(chReliable);
    attachFastChannel(chFast);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGatheringComplete(pc, iceGatherTimeoutMs);
    if (closed) return { ok: false, error: 'Session closed' };

    const createBody = {
      offer: serializeDescription(pc.localDescription),
      hostMeta: hostMeta || {}
    };
    if (roomCode) {
      createBody.code = roomCode;
    }

    const created = await fetchJson(`${apiBase}?action=create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createBody)
    });
    if (closed) return { ok: false, error: 'Session closed' };

    roomCode = String(created.code || '').toUpperCase();
    emitStatus('waiting');

    const pollForAnswer = async () => {
      if (closed || hasConnected) return;
      try {
        const room = await fetchJson(`${apiBase}?code=${encodeURIComponent(roomCode)}`);
        if (closed) return;

        if (room.answer) {
          pollTimer = null;
          if (room.guestMeta) guestMeta = room.guestMeta;
          emitStatus('connecting');
          startConnectTimeout();
          await pc.setRemoteDescription(room.answer);
          return;
        }
      } catch (err) {
        if (!closed) {
          emitError(err?.message || 'Room polling failed');
        }
        return;
      }

      if (!closed) {
        pollTimer = setTimeout(pollForAnswer, Math.max(200, pollIntervalMs));
      }
    };

    pollTimer = setTimeout(pollForAnswer, Math.max(200, pollIntervalMs));
    return { ok: true, role, code: roomCode };
  }

  async function startGuest() {
    if (!roomCode) {
      throw new Error('Room code is required to join.');
    }

    emitStatus('signaling');
    startConnectTimeout();

    const room = await fetchJson(`${apiBase}?code=${encodeURIComponent(roomCode)}`);
    if (closed) return { ok: false, error: 'Session closed' };

    if (!room.offer) {
      throw new Error('Room offer is missing.');
    }
    if (room.answer) {
      throw new Error('Room is already full.');
    }
    if (room.hostMeta) {
      hostMeta = room.hostMeta;
    }

    let iceServers = room.iceServers;
    if (!Array.isArray(iceServers) || iceServers.length === 0) {
      const iceData = await fetchJson(`${apiBase}?action=ice`);
      if (closed) return { ok: false, error: 'Session closed' };
      iceServers = iceData.iceServers;
    }

    pc = createPeerConnection(iceServers);
    pc.ondatachannel = (event) => {
      const ch = event?.channel;
      if (!ch) return;
      if (ch.label === 'gp500-reliable') {
        attachReliableChannel(ch);
      } else if (ch.label === 'gp500-fast') {
        attachFastChannel(ch);
      }
    };

    emitStatus('connecting');
    await pc.setRemoteDescription(room.offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitForIceGatheringComplete(pc, iceGatherTimeoutMs);
    if (closed) return { ok: false, error: 'Session closed' };

    await fetchJson(`${apiBase}?action=answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: roomCode,
        answer: serializeDescription(pc.localDescription),
        guestMeta: guestMeta || {}
      })
    });

    return { ok: true, role, code: roomCode, hostMeta };
  }

  let startPromise = null;

  function start() {
    if (startPromise) return startPromise;
    started = true;
    startPromise = (async () => {
      try {
        return role === 'guest' ? await startGuest() : await startHost();
      } catch (err) {
        const msg = err?.message || 'Unable to start online session.';
        emitError(msg);
        return { ok: false, error: msg };
      }
    })();
    return startPromise;
  }

  function sendPeerState(packet) {
    if (closed || !fastChannel || fastChannel.readyState !== 'open') {
      return false;
    }
    if (typeof fastChannel.bufferedAmount === 'number' && fastChannel.bufferedAmount > 65536) {
      return false;
    }
    try {
      const payload = typeof packet === 'string' ? packet : JSON.stringify(packet);
      fastChannel.send(payload);
      return true;
    } catch (_err) {
      return false;
    }
  }

  function sendLobby(msg) {
    return sendReliableRaw({ _nc: 'lobby', payload: msg });
  }

  function sendRaceEvent(msg) {
    return sendReliableRaw({ _nc: 'race', payload: msg });
  }

  function getClockSync() {
    return {
      rttMs: effectiveRttMs(),
      offsetMs: role === 'host' ? 0 : clockSync.offsetMs,
      sampleCount: clockSamples.length,
      synced: role === 'host' || clockSamples.length > 0
    };
  }

  function hostTimeToLocal(hostTs) {
    const ts = Number(hostTs);
    if (!Number.isFinite(ts)) return ts;
    if (role === 'host') return ts;
    return ts + clockSync.offsetMs;
  }

  function peerTimeToLocal(peerTs) {
    const ts = Number(peerTs);
    if (!Number.isFinite(ts)) return nowFn();
    if (clockSamples.length === 0) return nowFn();
    return ts + peerSync.offsetMs;
  }

  function close() {
    if (closed) return;
    closed = true;
    clearAllTimers();
    cleanupPeerConnection();
    if (started) {
      emitStatus('closed');
    }
  }

  return {
    start,
    sendPeerState,
    sendLobby,
    sendRaceEvent,
    getClockSync,
    hostTimeToLocal,
    peerTimeToLocal,
    getTransportType: () => transportType,
    getRole: () => role,
    getCode: () => roomCode,
    close
  };
}
