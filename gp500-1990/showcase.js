/**
 * Interactive Website Showcase Controller for 500cc Grand Prix '90
 * Powers:
 * - Hero cursor spotlight / flashlight reveal (--spot-x / --spot-y) with idle figure-eight motion
 * - IntersectionObserver scroll reveals (.reveal-block) & sticky navbar active link highlighting
 * - 3D Showroom machine selector, specs readout, Lean/Tuck pose toggles, and 2.2s V4 engine rev sweep
 * - Interactive Circuit Explorer (top-down curvature map + elevation profile)
 * - Live 500cc Engineering Lab (2-stroke powerband curve + cornering tan(theta) = v^2/(g*r) visualizer)
 * - Live Gamepad / Hardware status sync
 */

import { BIKES, getBikeById } from './bikes.js';
import { TRACKS, createTrack } from './track.js';
import { computePowerbandMultiplier, GRAVITY, MAX_LEAN_RAD } from './physics.js';

const BASE_GEAR_MAX_SPEEDS = [0, 37.0, 52.0, 63.5, 72.5, 80.0, 86.5];

const BIKE_SHOWROOM_META = {
  akagi: {
    engine: '498cc 70° V4 2-Stroke · Screamer',
    power: '162 HP @ 12,400 RPM',
    weight: '130 KG DRY',
    crank: '90° Even-Firing V4',
    summary: 'Razor-sharp corner entry with balanced chassis feedback and explosive midrange powerband drive.'
  },
  shiden: {
    engine: '499cc 112° V4 2-Stroke · Big-Bang',
    power: '168 HP @ 12,100 RPM',
    weight: '131 KG DRY',
    crank: 'Twin-Pulse Big-Bang V4',
    summary: 'Highest straight-line velocity in the 1990 paddock with twin-pulse traction off slow hairpins.'
  },
  kaze: {
    engine: '497cc Square-V4 2-Stroke · High-Rev',
    power: '159 HP @ 12,800 RPM',
    weight: '128 KG DRY',
    crank: 'Counter-Rotating Twin Crank',
    summary: 'Ultra-agile side-to-side flickability built to win late-braking duels into tight chicanes.'
  },
  corsa: {
    engine: '498cc 90° V4 2-Stroke · Staggered',
    power: '165 HP @ 12,300 RPM',
    weight: '130 KG DRY',
    crank: 'Staggered Italian V4',
    summary: 'Long-legged European chassis stability with muscular expansion-chamber pull through fast sweepers.'
  }
};

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function statToPercent(val, min, max) {
  return Math.round(clamp(((val - min) / Math.max(1e-5, max - min)) * 36 + 58, 46, 98));
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function sizeCanvasForDpr(canvas, fallbackW = 640, fallbackH = 380) {
  if (!canvas) return { width: fallbackW, height: fallbackH, dpr: 1 };
  const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
  const cssW = Math.max(120, Math.round(canvas.clientWidth || Number(canvas.getAttribute('width')) || fallbackW));
  const cssH = Math.max(100, Math.round(canvas.clientHeight || Number(canvas.getAttribute('height')) || fallbackH));
  const targetW = Math.round(cssW * dpr);
  const targetH = Math.round(cssH * dpr);
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }
  return { width: cssW, height: cssH, dpr };
}

function computeGearAndRpmFromSpeed(speedMs, bike) {
  const maxSpeed = bike?.stats?.maxSpeed || 85.0;
  const speedScale = maxSpeed / 85.0;
  let gear = 1;
  for (let g = 1; g <= 6; g++) {
    gear = g;
    if (speedMs <= BASE_GEAR_MAX_SPEEDS[g] * speedScale * 0.96) {
      break;
    }
  }
  const gMax = BASE_GEAR_MAX_SPEEDS[gear] * speedScale;
  const gMin = gear > 1 ? BASE_GEAR_MAX_SPEEDS[gear - 1] * speedScale * 0.52 : 0;
  const ratio = clamp((speedMs - gMin) / Math.max(1, gMax - gMin), 0, 1.0);
  const rpm = Math.round(clamp(4000 + ratio * 9000, 4000, 13000));
  return { gear, rpm };
}

/**
 * Initializes all interactive website sections, canvases, audio engine rev sweep,
 * scroll reveals, cursor spotlight reveal, and hardware gamepad status sync.
 */
export function initWebsiteShowcase(options = {}) {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return {
      setActive() {},
      syncGamepadStatus() {},
      setShowroom() {},
      setSelectedBike() {},
      setSelectedTrack() {},
      updateMuteUi() {},
      dispose() {}
    };
  }

  let showroom = options.showroom || null;
  const audio = options.audio || null;
  const input = options.input || null;
  const onLaunchRace = typeof options.onLaunchRace === 'function' ? options.onLaunchRace : null;
  const onOpenPaddock = typeof options.onOpenPaddock === 'function' ? options.onOpenPaddock : null;
  const onSelectBike = typeof options.onSelectBike === 'function' ? options.onSelectBike : null;
  const onSelectTrack = typeof options.onSelectTrack === 'function' ? options.onSelectTrack : null;
  const onToggleMute = typeof options.onToggleMute === 'function' ? options.onToggleMute : null;

  const prefersReducedMotion =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;

  let showcaseActive = true;
  let disposed = false;
  let selectedBikeId = getBikeById(options.initialBikeId || BIKES[0].id).id;
  let selectedTrackId = TRACKS.some((t) => t.id === options.initialTrackId)
    ? options.initialTrackId
    : TRACKS[0].id;
  let leanPreview = false;
  let tuckPreview = false;

  const cleanupFns = [];
  const addListener = (target, event, handler, opts) => {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener(event, handler, opts);
    cleanupFns.push(() => target.removeEventListener(event, handler, opts));
  };

  // =========================================================================
  // 1. HERO CURSOR SPOTLIGHT / FLASHLIGHT REVEAL
  // =========================================================================
  const heroSection = document.getElementById('hero-section');
  let spotX = 64;
  let spotY = 52;
  let targetSpotX = 64;
  let targetSpotY = 52;
  let pointerActiveInHero = false;
  let pointerIdleAt = 0;

  function applySpotlightCss() {
    if (!heroSection) return;
    heroSection.style.setProperty('--spot-x', `${spotX.toFixed(2)}%`);
    heroSection.style.setProperty('--spot-y', `${spotY.toFixed(2)}%`);
    heroSection.style.setProperty('--spot-active', pointerActiveInHero ? '1' : '0.82');
  }

  if (heroSection) {
    applySpotlightCss();
    addListener(heroSection, 'pointermove', (e) => {
      const rect = heroSection.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      pointerActiveInHero = true;
      pointerIdleAt = performance.now();
      targetSpotX = clamp(((e.clientX - rect.left) / rect.width) * 100, 4, 96);
      targetSpotY = clamp(((e.clientY - rect.top) / rect.height) * 100, 6, 94);
      if (prefersReducedMotion) {
        spotX = targetSpotX;
        spotY = targetSpotY;
        applySpotlightCss();
      }
    }, { passive: true });

    addListener(heroSection, 'pointerleave', () => {
      pointerActiveInHero = false;
      pointerIdleAt = performance.now();
    });
  }

  // =========================================================================
  // 2. SCROLL REVEAL & STICKY NAVBAR ACTIVE HIGHLIGHT
  // =========================================================================
  const navbar = document.getElementById('site-navbar');
  const navLinks = Array.from(document.querySelectorAll('#site-navbar .site-nav-link, .site-nav-link'));
  const revealBlocks = Array.from(document.querySelectorAll('.reveal-block'));
  const sectionIds = ['hero-section', 'showroom-section', 'circuits-section', 'engineering-section', 'controls-section'];

  function revealVisibleOrPassedBlocks() {
    const vh = window.innerHeight || 800;
    for (const el of revealBlocks) {
      if (el.classList.contains('is-visible')) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (rect.top < vh * 0.96) {
        el.classList.add('is-visible');
        el.setAttribute('data-revealed', 'true');
      }
    }
  }

  function updateNavbarScrollState() {
    if (navbar) {
      navbar.classList.toggle('scrolled', window.scrollY > 24);
    }
    revealVisibleOrPassedBlocks();
  }
  updateNavbarScrollState();
  addListener(window, 'scroll', updateNavbarScrollState, { passive: true });

  function setActiveNavSection(secId) {
    navLinks.forEach((link) => {
      const href = link.getAttribute('href') || '';
      link.classList.toggle('active', href === `#${secId}`);
    });
  }

  // Smooth anchor scroll for nav & explore links
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    const href = anchor.getAttribute('href') || '';
    const targetId = href.slice(1);
    if (!sectionIds.includes(targetId)) return;
    addListener(anchor, 'click', (e) => {
      const targetEl = document.getElementById(targetId);
      if (!targetEl) return;
      e.preventDefault();
      targetEl.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' });
      setActiveNavSection(targetId);
    });
  });

  if (typeof IntersectionObserver === 'function') {
    const revealObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            entry.target.setAttribute('data-revealed', 'true');
            revealObserver.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.1, rootMargin: '0px 0px -32px 0px' }
    );
    revealBlocks.forEach((el) => revealObserver.observe(el));
    cleanupFns.push(() => revealObserver.disconnect());

    const visibilityMap = new Map();
    const navObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          visibilityMap.set(entry.target.id, entry.isIntersecting ? entry.intersectionRatio : 0);
        }
        let bestId = null;
        let bestRatio = 0;
        for (const id of sectionIds) {
          const ratio = visibilityMap.get(id) || 0;
          if (ratio > bestRatio) {
            bestRatio = ratio;
            bestId = id;
          }
        }
        if (bestId) {
          setActiveNavSection(bestId);
        }
      },
      { threshold: [0.15, 0.35, 0.6], rootMargin: '-12% 0px -42% 0px' }
    );
    sectionIds.forEach((id) => {
      const el = document.getElementById(id);
      if (el) navObserver.observe(el);
    });
    cleanupFns.push(() => navObserver.disconnect());
  } else {
    revealBlocks.forEach((el) => el.classList.add('is-visible'));
    setActiveNavSection('hero-section');
  }

  // Top-level CTA & Mute bindings
  function updateMuteUi(isMuted) {
    const btn = document.getElementById('btn-site-mute');
    if (!btn) return;
    btn.textContent = isMuted ? 'AUDIO: MUTED [M]' : 'AUDIO: ON [M]';
    btn.classList.toggle('muted', Boolean(isMuted));
    btn.setAttribute('aria-pressed', isMuted ? 'true' : 'false');
  }

  const handleOpenPaddock = () => {
    stopEngineRev();
    if (onOpenPaddock) onOpenPaddock();
  };

  const handleQuickRace = () => {
    stopEngineRev();
    if (onLaunchRace) {
      onLaunchRace({ mode: 'gp', trackId: 'sakura', p1BikeId: selectedBikeId });
    }
  };

  addListener(document.getElementById('btn-nav-paddock'), 'click', handleOpenPaddock);
  addListener(document.getElementById('btn-hero-paddock'), 'click', handleOpenPaddock);
  addListener(document.getElementById('btn-controls-paddock'), 'click', handleOpenPaddock);

  addListener(document.getElementById('btn-nav-quickplay'), 'click', handleQuickRace);
  addListener(document.getElementById('btn-hero-quickplay'), 'click', handleQuickRace);
  addListener(document.getElementById('btn-footer-quickplay'), 'click', handleQuickRace);

  addListener(document.getElementById('btn-site-mute'), 'click', () => {
    if (onToggleMute) {
      onToggleMute();
    } else if (audio && typeof audio.toggleMute === 'function') {
      const m = audio.toggleMute();
      updateMuteUi(m);
    }
  });

  if (audio && typeof audio.isMuted === 'function') {
    updateMuteUi(audio.isMuted());
  }

  // =========================================================================
  // 3. INTERACTIVE 3D SHOWROOM CONTROLS & 2.2s V4 ENGINE REV SWEEP
  // =========================================================================
  function updateShowroomSpecs(bikeId) {
    const bike = getBikeById(bikeId);
    const meta = BIKE_SHOWROOM_META[bike.id] || BIKE_SHOWROOM_META.akagi;

    setText('showroom-bike-name', bike.name.toUpperCase());
    setText('showroom-bike-team', bike.team.toUpperCase());
    setText('showroom-bike-number', `#${bike.number}`);
    setText('showroom-bike-engine', meta.engine);
    setText('showroom-bike-topspeed', `${Math.round(bike.stats.maxSpeed * 3.6)} KM/H`);
    setText('showroom-bike-power', meta.power);
    setText('showroom-bike-weight', meta.weight);
    setText('showroom-bike-summary', meta.summary);
    setText(
      'showroom-timbre-tag',
      `${meta.crank} · BASE ${bike.timbre.baseFreq} HZ · RESONATOR ${bike.timbre.filterFreq} HZ`
    );

    const speedPct = statToPercent(bike.stats.maxSpeed, 79, 89);
    const accelPct = statToPercent(bike.stats.accel, 0.94, 1.10);
    const leanPct = statToPercent(bike.stats.leanRate, 0.92, 1.13);
    const brakePct = statToPercent(bike.stats.braking, 0.94, 1.11);
    const gripPct = statToPercent(bike.stats.grip, 0.94, 1.07);

    const setBar = (id, pct) => {
      const el = document.getElementById(id);
      if (el) el.style.width = `${pct}%`;
    };
    setBar('showroom-stat-speed', speedPct);
    setBar('showroom-stat-accel', accelPct);
    setBar('showroom-stat-lean', leanPct);
    setBar('showroom-stat-braking', brakePct);
    setBar('showroom-stat-grip', gripPct);

    const tabsContainer = document.getElementById('showroom-bike-tabs');
    if (tabsContainer) {
      tabsContainer.querySelectorAll('[data-bike-id]').forEach((btn) => {
        const isSel = btn.getAttribute('data-bike-id') === bike.id;
        btn.classList.toggle('active', isSel);
        btn.setAttribute('aria-selected', isSel ? 'true' : 'false');
      });
    }
  }

  function setSelectedBike(bikeId) {
    const bike = getBikeById(bikeId);
    selectedBikeId = bike.id;
    updateShowroomSpecs(bike.id);
    if (showroom && typeof showroom.setBike === 'function') {
      showroom.setBike(bike.id);
    }
    // Re-render physics curve to reflect the selected bike's gearbox & speed curve
    renderPhysicsCanvas();
  }

  const bikeTabsEl = document.getElementById('showroom-bike-tabs');
  if (bikeTabsEl) {
    addListener(bikeTabsEl, 'click', (e) => {
      const btn = e.target.closest('[data-bike-id]');
      if (!btn) return;
      const bikeId = btn.getAttribute('data-bike-id');
      if (bikeId) setSelectedBike(bikeId);
    });
  }

  const leanBtn = document.getElementById('btn-showroom-lean');
  addListener(leanBtn, 'click', () => {
    leanPreview = !leanPreview;
    if (leanBtn) {
      leanBtn.classList.toggle('active', leanPreview);
      leanBtn.setAttribute('aria-pressed', leanPreview ? 'true' : 'false');
    }
    if (showroom && typeof showroom.setLeanPreview === 'function') {
      showroom.setLeanPreview(leanPreview);
    }
  });

  const tuckBtn = document.getElementById('btn-showroom-tuck');
  addListener(tuckBtn, 'click', () => {
    tuckPreview = !tuckPreview;
    if (tuckBtn) {
      tuckBtn.classList.toggle('active', tuckPreview);
      tuckBtn.setAttribute('aria-pressed', tuckPreview ? 'true' : 'false');
    }
    if (showroom && typeof showroom.setTuckPreview === 'function') {
      showroom.setTuckPreview(tuckPreview);
    }
  });

  addListener(document.getElementById('btn-showroom-reset-cam'), 'click', () => {
    if (showroom && typeof showroom.resetView === 'function') {
      showroom.resetView();
    }
  });

  addListener(document.getElementById('btn-showroom-race'), 'click', () => {
    stopEngineRev();
    if (onSelectBike) onSelectBike(selectedBikeId);
    if (onOpenPaddock) onOpenPaddock({ bikeId: selectedBikeId });
  });

  // Live 2.2-second 2-stroke V4 engine rev sweep (4,200 -> 12,600 RPM -> overrun decel crackle)
  const revBtn = document.getElementById('btn-showroom-rev');
  const revDefaultText = revBtn ? revBtn.textContent : 'REV V4 ENGINE';
  const revState = {
    active: false,
    startTimeMs: 0,
    durationSec: 2.2
  };
  const revRider = {
    id: 'showroom-rev',
    name: 'Showroom V4',
    isAI: false,
    playerIndex: 0,
    bike: getBikeById(selectedBikeId),
    gear: 1,
    rpm: 4200,
    throttle: 0,
    speed: 0,
    lean: 0,
    rearSlip: 0,
    onKerb: false,
    offTrack: false,
    tuck: false
  };

  function stopEngineRev() {
    if (!revState.active) return;
    revState.active = false;
    if (revBtn) {
      revBtn.classList.remove('revving');
      revBtn.textContent = revDefaultText;
      revBtn.style.removeProperty('--rev-pct');
    }
    if (audio && typeof audio.silence === 'function') {
      audio.silence();
    }
  }

  function stepEngineRev(nowMs) {
    if (!revState.active) return;
    const elapsedSec = (nowMs - revState.startTimeMs) / 1000;
    if (elapsedSec >= revState.durationSec) {
      stopEngineRev();
      return;
    }

    const bike = getBikeById(selectedBikeId);
    revRider.bike = bike;

    let rpm = 4200;
    let throttle = 0;

    if (elapsedSec < 0.96) {
      // Aggressive WOT sweep from 4,200 up through the 8,500–12,500 RPM 2-stroke powerband
      const p = elapsedSec / 0.96;
      const eased = p < 0.38 ? 0.55 * (p / 0.38) : 0.55 + 0.45 * Math.pow((p - 0.38) / 0.62, 0.72);
      rpm = 4200 + (12600 - 4200) * eased;
      throttle = elapsedSec < 0.08 ? 0.55 + (elapsedSec / 0.08) * 0.45 : 1.0;
    } else if (elapsedSec < 1.18) {
      // Brief peak rev-limiter blip around 12,450 - 12,600 RPM
      const phase = (elapsedSec - 0.96) / 0.22;
      rpm = 12600 - Math.abs(Math.sin(phase * Math.PI * 2.2)) * 420;
      throttle = phase < 0.55 ? 0.85 : 0.15;
    } else {
      // Closed throttle overrun deceleration (12,600 -> 4,200 RPM) triggering 2-stroke exhaust pops!
      const p = (elapsedSec - 1.18) / (revState.durationSec - 1.18);
      const decay = 1 - Math.pow(1 - clamp(p, 0, 1), 1.65);
      rpm = 12600 - (12600 - 4200) * decay;
      throttle = 0.0;
    }

    revRider.rpm = rpm;
    revRider.throttle = throttle;

    if (audio && typeof audio.update === 'function') {
      audio.update([revRider], { splitMode: 'single' });
    }

    if (revBtn) {
      const pct = clamp(((rpm - 4000) / 9000) * 100, 0, 100);
      revBtn.style.setProperty('--rev-pct', `${pct.toFixed(1)}%`);
      revBtn.textContent = `${Math.round(rpm).toLocaleString()} RPM`;
    }
  }

  addListener(revBtn, 'click', () => {
    if (audio && typeof audio.init === 'function') {
      audio.init();
    }
    revState.active = true;
    revState.startTimeMs = performance.now();
    if (revBtn) {
      revBtn.classList.add('revving');
    }
    stepEngineRev(revState.startTimeMs);
  });

  updateShowroomSpecs(selectedBikeId);

  // =========================================================================
  // 4. INTERACTIVE CIRCUIT EXPLORER (#site-circuit-canvas)
  // =========================================================================
  const circuitCanvas = document.getElementById('site-circuit-canvas');
  const trackCache = new Map();

  function getCachedTrack(trackId) {
    if (!trackCache.has(trackId)) {
      trackCache.set(trackId, createTrack(trackId));
    }
    return trackCache.get(trackId);
  }

  function renderCircuitCanvas() {
    if (!circuitCanvas) return;
    const ctx = typeof circuitCanvas.getContext === 'function' ? circuitCanvas.getContext('2d') : null;
    if (!ctx) return;

    const { width: w, height: h, dpr } = sizeCanvasForDpr(circuitCanvas, 680, 420);
    const track = getCachedTrack(selectedTrackId);
    const samples = track.samples || [];
    if (samples.length < 4) return;

    ctx.save();
    ctx.scale(dpr, dpr);

    // Blueprint dark background
    ctx.fillStyle = '#090d14';
    ctx.fillRect(0, 0, w, h);

    // Technical grid
    ctx.strokeStyle = 'rgba(72, 118, 178, 0.10)';
    ctx.lineWidth = 1;
    const gridStep = 28;
    for (let gx = gridStep; gx < w; gx += gridStep) {
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, h);
      ctx.stroke();
    }
    for (let gy = gridStep; gy < h; gy += gridStep) {
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(w, gy);
      ctx.stroke();
    }

    const mapAreaH = h * 0.67;
    const elevTop = h * 0.72;
    const elevH = h * 0.22;

    // Bounding box in XZ + elevation min/max
    let minX = Infinity, maxX = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let maxCurv = 0;

    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      if (s.x < minX) minX = s.x;
      if (s.x > maxX) maxX = s.x;
      if (s.z < minZ) minZ = s.z;
      if (s.z > maxZ) maxZ = s.z;
      if (s.y < minY) minY = s.y;
      if (s.y > maxY) maxY = s.y;
      const ak = Math.abs(s.curvature || 0);
      if (ak > maxCurv) maxCurv = ak;
    }

    const padX = 36;
    const padY = 30;
    const spanX = Math.max(10, maxX - minX);
    const spanZ = Math.max(10, maxZ - minZ);
    const scale = Math.min((w - padX * 2) / spanX, (mapAreaH - padY * 2) / spanZ);
    const offsetX = (w - spanX * scale) * 0.5 - minX * scale;
    const offsetY = (mapAreaH - spanZ * scale) * 0.5 - minZ * scale + 4;

    const toPx = (x, z) => ({
      px: offsetX + x * scale,
      py: offsetY + z * scale
    });

    // Outer track corridor halo
    ctx.beginPath();
    for (let i = 0; i < samples.length; i++) {
      const p = toPx(samples[i].x, samples[i].z);
      if (i === 0) ctx.moveTo(p.px, p.py);
      else ctx.lineTo(p.px, p.py);
    }
    ctx.closePath();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 15;
    ctx.lineJoin = 'round';
    ctx.stroke();

    ctx.strokeStyle = '#1d2431';
    ctx.lineWidth = 10;
    ctx.stroke();

    // Curvature-coded racing line (Cyan straight -> Amber sweeper -> Crimson braking apex)
    const step = 3;
    ctx.lineCap = 'round';
    for (let i = 0; i < samples.length; i += step) {
      const a = samples[i];
      const b = samples[(i + step) % samples.length];
      const pa = toPx(a.x, a.z);
      const pb = toPx(b.x, b.z);
      const ak = Math.abs(a.curvature || 0);

      let col = '#2dd4ff';
      if (ak >= 0.011) col = '#ff2c24';
      else if (ak >= 0.0042) col = '#f5c542';

      ctx.beginPath();
      ctx.moveTo(pa.px, pa.py);
      ctx.lineTo(pb.px, pb.py);
      ctx.strokeStyle = col;
      ctx.lineWidth = 3.2;
      ctx.stroke();
    }

    // Start/finish checkered bar + direction chevron
    const s0 = samples[0];
    const p0 = toPx(s0.x, s0.z);
    const nx = s0.nx || 0;
    const nz = s0.nz || 1;
    const tx = s0.tx || 1;
    const tz = s0.tz || 0;

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(p0.px - nx * 10, p0.py - nz * 10);
    ctx.lineTo(p0.px + nx * 10, p0.py + nz * 10);
    ctx.stroke();

    // Direction arrow slightly ahead of s=0
    const sAhead = samples[Math.min(samples.length - 1, 18)];
    const pArrow = toPx(sAhead.x, sAhead.z);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(pArrow.px + tx * 8, pArrow.py + tz * 8);
    ctx.lineTo(pArrow.px - tx * 4 + nx * 5, pArrow.py - tz * 4 + nz * 5);
    ctx.lineTo(pArrow.px - tx * 4 - nx * 5, pArrow.py - tz * 4 - nz * 5);
    ctx.closePath();
    ctx.fill();

    ctx.font = 'bold 10px monospace';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.fillText('S/F', p0.px + 12, p0.py - 8);

    // Sector split pins (S2, S3)
    for (const [label, frac] of [['SECTOR 2', 0.34], ['SECTOR 3', 0.67]]) {
      const idx = Math.floor(samples.length * frac);
      const sec = samples[idx];
      if (!sec) continue;
      const ps = toPx(sec.x, sec.z);
      ctx.fillStyle = '#f5c542';
      ctx.beginPath();
      ctx.arc(ps.px, ps.py, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(232, 240, 252, 0.8)';
      ctx.font = 'bold 9px monospace';
      ctx.fillText(label, ps.px + 7, ps.py + 3);
    }

    // Legend top-left
    ctx.font = 'bold 10px monospace';
    const legendItems = [
      ['STRAIGHT / WOT', '#2dd4ff', 14],
      ['HIGH-SPEED APEX', '#f5c542', 130],
      ['HEAVY BRAKING', '#ff2c24', 252]
    ];
    for (const [label, color, lx] of legendItems) {
      ctx.fillStyle = color;
      ctx.fillRect(lx, 12, 10, 4);
      ctx.fillStyle = 'rgba(220, 232, 248, 0.82)';
      ctx.fillText(label, lx + 14, 17);
    }

    // Bottom Elevation Profile Graph
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(16, elevTop - 10);
    ctx.lineTo(w - 16, elevTop - 10);
    ctx.stroke();

    ctx.fillStyle = 'rgba(205, 220, 242, 0.78)';
    ctx.font = 'bold 10px monospace';
    ctx.fillText(`ELEVATION PROFILE  ·  MIN ${minY.toFixed(1)}M / MAX ${maxY.toFixed(1)}M`, 16, elevTop + 2);

    const elevSpan = Math.max(2.0, maxY - minY);
    const gx0 = 20;
    const gxW = w - 40;
    const gyBase = elevTop + elevH + 6;
    const gyTop = elevTop + 14;

    const grad = ctx.createLinearGradient(0, gyTop, 0, gyBase);
    grad.addColorStop(0, 'rgba(245, 197, 66, 0.36)');
    grad.addColorStop(1, 'rgba(45, 212, 255, 0.04)');

    ctx.beginPath();
    ctx.moveTo(gx0, gyBase);
    for (let i = 0; i < samples.length; i += 4) {
      const s = samples[i];
      const rx = gx0 + (i / (samples.length - 1)) * gxW;
      const ry = gyBase - ((s.y - minY) / elevSpan) * (gyBase - gyTop);
      ctx.lineTo(rx, ry);
    }
    ctx.lineTo(gx0 + gxW, gyBase);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    for (let i = 0; i < samples.length; i += 4) {
      const s = samples[i];
      const rx = gx0 + (i / (samples.length - 1)) * gxW;
      const ry = gyBase - ((s.y - minY) / elevSpan) * (gyBase - gyTop);
      if (i === 0) ctx.moveTo(rx, ry);
      else ctx.lineTo(rx, ry);
    }
    ctx.strokeStyle = '#f5c542';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.restore();
  }

  function setSelectedTrack(trackId) {
    const meta = TRACKS.find((t) => t.id === trackId) || TRACKS[0];
    selectedTrackId = meta.id;
    const track = getCachedTrack(meta.id);

    let minY = Infinity;
    let maxY = -Infinity;
    for (const s of track.samples || []) {
      if (s.y < minY) minY = s.y;
      if (s.y > maxY) maxY = s.y;
    }
    const deltaElev = Number.isFinite(maxY - minY) ? maxY - minY : 0;

    setText('circuit-name', meta.name.toUpperCase());
    setText('circuit-country', (meta.country || 'GP').toUpperCase());
    setText('circuit-length', `${(track.totalLength / 1000).toFixed(2)} KM`);
    setText('circuit-elevation', `${deltaElev.toFixed(1)} M CLIMB`);
    setText('circuit-desc', meta.description);

    const tabsEl = document.getElementById('site-circuit-tabs');
    if (tabsEl) {
      tabsEl.querySelectorAll('[data-track-id]').forEach((btn) => {
        const isSel = btn.getAttribute('data-track-id') === meta.id;
        btn.classList.toggle('active', isSel);
        btn.setAttribute('aria-selected', isSel ? 'true' : 'false');
      });
    }

    renderCircuitCanvas();
  }

  const circuitTabsEl = document.getElementById('site-circuit-tabs');
  if (circuitTabsEl) {
    addListener(circuitTabsEl, 'click', (e) => {
      const btn = e.target.closest('[data-track-id]');
      if (!btn) return;
      const trackId = btn.getAttribute('data-track-id');
      if (trackId) setSelectedTrack(trackId);
    });
  }

  addListener(document.getElementById('btn-circuit-race'), 'click', () => {
    stopEngineRev();
    if (onSelectTrack) onSelectTrack(selectedTrackId);
    if (onOpenPaddock) onOpenPaddock({ trackId: selectedTrackId });
  });

  setSelectedTrack(selectedTrackId);

  // =========================================================================
  // 5. INTERACTIVE 500cc ENGINEERING VISUALIZER (#site-physics-canvas)
  // =========================================================================
  const physicsCanvas = document.getElementById('site-physics-canvas');
  const speedSlider = document.getElementById('sim-speed-slider');
  const radiusSlider = document.getElementById('sim-radius-slider');
  const leanSlider = document.getElementById('sim-lean-slider');

  const simState = {
    speedKmh: speedSlider ? Number(speedSlider.value) || 168 : 168,
    radiusM: radiusSlider ? Number(radiusSlider.value) || 76 : 76
  };

  function computePhysicsState() {
    const bike = getBikeById(selectedBikeId);
    const speedMs = simState.speedKmh / 3.6;
    const latG = (speedMs * speedMs) / (GRAVITY * Math.max(10, simState.radiusM));
    const rawLeanRad = Math.atan(latG);
    const rawLeanDeg = (rawLeanRad * 180) / Math.PI;
    const clampedLeanRad = Math.min(rawLeanRad, MAX_LEAN_RAD);
    const clampedLeanDeg = (clampedLeanRad * 180) / Math.PI;
    const { gear, rpm } = computeGearAndRpmFromSpeed(speedMs, bike);
    const pbMult = computePowerbandMultiplier(rpm);
    const overLimit = rawLeanRad > MAX_LEAN_RAD;

    return {
      bike,
      speedMs,
      latG,
      rawLeanRad,
      rawLeanDeg,
      clampedLeanRad,
      clampedLeanDeg,
      gear,
      rpm,
      pbMult,
      overLimit
    };
  }

  function syncEngineeringReadouts(st) {
    setText('sim-speed-val', `${Math.round(simState.speedKmh)} KM/H`);
    setText('sim-radius-val', `${Math.round(simState.radiusM)} M`);
    setText('sim-lean-val', `${st.clampedLeanDeg.toFixed(1)}°`);
    setText('sim-gforce-val', `${st.latG.toFixed(2)} G`);
    setText('sim-rpm-val', `${st.rpm.toLocaleString()} RPM (G${st.gear})`);
    setText('sim-powerband-val', `${st.pbMult.toFixed(2)}× TORQUE`);
    setText('sim-status-tag', st.overLimit ? '55° LIMIT EXCEEDED · HIGHSIDE RISK' : 'APEX GRIP OPTIMAL');
  }

  function renderPhysicsCanvas() {
    const st = computePhysicsState();
    syncEngineeringReadouts(st);
    if (!physicsCanvas) return;

    const ctx = typeof physicsCanvas.getContext === 'function' ? physicsCanvas.getContext('2d') : null;
    if (!ctx) return;

    const { width: w, height: h, dpr } = sizeCanvasForDpr(physicsCanvas, 740, 340);
    ctx.save();
    ctx.scale(dpr, dpr);

    // Dark telemetry backdrop
    ctx.fillStyle = '#090d14';
    ctx.fillRect(0, 0, w, h);

    const isNarrow = w < 520;
    const leftW = isNarrow ? w : w * 0.54;
    const rightX = isNarrow ? 0 : leftW;
    const rightW = isNarrow ? w : w - leftW;
    const topH = isNarrow ? h * 0.52 : h;
    const botY = isNarrow ? topH : 0;
    const rightH = isNarrow ? h - topH : h;

    // Divider line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (isNarrow) {
      ctx.moveTo(16, topH);
      ctx.lineTo(w - 16, topH);
    } else {
      ctx.moveTo(leftW, 16);
      ctx.lineTo(leftW, h - 16);
    }
    ctx.stroke();

    // -----------------------------------------------------------------------
    // PANEL A: 2-STROKE EXPANSION CHAMBER POWERBAND CURVE (4,000 - 13,000 RPM)
    // -----------------------------------------------------------------------
    const padL = 44;
    const padR = 20;
    const padT = 38;
    const padB = 38;
    const plotW = Math.max(80, leftW - padL - padR);
    const plotH = Math.max(70, topH - padT - padB);

    const rpmToX = (rpm) => padL + ((rpm - 4000) / 9000) * plotW;
    const multToY = (m) => padT + (1 - clamp((m - 0.5) / 1.05, 0, 1)) * plotH;

    // Powerband resonance zone highlight (8,500 - 12,500 RPM)
    const pbX0 = rpmToX(8500);
    const pbX1 = rpmToX(12500);
    ctx.fillStyle = 'rgba(255, 58, 36, 0.13)';
    ctx.fillRect(pbX0, padT, pbX1 - pbX0, plotH);
    ctx.strokeStyle = 'rgba(255, 72, 46, 0.35)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(pbX0, padT);
    ctx.lineTo(pbX0, padT + plotH);
    ctx.moveTo(pbX1, padT);
    ctx.lineTo(pbX1, padT + plotH);
    ctx.stroke();
    ctx.setLineDash([]);

    // Axes & RPM ticks
    ctx.strokeStyle = 'rgba(220, 232, 248, 0.22)';
    ctx.beginPath();
    ctx.moveTo(padL, padT);
    ctx.lineTo(padL, padT + plotH);
    ctx.lineTo(padL + plotW, padT + plotH);
    ctx.stroke();

    ctx.font = 'bold 10px monospace';
    ctx.fillStyle = 'rgba(220, 232, 248, 0.78)';
    ctx.fillText('2-STROKE POWERBAND CURVE (4k–13k RPM)', padL, 20);

    ctx.fillStyle = 'rgba(255, 130, 108, 0.9)';
    ctx.fillText('RESONANCE 8.5k–12.5k', pbX0 + 6, padT + 14);

    for (const tickRpm of [4000, 6000, 8500, 10500, 12500]) {
      const tx = rpmToX(tickRpm);
      ctx.fillStyle = 'rgba(180, 198, 224, 0.72)';
      ctx.textAlign = 'center';
      ctx.fillText(`${(tickRpm / 1000).toFixed(tickRpm % 1000 === 0 ? 0 : 1)}k`, tx, padT + plotH + 15);
    }

    ctx.textAlign = 'right';
    for (const tickM of [0.6, 1.0, 1.4]) {
      const ty = multToY(tickM);
      ctx.fillStyle = 'rgba(180, 198, 224, 0.65)';
      ctx.fillText(`${tickM.toFixed(1)}×`, padL - 6, ty + 3);
    }
    ctx.textAlign = 'left';

    // Area fill under powerband curve
    const curveGrad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
    curveGrad.addColorStop(0, 'rgba(255, 72, 40, 0.34)');
    curveGrad.addColorStop(1, 'rgba(45, 212, 255, 0.03)');

    ctx.beginPath();
    ctx.moveTo(rpmToX(4000), padT + plotH);
    for (let r = 4000; r <= 13000; r += 100) {
      ctx.lineTo(rpmToX(r), multToY(computePowerbandMultiplier(r)));
    }
    ctx.lineTo(rpmToX(13000), padT + plotH);
    ctx.closePath();
    ctx.fillStyle = curveGrad;
    ctx.fill();

    // Curve stroke
    ctx.beginPath();
    for (let r = 4000; r <= 13000; r += 100) {
      const cx = rpmToX(r);
      const cy = multToY(computePowerbandMultiplier(r));
      if (r === 4000) ctx.moveTo(cx, cy);
      else ctx.lineTo(cx, cy);
    }
    ctx.strokeStyle = '#f5c542';
    ctx.lineWidth = 2.8;
    ctx.stroke();

    // Operating RPM beacon
    const opX = rpmToX(st.rpm);
    const opY = multToY(st.pbMult);
    ctx.strokeStyle = 'rgba(45, 212, 255, 0.55)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(opX, padT);
    ctx.lineTo(opX, padT + plotH);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#2dd4ff';
    ctx.beginPath();
    ctx.arc(opX, opY, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px monospace';
    ctx.fillText(
      `G${st.gear} · ${st.rpm.toLocaleString()} RPM · ${st.pbMult.toFixed(2)}×`,
      padL,
      padT + plotH + 31
    );

    // -----------------------------------------------------------------------
    // PANEL B: CORNERING LEAN & CENTRIFUGAL EQUILIBRIUM DIAGRAM
    // -----------------------------------------------------------------------
    const cx = rightX + rightW * 0.52;
    const roadY = botY + rightH * 0.78;
    const maxLen = Math.min(rightW * 0.34, rightH * 0.44);

    ctx.fillStyle = 'rgba(220, 232, 248, 0.78)';
    ctx.font = 'bold 10px monospace';
    ctx.fillText('CORNERING EQUILIBRIUM  tan(θ) = v² / (g·r)', rightX + 18, botY + 20);

    // Road surface
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(rightX + 22, roadY);
    ctx.lineTo(rightX + rightW - 22, roadY);
    ctx.stroke();

    // Vertical 0-deg reference + 55-deg limit arc
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(cx, roadY);
    ctx.lineTo(cx, roadY - maxLen - 16);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = st.overLimit ? 'rgba(255, 44, 36, 0.72)' : 'rgba(245, 197, 66, 0.38)';
    ctx.beginPath();
    ctx.arc(cx, roadY, maxLen * 0.56, -Math.PI / 2, -Math.PI / 2 + MAX_LEAN_RAD);
    ctx.stroke();

    // Bike & rider lean vector from contact patch (tilting right +angle)
    const leanSin = Math.sin(st.clampedLeanRad);
    const leanCos = Math.cos(st.clampedLeanRad);
    const cgDist = maxLen * 0.62;
    const cgX = cx + leanSin * cgDist;
    const cgY = roadY - leanCos * cgDist;

    // Stylized front silhouette of leaning 500cc GP machine + rider
    ctx.save();
    ctx.translate(cx, roadY);
    ctx.rotate(st.clampedLeanRad);

    // Tire contact patch & slick
    ctx.fillStyle = '#1f2937';
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(-8, -32, 16, 32, 7) : ctx.rect(-8, -32, 16, 32);
    ctx.fill();
    ctx.stroke();

    // Fairing shell in selected bike livery primary color
    ctx.fillStyle = st.bike.colorPrimaryHex || '#d91424';
    ctx.beginPath();
    ctx.moveTo(-14, -26);
    ctx.lineTo(-18, -62);
    ctx.lineTo(0, -82);
    ctx.lineTo(18, -62);
    ctx.lineTo(14, -26);
    ctx.closePath();
    ctx.fill();

    // Bubble windscreen & rider helmet
    ctx.fillStyle = '#8ad4ff';
    ctx.beginPath();
    ctx.arc(0, -76, 10, Math.PI, 0);
    ctx.fill();

    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.arc(6, -94, 11, 0, Math.PI * 2);
    ctx.fill();

    // Extended inside knee slider
    ctx.strokeStyle = '#f5c542';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(10, -56);
    ctx.lineTo(24 + leanSin * 14, -34);
    ctx.stroke();
    ctx.restore();

    // Force vectors at CG: Gravity (down) & Centrifugal (right)
    const gArrowLen = 36;
    const cArrowLen = clamp(st.latG * 36, 6, 78);

    // Downward gravity vector
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cgX, cgY);
    ctx.lineTo(cgX, cgY + gArrowLen);
    ctx.stroke();

    // Outward centrifugal vector
    ctx.strokeStyle = st.overLimit ? '#ff2c24' : '#f5c542';
    ctx.beginPath();
    ctx.moveTo(cgX, cgY);
    ctx.lineTo(cgX + cArrowLen, cgY);
    ctx.stroke();

    // Readout footer on right panel
    ctx.fillStyle = st.overLimit ? '#ff574d' : '#34d399';
    ctx.font = 'bold 11px monospace';
    ctx.fillText(
      `LEAN ${st.clampedLeanDeg.toFixed(1)}°  ·  ${st.latG.toFixed(2)} G  ·  ${st.overLimit ? 'LIMIT EXCEEDED!' : 'GRIP OPTIMAL'}`,
      rightX + 18,
      botY + rightH - 12
    );

    ctx.restore();
  }

  addListener(speedSlider, 'input', () => {
    simState.speedKmh = Number(speedSlider.value) || 168;
    const st = computePhysicsState();
    if (leanSlider) leanSlider.value = String((Math.round(st.clampedLeanDeg * 2) / 2).toFixed(1));
    renderPhysicsCanvas();
  });

  addListener(radiusSlider, 'input', () => {
    simState.radiusM = Number(radiusSlider.value) || 76;
    const st = computePhysicsState();
    if (leanSlider) leanSlider.value = String((Math.round(st.clampedLeanDeg * 2) / 2).toFixed(1));
    renderPhysicsCanvas();
  });

  addListener(leanSlider, 'input', () => {
    const targetDeg = clamp(Number(leanSlider.value) || 30, 5, 55);
    const targetTan = Math.max(0.05, Math.tan((targetDeg * Math.PI) / 180));
    const speedMs = simState.speedKmh / 3.6;
    const derivedRadius = clamp(Math.round((speedMs * speedMs) / (GRAVITY * targetTan)), 25, 220);
    simState.radiusM = derivedRadius;
    if (radiusSlider) radiusSlider.value = String(derivedRadius);
    renderPhysicsCanvas();
  });

  renderPhysicsCanvas();

  // =========================================================================
  // 6. LIVE HARDWARE / GAMEPAD STATUS SYNC (#controls-section)
  // =========================================================================
  function syncGamepadStatus() {
    const status =
      input && typeof input.getGamepadStatus === 'function'
        ? input.getGamepadStatus()
        : { p1Connected: false, p2Connected: false, p1Name: '', p2Name: '' };

    const p1El = document.getElementById('site-pad1-status');
    const p2El = document.getElementById('site-pad2-status');

    if (p1El) {
      p1El.textContent = status.p1Connected
        ? `P1 GAMEPAD: ${status.p1Name.slice(0, 26)}`
        : 'P1 GAMEPAD: STANDBY (WASD + SPACE + C)';
      p1El.classList.toggle('connected', Boolean(status.p1Connected));
    }
    if (p2El) {
      p2El.textContent = status.p2Connected
        ? `P2 GAMEPAD: ${status.p2Name.slice(0, 26)}`
        : 'P2 GAMEPAD: STANDBY (ARROWS + ENTER + .)';
      p2El.classList.toggle('connected', Boolean(status.p2Connected));
    }
  }

  syncGamepadStatus();
  addListener(window, 'gamepadconnected', syncGamepadStatus);
  addListener(window, 'gamepaddisconnected', syncGamepadStatus);

  // =========================================================================
  // WINDOW RESIZE & LIGHTWEIGHT SHOWCASE ANIMATION LOOP
  // =========================================================================
  const handleResize = () => {
    renderCircuitCanvas();
    renderPhysicsCanvas();
  };
  addListener(window, 'resize', handleResize);
  if (typeof ResizeObserver === 'function') {
    const canvasObserver = new ResizeObserver(() => {
      if (showcaseActive && !disposed) {
        renderCircuitCanvas();
        renderPhysicsCanvas();
      }
    });
    if (circuitCanvas) canvasObserver.observe(circuitCanvas);
    if (physicsCanvas) canvasObserver.observe(physicsCanvas);
    cleanupFns.push(() => canvasObserver.disconnect());
  }

  let rafId = null;
  let lastTickMs = performance.now();
  let lastGamepadPollMs = 0;

  function frameTick(nowMs) {
    if (!showcaseActive || disposed) {
      rafId = null;
      return;
    }

    const dt = clamp((nowMs - lastTickMs) / 1000, 0.001, 0.1);
    lastTickMs = nowMs;

    // Hero idle figure-eight spotlight + smooth cursor interpolation
    if (heroSection && !prefersReducedMotion) {
      if (!pointerActiveInHero || nowMs - pointerIdleAt > 3200) {
        const t = nowMs * 0.001;
        targetSpotX = 50 + Math.sin(t * 0.65) * 18;
        targetSpotY = 45 + Math.sin(t * 1.30) * 11;
      }
      const blend = 1 - Math.exp(-18.0 * dt);
      spotX += (targetSpotX - spotX) * blend;
      spotY += (targetSpotY - spotY) * blend;
      applySpotlightCss();
    }

    if (revState.active) {
      stepEngineRev(nowMs);
    }

    if (nowMs - lastGamepadPollMs > 750) {
      lastGamepadPollMs = nowMs;
      syncGamepadStatus();
    }

    if (typeof requestAnimationFrame === 'function') {
      rafId = requestAnimationFrame(frameTick);
    }
  }

  function startShowcaseLoop() {
    if (disposed || !showcaseActive || rafId !== null) return;
    if (typeof requestAnimationFrame === 'function') {
      lastTickMs = performance.now();
      rafId = requestAnimationFrame(frameTick);
    }
  }

  function stopShowcaseLoop() {
    if (rafId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function setActive(flag) {
    showcaseActive = Boolean(flag);
    if (showcaseActive && !disposed) {
      renderCircuitCanvas();
      renderPhysicsCanvas();
      syncGamepadStatus();
      startShowcaseLoop();
    } else {
      stopEngineRev();
      stopShowcaseLoop();
    }
    return showcaseActive;
  }

  function setShowroom(nextShowroom) {
    showroom = nextShowroom || null;
    if (showroom && typeof showroom.setBike === 'function') {
      showroom.setBike(selectedBikeId);
      showroom.setLeanPreview(leanPreview);
      showroom.setTuckPreview(tuckPreview);
    }
  }

  startShowcaseLoop();

  function dispose() {
    if (disposed) return;
    disposed = true;
    showcaseActive = false;
    stopEngineRev();
    stopShowcaseLoop();
    for (const fn of cleanupFns) fn();
    cleanupFns.length = 0;
    trackCache.clear();
  }

  return {
    setActive,
    setShowroom,
    setSelectedBike,
    setSelectedTrack,
    syncGamepadStatus,
    updateMuteUi,
    renderCircuitCanvas,
    renderPhysicsCanvas,
    dispose
  };
}
