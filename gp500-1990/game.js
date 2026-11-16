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

export const GAME_STATES = {
  MENU: 'MENU',
  COUNTDOWN: 'COUNTDOWN',
  RACING: 'RACING',
  PAUSED: 'PAUSED',
  RESULTS: 'RESULTS'
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

export function initGame() {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return null;
  }

  const canvas = document.getElementById('race-canvas');
  const paddockMenu = document.getElementById('paddock-menu');
  const raceHud = document.getElementById('race-hud');
  const countdownOverlay = document.getElementById('countdown-overlay');
  const countdownText = document.getElementById('countdown-text');
  const pauseOverlay = document.getElementById('pause-overlay');
  const resultsOverlay = document.getElementById('results-overlay');

  const minimapCanvas = document.getElementById('minimap-canvas');
  const minimapCtx = minimapCanvas ? minimapCanvas.getContext('2d') : null;
  const previewCanvas = document.getElementById('menu-track-preview');
  const previewCtx = previewCanvas ? previewCanvas.getContext('2d') : null;

  // Game configuration state
  const config = {
    mode: 'gp',            // 'gp' (2P + 6 AI), 'duel' (2P 1v1), 'solo' (1P + 7 AI)
    splitMode: 'horizontal', // 'horizontal' | 'vertical'
    trackId: 'sakura',     // 'sakura' | 'monterey' | 'cathedral'
    laps: 3,               // 3 | 5 | 8
    difficulty: 'pro',     // 'rookie' | 'pro' | 'legend'
    p1BikeId: 'akagi',
    p2BikeId: 'shiden'
  };

  let gameState = GAME_STATES.MENU;
  let stateBeforePause = GAME_STATES.RACING;
  let currentTrack = createTrack(config.trackId);
  let riders = [];
  let p1Rider = null;
  let p2Rider = null;

  // Physics fixed-timestep accumulator
  let physicsAccumulator = 0;
  let lastFrameTime = performance.now();

  // Countdown state
  let countdownTimer = 0;
  let lastLitLights = -1;
  let goBannerTimer = 0;
  let postFinishTimer = 0;

  // Core subsystems
  const renderer = createRaceRenderer(canvas);
  const audio = createAudioEngine();
  const input = createInputManager({
    onToggleSplit: () => toggleSplitOrientation(),
    onTogglePause: () => handlePauseShortcut(),
    onToggleMute: () => handleMuteShortcut()
  });

  // Cache HUD DOM elements for P1 and P2
  const hudElements = [1, 2].map((pNum) => ({
    root: document.getElementById(`hud-p${pNum}`),
    bikeTag: document.getElementById(`p${pNum}-bike-tag`),
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
    if (menuMuteBtn) {
      menuMuteBtn.textContent = isMuted ? 'AUDIO: MUTED [M]' : 'AUDIO: ON [M]';
    }
    if (hudMuteBtn) {
      hudMuteBtn.textContent = isMuted ? '[M] MUTE' : '[M] SND';
    }
  }

  function handlePauseShortcut() {
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
      track: currentTrack
    });
    riders.push(p1Rider);

    if (config.mode === 'gp' || config.mode === 'duel') {
      p2Rider = createRiderState({
        id: 'p2',
        name: `Player 2 (#${p2Bike.number})`,
        isAI: false,
        playerIndex: 1,
        bike: p2Bike,
        s: 18.0,
        d: 2.2,
        track: currentTrack
      });
      riders.push(p2Rider);
    } else {
      p2Rider = null;
    }

    // Add AI riders for full 8-rider Grand Prix grid
    const aiCount = config.mode === 'duel' ? 0 : config.mode === 'solo' ? 7 : 6;
    for (let i = 0; i < aiCount; i++) {
      const slotIndex = riders.length; // 1..7 or 2..7
      const row = Math.floor(slotIndex / 2);
      const col = slotIndex % 2;
      const gridS = Math.max(2.5, 18.0 - row * 3.8 - col * 1.1);
      const gridD = col === 0 ? -2.3 : 2.3;

      const aiTemplate = AI_ROSTER[i % AI_ROSTER.length];
      // If in 1P solo mode, first AI uses the P2 garage selection
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
    updateAllHud();
    drawMinimap(minimapCtx, minimapCanvas, currentTrack, riders);
  }

  function startRaceSession() {
    audio.init();
    input.reset();
    physicsAccumulator = 0;
    postFinishTimer = 0;

    buildRaceGrid();

    if (paddockMenu) paddockMenu.classList.add('hidden');
    if (pauseOverlay) pauseOverlay.classList.add('hidden');
    if (resultsOverlay) resultsOverlay.classList.add('hidden');
    if (raceHud) raceHud.classList.remove('hidden');

    // Start 5-light gantry countdown
    gameState = GAME_STATES.COUNTDOWN;
    countdownTimer = 3.2;
    lastLitLights = 0;
    goBannerTimer = 0;
    renderer.setStartLights(0, false);
    updateCountdownVisuals(0, false, 'ENGINES START — GET READY');
    if (countdownOverlay) countdownOverlay.classList.remove('hidden');
    lastFrameTime = performance.now();
  }

  function returnToPaddock() {
    audio.silence();
    gameState = GAME_STATES.MENU;
    if (raceHud) raceHud.classList.add('hidden');
    if (pauseOverlay) pauseOverlay.classList.add('hidden');
    if (resultsOverlay) resultsOverlay.classList.add('hidden');
    if (countdownOverlay) countdownOverlay.classList.add('hidden');
    if (paddockMenu) paddockMenu.classList.remove('hidden');
    buildRaceGrid();
    drawTrackPreview();
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

    // Allow human players to rev their 2-stroke engines on the start line
    const p1In = input.getPlayerInput(0);
    if (p1Rider) {
      p1Rider.throttle = p1In.throttle;
      p1Rider.rpm = 4200 + p1In.throttle * 7600 + Math.sin(performance.now() * 0.03) * 180;
    }
    if (p2Rider) {
      const p2In = input.getPlayerInput(1);
      p2Rider.throttle = p2In.throttle;
      p2Rider.rpm = 4200 + p2In.throttle * 7600 + Math.cos(performance.now() * 0.03) * 180;
    }
    audio.update(riders);

    const elapsed = 3.2 - countdownTimer;
    const litNow = clamp(Math.floor(elapsed / 0.58) + 1, 1, 5);

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
      goBannerTimer = 1.15;
      renderer.setStartLights(5, true);
      updateCountdownVisuals(5, true, 'GO! GO! GO!');
      audio.playStartBeep(true);
    }
  }

  // ---------------------------------------------------------------------------
  // FIXED-TIMESTEP PHYSICS SIMULATION
  // ---------------------------------------------------------------------------
  function stepSimulationTick(dt) {
    for (let i = 0; i < riders.length; i++) {
      const r = riders[i];
      let riderInput;

      if (!r.isAI && !r.finished) {
        riderInput = input.getPlayerInput(r.playerIndex);
      } else {
        // AI rider (or human rider on cooldown cruise after crossing finish line)
        riderInput = computeAIInput(r, currentTrack, riders, config.difficulty);
      }

      stepRiderPhysics(r, riderInput, currentTrack, riders, dt, config.laps);
    }

    rankRiders(riders);
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
  // POST-RACE PODIUM & STANDINGS TABLE
  // ---------------------------------------------------------------------------
  function showRaceResults() {
    gameState = GAME_STATES.RESULTS;
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

    if (resultsOverlay) resultsOverlay.classList.remove('hidden');
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

        if (player === '1') {
          config.p1BikeId = bikeId;
          document.querySelectorAll('#p1-bike-cards .bike-card').forEach((c) => {
            c.classList.toggle('selected', c.getAttribute('data-bike-id') === bikeId);
          });
        } else if (player === '2') {
          config.p2BikeId = bikeId;
          document.querySelectorAll('#p2-bike-cards .bike-card').forEach((c) => {
            c.classList.toggle('selected', c.getAttribute('data-bike-id') === bikeId);
          });
        }

        if (gameState === GAME_STATES.MENU) {
          buildRaceGrid();
        }
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
        : 'Gamepad 1: Standby (WASD + Space)';
      p1Badge.classList.toggle('active', status.p1Connected);
    }
    if (p2Badge) {
      p2Badge.textContent = status.p2Connected
        ? `Gamepad 2 Connected (${status.p2Name.slice(0, 22)})`
        : 'Gamepad 2: Standby (Arrows + Enter)';
      p2Badge.classList.toggle('active', status.p2Connected);
    }
    if (topPad1) {
      topPad1.textContent = status.p1Connected ? 'P1: GAMEPAD + WASD' : 'P1: WASD + SPACE';
      topPad1.classList.toggle('connected', status.p1Connected);
    }
    if (topPad2) {
      topPad2.textContent = status.p2Connected ? 'P2: GAMEPAD + ARROWS' : 'P2: ARROWS + ENTER';
      topPad2.classList.toggle('connected', status.p2Connected);
    }
  }

  // Bind UI controls
  bindConfigControl('select-mode', 'mode', String, () => {
    updateP2GarageLabels();
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

  // Buttons
  document.getElementById('btn-start-race')?.addEventListener('click', startRaceSession);
  document.getElementById('btn-menu-mute')?.addEventListener('click', handleMuteShortcut);
  document.getElementById('btn-hud-split')?.addEventListener('click', toggleSplitOrientation);
  document.getElementById('btn-hud-mute')?.addEventListener('click', handleMuteShortcut);
  document.getElementById('btn-hud-pause')?.addEventListener('click', handlePauseShortcut);

  document.getElementById('btn-resume')?.addEventListener('click', resumeFromPause);
  document.getElementById('btn-pause-split')?.addEventListener('click', toggleSplitOrientation);
  document.getElementById('btn-pause-mute')?.addEventListener('click', handleMuteShortcut);
  document.getElementById('btn-pause-restart')?.addEventListener('click', startRaceSession);
  document.getElementById('btn-pause-paddock')?.addEventListener('click', returnToPaddock);

  document.getElementById('btn-race-again')?.addEventListener('click', startRaceSession);
  document.getElementById('btn-back-paddock')?.addEventListener('click', returnToPaddock);

  window.addEventListener('resize', () => {
    renderer.resize();
  });

  // Initialize Paddock scene & circuit preview
  buildRaceGrid();
  drawTrackPreview();

  // ---------------------------------------------------------------------------
  // MAIN REQUESTANIMATIONFRAME LOOP
  // ---------------------------------------------------------------------------
  function frameLoop(now) {
    const rawDt = Math.min(0.1, Math.max(0.001, (now - lastFrameTime) / 1000));
    lastFrameTime = now;

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

      audio.update(riders);
      renderer.renderFrame(riders, getEffectiveSplitMode(), rawDt);
      updateAllHud();
      drawMinimap(minimapCtx, minimapCanvas, currentTrack, riders);
      checkRaceCompletion(rawDt);
    } else if (gameState === GAME_STATES.MENU) {
      // Render live 3D grid preview behind the Paddock menu
      renderer.renderFrame(riders, getEffectiveSplitMode(), rawDt);
    }

    requestAnimationFrame(frameLoop);
  }

  requestAnimationFrame(frameLoop);

  return {
    config,
    getState: () => gameState,
    getRiders: () => riders,
    startRaceSession,
    returnToPaddock
  };
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initGame());
  } else {
    initGame();
  }
}
