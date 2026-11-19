// Pure JS AI Rider Controller for 1990 500cc Grand Prix
// Uses lookahead curvature sampling and exact lateral acceleration (d_ddot = g * tan(lean)) control

import { GRAVITY, MAX_LEAN_RAD } from './physics.js';

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

// easy = the original 'Pro 500cc' AI. perfBoost scales the AI bike's engine (physics.js), so medium/hard
// rivals are simply faster; shove lets hard rivals lean on a human rider who is alongside them.
export const DIFFICULTY_PROFILES = {
  easy: {
    speedScale: 0.94,
    maxLeanRatio: 0.64,
    brakeDecel: 14.0,
    throttleAggression: 0.95,
    perfBoost: 1.0,
    shove: false
  },
  medium: {
    speedScale: 1.0,
    maxLeanRatio: 0.70,
    brakeDecel: 15.5,
    throttleAggression: 1.0,
    perfBoost: 1.0,
    shove: false
  },
  hard: {
    speedScale: 1.08,
    maxLeanRatio: 0.74,
    brakeDecel: 16.5,
    throttleAggression: 1.0,
    perfBoost: 1.11,
    shove: true
  }
};

export const DIFFICULTY_KEYS = Object.keys(DIFFICULTY_PROFILES);

export function getDifficultyProfile(key) {
  return DIFFICULTY_PROFILES[String(key || '').toLowerCase()] || DIFFICULTY_PROFILES.easy;
}

// Shove timing (seconds of race time)
const SHOVE_DURATION = 1.4;
const SHOVE_COOLDOWN_MIN = 9;
const SHOVE_COOLDOWN_RANGE = 8;
const SHOVE_CHANCE_PER_SEC = 0.7;

/**
 * Hard AI only: when a human rider is right alongside at speed, sometimes steer into them for a moment.
 * Returns the rider being shoved, or null. Sets rider.shoveTargetId so physics.js gives the push to the human.
 */
function chooseShoveTarget(rider, track, allRiders, dt) {
  const now = rider.totalTime || 0;
  if (rider.shoveTargetId && now < (rider.shoveUntil || 0)) {
    const target = allRiders.find((o) => o && o.id === rider.shoveTargetId);
    if (target && !target.finished) return target;
  }
  if (rider.shoveTargetId) {
    rider.shoveTargetId = null;
    rider.shoveCooldownUntil = now + SHOVE_COOLDOWN_MIN + Math.random() * SHOVE_COOLDOWN_RANGE;
  }
  if (now < (rider.shoveCooldownUntil || 0) || rider.speed < 25 || rider.finished) return null;

  for (const other of allRiders) {
    if (!other || other === rider || other.isAI || other.finished || other.offTrack) continue;
    const ds = track.wrapS(other.s - rider.s);
    const dsSigned = ds > track.totalLength / 2 ? ds - track.totalLength : ds;
    const dd = Math.abs(other.d - rider.d);
    if (Math.abs(dsSigned) < 3.5 && dd > 0.9 && dd < 3.2 && Math.random() < SHOVE_CHANCE_PER_SEC * dt) {
      rider.shoveTargetId = other.id;
      rider.shoveUntil = now + SHOVE_DURATION;
      return other;
    }
  }
  return null;
}

export function computeAIInput(rider, track, allRiders = [], difficulty = 'easy', dt = 1 / 120) {
  if (!track || !rider) {
    return { throttle: 0, brake: 0, steer: 0, tuck: false };
  }

  const profile = getDifficultyProfile(difficulty || rider.difficulty);

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

  let shoving = false;
  if (profile.shove && allRiders && allRiders.length > 1) {
    const victim = chooseShoveTarget(rider, track, allRiders, dt);
    if (victim) {
      shoving = true;
      // Aim just past the victim's line and hold their speed, so the bikes stay side by side and touch
      const side = Math.sign(victim.d - rider.d) || 1;
      targetD = clamp(victim.d + side * 0.4, -(halfW - 0.5), halfW - 0.5);
      const ds = track.wrapS(victim.s - rider.s);
      const victimAhead = ds > track.totalLength / 2 ? ds - track.totalLength : ds;
      targetSpeed = Math.min(targetSpeed, clamp(victim.speed + victimAhead * 0.8, 16.0, maxBikeSpeed));
    }
  } else if (rider.shoveTargetId) {
    rider.shoveTargetId = null;
  }

  // 3. Exact physical lateral controller:
  //    d_dot = v * sin(psi), d_ddot = g * tan(lean) - (v^2 * curvature / denom)
  const dError = rider.d - targetD;
  const dDot = rider.speed * Math.sin(rider.psi);

  const anticipatedCurvature = 0.4 * sampleNow.curvature + 0.6 * sampleLead.curvature;
  const denom = Math.max(0.5, 1.0 - rider.d * sampleNow.curvature);
  const effSpeedSq = Math.max(rider.speed * rider.speed, 36.0);

  // Critically damped PD feedback on lateral offset d and lateral velocity dDot
  const latAccelFeedback = shoving
    ? clamp(-5.0 * dError - 3.6 * dDot, -9.0, 9.0)
    : clamp(-2.4 * dError - 3.4 * dDot, -6.5, 6.5);
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
