// 1990 500cc Two-Stroke Acoustic Synthesizer (Web Audio API)
// Produces dual engine voices with distinct harmonic timbres, central mixing,
// gear-change pops, kerb rumble, tire slide screech, and start gantry tones.

function clampVal(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function buildWaveshaperCurve(intensity = 22) {
  const len = 256;
  const curve = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const x = (i * 2) / len - 1;
    curve[i] = ((3 + intensity) * x * 18 * (Math.PI / 180)) / (Math.PI + intensity * Math.abs(x));
  }
  return curve;
}

export function createAudioEngine() {
  let ctx = null;
  let masterOut = null;
  let muted = false;
  let ready = false;
  const voices = [];

  function ensureContext() {
    if (ready && ctx) return true;
    const AudioCtx =
      typeof window !== 'undefined'
        ? window.AudioContext || window.webkitAudioContext
        : null;
    if (!AudioCtx) return false;

    try {
      ctx = new AudioCtx();
      masterOut = ctx.createGain();
      masterOut.gain.value = muted ? 0 : 0.36;
      masterOut.connect(ctx.destination);

      voices.push(createRiderVoice(0), createRiderVoice(1));
      ready = true;
      return true;
    } catch (_e) {
      return false;
    }
  }

  function createRiderVoice(slotIdx) {
    const voiceBus = ctx.createGain();
    voiceBus.gain.value = 0.0001;
    voiceBus.connect(masterOut);

    // Sawtooth primary + square overtone for 2-stroke expansion chamber rasp
    const primaryOsc = ctx.createOscillator();
    primaryOsc.type = 'sawtooth';
    const harmonicOsc = ctx.createOscillator();
    harmonicOsc.type = 'square';
    const subOsc = ctx.createOscillator();
    subOsc.type = 'triangle';

    const primaryGain = ctx.createGain();
    primaryGain.gain.value = 0.42;
    const harmonicGain = ctx.createGain();
    harmonicGain.gain.value = 0.24;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.14;

    const resonanceFilter = ctx.createBiquadFilter();
    resonanceFilter.type = 'bandpass';
    resonanceFilter.frequency.value = 1300;
    resonanceFilter.Q.value = 2.4;

    const shaper = ctx.createWaveShaper();
    shaper.curve = buildWaveshaperCurve(26);
    shaper.oversample = '2x';

    primaryOsc.connect(primaryGain);
    harmonicOsc.connect(harmonicGain);
    subOsc.connect(subGain);

    primaryGain.connect(resonanceFilter);
    harmonicGain.connect(resonanceFilter);
    subGain.connect(resonanceFilter);

    resonanceFilter.connect(shaper);
    shaper.connect(voiceBus);

    // Kerb rumble oscillator
    const kerbOsc = ctx.createOscillator();
    kerbOsc.type = 'sawtooth';
    kerbOsc.frequency.value = 58;
    const kerbGain = ctx.createGain();
    kerbGain.gain.value = 0.0001;
    kerbOsc.connect(kerbGain);
    kerbGain.connect(masterOut);

    // Rear tire slip screech (high bandpass noise + FM tone)
    const screechOsc = ctx.createOscillator();
    screechOsc.type = 'sawtooth';
    screechOsc.frequency.value = 920 + slotIdx * 75;
    const screechFilter = ctx.createBiquadFilter();
    screechFilter.type = 'bandpass';
    screechFilter.frequency.value = 1850;
    screechFilter.Q.value = 6.5;
    const screechGain = ctx.createGain();
    screechGain.gain.value = 0.0001;
    screechOsc.connect(screechFilter);
    screechFilter.connect(screechGain);
    screechGain.connect(masterOut);

    const now = ctx.currentTime;
    primaryOsc.start(now);
    harmonicOsc.start(now);
    subOsc.start(now);
    kerbOsc.start(now);
    screechOsc.start(now);

    return {
      slotIdx,
      voiceBus,
      primaryOsc,
      harmonicOsc,
      subOsc,
      resonanceFilter,
      kerbOsc,
      kerbGain,
      screechOsc,
      screechFilter,
      screechGain,
      lastGear: 1
    };
  }

  function triggerGearPop(voice, isUpshift) {
    if (!ready || !ctx || muted) return;
    try {
      const now = ctx.currentTime;
      const popOsc = ctx.createOscillator();
      const popGain = ctx.createGain();
      popOsc.type = isUpshift ? 'triangle' : 'sawtooth';
      popOsc.frequency.setValueAtTime(isUpshift ? 175 : 230, now);
      popOsc.frequency.exponentialRampToValueAtTime(52, now + 0.065);

      popGain.gain.setValueAtTime(0.18, now);
      popGain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

      popOsc.connect(popGain);
      popGain.connect(masterOut);
      popOsc.start(now);
      popOsc.stop(now + 0.075);
    } catch (_e) {
      // Ignore transient scheduling errors
    }
  }

  function updateVoice(voice, rider, weight = 0.5) {
    if (!ready || !ctx) return;
    const now = ctx.currentTime;

    if (!rider) {
      voice.voiceBus.gain.setTargetAtTime(0.0001, now, 0.04);
      voice.kerbGain.gain.setTargetAtTime(0.0001, now, 0.04);
      voice.screechGain.gain.setTargetAtTime(0.0001, now, 0.04);
      return;
    }

    const rpm = clampVal(rider.rpm ?? 4500, 3000, 13800);
    const rpmNorm = (rpm - 3000) / 10500;
    const throttle = clampVal(rider.throttle ?? 0, 0, 1);
    const timbre = (rider.bike && rider.bike.timbre) || {
      baseFreq: 108,
      harmonicRatio: 1.9,
      filterFreq: 1350
    };

    const f0 = timbre.baseFreq * (0.55 + rpmNorm * 2.35);
    const fHarm = f0 * (timbre.harmonicRatio || 1.9);
    const fSub = f0 * 0.5;

    voice.primaryOsc.frequency.setTargetAtTime(f0, now, 0.02);
    voice.harmonicOsc.frequency.setTargetAtTime(fHarm, now, 0.02);
    voice.subOsc.frequency.setTargetAtTime(fSub, now, 0.02);

    // Two-stroke powerband scream opens bandpass filter above 8,500 RPM
    const inPowerband = rpm > 8500 ? (rpm - 8500) / 4500 : 0;
    const filterTarget =
      timbre.filterFreq * (0.65 + throttle * 0.55 + inPowerband * 0.95);
    voice.resonanceFilter.frequency.setTargetAtTime(
      clampVal(filterTarget, 300, 5200),
      now,
      0.025
    );
    voice.resonanceFilter.Q.setTargetAtTime(
      1.8 + inPowerband * 2.6 + throttle * 0.8,
      now,
      0.03
    );

    const targetGain = (0.09 + throttle * 0.14 + rpmNorm * 0.09) * weight;
    voice.voiceBus.gain.setTargetAtTime(
      muted ? 0.0001 : targetGain,
      now,
      0.025
    );

    // Gear change pop
    const gear = rider.gear || 1;
    if (gear !== voice.lastGear) {
      triggerGearPop(voice, gear > voice.lastGear);
      voice.lastGear = gear;
    }

    // Kerb rumble
    const speedRatio = clampVal((rider.speed || 0) / 65, 0, 1.3);
    if (rider.onKerb && speedRatio > 0.08 && !muted) {
      voice.kerbOsc.frequency.setTargetAtTime(42 + speedRatio * 55, now, 0.02);
      voice.kerbGain.gain.setTargetAtTime(0.11 * speedRatio * weight, now, 0.015);
    } else {
      voice.kerbGain.gain.setTargetAtTime(0.0001, now, 0.03);
    }

    // Rear tire slide screech when rearSlip > 0.35
    const slip = rider.rearSlip || 0;
    if (slip > 0.35 && !muted) {
      const slipInt = clampVal((slip - 0.35) / 0.65, 0, 1);
      voice.screechOsc.frequency.setTargetAtTime(
        880 + slipInt * 420 + voice.slotIdx * 90,
        now,
        0.02
      );
      voice.screechGain.gain.setTargetAtTime(0.09 * slipInt * weight, now, 0.02);
    } else {
      voice.screechGain.gain.setTargetAtTime(0.0001, now, 0.035);
    }
  }

  function update(riders = []) {
    if (!ready) return;
    if (ctx && ctx.state === 'suspended' && !muted) {
      ctx.resume().catch(() => {});
    }
    const humanRiders = riders.filter((r) => r && !r.isAI);
    const r0 = humanRiders[0] || riders[0] || null;
    const r1 = humanRiders[1] || null;

    if (r0 && r1) {
      updateVoice(voices[0], r0, 0.72);
      updateVoice(voices[1], r1, 0.72);
    } else {
      updateVoice(voices[0], r0, 1.0);
      updateVoice(voices[1], null, 0.0);
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
      gain.gain.setValueAtTime(0.24, now);
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
      masterOut.gain.setTargetAtTime(muted ? 0.0001 : 0.36, ctx.currentTime, 0.02);
    }
    return muted;
  }

  function toggleMute() {
    return setMuted(!muted);
  }

  function silence() {
    if (!ready || !ctx) return;
    updateVoice(voices[0], null, 0);
    updateVoice(voices[1], null, 0);
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
    stopAll: silence
  };
}
