/**
 * AudioWorkletProcessor: 1990 500cc V4 Two-Stroke GP Engine Physical DSP Synthesizer
 *
 * Models:
 * - 4-cylinder 2-stroke firing phases (1 combustion per crank rev per cylinder)
 *   with bike-specific V4 crank firing angles (Screamer vs Big-Bang/staggered)
 * - Cycle-to-cycle scavenging irregularity at idle/low-load ("ring-ding-ding")
 * - Exhaust port blowdown pressure pulses + port-opening combustion noise burst
 * - Dual tuned expansion-chamber resonant modes (powerband pipe scream > 8,500 RPM)
 * - Intake airbox induction roar scaled by throttle opening
 * - Deceleration overrun crackle / pop-and-bang when chopping throttle at high RPM
 * - Quickshifter ignition cut envelope + straight-cut gearbox whine
 */

const CRANK_PATTERNS = [
  [0.00, 0.25, 0.50, 0.75], // 0: Akagi V4 Screamer (even 90 deg)
  [0.00, 0.14, 0.50, 0.64], // 1: Shiden V4 Big-Bang (twin-pulse growl)
  [0.00, 0.22, 0.50, 0.72], // 2: Kaze Square/V4 snappy
  [0.00, 0.18, 0.52, 0.70]  // 3: Corsa staggered Italian V4
];

const CYL_WEIGHTS = [1.0, 0.94, 1.04, 0.91];

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

class StateVariableFilter {
  constructor() {
    this.low = 0;
    this.band = 0;
    this.high = 0;
  }

  process(input, cutoffHz, q, sr) {
    const safeCutoff = clamp(cutoffHz, 40, sr * 0.28);
    const f = 2.0 * Math.sin((Math.PI * safeCutoff) / sr);
    const damp = 1.0 / Math.max(0.65, q);

    // 2x oversampled Chamberlin SVF for rock-solid high-frequency stability
    for (let i = 0; i < 2; i++) {
      this.high = input - this.low - damp * this.band;
      this.band += f * 0.5 * this.high;
      this.low += f * 0.5 * this.band;
      // Soft-limit internal state to guarantee zero divergence
      if (this.band > 8) this.band = 8;
      else if (this.band < -8) this.band = -8;
      if (this.low > 8) this.low = 8;
      else if (this.low < -8) this.low = -8;
    }
  }
}

class TwoStrokeV4Processor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rpm', defaultValue: 4200, minValue: 2000, maxValue: 15000, automationRate: 'k-rate' },
      { name: 'throttle', defaultValue: 0.0, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' },
      { name: 'speed', defaultValue: 0.0, minValue: 0.0, maxValue: 120.0, automationRate: 'k-rate' },
      { name: 'shiftCut', defaultValue: 0.0, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' },
      { name: 'crankPattern', defaultValue: 0, minValue: 0, maxValue: 3, automationRate: 'k-rate' },
      { name: 'pipeFreqBase', defaultValue: 110, minValue: 60, maxValue: 240, automationRate: 'k-rate' },
      { name: 'harmonicRatio', defaultValue: 2.0, minValue: 1.2, maxValue: 3.0, automationRate: 'k-rate' },
      { name: 'filterResBase', defaultValue: 1350, minValue: 450, maxValue: 3200, automationRate: 'k-rate' },
      { name: 'dopplerRatio', defaultValue: 1.0, minValue: 0.5, maxValue: 1.8, automationRate: 'k-rate' }
    ];
  }

  constructor() {
    super();
    this.phase = Math.random();
    this.whinePhase = 0;
    this.smoothRpm = 4200;
    this.smoothThrottle = 0;
    this.smoothSpeed = 0;
    this.smoothDoppler = 1.0;
    this.exhaustEnv = 0;
    this.intakeEnv = 0;
    this.noiseBurstEnv = 0;
    this.overrunEnv = 0;
    this.dcPrevIn = 0;
    this.dcPrevOut = 0;
    this.rngState = (Math.floor(Math.random() * 0x7fffffff) | 1) >>> 0;

    this.svfPipe1 = new StateVariableFilter();
    this.svfPipe2 = new StateVariableFilter();
    this.svfIntake = new StateVariableFilter();
    this.svfOverrun = new StateVariableFilter();

    this.cylJitter = [0, 0, 0, 0];
  }

  nextRand() {
    // Fast xorshift32 PRNG (allocation-free in audio thread)
    let x = this.rngState;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.rngState = x >>> 0;
    return (this.rngState & 0xffffff) / 0x1000000;
  }

  process(_inputs, outputs, parameters) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const outL = output[0];
    const outR = output[1] || null;
    const blockSize = outL.length;
    const sr = sampleRate;

    const targetRpm = parameters.rpm[0];
    const targetThrottle = parameters.throttle[0];
    const targetSpeed = parameters.speed[0];
    const shiftCut = parameters.shiftCut[0] > 0.25;
    const patternIdx = clamp(Math.round(parameters.crankPattern[0]), 0, 3);
    const pipeFreqBase = parameters.pipeFreqBase[0];
    const harmonicRatio = parameters.harmonicRatio[0];
    const filterResBase = parameters.filterResBase[0];
    const targetDoppler = parameters.dopplerRatio[0];

    const pattern = CRANK_PATTERNS[patternIdx];
    const pitchScale = pipeFreqBase / 110.0;
    const slew = 1.0 - Math.exp(-1.0 / (sr * 0.012));

    for (let i = 0; i < blockSize; i++) {
      this.smoothRpm += (targetRpm - this.smoothRpm) * slew;
      this.smoothThrottle += (targetThrottle - this.smoothThrottle) * slew;
      this.smoothSpeed += (targetSpeed - this.smoothSpeed) * slew;
      this.smoothDoppler += (targetDoppler - this.smoothDoppler) * slew;

      const rpm = this.smoothRpm;
      const throttle = this.smoothThrottle;
      const rpmNorm = clamp((rpm - 3000) / 10500, 0, 1);
      const powerband = clamp((rpm - 8200) / 4300, 0, 1);

      // Crank frequency: 2-stroke fires every 360 deg per cylinder
      const revHz = clamp((rpm / 60.0) * pitchScale * this.smoothDoppler, 22, 420);
      const dPhase = revHz / sr;
      const prevPhase = this.phase;
      let nextPhase = prevPhase + dPhase;

      // Cylinder firing detection across [prevPhase, nextPhase)
      for (let c = 0; c < 4; c++) {
        const fireAngle = (pattern[c] + this.cylJitter[c] + 1.0) % 1.0;
        const fired =
          nextPhase < 1.0
            ? fireAngle >= prevPhase && fireAngle < nextPhase
            : fireAngle >= prevPhase || fireAngle < nextPhase - 1.0;

        if (fired) {
          // Refresh small jitter for next revolution (more irregular at idle/low load)
          const jitterAmt = (1.0 - rpmNorm * 0.72) * 0.007;
          this.cylJitter[c] = (this.nextRand() - 0.5) * jitterAmt;

          if (!shiftCut) {
            // 2-stroke scavenging miss/irregularity at idle & closed throttle ("ring-ding-ding")
            const fireProb = clamp(0.52 + rpmNorm * 0.38 + throttle * 0.48, 0.5, 1.0);
            const rFire = this.nextRand();
            const strokeStrength =
              rFire < fireProb
                ? (0.44 + throttle * 0.56) * (0.84 + 0.30 * this.nextRand())
                : (0.12 + 0.16 * throttle) * this.nextRand();

            const cylAmp = strokeStrength * CYL_WEIGHTS[c];
            this.exhaustEnv = Math.min(2.2, this.exhaustEnv + cylAmp * (0.95 + powerband * 0.45));
            this.intakeEnv = Math.min(1.8, this.intakeEnv + cylAmp * (0.25 + throttle * 0.85));
            this.noiseBurstEnv = Math.min(1.6, this.noiseBurstEnv + cylAmp * 0.75);
          }
        }
      }

      if (nextPhase >= 1.0) nextPhase -= 1.0;
      this.phase = nextPhase;

      // Exponential blowdown decay speeds up as RPM climbs so upper revs pack cleanly
      const exDecay = Math.exp(-1.0 / (sr * (0.0052 - rpmNorm * 0.0033)));
      const inDecay = Math.exp(-1.0 / (sr * (0.0075 - rpmNorm * 0.0040)));
      const nbDecay = Math.exp(-1.0 / (sr * 0.00085));
      this.exhaustEnv *= exDecay;
      this.intakeEnv *= inDecay;
      this.noiseBurstEnv *= nbDecay;

      // Exhaust port opening pressure pulse + combustion turbulence burst
      const white = this.nextRand() * 2.0 - 1.0;
      const crankRipple = Math.sin(this.phase * Math.PI * 2.0);
      const v2Ripple = Math.sin(this.phase * Math.PI * 4.0);
      const exhaustExcitation =
        this.exhaustEnv * (0.68 + 0.22 * crankRipple + 0.16 * v2Ripple) +
        this.noiseBurstEnv * white * (0.34 + 0.18 * powerband);

      // Deceleration overrun crackle / pop-and-bang when throttle chopped at high RPM
      if (throttle < 0.09 && rpm > 5600 && !shiftCut) {
        const popRate = (14.0 + 18.0 * rpmNorm) / sr;
        if (this.nextRand() < popRate) {
          this.overrunEnv = Math.min(1.8, this.overrunEnv + 0.65 + 0.65 * this.nextRand());
        }
      }
      this.overrunEnv *= Math.exp(-1.0 / (sr * 0.009));
      this.svfOverrun.process(this.overrunEnv * white, 420 + 260 * powerband, 2.2, sr);
      const overrunSig = (this.svfOverrun.band * 0.85 + this.svfOverrun.low * 0.55) * 0.42;

      // Expansion chamber tuned pipe resonators
      const pipeCutoff1 = clamp(
        filterResBase * (0.40 + rpmNorm * 0.62 + powerband * 0.48) * this.smoothDoppler,
        320,
        3800
      );
      const pipeQ1 = 1.65 + powerband * 2.25 + throttle * 0.55;
      this.svfPipe1.process(exhaustExcitation + overrunSig * 0.45, pipeCutoff1, pipeQ1, sr);

      const pipeCutoff2 = clamp(pipeCutoff1 * (1.72 + (harmonicRatio - 1.5) * 0.35), 600, 6400);
      const pipeQ2 = 2.2 + powerband * 2.5;
      this.svfPipe2.process(exhaustExcitation, pipeCutoff2, pipeQ2, sr);

      // Intake airbox induction bark under the tank
      const intakeCutoff = clamp((210 + rpmNorm * 280 + throttle * 160) * this.smoothDoppler, 150, 950);
      this.svfIntake.process(this.intakeEnv * (0.8 + 0.2 * white), intakeCutoff, 1.35, sr);

      // Straight-cut dry-clutch & gearbox whine proportional to wheel speed
      const whineHz = clamp((260 + this.smoothSpeed * 19.5) * this.smoothDoppler, 200, 2600);
      this.whinePhase += whineHz / sr;
      if (this.whinePhase >= 1.0) this.whinePhase -= 1.0;
      const whineTri = 1.0 - 4.0 * Math.abs(this.whinePhase - 0.5);
      const whineAmp = clamp(this.smoothSpeed / 35.0, 0, 1) * (0.022 + (shiftCut ? 0.015 : 0));

      // Combine physical layers
      const pipePrimary = this.svfPipe1.band * (0.58 + powerband * 0.42) + this.svfPipe1.low * (0.46 - powerband * 0.14);
      const pipeStinger = this.svfPipe2.band * (0.18 + powerband * 0.34) * (0.52 + 0.48 * throttle);
      const airbox = this.svfIntake.low * (0.20 + throttle * 0.52);

      let raw = pipePrimary + pipeStinger + airbox + overrunSig * 0.65 + whineTri * whineAmp;

      // Subtle asymmetric expansion-chamber saturation (adds realistic 2nd harmonic warmth & bite)
      const asym = raw + 0.16 * raw * raw;
      let shaped = Math.tanh(asym * 1.15) * 0.72;

      // DC-blocking highpass (~18 Hz) to prevent low-frequency offset drift from asymmetric pulse
      const dcOut = shaped - this.dcPrevIn + 0.9975 * this.dcPrevOut;
      this.dcPrevIn = shaped;
      this.dcPrevOut = dcOut;

      outL[i] = dcOut;
      if (outR) outR[i] = dcOut;
    }

    return true;
  }
}

registerProcessor('two-stroke-v4-processor', TwoStrokeV4Processor);
