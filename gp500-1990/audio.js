/**
 * 1990 500cc Two-Stroke Acoustic Synthesizer (Web Audio API + AudioWorklet DSP)
 *
 * Features:
 * - Physical V4 2-stroke AudioWorklet synthesizer (`./audio-worklet.js`) with cycle-to-cycle
 *   scavenging irregularity, tuned expansion-chamber resonance, and deceleration overrun pops
 * - Synchronous custom PeriodicWave V4 fallback so audio works immediately & reliably everywhere
 * - Quickshifter upshift ignition cut & downshift exhaust blip
 * - Pre-generated seamless noise buffer for realistic tire slide screech, aerodynamic wind rush,
 *   gravel trap stone crunch, and rhythmic speed-synced kerb rumble
 * - Nearby rival / AI pass-by Doppler voice (`rivalVoice`) using 3D positions & speeds
 * - Master DynamicsCompressorNode + gentle vertical-split stereo imaging
 */

function clampVal(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Recorded race-engine loops (cut from a real recording): idle, on-throttle and off-throttle.
// Once loaded they replace the synthesized engine; the synth stays as the fallback.
const ENGINE_SAMPLE_URLS = {
  idle: './assets/audio/engine_idle.wav',
  on: './assets/audio/engine_on.wav',
  off: './assets/audio/engine_off.wav'
};
// Firing fundamental of each loop in Hz, measured from the recording
const ENGINE_SAMPLE_F0 = { idle: 35, on: 48, off: 49 };
// Engine pitch target: fundamental (Hz) = rpm * this; 4,200 rpm idles at the idle loop's own pitch
const ENGINE_SAMPLE_HZ_PER_RPM = 0.47 / 60;
const ENGINE_SAMPLE_MIX = 1.5;

function smoothstep(edge0, edge1, x) {
  const t = clampVal((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

const BIKE_CRANK_PATTERN = {
  akagi: 0,  // V4 Screamer
  shiden: 1, // V4 Big-Bang twin-pulse
  kaze: 2,   // Snappy high-rev V4
  corsa: 3   // Staggered Italian V4
};

function buildWaveshaperCurve(intensity = 18) {
  const len = 256;
  const curve = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const x = (i * 2) / len - 1;
    // Slight asymmetry injects 2nd harmonic warmth typical of 2-stroke pipes
    const biased = x + 0.12 * x * x;
    curve[i] = Math.tanh(biased * (1 + intensity * 0.06));
  }
  return curve;
}

/**
 * Generates a 2.0-second seamless pink/white hybrid noise AudioBuffer for wind, tires, gravel, and kerbs.
 */
function createNoiseBuffer(ctx) {
  const sampleRate = ctx.sampleRate || 44100;
  const length = sampleRate * 2;
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.96900 * b2 + white * 0.1538520;
    b3 = 0.86650 * b3 + white * 0.3104856;
    b4 = 0.55000 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.0168980;
    const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
    // Blend pink (warm body) and white (crisp grit)
    data[i] = clampVal(pink * 0.68 + white * 0.32, -1, 1);
  }
  return buffer;
}

/**
 * Builds custom V4 2-stroke PeriodicWave harmonics (strong crank fundamental, 2nd, 4th, and brassy expansion harmonics).
 */
function createTwoStrokePeriodicWave(ctx, patternIdx = 0) {
  const numHarmonics = 24;
  const real = new Float32Array(numHarmonics);
  const imag = new Float32Array(numHarmonics);

  for (let n = 1; n < numHarmonics; n++) {
    let amp = 1.0 / Math.pow(n, 0.82);
    // Emphasize V4 firing orders (2x, 4x, 6x, 8x) depending on crank layout
    if (patternIdx === 1) {
      // Big-Bang emphasizes 1x and 2x twin-pulse thump
      if (n === 1 || n === 2) amp *= 1.65;
      else if (n % 2 === 1) amp *= 0.85;
    } else {
      // Screamer emphasizes 4x and 8x howl
      if (n === 4 || n === 8) amp *= 1.55;
    }
    imag[n] = amp;
    real[n] = (n % 2 === 0 ? 0.18 : -0.08) * amp;
  }

  return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
}

export function createAudioEngine() {
  let ctx = null;
  let masterBus = null;
  let masterCompressor = null;
  let masterOut = null;
  let noiseBuffer = null;
  let muted = false;
  let ready = false;
  let workletReady = false;
  let workletLoading = false;
  let gestureListenersBound = false;

  let engineSamples = null; // { idle, on, off } AudioBuffers
  let samplesLoading = false;

  const periodicWaves = [];
  const voices = [];
  let rivalVoice = null;

  function resumeOnGesture() {
    if (ctx && ctx.state === 'suspended' && !muted) {
      ctx.resume().catch(() => {});
    }
  }

  function bindGestureResume() {
    if (gestureListenersBound || typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
      return;
    }
    gestureListenersBound = true;
    window.addEventListener('pointerdown', resumeOnGesture, { passive: true });
    window.addEventListener('keydown', resumeOnGesture, { passive: true });
  }

  function decodeBuffer(arrayBuffer) {
    return new Promise((resolve, reject) => {
      const p = ctx.decodeAudioData(arrayBuffer, resolve, reject);
      if (p && typeof p.then === 'function') p.then(resolve, reject);
    });
  }

  function attachSamplesToVoice(voice) {
    if (!ctx || !engineSamples || voice.sampleLayers) return;
    const now = ctx.currentTime;

    const sampleGain = ctx.createGain();
    sampleGain.gain.value = 0.0001;
    sampleGain.connect(voice.voiceBus);

    // A little low-end body (the recording is thin below 200 Hz), then a throttle-driven lowpass
    const body = ctx.createBiquadFilter();
    body.type = 'lowshelf';
    body.frequency.value = 200;
    body.gain.value = 5;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 5000;
    tone.Q.value = 0.6;
    tone.connect(body);
    body.connect(sampleGain);

    const layers = {};
    for (const key of ['idle', 'on', 'off']) {
      const src = ctx.createBufferSource();
      src.buffer = engineSamples[key];
      src.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = 0.0001;
      src.connect(gain);
      gain.connect(tone);
      // Random start offset so several bikes never phase-lock on the same loop
      src.start(now, Math.random() * src.buffer.duration);
      layers[key] = { src, gain };
    }
    voice.sampleLayers = layers;
    voice.sampleTone = tone;
    voice.sampleGain = sampleGain;

    sampleGain.gain.setTargetAtTime(ENGINE_SAMPLE_MIX, now, 0.05);
    voice.fallbackGain.gain.setTargetAtTime(0.0001, now, 0.05);
    voice.workletGain.gain.setTargetAtTime(0.0001, now, 0.05);
    if (voice.workletNode) {
      const node = voice.workletNode;
      voice.workletNode = null;
      setTimeout(() => node.disconnect(), 300);
    }
  }

  function loadEngineSamples() {
    if (!ctx || engineSamples || samplesLoading || typeof fetch !== 'function') return;
    samplesLoading = true;
    Promise.all(
      Object.entries(ENGINE_SAMPLE_URLS).map(([key, url]) =>
        fetch(url)
          .then((r) => {
            if (!r.ok) throw new Error(`${url} ${r.status}`);
            return r.arrayBuffer();
          })
          .then(decodeBuffer)
          .then((buf) => [key, buf])
      )
    )
      .then((entries) => {
        if (!ctx) return;
        engineSamples = Object.fromEntries(entries);
        for (const v of voices) attachSamplesToVoice(v);
        if (rivalVoice) attachSamplesToVoice(rivalVoice);
      })
      .catch((err) => {
        samplesLoading = false;
        console.warn('[audio] engine samples unavailable, using synthesized engine', err);
      });
  }

  function attachWorkletToVoice(voice) {
    if (!ctx || !workletReady || voice.workletNode || voice.sampleLayers) return;
    try {
      const node = new AudioWorkletNode(ctx, 'two-stroke-v4-processor', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [1]
      });
      node.connect(voice.workletGain);
      voice.workletNode = node;

      // Crossfade smoothly from fallback oscillators to physical AudioWorklet engine
      const now = ctx.currentTime;
      voice.workletGain.gain.setTargetAtTime(1.0, now, 0.04);
      voice.fallbackGain.gain.setTargetAtTime(0.0001, now, 0.04);
    } catch (_e) {
      // Keep fallback active if AudioWorkletNode instantiation fails
    }
  }

  function loadAudioWorklet() {
    if (!ctx || !ctx.audioWorklet || workletReady || workletLoading) return;
    workletLoading = true;
    try {
      ctx.audioWorklet
        .addModule('./audio-worklet.js')
        .then(() => {
          workletReady = true;
          workletLoading = false;
          for (const v of voices) attachWorkletToVoice(v);
          if (rivalVoice) attachWorkletToVoice(rivalVoice);
        })
        .catch(() => {
          workletLoading = false;
          workletReady = false;
        });
    } catch (_e) {
      workletLoading = false;
      workletReady = false;
    }
  }

  function ensureContext() {
    if (ready && ctx) {
      if (ctx.state === 'suspended' && !muted) {
        ctx.resume().catch(() => {});
      }
      return true;
    }

    const AudioCtx =
      typeof window !== 'undefined'
        ? window.AudioContext || window.webkitAudioContext
        : null;
    if (!AudioCtx) return false;

    try {
      ctx = new AudioCtx();

      masterBus = ctx.createGain();
      masterBus.gain.value = 1.0;

      masterCompressor = ctx.createDynamicsCompressor();
      masterCompressor.threshold.value = -14;
      masterCompressor.knee.value = 12;
      masterCompressor.ratio.value = 4.5;
      masterCompressor.attack.value = 0.004;
      masterCompressor.release.value = 0.14;

      masterOut = ctx.createGain();
      masterOut.gain.value = muted ? 0.0001 : 0.42;

      masterBus.connect(masterCompressor);
      masterCompressor.connect(masterOut);
      masterOut.connect(ctx.destination);

      noiseBuffer = createNoiseBuffer(ctx);
      for (let p = 0; p < 4; p++) {
        periodicWaves.push(createTwoStrokePeriodicWave(ctx, p));
      }

      voices.push(createRiderVoice(0, true), createRiderVoice(1, true));
      rivalVoice = createRiderVoice(2, false);

      ready = true;
      bindGestureResume();
      loadEngineSamples();
      loadAudioWorklet();
      return true;
    } catch (_e) {
      return false;
    }
  }

  function createRiderVoice(slotIdx, withRoadEffects = true) {
    const voiceBus = ctx.createGain();
    voiceBus.gain.value = 0.0001;

    const panner =
      typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;
    if (panner) {
      panner.pan.value = 0;
      voiceBus.connect(panner);
      panner.connect(masterBus);
    } else {
      voiceBus.connect(masterBus);
    }

    // Dual-path engine submix: AudioWorklet path + PeriodicWave fallback path
    const workletGain = ctx.createGain();
    workletGain.gain.value = 0.0001;
    workletGain.connect(voiceBus);

    const fallbackGain = ctx.createGain();
    fallbackGain.gain.value = 1.0;
    fallbackGain.connect(voiceBus);

    // Rich PeriodicWave V4 fallback oscillators (active immediately until worklet loads, or permanently if unavailable)
    const primaryOsc = ctx.createOscillator();
    primaryOsc.setPeriodicWave(periodicWaves[slotIdx % periodicWaves.length]);

    const crankSubOsc = ctx.createOscillator();
    crankSubOsc.type = 'sawtooth';

    const primaryMix = ctx.createGain();
    primaryMix.gain.value = 0.45;
    const subMix = ctx.createGain();
    subMix.gain.value = 0.20;

    const intakeFilter = ctx.createBiquadFilter();
    intakeFilter.type = 'lowpass';
    intakeFilter.frequency.value = 420;
    intakeFilter.Q.value = 1.6;

    const pipeFilter = ctx.createBiquadFilter();
    pipeFilter.type = 'bandpass';
    pipeFilter.frequency.value = 1300;
    pipeFilter.Q.value = 2.6;

    const shaper = ctx.createWaveShaper();
    shaper.curve = buildWaveshaperCurve(18);
    shaper.oversample = '2x';

    primaryOsc.connect(primaryMix);
    crankSubOsc.connect(subMix);

    primaryMix.connect(pipeFilter);
    primaryMix.connect(intakeFilter);
    subMix.connect(intakeFilter);

    pipeFilter.connect(shaper);
    intakeFilter.connect(shaper);
    shaper.connect(fallbackGain);

    const now = ctx.currentTime;
    primaryOsc.start(now);
    crankSubOsc.start(now);

    const voice = {
      slotIdx,
      withRoadEffects,
      voiceBus,
      panner,
      workletGain,
      fallbackGain,
      workletNode: null,
      sampleLayers: null,
      sampleTone: null,
      sampleGain: null,
      primaryOsc,
      crankSubOsc,
      pipeFilter,
      intakeFilter,
      lastGear: 1,
      lastPatternIdx: -1,
      shiftCutUntil: 0,
      blipUntil: 0,
      lastOverrunPopAt: 0,
      kerbOsc: null,
      kerbLfo: null,
      kerbGain: null,
      screechFilter1: null,
      screechFilter2: null,
      screechGain: null,
      windFilter: null,
      windGain: null,
      gravelFilter: null,
      gravelGain: null
    };

    if (withRoadEffects && noiseBuffer) {
      // 1. Speed-synced Kerb Rumble (pulsed low thump + filtered grit)
      const kerbOsc = ctx.createOscillator();
      kerbOsc.type = 'triangle';
      kerbOsc.frequency.value = 54;

      const kerbNoiseSrc = ctx.createBufferSource();
      kerbNoiseSrc.buffer = noiseBuffer;
      kerbNoiseSrc.loop = true;

      const kerbNoiseFilter = ctx.createBiquadFilter();
      kerbNoiseFilter.type = 'lowpass';
      kerbNoiseFilter.frequency.value = 340;

      const kerbPulseGain = ctx.createGain();
      kerbPulseGain.gain.value = 0.55;

      const kerbMasterGain = ctx.createGain();
      kerbMasterGain.gain.value = 0.0001;

      const kerbLfo = ctx.createOscillator();
      kerbLfo.type = 'sine';
      kerbLfo.frequency.value = 24;
      const kerbLfoDepth = ctx.createGain();
      kerbLfoDepth.gain.value = 0.45;

      kerbOsc.connect(kerbPulseGain);
      kerbNoiseSrc.connect(kerbNoiseFilter);
      kerbNoiseFilter.connect(kerbPulseGain);
      kerbLfo.connect(kerbLfoDepth);
      kerbLfoDepth.connect(kerbPulseGain.gain);

      kerbPulseGain.connect(kerbMasterGain);
      if (panner) kerbMasterGain.connect(panner);
      else kerbMasterGain.connect(masterBus);

      kerbOsc.start(now);
      kerbNoiseSrc.start(now, Math.random());
      kerbLfo.start(now);

      // 2. Tire Slide Screech (filtered noise buffer through dual rubber-squeal resonances)
      const screechSrc = ctx.createBufferSource();
      screechSrc.buffer = noiseBuffer;
      screechSrc.loop = true;

      const screechFilter1 = ctx.createBiquadFilter();
      screechFilter1.type = 'bandpass';
      screechFilter1.frequency.value = 1040 + slotIdx * 45;
      screechFilter1.Q.value = 5.5;

      const screechFilter2 = ctx.createBiquadFilter();
      screechFilter2.type = 'bandpass';
      screechFilter2.frequency.value = 2220 + slotIdx * 65;
      screechFilter2.Q.value = 7.2;

      const screechGain = ctx.createGain();
      screechGain.gain.value = 0.0001;

      screechSrc.connect(screechFilter1);
      screechSrc.connect(screechFilter2);
      screechFilter1.connect(screechGain);
      screechFilter2.connect(screechGain);
      if (panner) screechGain.connect(panner);
      else screechGain.connect(masterBus);
      screechSrc.start(now, Math.random());

      // 3. Aerodynamic Wind Rush (high-speed pink noise)
      const windSrc = ctx.createBufferSource();
      windSrc.buffer = noiseBuffer;
      windSrc.loop = true;

      const windFilter = ctx.createBiquadFilter();
      windFilter.type = 'lowpass';
      windFilter.frequency.value = 320;
      windFilter.Q.value = 0.7;

      const windGain = ctx.createGain();
      windGain.gain.value = 0.0001;

      windSrc.connect(windFilter);
      windFilter.connect(windGain);
      if (panner) windGain.connect(panner);
      else windGain.connect(masterBus);
      windSrc.start(now, Math.random());

      // 4. Gravel Trap Crunch (coarse stone scatter when offTrack)
      const gravelSrc = ctx.createBufferSource();
      gravelSrc.buffer = noiseBuffer;
      gravelSrc.loop = true;

      const gravelFilter = ctx.createBiquadFilter();
      gravelFilter.type = 'bandpass';
      gravelFilter.frequency.value = 1280;
      gravelFilter.Q.value = 1.35;

      const gravelGain = ctx.createGain();
      gravelGain.gain.value = 0.0001;

      gravelSrc.connect(gravelFilter);
      gravelFilter.connect(gravelGain);
      if (panner) gravelGain.connect(panner);
      else gravelGain.connect(masterBus);
      gravelSrc.start(now, Math.random());

      voice.kerbOsc = kerbOsc;
      voice.kerbLfo = kerbLfo;
      voice.kerbGain = kerbMasterGain;
      voice.screechFilter1 = screechFilter1;
      voice.screechFilter2 = screechFilter2;
      voice.screechGain = screechGain;
      voice.windFilter = windFilter;
      voice.windGain = windGain;
      voice.gravelFilter = gravelFilter;
      voice.gravelGain = gravelGain;
    }

    if (workletReady) {
      attachWorkletToVoice(voice);
    }

    return voice;
  }

  function triggerShiftTransient(voice, isUpshift) {
    if (!ready || !ctx || muted) return;
    const now = ctx.currentTime;
    if (isUpshift) {
      // Quickshifter ignition cut: 48ms dip + crisp exhaust bark
      voice.shiftCutUntil = now + 0.048;
    } else {
      // Downshift auto-blip flare + hollow overrun pop
      voice.blipUntil = now + 0.085;
    }

    // Subtle mechanical gearbox/exhaust transient
    try {
      const popSrc = ctx.createBufferSource();
      popSrc.buffer = noiseBuffer;
      const popFilter = ctx.createBiquadFilter();
      popFilter.type = 'bandpass';
      popFilter.frequency.setValueAtTime(isUpshift ? 320 : 520, now);
      popFilter.Q.value = 2.4;

      const popGain = ctx.createGain();
      popGain.gain.setValueAtTime(isUpshift ? 0.14 : 0.18, now);
      popGain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);

      popSrc.connect(popFilter);
      popFilter.connect(popGain);
      popGain.connect(voice.panner || masterBus);
      popSrc.start(now, Math.random());
      popSrc.stop(now + 0.06);
    } catch (_e) {
      // Ignore transient scheduling errors
    }
  }

  function triggerOverrunPop(voice, rpmNorm) {
    if (!ready || !ctx || muted || !noiseBuffer) return;
    try {
      const now = ctx.currentTime;
      const popSrc = ctx.createBufferSource();
      popSrc.buffer = noiseBuffer;
      const popFilter = ctx.createBiquadFilter();
      popFilter.type = 'bandpass';
      popFilter.frequency.setValueAtTime(360 + Math.random() * 260, now);
      popFilter.Q.value = 2.6;

      const popGain = ctx.createGain();
      popGain.gain.setValueAtTime(0.08 + rpmNorm * 0.09, now);
      popGain.gain.exponentialRampToValueAtTime(0.001, now + 0.042);

      popSrc.connect(popFilter);
      popFilter.connect(popGain);
      popGain.connect(voice.panner || masterBus);
      popSrc.start(now, Math.random());
      popSrc.stop(now + 0.048);
    } catch (_e) {
      // Ignore
    }
  }

  function updateVoice(voice, rider, weight = 0.5, panVal = 0, dopplerRatio = 1.0) {
    if (!ready || !ctx || !voice) return;
    const now = ctx.currentTime;

    if (voice.panner) {
      voice.panner.pan.setTargetAtTime(clampVal(panVal, -0.75, 0.75), now, 0.03);
    }

    if (!rider || weight <= 0.001) {
      voice.voiceBus.gain.setTargetAtTime(0.0001, now, 0.04);
      if (voice.kerbGain) voice.kerbGain.gain.setTargetAtTime(0.0001, now, 0.04);
      if (voice.screechGain) voice.screechGain.gain.setTargetAtTime(0.0001, now, 0.04);
      if (voice.windGain) voice.windGain.gain.setTargetAtTime(0.0001, now, 0.04);
      if (voice.gravelGain) voice.gravelGain.gain.setTargetAtTime(0.0001, now, 0.04);
      return;
    }

    const gear = rider.gear || 1;
    if (voice.withRoadEffects && gear !== voice.lastGear) {
      triggerShiftTransient(voice, gear > voice.lastGear);
      voice.lastGear = gear;
    } else {
      voice.lastGear = gear;
    }

    const inShiftCut = now < voice.shiftCutUntil;
    const inDownBlip = now < voice.blipUntil;

    const rawRpm = clampVal(rider.rpm ?? 4500, 3000, 13800);
    const rpm = clampVal(rawRpm + (inDownBlip ? 1450 : 0), 3000, 14200);
    const rpmNorm = (rpm - 3000) / 10500;
    const throttle = clampVal((rider.throttle ?? 0) + (inDownBlip ? 0.55 : 0), 0, 1);
    const speed = Math.max(0, rider.speed || 0);
    const bikeId = rider.bike?.id || 'akagi';
    const patternIdx = BIKE_CRANK_PATTERN[bikeId] ?? 0;

    const timbre = (rider.bike && rider.bike.timbre) || {
      baseFreq: 110,
      harmonicRatio: 2.0,
      filterFreq: 1350
    };

    // 1. Update physical AudioWorklet parameters if active
    if (voice.workletNode) {
      const p = voice.workletNode.parameters;
      p.get('rpm')?.setValueAtTime(rpm, now);
      p.get('throttle')?.setValueAtTime(throttle, now);
      p.get('speed')?.setValueAtTime(speed, now);
      p.get('shiftCut')?.setValueAtTime(inShiftCut ? 1.0 : 0.0, now);
      p.get('crankPattern')?.setValueAtTime(patternIdx, now);
      p.get('pipeFreqBase')?.setValueAtTime(timbre.baseFreq || 110, now);
      p.get('harmonicRatio')?.setValueAtTime(timbre.harmonicRatio || 2.0, now);
      p.get('filterResBase')?.setValueAtTime(timbre.filterFreq || 1350, now);
      p.get('dopplerRatio')?.setValueAtTime(dopplerRatio, now);
    }

    // 1b. Recorded engine loops: pitch follows rpm, idle/on/off layers blend by rpm and throttle
    if (voice.sampleLayers) {
      const f0 = rpm * ENGINE_SAMPLE_HZ_PER_RPM * ((timbre.baseFreq || 110) / 110) * dopplerRatio;
      const L = voice.sampleLayers;
      L.idle.src.playbackRate.setTargetAtTime(clampVal(f0 / ENGINE_SAMPLE_F0.idle, 0.5, 2.2), now, 0.03);
      L.on.src.playbackRate.setTargetAtTime(clampVal(f0 / ENGINE_SAMPLE_F0.on, 0.5, 2.8), now, 0.03);
      L.off.src.playbackRate.setTargetAtTime(clampVal(f0 / ENGINE_SAMPLE_F0.off, 0.5, 2.8), now, 0.03);

      const revved = smoothstep(4800, 7400, rpm);
      const load = smoothstep(0.05, 0.6, throttle);
      L.idle.gain.gain.setTargetAtTime(Math.cos(revved * Math.PI / 2), now, 0.06);
      L.on.gain.gain.setTargetAtTime(Math.sin(revved * Math.PI / 2) * Math.sin(load * Math.PI / 2), now, 0.05);
      L.off.gain.gain.setTargetAtTime(Math.sin(revved * Math.PI / 2) * Math.cos(load * Math.PI / 2) * 0.8, now, 0.08);

      const toneHz = clampVal((1600 + throttle * 4200 + rpmNorm * 3000) * dopplerRatio, 900, 9000);
      voice.sampleTone.frequency.setTargetAtTime(toneHz, now, 0.04);

      if (voice.withRoadEffects && throttle < 0.08 && rpm > 6800 && now - voice.lastOverrunPopAt > 0.08) {
        if (Math.random() < 0.3) {
          triggerOverrunPop(voice, rpmNorm);
          voice.lastOverrunPopAt = now;
        }
      }
    }

    // 2. Update PeriodicWave fallback path (still active if worklet unavailable)
    if (!voice.sampleLayers && (!voice.workletNode || voice.fallbackGain.gain.value > 0.01)) {
      if (patternIdx !== voice.lastPatternIdx && periodicWaves[patternIdx]) {
        voice.primaryOsc.setPeriodicWave(periodicWaves[patternIdx]);
        voice.lastPatternIdx = patternIdx;
      }
      const fCrank = ((rpm / 60) * ((timbre.baseFreq || 110) / 110) * dopplerRatio);
      voice.primaryOsc.frequency.setTargetAtTime(fCrank, now, 0.018);
      voice.crankSubOsc.frequency.setTargetAtTime(fCrank * 0.5, now, 0.018);

      const powerband = rpm > 8500 ? (rpm - 8500) / 4500 : 0;
      const pipeCutoff = clampVal(
        (timbre.filterFreq || 1350) * (0.45 + rpmNorm * 0.55 + powerband * 0.5) * dopplerRatio,
        300,
        4600
      );
      voice.pipeFilter.frequency.setTargetAtTime(pipeCutoff, now, 0.02);
      voice.pipeFilter.Q.setTargetAtTime(1.8 + powerband * 2.2, now, 0.025);
      voice.intakeFilter.frequency.setTargetAtTime(
        clampVal((220 + rpmNorm * 280 + throttle * 200) * dopplerRatio, 160, 1100),
        now,
        0.02
      );

      // Overrun crackle on fallback path when closing throttle at high RPM
      if (!voice.workletNode && throttle < 0.08 && rpm > 6200 && now - voice.lastOverrunPopAt > 0.065) {
        if (Math.random() < 0.42) {
          triggerOverrunPop(voice, rpmNorm);
          voice.lastOverrunPopAt = now;
        }
      }
    }

    const cutMult = inShiftCut ? 0.14 : 1.0;
    const baseGain = (0.14 + throttle * 0.18 + rpmNorm * 0.12) * weight * cutMult;
    voice.voiceBus.gain.setTargetAtTime(
      muted ? 0.0001 : baseGain,
      now,
      inShiftCut ? 0.008 : 0.022
    );

    if (!voice.withRoadEffects) return;

    const speedRatio = clampVal(speed / 70, 0, 1.3);

    // 3. Speed-synced Kerb Rumble
    if (rider.onKerb && speed > 5 && !muted) {
      const kerbRate = clampVal(speed / 0.58, 12, 85);
      voice.kerbOsc.frequency.setTargetAtTime(38 + speedRatio * 48, now, 0.02);
      voice.kerbLfo.frequency.setTargetAtTime(kerbRate, now, 0.02);
      voice.kerbGain.gain.setTargetAtTime(0.14 * clampVal(speed / 45, 0.2, 1.0) * weight, now, 0.015);
    } else {
      voice.kerbGain.gain.setTargetAtTime(0.0001, now, 0.025);
    }

    // 4. Tire Slide Screech (filtered noise rubber squeal when rearSlip > 0.25)
    const slip = rider.rearSlip || 0;
    if (slip > 0.25 && speed > 8 && !muted) {
      const slipInt = clampVal((slip - 0.25) / 0.75, 0, 1);
      voice.screechFilter1.frequency.setTargetAtTime(980 + slipInt * 340 + voice.slotIdx * 45, now, 0.02);
      voice.screechFilter2.frequency.setTargetAtTime(2120 + slipInt * 520 + voice.slotIdx * 65, now, 0.02);
      voice.screechGain.gain.setTargetAtTime(0.24 * slipInt * weight, now, 0.02);
    } else {
      voice.screechGain.gain.setTargetAtTime(0.0001, now, 0.035);
    }

    // 5. Aerodynamic Wind Rush (scales smoothly above 20 m/s; quieter in aero tuck)
    if (speed > 20 && !muted) {
      const windNorm = clampVal((speed - 20) / 68, 0, 1);
      const tuckAtten = rider.tuck ? 0.78 : 1.0;
      voice.windFilter.frequency.setTargetAtTime(240 + windNorm * windNorm * 1150, now, 0.03);
      voice.windGain.gain.setTargetAtTime(0.13 * windNorm * windNorm * tuckAtten * weight, now, 0.03);
    } else {
      voice.windGain.gain.setTargetAtTime(0.0001, now, 0.04);
    }

    // 6. Gravel Trap Stone Crunch when offTrack
    if (rider.offTrack && speed > 4 && !muted) {
      const gravelNorm = clampVal(speed / 50, 0.15, 1.0);
      voice.gravelFilter.frequency.setTargetAtTime(980 + Math.random() * 550, now, 0.02);
      voice.gravelGain.gain.setTargetAtTime(0.22 * gravelNorm * weight, now, 0.02);
    } else {
      voice.gravelGain.gain.setTargetAtTime(0.0001, now, 0.03);
    }
  }

  function findClosestRivalPassby(riders, primaryRiders) {
    if (!riders || riders.length <= primaryRiders.length) return null;
    const primarySet = new Set(primaryRiders.filter(Boolean));
    let bestRival = null;
    let bestDist = 38.0;
    let bestRef = null;

    for (let i = 0; i < riders.length; i++) {
      const candidate = riders[i];
      if (!candidate || primarySet.has(candidate) || !candidate.world) continue;
      for (let j = 0; j < primaryRiders.length; j++) {
        const ref = primaryRiders[j];
        if (!ref || !ref.world) continue;
        const dx = candidate.world.x - ref.world.x;
        const dz = candidate.world.z - ref.world.z;
        const dist = Math.hypot(dx, dz);
        if (dist < bestDist) {
          bestDist = dist;
          bestRival = candidate;
          bestRef = ref;
        }
      }
    }

    if (!bestRival || !bestRef) return null;

    // Radial closing speed for authentic Doppler pitch shift
    const dx = bestRival.world.x - bestRef.world.x;
    const dz = bestRival.world.z - bestRef.world.z;
    const dist = Math.max(0.5, Math.hypot(dx, dz));
    const ux = dx / dist;
    const uz = dz / dist;

    const rvx = Math.cos(bestRival.world.heading || 0) * (bestRival.speed || 0);
    const rvz = Math.sin(bestRival.world.heading || 0) * (bestRival.speed || 0);
    const pvx = Math.cos(bestRef.world.heading || 0) * (bestRef.speed || 0);
    const pvz = Math.sin(bestRef.world.heading || 0) * (bestRef.speed || 0);

    // Positive closingSpeed means rival & listener are approaching -> pitch rises
    const closingSpeed = (pvx - rvx) * ux + (pvz - rvz) * uz;
    const doppler = clampVal(343 / Math.max(220, 343 - closingSpeed), 0.72, 1.38);
    const proxWeight = Math.pow(clampVal(1 - bestDist / 38.0, 0, 1), 1.8) * 0.42;

    // Subtle stereo pan toward rival side when close
    const fwdX = Math.cos(bestRef.world.heading || 0);
    const fwdZ = Math.sin(bestRef.world.heading || 0);
    const rightDot = -fwdZ * ux + fwdX * uz;
    const pan = clampVal(rightDot * 0.45, -0.45, 0.45);

    return { rival: bestRival, weight: proxWeight, doppler, pan };
  }

  function update(riders = [], options = {}) {
    if (!ready) return;
    if (ctx && ctx.state === 'suspended' && !muted) {
      ctx.resume().catch(() => {});
    }

    const humanRiders = riders.filter((r) => r && !r.isAI);
    const r0 = humanRiders[0] || riders[0] || null;
    const r1 = humanRiders[1] || null;

    const isVertical = options?.splitMode === 'vertical' && Boolean(r0 && r1);
    const p1Pan = isVertical ? -0.24 : 0;
    const p2Pan = isVertical ? 0.24 : 0;

    if (r0 && r1) {
      updateVoice(voices[0], r0, 0.68, p1Pan, 1.0);
      updateVoice(voices[1], r1, 0.68, p2Pan, 1.0);
    } else {
      updateVoice(voices[0], r0, 0.96, 0, 1.0);
      updateVoice(voices[1], null, 0.0, 0, 1.0);
    }

    if (rivalVoice) {
      const passby = findClosestRivalPassby(riders, r1 ? [r0, r1] : [r0]);
      if (passby) {
        updateVoice(rivalVoice, passby.rival, passby.weight, passby.pan, passby.doppler);
      } else {
        updateVoice(rivalVoice, null, 0, 0, 1.0);
      }
    }
  }

  function playBeep(freq = 440, duration = 0.18, type = 'sine') {
    if (!ensureContext() || !ctx || muted) return;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.22, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc.connect(gain);
      gain.connect(masterOut);
      osc.start(now);
      osc.stop(now + duration + 0.02);
    } catch (_e) {
      // Ignore if audio context is blocked
    }
  }

  function playStartBeep(isGo = false) {
    if (isGo) {
      playBeep(880, 0.42, 'triangle');
    } else {
      playBeep(440, 0.16, 'sine');
    }
  }

  function setMuted(flag) {
    muted = Boolean(flag);
    if (ready && ctx && masterOut) {
      masterOut.gain.setTargetAtTime(muted ? 0.0001 : 0.42, ctx.currentTime, 0.02);
    }
    return muted;
  }

  function toggleMute() {
    return setMuted(!muted);
  }

  function silence() {
    if (!ready || !ctx) return;
    updateVoice(voices[0], null, 0, 0, 1.0);
    updateVoice(voices[1], null, 0, 0, 1.0);
    if (rivalVoice) updateVoice(rivalVoice, null, 0, 0, 1.0);
  }

  function dispose() {
    silence();
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function' && gestureListenersBound) {
      window.removeEventListener('pointerdown', resumeOnGesture);
      window.removeEventListener('keydown', resumeOnGesture);
      gestureListenersBound = false;
    }
    if (ctx && typeof ctx.close === 'function') {
      ctx.close().catch(() => {});
    }
    ctx = null;
    ready = false;
    engineSamples = null;
    samplesLoading = false;
    workletReady = false;
    workletLoading = false;
    voices.length = 0;
    rivalVoice = null;
  }

  return {
    init: ensureContext,
    resume: ensureContext,
    update,
    updateAudio: update,
    step: update,
    playBeep,
    playStartBeep,
    setMuted,
    toggleMute,
    isMuted: () => muted,
    silence,
    stopAll: silence,
    dispose,
    getDebugState: () => ({
      ready,
      workletReady,
      samplesReady: Boolean(engineSamples),
      muted,
      voiceCount: voices.length,
      hasRivalVoice: Boolean(rivalVoice)
    })
  };
}
