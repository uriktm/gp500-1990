// Pure JS AI Rider Controller for 1990 500cc Grand Prix
// Uses lookahead curvature sampling and exact lateral acceleration (d_ddot = g * tan(lean)) control

import { GRAVITY, MAX_LEAN_RAD } from './physics.js';

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

const DIFFICULTY_PROFILES = {
  rookie: {
    speedScale: 0.85,
    maxLeanRatio: 0.56,
    brakeDecel: 12.5,
    throttleAggression: 0.85
  },
  pro: {
    speedScale: 0.94,
    maxLeanRatio: 0.64,
    brakeDecel: 14.0,
    throttleAggression: 0.95
  },
  legend: {
    speedScale: 1.0,
    maxLeanRatio: 0.70,
    brakeDecel: 15.5,
    throttleAggression: 1.0
  }
};

export function computeAIInput(rider, track, allRiders = [], difficulty = 'pro') {
  if (!track || !rider) {
    return { throttle: 0, brake: 0, steer: 0, tuck: false };
  }

  const diffKey = String(difficulty || rider.difficulty || 'pro').toLowerCase();
  const profile =
    diffKey.includes('rookie') || diffKey.includes('easy')
      ? DIFFICULTY_PROFILES.rookie
      : diffKey.includes('legend') || diffKey.includes('hard')
      ? DIFFICULTY_PROFILES.legend
      : DIFFICULTY_PROFILES.pro;

  const halfW = track.halfWidth ?? 7.0;
  const maxBikeSpeed = (rider.bike?.stats?.maxSpeed ?? 85.0) * profile.speedScale;
  const maxSafeLean = MAX_LEAN_RAD * profile.maxLeanRatio;
  const tanMaxSafeLean = Math.tan(maxSafeLean);

  // 1. Multi-point lookahead along s (up to 220m ahead) to determine safe cornering & braking speed
  const lookaheads = [0, 6, 14, 24, 36, 50, 68, 90, 115, 145, 180, 220];
  let targetSpeed = maxBikeSpeed;

  for (let i = 0; i < lookaheads.length; i++) {
    const dist = lookaheads[i];
    const sample = track.sampleAtS(rider.s + dist);
    const absK = Math.abs(sample.curvature);
    if (absK > 0.0008) {
      const cornerSafeSpeed = Math.sqrt((GRAVITY * tanMaxSafeLean) / absK);
      const brakeMarginDist = Math.max(0, dist - 18);
      const allowedEntrySpeed = Math.sqrt(
        cornerSafeSpeed * cornerSafeSpeed + 2 * profile.brakeDecel * brakeMarginDist
      );
      if (allowedEntrySpeed < targetSpeed) {
        targetSpeed = allowedEntrySpeed;
      }
    }
  }

  targetSpeed = clamp(targetSpeed, 16.0, maxBikeSpeed);

  // 2. Choose racing line & overtaking lateral offset d
  const sampleNow = track.sampleAtS(rider.s);
  const leadDist = clamp(rider.speed * 0.22, 4.0, 16.0);
  const sampleLead = track.sampleAtS(rider.s + leadDist);

  const baseOffset = clamp(rider.aiLineOffset ?? 0, -1.5, 1.5);
  const apexBias = clamp(sampleLead.curvature * 60.0, -1.0, 1.0);
  let targetD = clamp(baseOffset * 0.4 + apexBias, -(halfW - 3.5), halfW - 3.5);

  // Overtaking avoidance against slower bikes directly ahead
  if (allRiders && allRiders.length > 1) {
    for (let i = 0; i < allRiders.length; i++) {
      const other = allRiders[i];
      if (!other || other === rider) continue;
      const dsAhead = track.wrapS(other.s - rider.s);
      const ddOther = other.d - rider.d;
      if (dsAhead > 0.5 && dsAhead < 20.0 && Math.abs(ddOther) < 1.6) {
        const passSide = other.d > 0 ? -2.0 : 2.0;
        targetD = clamp(other.d + passSide, -(halfW - 3.0), halfW - 3.0);
        break;
      }
    }
  }

  // 3. Exact physical lateral controller:
  //    d_dot = v * sin(psi), d_ddot = g * tan(lean) - (v^2 * curvature / denom)
  const dError = rider.d - targetD;
  const dDot = rider.speed * Math.sin(rider.psi);

  const anticipatedCurvature = 0.4 * sampleNow.curvature + 0.6 * sampleLead.curvature;
  const denom = Math.max(0.5, 1.0 - rider.d * sampleNow.curvature);
  const effSpeedSq = Math.max(rider.speed * rider.speed, 36.0);

  // Critically damped PD feedback on lateral offset d and lateral velocity dDot
  const latAccelFeedback = clamp(-2.4 * dError - 3.4 * dDot, -6.5, 6.5);
  const reqTanLean = (anticipatedCurvature * effSpeedSq) / (GRAVITY * denom) + latAccelFeedback / GRAVITY;
  const idealLean = Math.atan(reqTanLean);

  // Subtle lead compensation for roll damper
  const commandedLean = idealLean + 0.15 * (idealLean - rider.lean) - 0.03 * rider.leanRate;
  const steer = clamp(commandedLean / MAX_LEAN_RAD, -1, 1);

  // 4. Longitudinal throttle, brake, and tuck control
  const speedError = targetSpeed - rider.speed;
  let throttle = 0;
  let brake = 0;

  if (speedError >= -0.6) {
    throttle = clamp(0.35 + speedError * 0.22, 0.15, 1.0) * profile.throttleAggression;
    brake = 0;
  } else {
    throttle = 0;
    brake = clamp((-speedError - 0.6) * 0.18, 0.08, 1.0);
  }

  // Prevent AI highsides by modulating throttle at deep lean angles
  const currentLeanRatio = Math.abs(rider.lean) / MAX_LEAN_RAD;
  if (currentLeanRatio > 0.66) {
    throttle = Math.min(throttle, 0.58);
  }
  if (rider.rearSlip > 0.4) {
    throttle = Math.min(throttle, 0.3);
  }

  const tuck = Math.abs(rider.lean) < 0.2 && brake === 0 && throttle > 0.75 && rider.speed > 42;

  return {
    throttle: clamp(throttle, 0, 1),
    brake: clamp(brake, 0, 1),
    steer,
    tuck
  };
}
