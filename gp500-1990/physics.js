// Pure JS 1990 500cc 2-Stroke Grand Prix Simcade Physics Engine
// Operates in track Frenet coordinates (s, d, psi) with lean-derived curvature

import { getBikeById } from './bikes.js';

export const FIXED_DT = 1 / 120;
export const GRAVITY = 9.81;
export const MAX_LEAN_RAD = (55 * Math.PI) / 180;

// Top speeds (m/s) per gear at 13,000 RPM for a standard 85 m/s (~306 km/h) 500cc GP bike
const BASE_GEAR_MAX_SPEEDS = [0, 37.0, 52.0, 63.5, 72.5, 80.0, 86.5];
const GEAR_TORQUE_MULT = [0, 1.55, 1.32, 1.16, 1.04, 0.95, 0.88];

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

function wrapAngle(angle) {
  let a = (angle + Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a - Math.PI;
}

export function createRiderState(opts = {}) {
  const bike =
    typeof opts.bike === 'object' && opts.bike !== null
      ? opts.bike
      : getBikeById(opts.bikeId || opts.bike || 'akagi');

  const s = opts.s ?? 0;
  const d = opts.d ?? 0;
  const psi = opts.psi ?? 0;
  const lean = opts.lean ?? 0;
  const lap = opts.lap ?? 1;
  const track = opts.track || null;
  const totalLength = track ? track.totalLength : 2000;
  const normS = totalLength > 0 ? ((s % totalLength) + totalLength) % totalLength / totalLength : 0;

  const worldPos = track
    ? track.frenetToWorld(s, d, psi)
    : { x: s, y: 0, z: d, heading: psi, pitch: 0 };

  return {
    id: opts.id ?? 'rider-0',
    name: opts.name ?? 'Rider',
    isAI: Boolean(opts.isAI),
    playerIndex: opts.playerIndex ?? (opts.isAI ? -1 : 0),
    difficulty: opts.difficulty ?? 'easy',
    // AI engine multiplier from the difficulty profile (ai.js); humans stay at 1
    perfBoost: opts.perfBoost ?? 1,
    shoveTargetId: null,
    bike,
    s,
    d,
    psi,
    speed: opts.speed ?? 0,
    rpm: opts.rpm ?? 4200,
    gear: opts.gear ?? 1,
    shiftTimer: 0,
    lean,
    leanRate: opts.leanRate ?? 0,
    throttle: 0,
    brake: 0,
    steer: 0,
    tuck: false,
    rearSlip: opts.rearSlip ?? 0,
    tractionControl: opts.tractionControl ?? true,
    highsideTimer: opts.highsideTimer ?? 0,
    wheelieAngle: opts.wheelieAngle ?? 0,
    slipstreamBoost: opts.slipstreamBoost ?? 0,
    onKerb: false,
    offTrack: false,
    lap,
    totalProgress: (lap - 1) * totalLength + s,
    maxLapProgress: opts.maxLapProgress ?? (normS < 0.5 ? normS : 0),
    lapTime: 0,
    lastLapTime: null,
    bestLapTime: null,
    totalTime: 0,
    finished: Boolean(opts.finished),
    finishPosition: opts.finishPosition ?? null,
    position: opts.position ?? 1,
    totalDistance: opts.totalDistance ?? ((lap - 1) * totalLength + s),
    aiLineOffset: opts.aiLineOffset ?? 0,
    world: {
      x: worldPos.x,
      y: worldPos.y,
      z: worldPos.z,
      heading: worldPos.heading,
      pitch: worldPos.pitch,
      roll: lean
    }
  };
}

function computeGearAndRpm(rider, throttle, dt) {
  const bikeMaxSpeed = rider.bike?.stats?.maxSpeed ?? 85.0;
  const speedScale = bikeMaxSpeed / 85.0;

  if (rider.shiftTimer > 0) {
    rider.shiftTimer = Math.max(0, rider.shiftTimer - dt);
  }

  const getRpmForGear = (gear, speed) => {
    const gMax = BASE_GEAR_MAX_SPEEDS[gear] * speedScale;
    const gMin = gear > 1 ? BASE_GEAR_MAX_SPEEDS[gear - 1] * speedScale * 0.52 : 0;
    const ratio = clamp((speed - gMin) / Math.max(1, gMax - gMin), 0, 1.05);
    const clutchSlip = gear === 1 && speed < 14 ? throttle * 1600 * (1 - speed / 14) : 0;
    return clamp(4000 + ratio * 9000 + clutchSlip, 4000, 13200);
  };

  rider.rpm = getRpmForGear(rider.gear, rider.speed);

  if (rider.shiftTimer <= 0) {
    // Shift just before the pipe falls off its peak (12,500): above it the bike can stall at the redline and never reach 6th
    if (rider.gear < 6 && rider.rpm >= 12300) {
      rider.gear += 1;
      rider.shiftTimer = 0.065;
      rider.rpm = getRpmForGear(rider.gear, rider.speed);
    } else if (rider.gear > 1 && rider.rpm <= 7400 && rider.speed < BASE_GEAR_MAX_SPEEDS[rider.gear - 1] * speedScale * 0.88) {
      rider.gear -= 1;
      rider.shiftTimer = 0.055;
      rider.rpm = getRpmForGear(rider.gear, rider.speed);
    }
  }
}

export function computePowerbandMultiplier(rpm) {
  // 1990 500cc 2-stroke expansion chamber resonance between 8,500 and 12,500 RPM
  if (rpm < 8500) {
    const t = clamp((rpm - 4000) / 4500, 0, 1);
    return 0.62 + 0.33 * t;
  }
  if (rpm <= 12500) {
    const phase = (rpm - 8500) / 4000;
    return 1.05 + 0.38 * Math.sin(phase * Math.PI);
  }
  return 0.88;
}

export function stepRiderPhysics(rider, input = {}, track, allRiders = [], dt = FIXED_DT, targetLaps = 3) {
  const rawThrottle = clamp(input.throttle ?? 0, 0, 1);
  const rawBrake = clamp(input.brake ?? 0, 0, 1);
  const rawSteer = clamp(input.steer ?? 0, -1, 1);
  const rawTuck = Boolean(input.tuck);

  // Highside recovery state
  const inHighside = rider.highsideTimer > 0;
  if (inHighside) {
    rider.highsideTimer = Math.max(0, rider.highsideTimer - dt);
  }

  // Traction control: keyboard and touch always ask for full lean and full throttle, which
  // would highside in every long corner. Feather the throttle as the rear steps out so the
  // slide settles into a controlled powerslide below the highside point.
  const tcCut = rider.tractionControl === false ? 0 : clamp((rider.rearSlip - 0.45) / 0.3, 0, 1);
  const throttle = inHighside ? 0 : rawThrottle * (1 - 0.35 * tcCut);
  const brake = inHighside ? 0.35 : rawBrake;
  const steer = inHighside ? 0 : rawSteer;
  const tuck = !inHighside && rawTuck && Math.abs(rider.lean) < 0.42;

  rider.throttle = throttle;
  rider.brake = brake;
  rider.steer = steer;
  rider.tuck = tuck;

  // 1. Roll / Lean dynamics (spring-damper toward targetLean)
  const leanStat = rider.bike?.stats?.leanRate ?? 1.0;
  const targetLean = inHighside ? 0 : steer * MAX_LEAN_RAD;
  const leanStiffness = 44.0 * leanStat;
  const leanDamping = 12.0 * Math.sqrt(leanStat);
  const leanAccel = (targetLean - rider.lean) * leanStiffness - rider.leanRate * leanDamping;
  rider.leanRate += leanAccel * dt;
  rider.lean = clamp(rider.lean + rider.leanRate * dt, -MAX_LEAN_RAD, MAX_LEAN_RAD);

  // 2. Kerb & Off-track detection
  const halfWidth = track?.halfWidth ?? 7.0;
  const kerbWidth = track?.kerbWidth ?? 1.6;
  const absD = Math.abs(rider.d);
  rider.onKerb = absD >= halfWidth - kerbWidth * 0.65 && absD <= halfWidth + kerbWidth * 0.65;
  rider.offTrack = absD > halfWidth;

  // 3. Slipstream check behind ahead riders
  let targetDraft = 0;
  if (allRiders && allRiders.length > 1 && track && rider.speed > 18) {
    for (let i = 0; i < allRiders.length; i++) {
      const other = allRiders[i];
      if (!other || other === rider) continue;
      const dsAhead = track.wrapS(other.s - rider.s);
      const latDiff = Math.abs(other.d - rider.d);
      if (dsAhead > 2.2 && dsAhead < 38.0 && latDiff < 2.2) {
        const draftStrength = (1 - dsAhead / 38.0) * (1 - latDiff / 2.2);
        if (draftStrength > targetDraft) targetDraft = draftStrength;
      }
    }
  }
  if (targetDraft > rider.slipstreamBoost) {
    rider.slipstreamBoost = Math.min(1.0, rider.slipstreamBoost + (targetDraft - rider.slipstreamBoost) * Math.min(1, 5.0 * dt) + 0.8 * dt);
  } else {
    rider.slipstreamBoost = Math.max(0, rider.slipstreamBoost - 1.5 * dt);
  }

  // 4. Automatic 6-speed gearbox & 2-stroke powerband
  computeGearAndRpm(rider, throttle, dt);
  const powerbandMult = computePowerbandMultiplier(rider.rpm);
  const inPowerband = rider.rpm >= 8500 && rider.rpm <= 12500;

  // 5. Rear-tire slip (Powerslide) & Highside trigger
  const leanRatio = Math.abs(rider.lean) / MAX_LEAN_RAD;
  const gripStat = rider.bike?.stats?.grip ?? 1.0;
  if (!inHighside && leanRatio > 0.72 && throttle > 0.72 && rider.rpm >= 8200) {
    const excessLean = (leanRatio - 0.72) / 0.28;
    const slipBuildRate = ((0.65 + 1.45 * excessLean) * throttle * (inPowerband ? 1.25 : 0.9)) / gripStat;
    rider.rearSlip = clamp(rider.rearSlip + slipBuildRate * dt, 0, 1.05);
    if (rider.rearSlip >= 1.0) {
      // Trigger Highside snap
      rider.highsideTimer = 1.05;
      rider.rearSlip = 0.35;
      rider.speed *= 0.62;
      rider.leanRate = -Math.sign(rider.lean || 1) * 5.0;
      rider.wheelieAngle = 0.22;
    }
  } else {
    rider.rearSlip = Math.max(0, rider.rearSlip - 1.8 * dt);
  }

  // 6. Longitudinal forces (2-stroke thrust, braking, aero drag, slope, gravel drag)
  const perfBoost = rider.perfBoost ?? 1;
  const bikeMaxSpeed = (rider.bike?.stats?.maxSpeed ?? 85.0) * (tuck ? 1.035 : 1.0) * (1 + (perfBoost - 1) * 0.6) + rider.slipstreamBoost * 4.5;
  const accelStat = rider.bike?.stats?.accel ?? 1.0;
  const brakeStat = rider.bike?.stats?.braking ?? 1.0;
  const gearTorque = GEAR_TORQUE_MULT[rider.gear] ?? 1.0;
  const shiftCut = rider.shiftTimer > 0 ? 0.35 : 1.0;

  const engineAccel = throttle * 16.8 * accelStat * perfBoost * gearTorque * powerbandMult * shiftCut * (1 + 0.12 * rider.slipstreamBoost);
  const brakeDecel = brake * 25.0 * brakeStat;

  const aeroDragCoeff = (tuck ? 0.00205 : 0.0024) * (1 - 0.18 * rider.slipstreamBoost);
  const aeroDecel = aeroDragCoeff * rider.speed * rider.speed + 0.32;
  const cornerScrub = 0.42 * leanRatio * leanRatio + rider.rearSlip * 3.2;

  const trackSample = track ? track.sampleAtS(rider.s) : { curvature: 0, pitch: 0, tangentAngle: 0 };
  const slopeAccel = -GRAVITY * Math.sin(trackSample.pitch || 0) * 0.45;

  let gravelDecel = 0;
  if (rider.offTrack) {
    const excessD = clamp((absD - halfWidth) / 3.0, 0.25, 1.0);
    gravelDecel = (7.5 + rider.speed * 0.32) * excessD;
  }

  const netAccel = engineAccel - brakeDecel - aeroDecel - cornerScrub + slopeAccel - gravelDecel;
  rider.speed = clamp(rider.speed + netAccel * dt, 0, bikeMaxSpeed + 4.0);

  // Re-sync RPM after speed update
  computeGearAndRpm(rider, throttle, 0);

  // 7. Wheelie dynamics in gears 1-2 under hard acceleration
  if (!inHighside && rider.gear <= 2 && throttle > 0.78 && rider.rpm >= 7800 && leanRatio < 0.3 && !rider.offTrack) {
    const gearFactor = rider.gear === 1 ? 0.25 : 0.14;
    const targetWheelie = gearFactor * throttle * clamp((rider.rpm - 7200) / 5200, 0.2, 1.0);
    rider.wheelieAngle += (targetWheelie - rider.wheelieAngle) * Math.min(1, 9.0 * dt);
  } else {
    rider.wheelieAngle += (0 - rider.wheelieAngle) * Math.min(1, 10.0 * dt);
  }

  // 8. Frenet (s, d, psi) kinematics with physical lean-to-curvature relationship:
  //    kappa_bike = (g * tan(lean)) / max(v^2, 36.0) + lowSpeedSteer
  const effSpeedSq = Math.max(rider.speed * rider.speed, 36.0);
  const lowSpeedSteer = rider.speed < 12 ? steer * 0.08 * (1 - rider.speed / 12) : 0;
  const bikeCurvature = (GRAVITY * Math.tan(rider.lean)) / effSpeedSq + lowSpeedSteer;

  const denom = Math.max(0.25, 1.0 - rider.d * trackSample.curvature);
  const sDot = (rider.speed * Math.cos(rider.psi)) / denom;
  const ds = sDot * dt;
  const dd = rider.speed * Math.sin(rider.psi) * dt;
  const dPsi = (rider.speed * bikeCurvature - trackSample.curvature * sDot) * dt;

  const prevS = rider.s;
  const totalLen = track ? track.totalLength : 2000;
  const wrappedNewS = track ? track.wrapS(prevS + ds) : prevS + ds;

  rider.s = wrappedNewS;
  rider.d += dd;
  rider.psi = clamp(wrapAngle(rider.psi + dPsi), -Math.PI / 2.2, Math.PI / 2.2);

  // 9. Soft barrier clamp at ±(halfWidth + 4.5) with psi dampening toward centerline
  const barrierLimit = halfWidth + 4.5;
  if (rider.d > barrierLimit) {
    rider.d = barrierLimit;
    if (rider.psi > 0) rider.psi *= 0.35;
    rider.psi -= 0.25 * dt;
    rider.speed *= 0.985;
  } else if (rider.d < -barrierLimit) {
    rider.d = -barrierLimit;
    if (rider.psi < 0) rider.psi *= 0.35;
    rider.psi += 0.25 * dt;
    rider.speed *= 0.985;
  }

  // 10. Rider-to-rider soft lateral nudge on collision
  if (allRiders && allRiders.length > 1 && track) {
    for (let i = 0; i < allRiders.length; i++) {
      const other = allRiders[i];
      if (!other || other === rider) continue;
      let dsOther = other.s - rider.s;
      if (dsOther > totalLen * 0.5) dsOther -= totalLen;
      if (dsOther < -totalLen * 0.5) dsOther += totalLen;
      const ddOther = other.d - rider.d;
      if (Math.abs(dsOther) < 2.1 && Math.abs(ddOther) < 1.05) {
        const pushDir = ddOther >= 0 ? -1 : 1;
        const overlap = 1.05 - Math.abs(ddOther);
        // A hard AI rider leaning on someone (ai.js shove) barely moves; the rider being shoved takes the push
        const shoveMult = other.shoveTargetId === rider.id ? 4.5 : rider.shoveTargetId === other.id ? 0.25 : 1;
        rider.d += pushDir * overlap * 4.5 * shoveMult * dt;
        if (dsOther > 0 && rider.speed > other.speed) {
          rider.speed = Math.max(other.speed * 0.96, rider.speed - 4.0 * dt);
        }
      }
    }
  }

  // 11. Monotonic checkpointed lap counting & anti-shortcutting
  const newNorm = wrappedNewS / totalLen;
  const crossedFinishForward = prevS > totalLen * 0.7 && wrappedNewS < totalLen * 0.3 && ds > 0;
  const crossedFinishBackward = prevS < totalLen * 0.3 && wrappedNewS > totalLen * 0.7 && ds < 0;

  if (!crossedFinishForward && !crossedFinishBackward && ds >= 0) {
    // Allow monotonic progress along the lap; block jumps >45% from near s=0 (anti-shortcut)
    if (newNorm > rider.maxLapProgress && (newNorm - rider.maxLapProgress < 0.45 || rider.maxLapProgress >= 0.45)) {
      rider.maxLapProgress = newNorm;
    }
  }

  if (!rider.finished) {
    rider.lapTime += dt;
    rider.totalTime += dt;
  }

  if (crossedFinishForward && rider.maxLapProgress >= 0.7) {
    if (!rider.finished) {
      rider.lastLapTime = rider.lapTime;
      if (rider.bestLapTime === null || rider.lapTime < rider.bestLapTime) {
        rider.bestLapTime = rider.lapTime;
      }
      rider.lapTime = 0;
      rider.lap += 1;
      rider.maxLapProgress = newNorm;
      if (rider.lap > targetLaps) {
        rider.finished = true;
      }
    } else {
      rider.lap += 1;
      rider.maxLapProgress = newNorm;
    }
  }

  rider.totalProgress = (rider.lap - 1) * totalLen + rider.s;
  rider.totalDistance = rider.totalProgress;

  // 12. Update 3D world pose
  if (track) {
    const worldPose = track.frenetToWorld(rider.s, rider.d, rider.psi);
    rider.world.x = worldPose.x;
    rider.world.y = worldPose.y;
    rider.world.z = worldPose.z;
    rider.world.heading = worldPose.heading;
    rider.world.pitch = worldPose.pitch + rider.wheelieAngle;
    rider.world.roll = rider.lean;
  }

  return rider;
}

export function rankRiders(riders = []) {
  let nextFinishPos = 1;
  for (let i = 0; i < riders.length; i++) {
    if (riders[i].finished && riders[i].finishPosition != null) {
      nextFinishPos = Math.max(nextFinishPos, riders[i].finishPosition + 1);
    }
  }
  for (let i = 0; i < riders.length; i++) {
    if (riders[i].finished && riders[i].finishPosition == null) {
      riders[i].finishPosition = nextFinishPos++;
    }
  }

  riders.sort((a, b) => {
    if (a.finished !== b.finished) {
      return a.finished ? -1 : 1;
    }
    if ((b.totalDistance ?? 0) !== (a.totalDistance ?? 0)) {
      return (b.totalDistance ?? 0) - (a.totalDistance ?? 0);
    }
    if (a.finished && b.finished && a.finishPosition != null && b.finishPosition != null) {
      return a.finishPosition - b.finishPosition;
    }
    return (a.totalTime ?? 0) - (b.totalTime ?? 0);
  });

  for (let i = 0; i < riders.length; i++) {
    riders[i].position = i + 1;
  }

  return riders;
}
