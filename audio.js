/**
 * audio.js - Standalone Web Audio API Sound Synthesizer & SFX Manager
 * Bubble Shooter Game
 * 
 * Exposes window.GameAudio with synthesized sound effects:
 * - init()
 * - playShoot()
 * - playBounce()
 * - playPop(comboCount)
 * - playDrop(count)
 * - playCeilingDrop()
 * - playGameOver()
 * - playVictory()
 * - toggleMute()
 * - isMuted()
 * - toggleMusic()
 * - isMusicPlaying()
 */

(function (root) {
  'use strict';

  // --- Audio State & Context ---
  var ctx = null;
  var masterGain = null;
  var sfxGain = null;
  var musicGain = null;
  var isMutedState = false;
  var isMusicActive = false;
  var initialized = false;
  var previousMasterVolume = 0.7;

  // Background Music Sequencer State
  var musicTimer = null;
  var currentStep = 0;
  var nextNoteTime = 0.0;
  var activeMusicOscillators = [];

  // Musical scales for melodic sfx & music (Hz)
  // Pentatonic scale base: C4, D4, E4, G4, A4, C5, D5, E5, G5, A5, C6...
  var PENTATONIC_SCALE = [
    261.63, 293.66, 329.63, 392.00, 440.00,
    523.25, 587.33, 659.25, 783.99, 880.00,
    1046.50, 1174.66, 1318.51, 1567.98, 1760.00
  ];

  // Arcade BGM Pattern (Chords & Melody in A minor / C major arcade style)
  var BGM_BPM = 120;
  var BGM_BEAT_DUR = 60 / BGM_BPM; // 0.5s per beat, 0.125s per 16th
  var BGM_STEPS = 32; // 2 bars of 16th notes
  
  // Melody notes (step index -> frequency or null)
  var BGM_MELODY = [
    523.25, null, 659.25, null, 783.99, null, 659.25, 783.99, // C5, E5, G5, E5, G5
    880.00, null, 783.99, null, 659.25, null, 587.33, null,   // A5, G5, E5, D5
    523.25, null, 587.33, null, 659.25, null, 523.25, null,   // C5, D5, E5, C5
    440.00, 523.25, 587.33, 659.25, 783.99, null, null, null // A4, C5, D5, E5, G5
  ];

  // Bass notes (step index -> frequency or null)
  var BGM_BASS = [
    130.81, null, null, null, 130.81, null, null, null, // C3
    110.00, null, null, null, 110.00, null, null, null, // A2
    146.83, null, null, null, 146.83, null, null, null, // D3
    98.00,  null, null, null, 196.00, null, null, null  // G2, G3
  ];

  /**
   * Safe getter for AudioContext
   */
  function getContext() {
    if (!ctx) {
      try {
        var AudioContextClass = root.AudioContext || root.webkitAudioContext;
        if (AudioContextClass) {
          ctx = new AudioContextClass();
        }
      } catch (e) {
        ctx = null;
      }
    }
    return ctx;
  }

  /**
   * Resume audio context if suspended (needed for browser autoplay policies)
   */
  function ensureContextRunning() {
    var audioCtx = getContext();
    if (!audioCtx) return false;

    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(function () {});
    }
    return true;
  }

  /**
   * Initialize nodes and attach auto-resume listeners
   */
  function init() {
    if (initialized && ctx) {
      ensureContextRunning();
      return GameAudio;
    }

    var audioCtx = getContext();
    if (!audioCtx) {
      initialized = true;
      return GameAudio;
    }

    try {
      // Master Gain
      masterGain = audioCtx.createGain();
      masterGain.gain.setValueAtTime(isMutedState ? 0 : previousMasterVolume, audioCtx.currentTime);

      // SFX Gain
      sfxGain = audioCtx.createGain();
      sfxGain.gain.setValueAtTime(0.85, audioCtx.currentTime);
      sfxGain.connect(masterGain);

      // Music Gain
      musicGain = audioCtx.createGain();
      musicGain.gain.setValueAtTime(0.22, audioCtx.currentTime);
      musicGain.connect(masterGain);

      masterGain.connect(audioCtx.destination);

      // Auto-resume on user gesture if suspended
      if (typeof root.addEventListener === 'function') {
        var unlockHandler = function () {
          if (audioCtx.state === 'suspended') {
            audioCtx.resume().then(function () {
              cleanUnlockListeners();
            }).catch(function () {});
          } else {
            cleanUnlockListeners();
          }
        };

        var cleanUnlockListeners = function () {
          root.removeEventListener('click', unlockHandler, true);
          root.removeEventListener('touchstart', unlockHandler, true);
          root.removeEventListener('keydown', unlockHandler, true);
          root.removeEventListener('pointerdown', unlockHandler, true);
        };

        root.addEventListener('click', unlockHandler, true);
        root.addEventListener('touchstart', unlockHandler, true);
        root.addEventListener('keydown', unlockHandler, true);
        root.addEventListener('pointerdown', unlockHandler, true);
      }

      ensureContextRunning();
      initialized = true;
    } catch (err) {
      console.warn('[GameAudio] Initialization warning:', err);
    }

    return GameAudio;
  }

  /**
   * Utility to safely schedule oscillator stop and disconnect
   */
  function cleanupNodeOnEnd(sourceNode, gainNode) {
    sourceNode.onended = function () {
      try {
        sourceNode.disconnect();
      } catch (e) {}
      if (gainNode) {
        try {
          gainNode.disconnect();
        } catch (e) {}
      }
    };
  }

  // --- Sound Effects Synthesizers ---

  /**
   * playShoot()
   * Cannon shoot sound: punchy pop + upward sweeping frequency ("thwip-pop")
   */
  function playShoot() {
    if (isMutedState) return;
    init();
    var audioCtx = getContext();
    if (!audioCtx || !sfxGain) return;
    ensureContextRunning();

    var now = audioCtx.currentTime;

    // Body of the shot (punchy sine sweep)
    var osc = audioCtx.createOscillator();
    var gain = audioCtx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(480, now + 0.09);

    gain.gain.setValueAtTime(0.45, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    osc.connect(gain);
    gain.connect(sfxGain);

    osc.start(now);
    osc.stop(now + 0.13);
    cleanupNodeOnEnd(osc, gain);

    // Subtle click/transient at start
    var snapOsc = audioCtx.createOscillator();
    var snapGain = audioCtx.createGain();
    snapOsc.type = 'triangle';
    snapOsc.frequency.setValueAtTime(600, now);
    snapOsc.frequency.exponentialRampToValueAtTime(200, now + 0.03);

    snapGain.gain.setValueAtTime(0.2, now);
    snapGain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);

    snapOsc.connect(snapGain);
    snapGain.connect(sfxGain);

    snapOsc.start(now);
    snapOsc.stop(now + 0.04);
    cleanupNodeOnEnd(snapOsc, snapGain);
  }

  /**
   * playBounce()
   * Ball bouncing off left/right walls: rubbery, elastic "boing-tap"
   */
  function playBounce() {
    if (isMutedState) return;
    init();
    var audioCtx = getContext();
    if (!audioCtx || !sfxGain) return;
    ensureContextRunning();

    var now = audioCtx.currentTime;

    var osc = audioCtx.createOscillator();
    var gain = audioCtx.createGain();

    osc.type = 'sine';
    // Rubbery dip and quick settle
    osc.frequency.setValueAtTime(360, now);
    osc.frequency.exponentialRampToValueAtTime(180, now + 0.04);
    osc.frequency.exponentialRampToValueAtTime(260, now + 0.08);

    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.085);

    osc.connect(gain);
    gain.connect(sfxGain);

    osc.start(now);
    osc.stop(now + 0.09);
    cleanupNodeOnEnd(osc, gain);
  }

  /**
   * playPop(comboCount)
   * Bubble pop! Crisp pop followed by sweet pitched tone.
   * Pitch rises musically with comboCount. High combos include sparkle chimes.
   */
  function playPop(comboCount) {
    if (isMutedState) return;
    init();
    var audioCtx = getContext();
    if (!audioCtx || !sfxGain) return;
    ensureContextRunning();

    var combo = Math.max(1, parseInt(comboCount, 10) || 1);
    var now = audioCtx.currentTime;

    // Pick base pitch from pentatonic scale based on combo
    var noteIdx = (combo - 1) % PENTATONIC_SCALE.length;
    var octavesUp = Math.floor((combo - 1) / PENTATONIC_SCALE.length);
    var baseFreq = PENTATONIC_SCALE[noteIdx] * Math.pow(2, octavesUp);

    // Clamp within audible musical range
    if (baseFreq > 2400) baseFreq = 2400;

    // 1. Primary Pop Tone (sweet upward bubble snap)
    var osc = audioCtx.createOscillator();
    var gain = audioCtx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(baseFreq * 0.75, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.35, now + 0.035);
    osc.frequency.exponentialRampToValueAtTime(baseFreq, now + 0.1);

    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

    osc.connect(gain);
    gain.connect(sfxGain);

    osc.start(now);
    osc.stop(now + 0.15);
    cleanupNodeOnEnd(osc, gain);

    // 2. High crisp transient pop
    var clickOsc = audioCtx.createOscillator();
    var clickGain = audioCtx.createGain();
    clickOsc.type = 'sine';
    clickOsc.frequency.setValueAtTime(baseFreq * 2.2, now);
    clickOsc.frequency.exponentialRampToValueAtTime(baseFreq * 0.5, now + 0.025);

    clickGain.gain.setValueAtTime(0.25, now);
    clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);

    clickOsc.connect(clickGain);
    clickGain.connect(sfxGain);

    clickOsc.start(now);
    clickOsc.stop(now + 0.035);
    cleanupNodeOnEnd(clickOsc, clickGain);

    // 3. Combo Chime / Harmony for combos >= 2
    if (combo >= 2) {
      var chimeOsc = audioCtx.createOscillator();
      var chimeGain = audioCtx.createGain();

      chimeOsc.type = 'sine';
      // Harmonic fifth or octave above
      var harmonicFreq = baseFreq * 1.5;
      chimeOsc.frequency.setValueAtTime(harmonicFreq, now + 0.02);

      chimeGain.gain.setValueAtTime(0.001, now);
      chimeGain.gain.linearRampToValueAtTime(0.25, now + 0.03);
      chimeGain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

      chimeOsc.connect(chimeGain);
      chimeGain.connect(sfxGain);

      chimeOsc.start(now + 0.02);
      chimeOsc.stop(now + 0.3);
      cleanupNodeOnEnd(chimeOsc, chimeGain);
    }

    // 4. Extra sparkle for big combo (>= 4)
    if (combo >= 4) {
      var sparkleOsc = audioCtx.createOscillator();
      var sparkleGain = audioCtx.createGain();

      sparkleOsc.type = 'sine';
      sparkleOsc.frequency.setValueAtTime(baseFreq * 2.0, now + 0.05);
      sparkleOsc.frequency.exponentialRampToValueAtTime(baseFreq * 3.0, now + 0.22);

      sparkleGain.gain.setValueAtTime(0.001, now);
      sparkleGain.gain.linearRampToValueAtTime(0.18, now + 0.06);
      sparkleGain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      sparkleOsc.connect(sparkleGain);
      sparkleGain.connect(sfxGain);

      sparkleOsc.start(now + 0.05);
      sparkleOsc.stop(now + 0.36);
      cleanupNodeOnEnd(sparkleOsc, sparkleGain);
    }
  }

  /**
   * playDrop(count)
   * Disconnected / floating bubbles falling down.
   * Plays cascading cute water droplets / tumbling bloops.
   */
  function playDrop(count) {
    if (isMutedState) return;
    init();
    var audioCtx = getContext();
    if (!audioCtx || !sfxGain) return;
    ensureContextRunning();

    var dropCount = Math.max(1, Math.min(6, parseInt(count, 10) || 1));
    var startTime = audioCtx.currentTime;

    for (var i = 0; i < dropCount; i++) {
      (function (idx) {
        var noteDelay = idx * 0.055;
        var noteStart = startTime + noteDelay;

        var osc = audioCtx.createOscillator();
        var gain = audioCtx.createGain();

        // Staggered descending cute droplet pitches
        var freq = 650 - (idx * 65);
        if (freq < 240) freq = 240;

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, noteStart);
        osc.frequency.exponentialRampToValueAtTime(freq * 0.7, noteStart + 0.07);

        gain.gain.setValueAtTime(0.001, noteStart);
        gain.gain.linearRampToValueAtTime(0.28, noteStart + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.001, noteStart + 0.08);

        osc.connect(gain);
        gain.connect(sfxGain);

        osc.start(noteStart);
        osc.stop(noteStart + 0.09);
        cleanupNodeOnEnd(osc, gain);
      })(i);
    }
  }

  /**
   * playCeilingDrop()
   * Ceiling drop / danger warning: ominous low mechanical thud and ratchet slide.
   */
  function playCeilingDrop() {
    if (isMutedState) return;
    init();
    var audioCtx = getContext();
    if (!audioCtx || !sfxGain) return;
    ensureContextRunning();

    var now = audioCtx.currentTime;

    // 1. Low warning rumble
    var rumbleOsc = audioCtx.createOscillator();
    var rumbleGain = audioCtx.createGain();
    var filter = audioCtx.createBiquadFilter();

    rumbleOsc.type = 'sawtooth';
    rumbleOsc.frequency.setValueAtTime(120, now);
    rumbleOsc.frequency.exponentialRampToValueAtTime(55, now + 0.35);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(280, now);
    filter.frequency.exponentialRampToValueAtTime(90, now + 0.35);

    rumbleGain.gain.setValueAtTime(0.4, now);
    rumbleGain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);

    rumbleOsc.connect(filter);
    filter.connect(rumbleGain);
    rumbleGain.connect(sfxGain);

    rumbleOsc.start(now);
    rumbleOsc.stop(now + 0.4);
    cleanupNodeOnEnd(rumbleOsc, rumbleGain);

    // 2. Mechanical double ratchet click
    [0.0, 0.12].forEach(function (offset) {
      var clickStart = now + offset;
      var clickOsc = audioCtx.createOscillator();
      var clickGain = audioCtx.createGain();

      clickOsc.type = 'triangle';
      clickOsc.frequency.setValueAtTime(400, clickStart);
      clickOsc.frequency.exponentialRampToValueAtTime(150, clickStart + 0.04);

      clickGain.gain.setValueAtTime(0.25, clickStart);
      clickGain.gain.exponentialRampToValueAtTime(0.001, clickStart + 0.045);

      clickOsc.connect(clickGain);
      clickGain.connect(sfxGain);

      clickOsc.start(clickStart);
      clickOsc.stop(clickStart + 0.05);
      cleanupNodeOnEnd(clickOsc, clickGain);
    });
  }

  /**
   * playGameOver()
   * Defeat slide: sad minor descending phrase ("wah-wah-wah-waaah")
   */
  function playGameOver() {
    if (isMutedState) return;
    init();
    var audioCtx = getContext();
    if (!audioCtx || !sfxGain) return;
    ensureContextRunning();

    var now = audioCtx.currentTime;
    // Sad descending notes: Eb4, D4, Db4, C4 (with vibrato & downward slide)
    var notes = [
      { freq: 311.13, dur: 0.18, delay: 0.0 },   // Eb4
      { freq: 293.66, dur: 0.18, delay: 0.2 },   // D4
      { freq: 277.18, dur: 0.22, delay: 0.4 },   // Db4
      { freq: 261.63, dur: 0.65, delay: 0.65, slide: 180.0 } // C4 -> 180Hz slide
    ];

    notes.forEach(function (n) {
      var noteStart = now + n.delay;
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(n.freq, noteStart);

      if (n.slide) {
        osc.frequency.setValueAtTime(n.freq, noteStart);
        osc.frequency.exponentialRampToValueAtTime(n.slide, noteStart + n.dur);
      }

      gain.gain.setValueAtTime(0.001, noteStart);
      gain.gain.linearRampToValueAtTime(0.35, noteStart + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, noteStart + n.dur);

      osc.connect(gain);
      gain.connect(sfxGain);

      osc.start(noteStart);
      osc.stop(noteStart + n.dur + 0.02);
      cleanupNodeOnEnd(osc, gain);
    });
  }

  /**
   * playVictory()
   * Victory fanfare: triumphant ascending major arpeggio + shimmering final chord
   */
  function playVictory() {
    if (isMutedState) return;
    init();
    var audioCtx = getContext();
    if (!audioCtx || !sfxGain) return;
    ensureContextRunning();

    var now = audioCtx.currentTime;

    // Upbeat fanfare: C5, E5, G5, High C6
    var fanfare = [
      { freq: 523.25, time: 0.00, dur: 0.12 }, // C5
      { freq: 659.25, time: 0.12, dur: 0.12 }, // E5
      { freq: 783.99, time: 0.24, dur: 0.12 }, // G5
      { freq: 1046.50, time: 0.38, dur: 0.70 } // C6 (long triumph)
    ];

    fanfare.forEach(function (item) {
      var noteStart = now + item.time;
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(item.freq, noteStart);

      gain.gain.setValueAtTime(0.001, noteStart);
      gain.gain.linearRampToValueAtTime(0.35, noteStart + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, noteStart + item.dur);

      osc.connect(gain);
      gain.connect(sfxGain);

      osc.start(noteStart);
      osc.stop(noteStart + item.dur + 0.02);
      cleanupNodeOnEnd(osc, gain);
    });

    // Chord backing on final hit (E5 + G5 accompanying High C6)
    [659.25, 783.99].forEach(function (chordFreq) {
      var noteStart = now + 0.38;
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(chordFreq, noteStart);

      gain.gain.setValueAtTime(0.001, noteStart);
      gain.gain.linearRampToValueAtTime(0.18, noteStart + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, noteStart + 0.65);

      osc.connect(gain);
      gain.connect(sfxGain);

      osc.start(noteStart);
      osc.stop(noteStart + 0.68);
      cleanupNodeOnEnd(osc, gain);
    });
  }

  // --- Background Music (Synthesized Arcade BGM) ---

  /**
   * Schedule a single synth note for BGM
   */
  function scheduleBgmNote(freq, startTime, duration, type, volume) {
    var audioCtx = getContext();
    if (!audioCtx || !musicGain) return;

    var osc = audioCtx.createOscillator();
    var gain = audioCtx.createGain();

    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, startTime);

    gain.gain.setValueAtTime(0.001, startTime);
    gain.gain.linearRampToValueAtTime(volume, startTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    osc.connect(gain);
    gain.connect(musicGain);

    osc.start(startTime);
    osc.stop(startTime + duration + 0.02);
    cleanupNodeOnEnd(osc, gain);

    activeMusicOscillators.push(osc);
    osc.onended = function () {
      var idx = activeMusicOscillators.indexOf(osc);
      if (idx !== -1) activeMusicOscillators.splice(idx, 1);
      try { osc.disconnect(); } catch (e) {}
      try { gain.disconnect(); } catch (e) {}
    };
  }

  /**
   * Step the BGM sequencer
   */
  function bgmScheduler() {
    var audioCtx = getContext();
    if (!audioCtx || !isMusicActive) return;

    // Lookahead: schedule up to 0.25s in advance
    var lookahead = 0.25;
    var stepDuration = BGM_BEAT_DUR / 4; // 16th note

    while (nextNoteTime < audioCtx.currentTime + lookahead) {
      // Melody
      var melodyFreq = BGM_MELODY[currentStep];
      if (melodyFreq) {
        scheduleBgmNote(melodyFreq, nextNoteTime, stepDuration * 1.8, 'sine', 0.2);
      }

      // Bass
      var bassFreq = BGM_BASS[currentStep];
      if (bassFreq) {
        scheduleBgmNote(bassFreq, nextNoteTime, stepDuration * 3.5, 'triangle', 0.28);
      }

      // Advance step
      nextNoteTime += stepDuration;
      currentStep = (currentStep + 1) % BGM_STEPS;
    }
  }

  /**
   * Start BGM loop
   */
  function startMusic() {
    init();
    var audioCtx = getContext();
    if (!audioCtx) {
      isMusicActive = true;
      return true;
    }
    ensureContextRunning();

    if (musicTimer) clearInterval(musicTimer);
    activeMusicOscillators = [];
    currentStep = 0;
    nextNoteTime = audioCtx.currentTime + 0.05;
    isMusicActive = true;

    musicTimer = setInterval(bgmScheduler, 50);
    return true;
  }

  /**
   * Stop BGM loop
   */
  function stopMusic() {
    isMusicActive = false;
    if (musicTimer) {
      clearInterval(musicTimer);
      musicTimer = null;
    }
    // Stop all active music oscillators
    for (var i = 0; i < activeMusicOscillators.length; i++) {
      try {
        activeMusicOscillators[i].stop();
        activeMusicOscillators[i].disconnect();
      } catch (e) {}
    }
    activeMusicOscillators = [];
    return false;
  }

  /**
   * toggleMusic()
   * Toggles arcade background music loop on/off.
   * Returns boolean (true if music is now active, false otherwise).
   */
  function toggleMusic() {
    if (isMusicActive) {
      stopMusic();
      return false;
    } else {
      startMusic();
      return true;
    }
  }

  /**
   * isMusicPlaying()
   */
  function isMusicPlaying() {
    return isMusicActive;
  }

  // --- Mute & Volume Controls ---

  /**
   * toggleMute()
   * Toggles mute state. Silences or restores master gain.
   * Returns boolean (true if muted, false if unmuted).
   */
  function toggleMute() {
    init();
    isMutedState = !isMutedState;
    var audioCtx = getContext();

    if (masterGain && audioCtx) {
      var now = audioCtx.currentTime;
      masterGain.gain.cancelScheduledValues(now);
      if (isMutedState) {
        masterGain.gain.setValueAtTime(masterGain.gain.value, now);
        masterGain.gain.linearRampToValueAtTime(0.0, now + 0.03);
      } else {
        masterGain.gain.setValueAtTime(0.0, now);
        masterGain.gain.linearRampToValueAtTime(previousMasterVolume, now + 0.03);
      }
    }

    return isMutedState;
  }

  /**
   * isMuted()
   * Returns current mute state.
   */
  function isMuted() {
    return isMutedState;
  }

  /**
   * setMasterVolume(vol)
   * Optional helper: range 0.0 to 1.0
   */
  function setMasterVolume(vol) {
    var v = Math.max(0, Math.min(1, parseFloat(vol) || 0));
    previousMasterVolume = v;
    if (!isMutedState && masterGain && ctx) {
      masterGain.gain.setValueAtTime(v, ctx.currentTime);
    }
    return previousMasterVolume;
  }

  // --- Public API Object ---
  var GameAudio = {
    init: init,
    playShoot: playShoot,
    playBounce: playBounce,
    playPop: playPop,
    playDrop: playDrop,
    playCeilingDrop: playCeilingDrop,
    playGameOver: playGameOver,
    playVictory: playVictory,
    toggleMute: toggleMute,
    isMuted: isMuted,
    toggleMusic: toggleMusic,
    isMusicPlaying: isMusicPlaying,
    setMasterVolume: setMasterVolume
  };

  // Expose to window / global scope
  if (typeof root !== 'undefined') {
    root.GameAudio = GameAudio;
  }

  // CommonJS / Node support
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = GameAudio;
  }

})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
