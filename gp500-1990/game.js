import { BIKES, getBikeById } from './bikes.js';
import { TRACKS, createTrack } from './track.js';
import {
  FIXED_DT,
  MAX_LEAN_RAD,
  createRiderState,
  stepRiderPhysics,
  rankRiders
} from './physics.js';
import { computeAIInput } from './ai.js';
import { createInputManager } from './input.js';
import { createRaceRenderer } from './renderer.js';
import { createAudioEngine } from './audio.js';
import { createReplayRecorder } from './replay.js';
import {
  createChampionshipManager,
  CHAMPIONSHIP_ROUNDS,
  getTrackMeta
} from './championship.js';
import { createBikeShowroom } from './showroom.js';
import { initWebsiteShowcase } from './showcase.js';

export const GAME_STATES = {
  MENU: 'MENU',
  COUNTDOWN: 'COUNTDOWN',
  RACING: 'RACING',
  PAUSED: 'PAUSED',
  RESULTS: 'RESULTS',
  REPLAY: 'REPLAY',
  CHAMPIONSHIP: 'CHAMPIONSHIP'
};

export const CAMERA_MODES = ['chase', 'chase-far', 'helmet'];

const CAMERA_MODE_LABELS = {
  'chase': 'CHASE',
  'chase-far': 'FAR',
  'helmet': 'HELMET'
};

const AI_ROSTER = [
  { name: 'K. Takahashi #2', bikeId: 'shiden', lineOffset: -1.4 },
  { name: 'W. Vance #3', bikeId: 'akagi', lineOffset: 1.4 },
  { name: 'M. Donato #7', bikeId: 'corsa', lineOffset: -0.8 },
  { name: 'R. Mackenzie #11', bikeId: 'kaze', lineOffset: 0.9 },
  { name: 'J. Moreau #19', bikeId: 'shiden', lineOffset: -1.8 },
  { name: 'C. Gardner #21', bikeId: 'akagi', lineOffset: 1.7 },
  { name: 'L. Bianchi #55', bikeId: 'corsa', lineOffset: 0.0 }
];

export function formatLapTime(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) {
    return '--:--.---';
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds - Math.floor(seconds)) * 1000);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

export function formatShortTime(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return '00:00.0';
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const tenths = Math.floor((seconds - Math.floor(seconds)) * 10);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`;
}

export function formatOrdinal(n) {
  const v = Math.max(1, Math.round(n || 1));
  const mod100 = v % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${v}th`;
  switch (v % 10) {
    case 1: return `${v}st`;
    case 2: return `${v}nd`;
    case 3: return `${v}rd`;
    default: return `${v}th`;
  }
}

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

/**
 * Parses URL query parameters for automated verification and quick launch hooks:
 * ?autostart=1&mode=gp|duel|solo|championship&track=sakura|monterey|cathedral&split=horizontal|vertical&demo=1
 */
export function parseUrlConfig(searchStr = typeof window !== 'undefined' && window.location ? window.location.search : '') {
  const params = new URLSearchParams(searchStr || '');
  const parsed = {
    autostart: params.get('autostart') === '1' || params.get('autostart') === 'true',
    demo: params.get('demo') === '1' || params.get('demo') === 'true',
    replay: params.get('replay') === '1' || params.get('replay') === 'true',
    mode: null,
    trackId: null,
    splitMode: null,
    laps: null,
    difficulty: null,
    p1Camera: null,
    p2Camera: null
  };

  const modeParam = (params.get('mode') || '').toLowerCase();
  if (['gp', 'duel', 'solo', 'championship'].includes(modeParam)) {
    parsed.mode = modeParam;
  }

  const trackParam = (params.get('track') || '').toLowerCase();
  if (['sakura', 'monterey', 'cathedral'].includes(trackParam)) {
    parsed.trackId = trackParam;
  }

  const splitParam = (params.get('split') || '').toLowerCase();
  if (['horizontal', 'vertical'].includes(splitParam)) {
    parsed.splitMode = splitParam;
  }

  const lapsParam = Number(params.get('laps'));
  if (Number.isFinite(lapsParam) && lapsParam >= 1 && lapsParam <= 20) {
    parsed.laps = Math.round(lapsParam);
  }

  const diffParam = (params.get('difficulty') || '').toLowerCase();
  if (['rookie', 'pro', 'legend'].includes(diffParam)) {
    parsed.difficulty = diffParam;
  }

  const camParam = (params.get('cam') || params.get('camera') || params.get('p1cam') || '').toLowerCase();
  if (CAMERA_MODES.includes(camParam)) {
    parsed.p1Camera = camParam;
  }

  const p2CamParam = (params.get('p2cam') || '').toLowerCase();
  if (CAMERA_MODES.includes(p2CamParam)) {
    parsed.p2Camera = p2CamParam;
  }

  return parsed;
}

export function initGame() {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return null;
  }

  const canvas = document.getElementById('race-canvas');
  const siteNavbar = document.getElementById('site-navbar');
  const siteLanding = document.getElementById('site-landing');
  const showroomCanvas = document.getElementById('showroom-canvas');
  const paddockMenu = document.getElementById('paddock-menu');
  const raceHud = document.getElementById('race-hud');
  const countdownOverlay = document.getElementById('countdown-overlay');
  const countdownText = document.getElementById('countdown-text');
  const pauseOverlay = document.getElementById('pause-overlay');
  const resultsOverlay = document.getElementById('results-overlay');
  const championshipOverlay = document.getElementById('championship-overlay');
  const replayOverlay = document.getElementById('replay-overlay');

  const minimapCanvas = document.getElementById('minimap-canvas');
  const minimapCtx = minimapCanvas ? minimapCanvas.getContext('2d') : null;
  const previewCanvas = document.getElementById('menu-track-preview');
  const previewCtx = previewCanvas ? previewCanvas.getContext('2d') : null;

  // Game configuration state
  const config = {
    mode: 'gp',              // 'gp' | 'championship' | 'duel' | 'solo'
    splitMode: 'horizontal', // 'horizontal' | 'vertical'
    trackId: 'sakura',       // 'sakura' | 'monterey' | 'cathedral'
    laps: 3,                 // 3 | 5 | 8
    difficulty: 'pro',       // 'rookie' | 'pro' | 'legend'
    p1BikeId: 'akagi',
    p2BikeId: 'shiden',
    demo: false,             // when true, human slots are AI-driven
    autostart: false
  };

  let gameState = GAME_STATES.MENU;
  let viewMode = 'site'; // 'site' | 'paddock' | 'race'
  let stateBeforePause = GAME_STATES.RACING;
  let stateBeforeReplay = GAME_STATES.RESULTS;
  let currentTrack = createTrack(config.trackId);
  let riders = [];
  let p1Rider = null;
  let p2Rider = null;
  let showroom = null;
  let showcase = null;

  // Camera modes per slot: 'chase' -> 'chase-far' -> 'helmet'
  const slotCameraModes = ['chase', 'chase'];

  // Physics fixed-timestep accumulator
  let physicsAccumulator = 0;
  let lastFrameTime = performance.now();

  // Rolling FPS tracker for window.__gp500.fps
  const frameDurationHistory = [];
  const FPS_WINDOW_SIZE = 30;
  let rollingFps = 60.0;

  // Countdown state
  let countdownTimer = 0;
  let countdownDuration = 3.2;
  let lastLitLights = -1;
  let goBannerTimer = 0;
  let postFinishTimer = 0;

  // Isolate website keyboard scrolling & slider controls before input.js binds global keydown preventDefault
  window.addEventListener('keydown', (e) => {
    if (gameState === GAME_STATES.MENU && viewMode === 'site') {
      if (e.code === 'KeyM' && !e.repeat) {
        const tag = e.target && e.target.tagName;
        if (tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'TEXTAREA') {
          handleMuteShortcut();
        }
      }
      e.stopImmediatePropagation();
    }
  });

  // Core subsystems
  const renderer = createRaceRenderer(canvas);
  const audio = createAudioEngine();
  const replay = createReplayRecorder();
  const championship = createChampionshipManager();
  const input = createInputManager({
    onToggleSplit: () => {
      if (viewMode !== 'site') toggleSplitOrientation();
    },
    onTogglePause: () => handlePauseShortcut(),
    onToggleMute: () => handleMuteShortcut(),
    onCycleCamera: (slot) => {
      if (gameState === GAME_STATES.RACING || gameState === GAME_STATES.COUNTDOWN) {
        cyclePlayerCameraMode(slot);
      }
    }
  });

  // Cache HUD DOM elements for P1 and P2
  const hudElements = [1, 2].map((pNum) => ({
    root: document.getElementById(`hud-p${pNum}`),
    bikeTag: document.getElementById(`p${pNum}-bike-tag`),
    camBadge: document.getElementById(`p${pNum}-cam-badge`),
    pos: document.getElementById(`p${pNum}-pos`),
    posTotal: document.getElementById(`p${pNum}-pos-total`),
    lap: document.getElementById(`p${pNum}-lap`),
    curLap: document.getElementById(`p${pNum}-cur-lap`),
    bestLap: document.getElementById(`p${pNum}-best-lap`),
    rpmVal: document.getElementById(`p${pNum}-rpm-val`),
    shiftLamp: document.getElementById(`p${pNum}-shift-lamp`),
    rpmFill: document.getElementById(`p${pNum}-rpm-fill`),
    gear: document.getElementById(`p${pNum}-gear`),
    speed: document.getElementById(`p${pNum}-speed`),
    leanVal: document.getElementById(`p${pNum}-lean-val`),
    leanNeedle: document.getElementById(`p${pNum}-lean-needle`),
    badges: {
      powerslide: document.getElementById(`p${pNum}-badge-powerslide`),
      wheelie: document.getElementById(`p${pNum}-badge-wheelie`),
      slipstream: document.getElementById(`p${pNum}-badge-slipstream`),
      gravel: document.getElementById(`p${pNum}-badge-gravel`),
      highside: document.getElementById(`p${pNum}-badge-highside`),
      tuck: document.getElementById(`p${pNum}-badge-tuck`)
    }
  }));

  const gantryLights = Array.from(document.querySelectorAll('.gantry-light'));

  // ---------------------------------------------------------------------------
  // CAMERA CYCLE ('chase' -> 'chase-far' -> 'helmet')
  // ---------------------------------------------------------------------------
  function setPlayerCameraMode(slot = 0, mode = 'chase') {
    const idx = slot === 1 ? 1 : 0;
    const normalized = CAMERA_MODES.includes(mode) ? mode : 'chase';
    slotCameraModes[idx] = normalized;
    if (renderer && typeof renderer.setCameraMode === 'function') {
      renderer.setCameraMode(idx, normalized);
    }
    updateCameraHudBadge(idx);
    return normalized;
  }

  function getPlayerCameraMode(slot = 0) {
    const idx = slot === 1 ? 1 : 0;
    if (renderer && typeof renderer.getCameraMode === 'function') {
      const fromRenderer = renderer.getCameraMode(idx);
      if (CAMERA_MODES.includes(fromRenderer)) {
        slotCameraModes[idx] = fromRenderer;
      }
    }
    return slotCameraModes[idx];
  }

  function cyclePlayerCameraMode(slot = 0) {
    const idx = slot === 1 ? 1 : 0;
    const current = getPlayerCameraMode(idx);
    const curIndex = CAMERA_MODES.indexOf(current);
    const nextMode = CAMERA_MODES[(curIndex + 1) % CAMERA_MODES.length];
    return setPlayerCameraMode(idx, nextMode);
  }

  function updateCameraHudBadge(slot = 0) {
    const idx = slot === 1 ? 1 : 0;
    const el = hudElements[idx]?.camBadge;
    if (!el) return;
    const mode = getPlayerCameraMode(idx);
    const shortLabel = CAMERA_MODE_LABELS[mode] || mode.toUpperCase();
    const keyHint = idx === 0 ? 'C' : '.';
    el.textContent = `CAM: ${shortLabel} [${keyHint}]`;
  }

  // ---------------------------------------------------------------------------
  // SPLIT ORIENTATION, AUDIO & PAUSE CONTROLS
  // ---------------------------------------------------------------------------
  function getEffectiveSplitMode() {
    if (config.mode === 'solo') return 'single';
    return config.splitMode === 'vertical' ? 'vertical' : 'horizontal';
  }

  function applySplitModeToDomAndRenderer() {
    const eff = getEffectiveSplitMode();
    if (raceHud) {
      raceHud.setAttribute('data-split', eff);
    }
    renderer.setSplitMode(eff);
  }

  function toggleSplitOrientation() {
    config.splitMode = config.splitMode === 'horizontal' ? 'vertical' : 'horizontal';
    syncSelectAndPills('select-split', config.splitMode);
    applySplitModeToDomAndRenderer();
  }

  function handleMuteShortcut() {
    const isMuted = audio.toggleMute();
    updateMuteButtons(isMuted);
  }

  function updateMuteButtons(isMuted) {
    const menuMuteBtn = document.getElementById('btn-menu-mute');
    const hudMuteBtn = document.getElementById('btn-hud-mute');
    const siteMuteBtn = document.getElementById('btn-site-mute');
    if (menuMuteBtn) {
      menuMuteBtn.textContent = isMuted ? 'AUDIO: MUTED [M]' : 'AUDIO: ON [M]';
    }
    if (hudMuteBtn) {
      hudMuteBtn.textContent = isMuted ? '[M] MUTE' : '[M] SND';
    }
    if (showcase && typeof showcase.updateMuteUi === 'function') {
      showcase.updateMuteUi(isMuted);
    } else if (siteMuteBtn) {
      siteMuteBtn.textContent = isMuted ? 'AUDIO: MUTED [M]' : 'AUDIO: ON [M]';
      siteMuteBtn.classList.toggle('muted', Boolean(isMuted));
      siteMuteBtn.setAttribute('aria-pressed', isMuted ? 'true' : 'false');
    }
  }

  function handlePauseShortcut() {
    if (gameState === GAME_STATES.REPLAY) {
      exitReplayMode();
      return;
    }
    if (gameState === GAME_STATES.RACING || gameState === GAME_STATES.COUNTDOWN) {
      stateBeforePause = gameState;
      gameState = GAME_STATES.PAUSED;
      audio.silence();
      if (pauseOverlay) pauseOverlay.classList.remove('hidden');
    } else if (gameState === GAME_STATES.PAUSED) {
      resumeFromPause();
    }
  }

  function resumeFromPause() {
    if (gameState !== GAME_STATES.PAUSED) return;
    if (pauseOverlay) pauseOverlay.classList.add('hidden');
    gameState = stateBeforePause || GAME_STATES.RACING;
    lastFrameTime = performance.now();
  }

  // ---------------------------------------------------------------------------
  // GRID FORMATION & RACE INITIALIZATION
  // ---------------------------------------------------------------------------
  function buildRaceGrid() {
    currentTrack = createTrack(config.trackId);
    renderer.buildTrackScene(currentTrack);

    const hudTrackName = document.getElementById('hud-track-name');
    if (hudTrackName) {
      hudTrackName.textContent = currentTrack.name.toUpperCase();
    }

    riders = [];
    const p1Bike = getBikeById(config.p1BikeId);
    const p2Bike = getBikeById(config.p2BikeId);

    // Place P1 and P2 on the front row at s = 18m so totalDistance is positive and monotonic
    p1Rider = createRiderState({
      id: 'p1',
      name: `Player 1 (#${p1Bike.number})`,
      isAI: false,
      playerIndex: 0,
      bike: p1Bike,
      s: 18.0,
      d: -2.2,
      aiLineOffset: -1.1,
      track: currentTrack
    });
    riders.push(p1Rider);

    if (config.mode === 'gp' || config.mode === 'championship' || config.mode === 'duel') {
      p2Rider = createRiderState({
        id: 'p2',
        name: `Player 2 (#${p2Bike.number})`,
        isAI: false,
        playerIndex: 1,
        bike: p2Bike,
        s: 18.0,
        d: 2.2,
        aiLineOffset: 1.1,
        track: currentTrack
      });
      riders.push(p2Rider);
    } else {
      p2Rider = null;
    }

    // Add AI riders for full 8-rider Grand Prix / Championship grid
    const aiCount = config.mode === 'duel' ? 0 : config.mode === 'solo' ? 7 : 6;
    for (let i = 0; i < aiCount; i++) {
      const slotIndex = riders.length; // 1..7 or 2..7
      const row = Math.floor(slotIndex / 2);
      const col = slotIndex % 2;
      const gridS = Math.max(2.5, 18.0 - row * 3.8 - col * 1.1);
      const gridD = col === 0 ? -2.3 : 2.3;

      const aiTemplate = AI_ROSTER[i % AI_ROSTER.length];
      const aiBike = (config.mode === 'solo' && i === 0)
        ? p2Bike
        : getBikeById(aiTemplate.bikeId);

      const aiRider = createRiderState({
        id: `ai-${i + 1}`,
        name: aiTemplate.name,
        isAI: true,
        playerIndex: -1,
        difficulty: config.difficulty,
        bike: aiBike,
        s: gridS,
        d: gridD,
        aiLineOffset: aiTemplate.lineOffset,
        track: currentTrack
      });
      riders.push(aiRider);
    }

    rankRiders(riders);
    renderer.syncRiders(riders);
    applySplitModeToDomAndRenderer();
    updateCameraHudBadge(0);
    updateCameraHudBadge(1);
    updateAllHud();
    drawMinimap(minimapCtx, minimapCanvas, currentTrack, riders);
  }

  function ensureShowroom() {
    if (!showroom && showroomCanvas) {
      showroom = createBikeShowroom(showroomCanvas, { initialBikeId: config.p1BikeId });
      if (showcase && typeof showcase.setShowroom === 'function') {
        showcase.setShowroom(showroom);
      }
    }
    return showroom;
  }

  function applySiteModeClasses(mode) {
    viewMode = mode;
    const rootEl = document.documentElement;

    if (mode === 'site') {
      rootEl.classList.remove('autostart-boot');
      rootEl.classList.add('site-scroll');
      if (siteNavbar) siteNavbar.classList.remove('hidden');
      if (siteLanding) siteLanding.classList.remove('hidden');
      if (paddockMenu) {
        paddockMenu.classList.add('hidden');
        paddockMenu.classList.remove('active');
      }
      ensureShowroom();
      if (showroom) {
        showroom.setBike(config.p1BikeId);
        showroom.setActive(true);
        showroom.resize();
      }
      if (showcase) {
        showcase.setSelectedBike(config.p1BikeId);
        showcase.setSelectedTrack(config.trackId);
        showcase.setActive(true);
      }
    } else if (mode === 'paddock') {
      rootEl.classList.remove('site-scroll', 'autostart-boot');
      if (siteNavbar) siteNavbar.classList.add('hidden');
      if (siteLanding) siteLanding.classList.add('hidden');
      if (showroom) showroom.setActive(false);
      if (showcase) showcase.setActive(false);
      if (paddockMenu) {
        paddockMenu.classList.remove('hidden');
        paddockMenu.classList.add('active');
      }
      renderer.resize();
    } else {
      rootEl.classList.remove('site-scroll', 'autostart-boot');
      if (siteNavbar) siteNavbar.classList.add('hidden');
      if (siteLanding) siteLanding.classList.add('hidden');
      if (paddockMenu) {
        paddockMenu.classList.add('hidden');
        paddockMenu.classList.remove('active');
      }
      if (showroom) showroom.setActive(false);
      if (showcase) showcase.setActive(false);
      renderer.resize();
    }
  }

  function setBikeSelection(playerNum, bikeId) {
    if (!bikeId) return;
    const resolvedId = getBikeById(bikeId).id;
    if (String(playerNum) === '1') {
      config.p1BikeId = resolvedId;
      document.querySelectorAll('#p1-bike-cards .bike-card').forEach((c) => {
        c.classList.toggle('selected', c.getAttribute('data-bike-id') === resolvedId);
      });
    } else if (String(playerNum) === '2') {
      config.p2BikeId = resolvedId;
      document.querySelectorAll('#p2-bike-cards .bike-card').forEach((c) => {
        c.classList.toggle('selected', c.getAttribute('data-bike-id') === resolvedId);
      });
    }
    if (gameState === GAME_STATES.MENU) {
      buildRaceGrid();
    }
  }

  function setTrackSelection(trackId) {
    if (!trackId) return;
    config.trackId = trackId;
    syncSelectAndPills('select-track', config.trackId);
    if (gameState === GAME_STATES.MENU) {
      buildRaceGrid();
      drawTrackPreview();
    }
  }

  function openPaddock(opts = {}) {
    audio.silence();
    gameState = GAME_STATES.MENU;
    if (opts && opts.bikeId) {
      setBikeSelection(1, opts.bikeId);
    }
    if (opts && opts.trackId) {
      config.trackId = opts.trackId;
      syncSelectAndPills('select-track', config.trackId);
    }
    if (raceHud) raceHud.classList.add('hidden');
    if (pauseOverlay) pauseOverlay.classList.add('hidden');
    if (resultsOverlay) resultsOverlay.classList.add('hidden');
    if (championshipOverlay) championshipOverlay.classList.add('hidden');
    if (replayOverlay) replayOverlay.classList.add('hidden');
    if (countdownOverlay) countdownOverlay.classList.add('hidden');
    applySiteModeClasses('paddock');
    refreshChampionshipMenuBanner();
    buildRaceGrid();
    drawTrackPreview();
  }

  function returnToSite() {
    audio.silence();
    gameState = GAME_STATES.MENU;
    if (raceHud) raceHud.classList.add('hidden');
    if (pauseOverlay) pauseOverlay.classList.add('hidden');
    if (resultsOverlay) resultsOverlay.classList.add('hidden');
    if (championshipOverlay) championshipOverlay.classList.add('hidden');
    if (replayOverlay) replayOverlay.classList.add('hidden');
    if (countdownOverlay) countdownOverlay.classList.add('hidden');
    applySiteModeClasses('site');
  }

  function launchQuickRace(opts = {}) {
    if (opts.mode) {
      config.mode = opts.mode;
      syncSelectAndPills('select-mode', config.mode);
      updateP2GarageLabels();
    } else {
      config.mode = 'gp';
      syncSelectAndPills('select-mode', 'gp');
      updateP2GarageLabels();
    }
    if (opts.trackId) {
      config.trackId = opts.trackId;
      syncSelectAndPills('select-track', config.trackId);
    } else {
      config.trackId = 'sakura';
      syncSelectAndPills('select-track', 'sakura');
    }
    if (opts.p1BikeId) {
      setBikeSelection(1, opts.p1BikeId);
    }
    startRaceSession();
  }

  function startRaceSession() {
    applySiteModeClasses('race');

    // If starting in Championship mode, sync track to the current championship round
    if (config.mode === 'championship') {
      if (!championship.isActive() || championship.isCompleted()) {
        championship.startNewChampionship(config);
      } else {
        championship.updateConfig(config);
      }
      config.trackId = championship.getCurrentTrackId();
      syncSelectAndPills('select-track', config.trackId);
    }

    audio.init();
    input.reset();
    physicsAccumulator = 0;
    postFinishTimer = 0;

    buildRaceGrid();

    // Reset 60 Hz replay buffer and capture initial grid snapshot at t = 0
    replay.reset({
      trackId: config.trackId,
      trackLength: currentTrack.totalLength
    });
    replay.record(riders, 0);

    if (paddockMenu) {
      paddockMenu.classList.add('hidden');
      paddockMenu.classList.remove('active');
    }
    if (pauseOverlay) pauseOverlay.classList.add('hidden');
    if (resultsOverlay) resultsOverlay.classList.add('hidden');
    if (championshipOverlay) championshipOverlay.classList.add('hidden');
    if (replayOverlay) replayOverlay.classList.add('hidden');
    if (raceHud) raceHud.classList.remove('hidden');

    // Start 5-light gantry countdown (shorter when autostart=1 so screenshot hooks reach racing faster)
    gameState = GAME_STATES.COUNTDOWN;
    countdownDuration = config.autostart ? 1.1 : 3.2;
    countdownTimer = countdownDuration;
    lastLitLights = 0;
    goBannerTimer = 0;
    renderer.setStartLights(0, false);
    updateCountdownVisuals(0, false, 'ENGINES START — GET READY');
    if (countdownOverlay) countdownOverlay.classList.remove('hidden');
    lastFrameTime = performance.now();
  }

  function returnToPaddock() {
    openPaddock();
  }

  // ---------------------------------------------------------------------------
  // COUNTDOWN GANTRY LOGIC
  // ---------------------------------------------------------------------------
  function updateCountdownVisuals(litCount, isGreen, bannerStr) {
    for (let i = 0; i < gantryLights.length; i++) {
      const lamp = gantryLights[i];
      lamp.classList.remove('red-lit', 'green-lit');
      if (isGreen) {
        lamp.classList.add('green-lit');
      } else if (i < litCount) {
        lamp.classList.add('red-lit');
      }
    }
    if (countdownText && bannerStr) {
      countdownText.textContent = bannerStr;
    }
  }

  function stepCountdown(dt) {
    countdownTimer -= dt;

    // Allow human players (or AI in demo mode) to rev their 2-stroke engines on the start line
    const p1In = config.demo ? { throttle: 0.75 } : input.getPlayerInput(0);
    if (p1Rider) {
      p1Rider.throttle = p1In.throttle;
      p1Rider.rpm = 4200 + p1In.throttle * 7600 + Math.sin(performance.now() * 0.03) * 180;
    }
    if (p2Rider) {
      const p2In = config.demo ? { throttle: 0.72 } : input.getPlayerInput(1);
      p2Rider.throttle = p2In.throttle;
      p2Rider.rpm = 4200 + p2In.throttle * 7600 + Math.cos(performance.now() * 0.03) * 180;
    }
    audio.update(riders, { splitMode: getEffectiveSplitMode() });

    const stepInterval = Math.max(0.15, (countdownDuration * 0.9) / 5);
    const elapsed = countdownDuration - countdownTimer;
    const litNow = clamp(Math.floor(elapsed / stepInterval) + 1, 1, 5);

    if (countdownTimer > 0) {
      if (litNow !== lastLitLights) {
        lastLitLights = litNow;
        renderer.setStartLights(litNow, false);
        const secLeft = Math.max(1, 6 - litNow);
        updateCountdownVisuals(litNow, false, `START IN ${secLeft}...`);
        audio.playStartBeep(false);
      }
    } else {
      // GREEN LIGHTS — GO!
      gameState = GAME_STATES.RACING;
      goBannerTimer = config.autostart ? 0.45 : 1.15;
      renderer.setStartLights(5, true);
      updateCountdownVisuals(5, true, 'GO! GO! GO!');
      audio.playStartBeep(true);
    }
  }

  // ---------------------------------------------------------------------------
  // FIXED-TIMESTEP PHYSICS SIMULATION & 60Hz REPLAY RECORDING
  // ---------------------------------------------------------------------------
  function stepSimulationTick(dt) {
    for (let i = 0; i < riders.length; i++) {
      const r = riders[i];
      let riderInput;

      if (!r.isAI && !r.finished && !config.demo) {
        riderInput = input.getPlayerInput(r.playerIndex);
      } else {
        // AI rider, demo mode human slot, or human rider on cooldown cruise after crossing finish line
        riderInput = computeAIInput(r, currentTrack, riders, config.difficulty);
      }

      stepRiderPhysics(r, riderInput, currentTrack, riders, dt, config.laps);
    }

    rankRiders(riders);

    // Record per-rider state at 60 Hz into the replay buffer
    replay.record(riders, dt);
  }

  function updateGamepadHaptics(nowMs) {
    if (gameState !== GAME_STATES.RACING) return;
    if (p1Rider) input.updateRiderRumble(0, p1Rider, nowMs);
    if (p2Rider) input.updateRiderRumble(1, p2Rider, nowMs);
  }

  function checkRaceCompletion(dt) {
    const humanRiders = riders.filter((r) => !r.isAI);
    const allHumansFinished = humanRiders.length > 0 && humanRiders.every((r) => r.finished);
    const anyHumanFinished = humanRiders.some((r) => r.finished);

    if (allHumansFinished) {
      postFinishTimer += dt;
      if (postFinishTimer >= 1.1) {
        showRaceResults();
      }
    } else if (anyHumanFinished) {
      // If one player finished in 2P mode, give the second player up to 20s to finish their lap
      postFinishTimer += dt;
      if (postFinishTimer >= 20.0) {
        showRaceResults();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // TELEMETRY HUD & 2D MINIMAP UPDATES
  // ---------------------------------------------------------------------------
  function updatePlayerHud(slotIdx, rider) {
    const el = hudElements[slotIdx];
    if (!el || !rider) return;

    if (el.bikeTag) {
      el.bikeTag.textContent = `${rider.bike.name} #${rider.bike.number}`;
    }
    updateCameraHudBadge(slotIdx);

    if (el.pos) {
      el.pos.textContent = formatOrdinal(rider.position);
    }
    if (el.posTotal) {
      el.posTotal.textContent = `/ ${riders.length}`;
    }

    const displayLap = Math.min(rider.lap, config.laps);
    if (el.lap) {
      el.lap.textContent = rider.finished
        ? 'FINISHED'
        : `LAP ${displayLap}/${config.laps}`;
    }
    if (el.curLap) {
      el.curLap.textContent = formatLapTime(rider.lapTime);
    }
    if (el.bestLap) {
      el.bestLap.textContent = formatLapTime(rider.bestLapTime);
    }

    const rpm = Math.round(rider.rpm || 4000);
    if (el.rpmVal) {
      el.rpmVal.textContent = `${rpm.toLocaleString()} RPM`;
    }

    const rpmPct = clamp(((rpm - 4000) / 9000) * 100, 4, 100);
    if (el.rpmFill) {
      el.rpmFill.style.width = `${rpmPct.toFixed(1)}%`;
    }

    if (el.shiftLamp) {
      el.shiftLamp.classList.remove('powerband', 'redline');
      if (rpm >= 12250) {
        el.shiftLamp.textContent = 'SHIFT!';
        el.shiftLamp.classList.add('redline');
      } else if (rpm >= 8500) {
        el.shiftLamp.textContent = 'POWERBAND';
        el.shiftLamp.classList.add('powerband');
      } else {
        el.shiftLamp.textContent = '2-STROKE';
      }
    }

    if (el.gear) {
      el.gear.textContent = String(rider.gear || 1);
    }

    const speedKmh = Math.round((rider.speed || 0) * 3.6);
    if (el.speed) {
      el.speed.textContent = String(speedKmh);
    }

    const leanDeg = Math.round(((rider.lean || 0) * 180) / Math.PI);
    const absLean = Math.abs(leanDeg);
    const dirSuffix = leanDeg < -1 ? 'L' : leanDeg > 1 ? 'R' : '';
    if (el.leanVal) {
      el.leanVal.textContent = `${absLean}°${dirSuffix}`;
    }
    if (el.leanNeedle) {
      const needlePct = clamp(50 + (leanDeg / 55) * 46, 4, 96);
      el.leanNeedle.style.left = `${needlePct.toFixed(1)}%`;
    }

    // Status warning badges
    if (el.badges) {
      toggleClass(el.badges.powerslide, 'active', (rider.rearSlip || 0) > 0.28);
      toggleClass(el.badges.wheelie, 'active', (rider.wheelieAngle || 0) > 0.025);
      toggleClass(el.badges.slipstream, 'active', (rider.slipstreamBoost || 0) > 0.08);
      toggleClass(el.badges.gravel, 'active', Boolean(rider.offTrack));
      toggleClass(el.badges.highside, 'active', (rider.highsideTimer || 0) > 0);
      toggleClass(el.badges.tuck, 'active', Boolean(rider.tuck));
    }
  }

  function toggleClass(node, className, condition) {
    if (!node) return;
    if (condition) {
      node.classList.add(className);
    } else {
      node.classList.remove(className);
    }
  }

  function updateAllHud() {
    if (p1Rider) updatePlayerHud(0, p1Rider);
    if (p2Rider) updatePlayerHud(1, p2Rider);
  }

  function drawMinimap(ctx, cvs, track, riderList) {
    if (!ctx || !cvs || !track || !track.samples || track.samples.length === 0) return;

    const w = cvs.width;
    const h = cvs.height;
    ctx.clearRect(0, 0, w, h);

    const samples = track.samples;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < samples.length; i += 2) {
      const s = samples[i];
      if (s.x < minX) minX = s.x;
      if (s.x > maxX) maxX = s.x;
      if (s.z < minZ) minZ = s.z;
      if (s.z > maxZ) maxZ = s.z;
    }

    const pad = 14;
    const spanX = Math.max(1, maxX - minX);
    const spanZ = Math.max(1, maxZ - minZ);
    const scale = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanZ);
    const offX = (w - spanX * scale) * 0.5 - minX * scale;
    const offZ = (h - spanZ * scale) * 0.5 - minZ * scale;

    const toX = (x) => x * scale + offX;
    const toY = (z) => z * scale + offZ;

    // Outer track border
    ctx.beginPath();
    for (let i = 0; i < samples.length; i += 3) {
      const pt = samples[i];
      if (i === 0) ctx.moveTo(toX(pt.x), toY(pt.z));
      else ctx.lineTo(toX(pt.x), toY(pt.z));
    }
    ctx.closePath();
    ctx.strokeStyle = '#33415c';
    ctx.lineWidth = 6.5;
    ctx.stroke();

    // Inner asphalt ribbon
    ctx.strokeStyle = '#9aa8c2';
    ctx.lineWidth = 2.6;
    ctx.stroke();

    // Start/finish line marker at s=0
    const sf = samples[0];
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(toX(sf.x) - 3.5, toY(sf.z) - 3.5, 7, 7);

    // Draw rider dots (AI first, then P2 and P1 on top)
    if (riderList && riderList.length > 0) {
      for (let i = riderList.length - 1; i >= 0; i--) {
        const r = riderList[i];
        const wx = r.world ? r.world.x : 0;
        const wz = r.world ? r.world.z : 0;
        const px = toX(wx);
        const py = toY(wz);

        ctx.beginPath();
        if (r.id === 'p1') {
          ctx.fillStyle = '#ff1e27';
          ctx.arc(px, py, 5.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        } else if (r.id === 'p2') {
          ctx.fillStyle = '#00c4ff';
          ctx.arc(px, py, 5.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        } else {
          ctx.fillStyle = r.bike?.colorPrimaryHex || '#ffba08';
          ctx.arc(px, py, 3.3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  function drawTrackPreview() {
    const trackMeta = TRACKS.find((t) => t.id === config.trackId) || TRACKS[0];
    const descEl = document.getElementById('menu-track-desc');
    const metaEl = document.getElementById('menu-track-meta');
    if (descEl && trackMeta) {
      descEl.textContent = trackMeta.description;
    }
    if (metaEl && currentTrack) {
      metaEl.textContent = `${(currentTrack.totalLength / 1000).toFixed(2)} KM · 14M WIDE`;
    }
    drawMinimap(previewCtx, previewCanvas, currentTrack, []);
  }

  // ---------------------------------------------------------------------------
  // POST-RACE PODIUM, STANDINGS & CHAMPIONSHIPPROGRESSION
  // ---------------------------------------------------------------------------
  function showRaceResults() {
    audio.silence();

    const ranked = rankRiders([...riders]);
    const leaderTime = ranked[0] ? ranked[0].totalTime : 0;

    const circuitBadge = document.getElementById('results-circuit-tag');
    if (circuitBadge) {
      circuitBadge.textContent = `${currentTrack.name.toUpperCase()} · ${config.laps} LAPS`;
    }

    const podiumContainer = document.getElementById('podium-cards');
    if (podiumContainer) {
      podiumContainer.innerHTML = '';
      const top3 = ranked.slice(0, 3);
      top3.forEach((r, idx) => {
        const card = document.createElement('div');
        card.className = `podium-box pos-${idx + 1}`;
        card.innerHTML = `
          <span class="podium-place">${formatOrdinal(idx + 1)} PLACE</span>
          <div class="podium-rider">${r.name}</div>
          <div class="podium-bike">${r.bike.name} · ${r.bike.team}</div>
          <div class="podium-bike">BEST: ${formatLapTime(r.bestLapTime)}</div>
        `;
        podiumContainer.appendChild(card);
      });
    }

    const tbody = document.getElementById('results-tbody');
    if (tbody) {
      tbody.innerHTML = '';
      ranked.forEach((r, idx) => {
        const tr = document.createElement('tr');
        if (r.id === 'p1') tr.className = 'human-row';
        else if (r.id === 'p2') tr.className = 'human-p2-row';

        let timeCol = formatLapTime(r.totalTime);
        if (idx > 0) {
          if (r.finished && ranked[0].finished) {
            const gap = Math.max(0, r.totalTime - leaderTime);
            timeCol = `+${gap.toFixed(3)}s`;
          } else {
            const distGap = Math.max(1, Math.round((ranked[0].totalDistance || 0) - (r.totalDistance || 0)));
            timeCol = `+${distGap}m`;
          }
        }

        const lapsDone = r.finished ? config.laps : Math.max(0, r.lap - 1);
        tr.innerHTML = `
          <td>${formatOrdinal(idx + 1)}</td>
          <td>${r.name}</td>
          <td>${r.bike.name} #${r.bike.number}</td>
          <td>${lapsDone}/${config.laps}</td>
          <td>${timeCol}</td>
          <td>${formatLapTime(r.bestLapTime)}</td>
        `;
        tbody.appendChild(tr);
      });
    }

    const btnResultsChamp = document.getElementById('btn-results-championship');
    if (config.mode === 'championship') {
      championship.recordRoundResult(ranked);
      refreshChampionshipMenuBanner();
      if (btnResultsChamp) btnResultsChamp.classList.remove('hidden');
      showChampionshipStandings();
      return;
    }

    if (btnResultsChamp) btnResultsChamp.classList.add('hidden');
    gameState = GAME_STATES.RESULTS;
    if (championshipOverlay) championshipOverlay.classList.add('hidden');
    if (resultsOverlay) resultsOverlay.classList.remove('hidden');
  }

  // ---------------------------------------------------------------------------
  // 2P CHAMPIONSHIP STANDINGS & WORLD CHAMPION PODIUM UI
  // ---------------------------------------------------------------------------
  function renderChampionshipModal() {
    const champState = championship.getState();
    const standings = champState.standings || [];
    const completed = champState.completed;
    const roundsDone = champState.roundHistory.filter(Boolean).length;

    const eyebrowEl = document.getElementById('champ-eyebrow');
    const titleEl = document.getElementById('champ-title');
    const badgeEl = document.getElementById('champ-round-badge');
    const podiumEl = document.getElementById('champ-podium-cards');
    const tbodyEl = document.getElementById('champ-tbody');
    const nextBtn = document.getElementById('btn-champ-next-round');
    const replayBtn = document.getElementById('btn-champ-watch-replay');
    const raceResBtn = document.getElementById('btn-champ-race-results');

    if (eyebrowEl) {
      eyebrowEl.textContent = completed
        ? '1990 FIM 500cc WORLD CHAMPIONSHIP — FINAL SEASON CLASSIFICATION'
        : '1990 FIM 500cc WORLD CHAMPIONSHIP — POINTS: 20·17·15·13·11·10·9·8';
    }

    if (titleEl) {
      if (completed && champState.champion) {
        titleEl.textContent = `WORLD CHAMPION CROWNED: ${champState.champion.name.toUpperCase()}!`;
      } else {
        titleEl.textContent = `CHAMPIONSHIP STANDINGS — ROUND ${roundsDone} OF ${CHAMPIONSHIP_ROUNDS.length}`;
      }
    }

    if (badgeEl) {
      if (completed) {
        badgeEl.textContent = 'FINAL PODIUM (3/3 ROUNDS)';
      } else {
        const nextTrack = getTrackMeta(champState.currentTrackId);
        badgeEl.textContent = `NEXT: R${champState.currentRoundNumber} ${nextTrack.name.toUpperCase()}`;
      }
    }

    if (podiumEl) {
      podiumEl.innerHTML = '';
      const top3 = standings.slice(0, 3);
      top3.forEach((entry, idx) => {
        const card = document.createElement('div');
        card.className = `podium-box pos-${idx + 1}${completed && idx === 0 ? ' champion-crowned' : ''}`;
        const placeLabel = completed && idx === 0
          ? '1990 WORLD CHAMPION'
          : `${formatOrdinal(idx + 1)} OVERALL`;
        card.innerHTML = `
          <span class="podium-place">${placeLabel}</span>
          <div class="podium-rider">${entry.name}</div>
          <div class="podium-bike">${entry.bike?.name || ''} · ${entry.points} PTS (${entry.wins || 0} WINS)</div>
        `;
        podiumEl.appendChild(card);
      });
    }

    if (tbodyEl) {
      tbodyEl.innerHTML = '';
      standings.forEach((entry, idx) => {
        const tr = document.createElement('tr');
        if (entry.id === 'p1') tr.className = 'human-row';
        else if (entry.id === 'p2') tr.className = 'human-p2-row';

        const rPts = entry.roundPoints || [null, null, null];
        const fmtRound = (rIdx) => {
          const val = rPts[rIdx];
          const pos = entry.roundPositions ? entry.roundPositions[rIdx] : null;
          if (val === null || val === undefined) return '—';
          return `${val} pts (${formatOrdinal(pos)})`;
        };

        tr.innerHTML = `
          <td>${formatOrdinal(idx + 1)}</td>
          <td>${entry.name}</td>
          <td>${entry.bike?.name || ''} #${entry.bike?.number || ''}</td>
          <td>${fmtRound(0)}</td>
          <td>${fmtRound(1)}</td>
          <td>${fmtRound(2)}</td>
          <td>${entry.wins || 0}</td>
          <td><strong>${entry.points} PTS</strong></td>
        `;
        tbodyEl.appendChild(tr);
      });
    }

    if (nextBtn) {
      if (completed) {
        nextBtn.textContent = 'START NEW CHAMPIONSHIP';
      } else {
        const nextTrack = getTrackMeta(champState.currentTrackId);
        nextBtn.textContent = `START ROUND ${champState.currentRoundNumber}: ${nextTrack.name.toUpperCase()}`;
      }
    }

    const hasReplay = replay.getFrameCount() > 1;
    if (replayBtn) {
      replayBtn.classList.toggle('hidden', !hasReplay);
    }
    if (raceResBtn) {
      raceResBtn.classList.toggle('hidden', riders.length === 0 || roundsDone === 0);
    }
  }

  function showChampionshipStandings() {
    renderChampionshipModal();
    gameState = GAME_STATES.CHAMPIONSHIP;
    if (resultsOverlay) resultsOverlay.classList.add('hidden');
    if (paddockMenu) paddockMenu.classList.add('hidden');
    if (championshipOverlay) championshipOverlay.classList.remove('hidden');
  }

  function refreshChampionshipMenuBanner() {
    const bar = document.getElementById('championship-menu-bar');
    const statusText = document.getElementById('champ-banner-status');
    const resumeBtn = document.getElementById('btn-resume-championship');
    const viewBtn = document.getElementById('btn-view-championship-menu');
    const resetBtn = document.getElementById('btn-reset-championship');
    const startBtn = document.getElementById('btn-start-race');

    const hasSaved = championship.hasSavedChampionship();
    const champState = championship.getState();
    const showBar = config.mode === 'championship' || hasSaved;

    if (bar) {
      bar.classList.toggle('hidden', !showBar);
    }

    if (statusText) {
      if (hasSaved && !champState.completed && champState.currentRoundIndex > 0) {
        const nextTrack = getTrackMeta(champState.currentTrackId);
        const leader = champState.standings[0];
        const leaderInfo = leader ? ` · LEADER: ${leader.name} (${leader.points} PTS)` : '';
        statusText.textContent = `IN PROGRESS — NEXT: ROUND ${champState.currentRoundNumber}/3 (${nextTrack.name.toUpperCase()})${leaderInfo}`;
      } else if (hasSaved && champState.completed && champState.champion) {
        statusText.textContent = `COMPLETED — CHAMPION: ${champState.champion.name} (${champState.champion.points} PTS)`;
      } else {
        statusText.textContent = '3 ROUNDS: R1 SAKURA GP → R2 MONTEREY RIDGE → R3 CATHEDRAL TT (PTS: 20·17·15·13·11·10·9·8)';
      }
    }

    const canResume = hasSaved && !champState.completed && champState.currentRoundIndex > 0;
    if (resumeBtn) {
      resumeBtn.classList.toggle('hidden', !canResume);
      if (canResume) {
        resumeBtn.textContent = `RESUME R${champState.currentRoundNumber}/3`;
      }
    }
    if (viewBtn) {
      viewBtn.classList.toggle('hidden', !hasSaved || champState.standings.length === 0);
    }
    if (resetBtn) {
      resetBtn.classList.toggle('hidden', !hasSaved);
    }

    if (startBtn) {
      if (config.mode === 'championship') {
        if (canResume) {
          startBtn.textContent = `LAUNCH ROUND ${champState.currentRoundNumber}/3`;
        } else {
          startBtn.textContent = 'START 2P CHAMPIONSHIP (R1)';
        }
      } else {
        startBtn.textContent = 'START GRAND PRIX';
      }
    }
  }

  // ---------------------------------------------------------------------------
  // FULL-SCREEN TV BROADCAST REPLAY PLAYBACK & UI
  // ---------------------------------------------------------------------------
  function enterReplayMode() {
    // If replay is invoked directly (e.g. via URL hook or test) before enough frames were recorded,
    // fast-forward a few seconds of deterministic simulation so the replay has moving bikes
    if (replay.getFrameCount() < 10) {
      if (riders.length === 0) buildRaceGrid();
      for (let i = 0; i < 360; i++) {
        stepSimulationTick(FIXED_DT);
      }
    }

    if (gameState !== GAME_STATES.REPLAY) {
      stateBeforeReplay = gameState;
    }
    applySiteModeClasses('race');
    gameState = GAME_STATES.REPLAY;
    audio.init();
    replay.startPlayback();

    if (paddockMenu) paddockMenu.classList.add('hidden');
    if (raceHud) raceHud.classList.add('hidden');
    if (pauseOverlay) pauseOverlay.classList.add('hidden');
    if (resultsOverlay) resultsOverlay.classList.add('hidden');
    if (championshipOverlay) championshipOverlay.classList.add('hidden');
    if (replayOverlay) replayOverlay.classList.remove('hidden');

    syncReplayControlsUi(replay.stepPlayback(0));
    lastFrameTime = performance.now();
  }

  function exitReplayMode() {
    audio.silence();
    if (replayOverlay) replayOverlay.classList.add('hidden');

    if (stateBeforeReplay === GAME_STATES.CHAMPIONSHIP) {
      showChampionshipStandings();
    } else if (stateBeforeReplay === GAME_STATES.RESULTS) {
      gameState = GAME_STATES.RESULTS;
      if (resultsOverlay) resultsOverlay.classList.remove('hidden');
    } else {
      returnToPaddock();
    }
    applySplitModeToDomAndRenderer();
  }

  function syncReplayControlsUi(snap) {
    if (!snap) return;
    const playBtn = document.getElementById('btn-replay-play');
    const focusBtn = document.getElementById('btn-replay-focus');
    const camBtn = document.getElementById('btn-replay-cam');
    const camPill = document.getElementById('replay-cam-pill');
    const scrubEl = document.getElementById('replay-scrub');
    const curTimeEl = document.getElementById('replay-time-current');
    const totTimeEl = document.getElementById('replay-time-total');

    const riderNameEl = document.getElementById('replay-rider-name');
    const riderPosEl = document.getElementById('replay-rider-pos');
    const riderSpeedEl = document.getElementById('replay-rider-speed');
    const riderGearEl = document.getElementById('replay-rider-gear');
    const riderLapEl = document.getElementById('replay-rider-lap');

    if (playBtn) {
      playBtn.textContent = snap.playing ? 'PAUSE' : 'PLAY';
    }
    if (focusBtn) {
      focusBtn.textContent = `FOCUS: ${snap.focusMode.toUpperCase()}`;
    }
    if (camBtn) {
      camBtn.textContent = snap.tvMode ? 'CAM: TV BROADCAST' : 'CAM: CHASE';
    }
    if (camPill) {
      camPill.textContent = snap.tvMode ? 'TRACKSIDE TV CAM' : 'CHASE CAM';
    }

    document.querySelectorAll('.replay-speed-btn').forEach((btn) => {
      const btnSpeed = Number(btn.getAttribute('data-speed'));
      btn.classList.toggle('active', Math.abs(btnSpeed - snap.speed) < 1e-3);
    });

    if (scrubEl && document.activeElement !== scrubEl) {
      scrubEl.value = String(Math.round((snap.progress || 0) * 1000));
    }
    if (curTimeEl) {
      curTimeEl.textContent = formatShortTime(snap.currentTime);
    }
    if (totTimeEl) {
      totTimeEl.textContent = formatShortTime(snap.duration);
    }

    const r = snap.focusedRider;
    if (r) {
      if (riderNameEl) riderNameEl.textContent = r.name || r.id;
      if (riderPosEl) riderPosEl.textContent = `POS ${formatOrdinal(r.position || 1)}`;
      if (riderSpeedEl) riderSpeedEl.textContent = `${Math.round((r.speed || 0) * 3.6)} KM/H`;
      if (riderGearEl) riderGearEl.textContent = `GEAR ${r.gear || 1}`;
      if (riderLapEl) riderLapEl.textContent = `LAP ${Math.min(r.lap || 1, config.laps)}/${config.laps}`;
    }
  }

  function stepReplayFrame(rawDt) {
    const snap = replay.stepPlayback(rawDt);
    const snapshotRiders = snap.riders || [];
    const focusIndex = snap.focusIndex ?? 0;

    // When in chase cam mode during single-screen replay, ensure the focused rider is treated as the primary subject
    const renderList = snap.tvMode
      ? snapshotRiders
      : snapshotRiders.map((r, idx) => ({ ...r, isAI: idx !== focusIndex }));

    renderer.renderFrame(renderList, 'single', rawDt, {
      tv: snap.tvMode,
      focusIndex
    });

    // Audio follows the focused rider during replay with Doppler pass-bys from surrounding riders
    if (snap.playing && snap.focusedRider) {
      const replayAudioRiders = snapshotRiders.map((r, idx) =>
        idx === focusIndex ? { ...r, isAI: false } : { ...r, isAI: true }
      );
      audio.update(replayAudioRiders, { tvMode: snap.tvMode, focusIndex, splitMode: 'single' });
    } else {
      audio.silence();
    }

    syncReplayControlsUi(snap);
  }

  // ---------------------------------------------------------------------------
  // PADDOCK MENU INTERACTIVITY & GAMEPAD POLLING
  // ---------------------------------------------------------------------------
  function syncSelectAndPills(selectId, value) {
    const sel = document.getElementById(selectId);
    if (sel) sel.value = String(value);
    const pillGroup = document.querySelector(`.Segmented-pills[data-for="${selectId}"]`);
    if (pillGroup) {
      pillGroup.querySelectorAll('.seg-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.getAttribute('data-value') === String(value));
      });
    }
  }

  function updateP2GarageLabels() {
    const p2Title = document.getElementById('p2-garage-title');
    const p2Sub = document.getElementById('p2-garage-sub');
    if (!p2Title || !p2Sub) return;

    if (config.mode === 'solo') {
      p2Title.textContent = 'LEAD AI RIVAL MACHINE';
      p2Sub.textContent = 'SOLO GP MODE — FULL SCREEN VIEWPORT';
    } else if (config.mode === 'championship') {
      p2Title.textContent = 'PLAYER 2 MACHINE';
      p2Sub.textContent = '2P WORLD CHAMPIONSHIP CONTENDER';
    } else {
      p2Title.textContent = 'PLAYER 2 MACHINE';
      p2Sub.textContent = '500cc V4 TWO-STROKE FACTORY ENTRY';
    }
  }

  function bindConfigControl(selectId, configKey, transform = (v) => v, onChange = null) {
    const sel = document.getElementById(selectId);
    const pillGroup = document.querySelector(`.Segmented-pills[data-for="${selectId}"]`);

    const applyVal = (rawVal) => {
      config[configKey] = transform(rawVal);
      syncSelectAndPills(selectId, rawVal);
      if (onChange) onChange(config[configKey]);
    };

    if (sel) {
      sel.addEventListener('change', (e) => applyVal(e.target.value));
    }
    if (pillGroup) {
      pillGroup.querySelectorAll('.seg-btn').forEach((btn) => {
        btn.addEventListener('click', () => applyVal(btn.getAttribute('data-value')));
      });
    }
  }

  function bindBikeCards() {
    const cards = document.querySelectorAll('.bike-card');
    cards.forEach((card) => {
      const selectCard = () => {
        const player = card.getAttribute('data-player');
        const bikeId = card.getAttribute('data-bike-id');
        if (!bikeId) return;
        setBikeSelection(player, bikeId);
      };

      card.addEventListener('click', selectCard);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          selectCard();
        }
      });
    });
  }

  function refreshGamepadBadges() {
    const status = input.getGamepadStatus();
    const p1Badge = document.getElementById('p1-gamepad-badge');
    const p2Badge = document.getElementById('p2-gamepad-badge');
    const topPad1 = document.getElementById('menu-pad1-status');
    const topPad2 = document.getElementById('menu-pad2-status');

    if (p1Badge) {
      p1Badge.textContent = status.p1Connected
        ? `Gamepad 1 Connected (${status.p1Name.slice(0, 22)})`
        : 'Gamepad 1: Standby (WASD + Space + C)';
      p1Badge.classList.toggle('active', status.p1Connected);
    }
    if (p2Badge) {
      p2Badge.textContent = status.p2Connected
        ? `Gamepad 2 Connected (${status.p2Name.slice(0, 22)})`
        : 'Gamepad 2: Standby (Arrows + Enter + .)';
      p2Badge.classList.toggle('active', status.p2Connected);
    }
    if (topPad1) {
      topPad1.textContent = status.p1Connected ? 'P1: GAMEPAD + WASD' : 'P1: WASD + SPACE + C';
      topPad1.classList.toggle('connected', status.p1Connected);
    }
    if (topPad2) {
      topPad2.textContent = status.p2Connected ? 'P2: GAMEPAD + ARROWS' : 'P2: ARROWS + ENTER + .';
      topPad2.classList.toggle('connected', status.p2Connected);
    }
  }

  // Bind UI controls
  bindConfigControl('select-mode', 'mode', String, () => {
    if (config.mode === 'championship') {
      const nextTrackId = championship.isActive() && !championship.isCompleted()
        ? championship.getCurrentTrackId()
        : CHAMPIONSHIP_ROUNDS[0];
      config.trackId = nextTrackId;
      syncSelectAndPills('select-track', config.trackId);
      drawTrackPreview();
    }
    updateP2GarageLabels();
    refreshChampionshipMenuBanner();
    applySplitModeToDomAndRenderer();
    if (gameState === GAME_STATES.MENU) buildRaceGrid();
  });
  bindConfigControl('select-split', 'splitMode', String, () => {
    applySplitModeToDomAndRenderer();
  });
  bindConfigControl('select-track', 'trackId', String, () => {
    if (gameState === GAME_STATES.MENU) {
      buildRaceGrid();
      drawTrackPreview();
    }
  });
  bindConfigControl('select-laps', 'laps', (v) => Number(v) || 3);
  bindConfigControl('select-difficulty', 'difficulty', String);
  bindBikeCards();

  // Menu & HUD Buttons
  document.getElementById('btn-start-race')?.addEventListener('click', startRaceSession);
  document.getElementById('btn-paddock-home')?.addEventListener('click', returnToSite);
  document.getElementById('btn-footer-quickplay')?.addEventListener('click', () =>
    launchQuickRace({ mode: 'gp', trackId: 'sakura' })
  );
  document.getElementById('btn-menu-mute')?.addEventListener('click', handleMuteShortcut);
  document.getElementById('btn-hud-split')?.addEventListener('click', toggleSplitOrientation);
  document.getElementById('btn-hud-mute')?.addEventListener('click', handleMuteShortcut);
  document.getElementById('btn-hud-pause')?.addEventListener('click', handlePauseShortcut);
  document.getElementById('p1-cam-badge')?.addEventListener('click', () => cyclePlayerCameraMode(0));
  document.getElementById('p2-cam-badge')?.addEventListener('click', () => cyclePlayerCameraMode(1));

  // Pause Modal Buttons
  document.getElementById('btn-resume')?.addEventListener('click', resumeFromPause);
  document.getElementById('btn-pause-split')?.addEventListener('click', toggleSplitOrientation);
  document.getElementById('btn-pause-mute')?.addEventListener('click', handleMuteShortcut);
  document.getElementById('btn-pause-restart')?.addEventListener('click', startRaceSession);
  document.getElementById('btn-pause-paddock')?.addEventListener('click', returnToPaddock);

  // Results Modal Buttons
  document.getElementById('btn-watch-replay')?.addEventListener('click', enterReplayMode);
  document.getElementById('btn-results-championship')?.addEventListener('click', showChampionshipStandings);
  document.getElementById('btn-race-again')?.addEventListener('click', startRaceSession);
  document.getElementById('btn-back-paddock')?.addEventListener('click', returnToPaddock);

  // Championship Paddock & Modal Buttons
  document.getElementById('btn-resume-championship')?.addEventListener('click', () => {
    config.mode = 'championship';
    syncSelectAndPills('select-mode', 'championship');
    config.trackId = championship.getCurrentTrackId();
    syncSelectAndPills('select-track', config.trackId);
    updateP2GarageLabels();
    startRaceSession();
  });
  document.getElementById('btn-view-championship-menu')?.addEventListener('click', showChampionshipStandings);
  document.getElementById('btn-reset-championship')?.addEventListener('click', () => {
    championship.resetChampionship();
    if (config.mode === 'championship') {
      config.trackId = CHAMPIONSHIP_ROUNDS[0];
      syncSelectAndPills('select-track', config.trackId);
      buildRaceGrid();
      drawTrackPreview();
    }
    refreshChampionshipMenuBanner();
  });

  document.getElementById('btn-champ-watch-replay')?.addEventListener('click', enterReplayMode);
  document.getElementById('btn-champ-race-results')?.addEventListener('click', () => {
    if (championshipOverlay) championshipOverlay.classList.add('hidden');
    if (resultsOverlay) resultsOverlay.classList.remove('hidden');
    gameState = GAME_STATES.RESULTS;
  });
  document.getElementById('btn-champ-reset')?.addEventListener('click', () => {
    championship.resetChampionship();
    returnToPaddock();
  });
  document.getElementById('btn-champ-paddock')?.addEventListener('click', returnToPaddock);
  document.getElementById('btn-champ-next-round')?.addEventListener('click', () => {
    config.mode = 'championship';
    syncSelectAndPills('select-mode', 'championship');
    if (championship.isCompleted()) {
      championship.startNewChampionship(config);
    }
    config.trackId = championship.getCurrentTrackId();
    syncSelectAndPills('select-track', config.trackId);
    startRaceSession();
  });

  // Replay Controls
  document.getElementById('btn-replay-play')?.addEventListener('click', () => {
    replay.togglePlay();
    syncReplayControlsUi(replay.stepPlayback(0));
  });
  document.querySelectorAll('.replay-speed-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      replay.setSpeed(Number(btn.getAttribute('data-speed')) || 1);
      syncReplayControlsUi(replay.stepPlayback(0));
    });
  });
  document.getElementById('replay-scrub')?.addEventListener('input', (e) => {
    const ratio = (Number(e.target.value) || 0) / 1000;
    replay.seekProgress(ratio);
    syncReplayControlsUi(replay.stepPlayback(0));
  });
  document.getElementById('btn-replay-focus')?.addEventListener('click', () => {
    replay.cycleFocusMode(riders);
    syncReplayControlsUi(replay.stepPlayback(0));
  });
  document.getElementById('btn-replay-cam')?.addEventListener('click', () => {
    replay.toggleCameraMode();
    syncReplayControlsUi(replay.stepPlayback(0));
  });
  document.getElementById('btn-replay-exit')?.addEventListener('click', exitReplayMode);

  window.addEventListener('resize', () => {
    if (viewMode === 'site' && showroom) {
      showroom.resize();
    } else {
      renderer.resize();
    }
  });

  // Apply URL query parameters (?autostart=1&mode=gp|duel|solo&track=sakura&split=horizontal|vertical&demo=1)
  const urlCfg = parseUrlConfig();
  if (urlCfg.mode) {
    config.mode = urlCfg.mode;
    syncSelectAndPills('select-mode', config.mode);
    updateP2GarageLabels();
  }
  if (urlCfg.trackId) {
    config.trackId = urlCfg.trackId;
    syncSelectAndPills('select-track', config.trackId);
  }
  if (urlCfg.splitMode) {
    config.splitMode = urlCfg.splitMode;
    syncSelectAndPills('select-split', config.splitMode);
  }
  if (urlCfg.laps) {
    config.laps = urlCfg.laps;
    syncSelectAndPills('select-laps', config.laps);
  }
  if (urlCfg.difficulty) {
    config.difficulty = urlCfg.difficulty;
    syncSelectAndPills('select-difficulty', config.difficulty);
  }
  if (urlCfg.demo) {
    config.demo = true;
  }
  if (urlCfg.autostart) {
    config.autostart = true;
  }

  // Initialize Paddock scene & circuit preview
  refreshChampionshipMenuBanner();
  buildRaceGrid();
  drawTrackPreview();

  if (urlCfg.p1Camera) {
    setPlayerCameraMode(0, urlCfg.p1Camera);
  }
  if (urlCfg.p2Camera) {
    setPlayerCameraMode(1, urlCfg.p2Camera);
  }

  // Initialize 3D Showroom (deferred when autostart/replay) and Website Showcase controller
  const immediateRaceBoot = Boolean(urlCfg.replay || urlCfg.autostart);
  if (!immediateRaceBoot) {
    ensureShowroom();
  }
  showcase = initWebsiteShowcase({
    showroom,
    audio,
    input,
    initialBikeId: config.p1BikeId,
    initialTrackId: config.trackId,
    onLaunchRace: launchQuickRace,
    onOpenPaddock: openPaddock,
    onSelectBike: (bikeId) => setBikeSelection(1, bikeId),
    onSelectTrack: (trackId) => setTrackSelection(trackId),
    onToggleMute: handleMuteShortcut
  });

  // Auto-launch race or replay if requested via URL parameters
  if (urlCfg.replay) {
    startRaceSession();
    enterReplayMode();
  } else if (urlCfg.autostart) {
    startRaceSession();
  } else {
    applySiteModeClasses('site');
  }

  // ---------------------------------------------------------------------------
  // MAIN REQUESTANIMATIONFRAME LOOP & FPS TRACKER
  // ---------------------------------------------------------------------------
  function updateRollingFps(frameDeltaSec) {
    if (frameDeltaSec > 0.0005 && frameDeltaSec < 1.0) {
      frameDurationHistory.push(frameDeltaSec);
      if (frameDurationHistory.length > FPS_WINDOW_SIZE) {
        frameDurationHistory.shift();
      }
      const sumDt = frameDurationHistory.reduce((acc, v) => acc + v, 0);
      if (sumDt > 0) {
        rollingFps = Math.round((frameDurationHistory.length / sumDt) * 10) / 10;
      }
    }
    if (window.__gp500) {
      window.__gp500.fps = rollingFps;
    }
  }

  function frameLoop(now) {
    const actualDt = (now - lastFrameTime) / 1000;
    const rawDt = Math.min(0.1, Math.max(0.001, actualDt > 0 ? actualDt : 1 / 60));
    lastFrameTime = now;

    updateRollingFps(actualDt);
    refreshGamepadBadges();

    if (gameState === GAME_STATES.COUNTDOWN) {
      stepCountdown(rawDt);
      renderer.renderFrame(riders, getEffectiveSplitMode(), rawDt);
      updateAllHud();
      drawMinimap(minimapCtx, minimapCanvas, currentTrack, riders);
    } else if (gameState === GAME_STATES.RACING) {
      if (goBannerTimer > 0) {
        goBannerTimer -= rawDt;
        if (goBannerTimer <= 0 && countdownOverlay) {
          countdownOverlay.classList.add('hidden');
        }
      }

      physicsAccumulator += rawDt;
      // Cap substeps to prevent spiral of death on tab switch
      let subSteps = 0;
      while (physicsAccumulator >= FIXED_DT && subSteps < 10) {
        stepSimulationTick(FIXED_DT);
        physicsAccumulator -= FIXED_DT;
        subSteps++;
      }

      updateGamepadHaptics(now);
      audio.update(riders, { splitMode: getEffectiveSplitMode() });
      renderer.renderFrame(riders, getEffectiveSplitMode(), rawDt);
      updateAllHud();
      drawMinimap(minimapCtx, minimapCanvas, currentTrack, riders);
      checkRaceCompletion(rawDt);
    } else if (gameState === GAME_STATES.REPLAY) {
      stepReplayFrame(rawDt);
    } else if (gameState === GAME_STATES.MENU && viewMode === 'paddock') {
      // Render live 3D grid preview behind the Paddock menu (paused while browsing website)
      renderer.renderFrame(riders, getEffectiveSplitMode(), rawDt);
    }

    requestAnimationFrame(frameLoop);
  }

  const api = {
    config,
    renderer,
    audio,
    replay,
    championship,
    input,
    showcase,
    getShowroom: () => showroom,
    getViewMode: () => viewMode,
    getState: () => gameState,
    getRiders: () => riders,
    fps: rollingFps,
    setCameraMode: setPlayerCameraMode,
    getCameraMode: getPlayerCameraMode,
    cycleCameraMode: cyclePlayerCameraMode,
    setSplitMode: (mode) => {
      config.splitMode = mode === 'vertical' ? 'vertical' : 'horizontal';
      syncSelectAndPills('select-split', config.splitMode);
      applySplitModeToDomAndRenderer();
    },
    openPaddock,
    returnToSite,
    startRaceSession,
    returnToPaddock,
    showRaceResults,
    showChampionshipStandings,
    startReplay: enterReplayMode,
    stopReplay: exitReplayMode,
    stepFrames: (count = 1, dt = FIXED_DT) => {
      for (let i = 0; i < count; i++) {
        stepSimulationTick(dt);
      }
      renderer.renderFrame(riders, getEffectiveSplitMode(), dt);
      updateAllHud();
    }
  };

  window.__gp500 = api;
  requestAnimationFrame(frameLoop);

  return api;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initGame());
  } else {
    initGame();
  }
}
