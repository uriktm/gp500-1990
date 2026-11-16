/**
 * Automated Verification Suite for 500cc Grand Prix '90 (gp500-1990)
 * Executable via: node c:\projects\game\gp500-1990\test_gp500.js
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Map bare specifier 'three' to './vendor/three.module.js' in Node.js (matching index.html importmap)
if (typeof registerHooks === 'function') {
  const threeUrl = pathToFileURL(path.join(__dirname, 'vendor', 'three.module.js')).href;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === 'three') {
        return { url: threeUrl, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });
}

let passed = 0;
let failed = 0;
const failures = [];

async function runTest(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  [PASS] ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, err });
    console.error(`  [FAIL] ${name}`);
    console.error(`         ${err && err.stack ? err.stack.split('\n').slice(0, 3).join('\n         ') : err}`);
  }
}

function fetchUrl(port, reqPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: reqPath, timeout: 4000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error(`Timeout fetching ${reqPath}`));
    });
  });
}

async function main() {
  console.log('==========================================================');
  console.log(' 500cc Grand Prix \'90 — Automated Verification Suite');
  console.log('==========================================================\n');

  // ---------------------------------------------------------------------------
  // 1. BIKES MODULE TESTS (bikes.js)
  // ---------------------------------------------------------------------------
  console.log('1. Bike Roster & Timbre Tests (bikes.js)');
  const bikesMod = await import('./bikes.js');
  const { BIKES, getBikeById } = bikesMod;

  await runTest('Exports 4 original 1990 500cc GP bikes without real-world trademarks', () => {
    assert.ok(Array.isArray(BIKES), 'BIKES should be an array');
    assert.equal(BIKES.length, 4, 'BIKES should contain 4 bikes');
    const expectedIds = ['akagi', 'shiden', 'kaze', 'corsa'];
    assert.deepEqual(BIKES.map((b) => b.id), expectedIds);

    const forbidden = /honda|yamaha|suzuki|cagiva|marlboro|lucky\s*strike|rothmans|pepsi/i;
    for (const bike of BIKES) {
      assert.ok(!forbidden.test(bike.name), `Forbidden trademark in bike name: ${bike.name}`);
      assert.ok(!forbidden.test(bike.team), `Forbidden trademark in bike team: ${bike.team}`);
      assert.ok(bike.timbre && bike.timbre.baseFreq > 50, `Bike ${bike.id} missing valid timbre`);
      assert.ok(bike.stats && bike.stats.maxSpeed > 75, `Bike ${bike.id} missing valid stats`);
    }
    assert.equal(getBikeById('kaze').id, 'kaze');
    assert.equal(getBikeById('nonexistent').id, BIKES[0].id);
  });

  // ---------------------------------------------------------------------------
  // 2. TRACK SPLINE & FRENET MATH TESTS (track.js)
  // ---------------------------------------------------------------------------
  console.log('\n2. Track Spline & Frenet Math Tests (track.js)');
  const trackMod = await import('./track.js');
  const { TRACKS, createTrack } = trackMod;

  await runTest('Exports TRACKS metadata and createTrack for sakura, monterey, cathedral', () => {
    assert.ok(Array.isArray(TRACKS) && TRACKS.length >= 3, 'TRACKS should list 3 circuits');
    for (const id of ['sakura', 'monterey', 'cathedral']) {
      const t = createTrack(id);
      assert.equal(t.id, id);
      assert.ok(t.totalLength > 800, `Track ${id} totalLength (${t.totalLength}) should be > 800m`);
      assert.equal(t.width, 14);
      assert.equal(t.halfWidth, 7);
      assert.ok(Math.abs(t.kerbWidth - 1.6) < 0.2);
    }
  });

  for (const trackId of ['sakura', 'monterey', 'cathedral']) {
    const track = createTrack(trackId);

    await runTest(`[${trackId}] Closed loop continuity at s=0 vs s=totalLength`, () => {
      const s0 = track.sampleAtS(0);
      const sEnd = track.sampleAtS(track.totalLength);
      const distWrap = Math.hypot(s0.x - sEnd.x, s0.y - sEnd.y, s0.z - sEnd.z);
      assert.ok(distWrap < 0.05, `Start and wrapped end should match closely, got dist=${distWrap}`);

      const sNearEnd = track.sampleAtS(track.totalLength - 0.5);
      const distStep = Math.hypot(s0.x - sNearEnd.x, s0.y - sNearEnd.y, s0.z - sNearEnd.z);
      assert.ok(distStep < 1.0, `s=totalLength-0.5 should be within 1.0m of s=0, got ${distStep}`);

      const dotTangent = s0.tx * sNearEnd.tx + s0.ty * sNearEnd.ty + s0.tz * sNearEnd.tz;
      assert.ok(dotTangent > 0.995, `Tangent continuity across s=0 failed: dot=${dotTangent}`);
    });

    await runTest(`[${trackId}] Uniform arc-length parameterization & finite curvature`, () => {
      const numSteps = 250;
      const ds = track.totalLength / numSteps;
      let prev = track.sampleAtS(0);

      for (let i = 1; i <= numSteps; i++) {
        const s = (i < numSteps) ? i * ds : track.totalLength - 1e-4;
        const curr = track.sampleAtS(s);
        const chord = Math.hypot(curr.x - prev.x, curr.y - prev.y, curr.z - prev.z);

        // Chord length should be very close to arc-length step ds
        assert.ok(
          Math.abs(chord - ds) < ds * 0.12,
          `Arc-length non-uniform at s=${s.toFixed(1)}: chord=${chord.toFixed(3)}, ds=${ds.toFixed(3)}`
        );

        assert.ok(Number.isFinite(curr.curvature), `Curvature not finite at s=${s}`);
        assert.ok(Number.isFinite(curr.pitch), `Pitch not finite at s=${s}`);

        // Verify Frenet denominator 1 - d * curvature > 0.4 at track edges
        const denomLeft = 1 - (-track.halfWidth) * curr.curvature;
        const denomRight = 1 - track.halfWidth * curr.curvature;
        assert.ok(
          denomLeft > 0.35 && denomRight > 0.35,
          `Curvature too tight at s=${s.toFixed(1)}: curvature=${curr.curvature.toFixed(4)}`
        );

        // Verify right-hand normal is perpendicular to tangent in XZ plane
        const dotTN = curr.tx * curr.nx + curr.tz * curr.nz;
        assert.ok(Math.abs(dotTN) < 1e-2, `Normal not orthogonal to tangent at s=${s}: dot=${dotTN}`);

        prev = curr;
      }
    });

    await runTest(`[${trackId}] frenetToWorld(s, d) lateral offset accuracy`, () => {
      for (let s = 0; s < track.totalLength; s += track.totalLength / 20) {
        const sample = track.sampleAtS(s);
        const center = track.frenetToWorld(s, 0);
        const right5 = track.frenetToWorld(s, 5);
        const left5 = track.frenetToWorld(s, -5);

        assert.ok(Math.hypot(center.x - sample.x, center.y - sample.y, center.z - sample.z) < 1e-4);

        const distRight = Math.hypot(right5.x - center.x, right5.z - center.z);
        const distLeft = Math.hypot(left5.x - center.x, left5.z - center.z);
        assert.ok(Math.abs(distRight - 5) < 1e-2, `Expected 5m right offset, got ${distRight}`);
        assert.ok(Math.abs(distLeft - 5) < 1e-2, `Expected 5m left offset, got ${distLeft}`);

        // Vector from center to right5 should align with right-hand normal (nx, nz)
        const dx = (right5.x - center.x) / 5;
        const dz = (right5.z - center.z) / 5;
        const align = dx * sample.nx + dz * sample.nz;
        assert.ok(align > 0.999, `frenetToWorld(s, +5) does not align with right normal: align=${align}`);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 3. PHYSICS & SIMCADE TESTS (physics.js)
  // ---------------------------------------------------------------------------
  console.log('\n3. Physics & Simcade Tests (physics.js)');
  const physicsMod = await import('./physics.js');
  const {
    FIXED_DT,
    GRAVITY,
    MAX_LEAN_RAD,
    createRiderState,
    stepRiderPhysics,
    rankRiders,
  } = physicsMod;

  const sakura = createTrack('sakura');

  await runTest('Exports FIXED_DT=1/120, GRAVITY=9.81, MAX_LEAN_RAD=55deg, and complete rider state', () => {
    assert.ok(Math.abs(FIXED_DT - 1 / 120) < 1e-6);
    assert.ok(Math.abs(GRAVITY - 9.81) < 1e-3);
    assert.ok(Math.abs(MAX_LEAN_RAD - (55 * Math.PI) / 180) < 1e-4);

    const r = createRiderState({ id: 'p1', name: 'Player 1', bikeId: 'akagi', s: 0, d: 0 });
    const requiredKeys = [
      'id', 'name', 'isAI', 'playerIndex', 'bike', 's', 'd', 'psi', 'speed', 'rpm', 'gear',
      'shiftTimer', 'lean', 'leanRate', 'throttle', 'brake', 'steer', 'tuck', 'rearSlip',
      'highsideTimer', 'wheelieAngle', 'slipstreamBoost', 'onKerb', 'offTrack', 'lap',
      'totalProgress', 'maxLapProgress', 'lapTime', 'lastLapTime', 'bestLapTime', 'totalTime',
      'finished', 'finishPosition', 'position', 'totalDistance', 'world',
    ];
    for (const k of requiredKeys) {
      assert.ok(k in r, `Rider state missing property '${k}'`);
    }
  });

  await runTest('Fixed-timestep acceleration, automatic 6-speed upshifting & downshifting, and 2-stroke powerband', () => {
    const rider = createRiderState({ id: 'test_accel', bike: BIKES[0], s: 20, d: 0 });
    assert.equal(rider.gear, 1);

    const gearsSeen = new Set([rider.gear]);
    let inPowerbandSteps = 0;

    // Straight-line top-speed acceleration pull for 16 seconds on level straight (s=20, d=0, psi=0)
    for (let i = 0; i < 16 * 120; i++) {
      rider.s = 20;
      rider.d = 0;
      rider.psi = 0;
      stepRiderPhysics(rider, { throttle: 1, brake: 0, steer: 0, tuck: true }, sakura, [rider], FIXED_DT, 3);
      gearsSeen.add(rider.gear);
      if (rider.rpm >= 8500 && rider.rpm <= 12500) {
        inPowerbandSteps++;
      }
    }

    assert.ok(rider.speed > 75, `Expected rider to accelerate > 75 m/s (270 km/h), got ${rider.speed.toFixed(2)}`);
    assert.equal(rider.gear, 6, `Expected automatic upshift to gear 6, got gear=${rider.gear}`);
    assert.equal(gearsSeen.size, 6, `Expected sequential upshifts through all 6 gears, saw: ${[...gearsSeen].join(',')}`);
    assert.ok(inPowerbandSteps > 200, `Expected rider RPM to operate in 2-stroke powerband (8500-12500 RPM)`);

    // Verify 2-stroke powerband boost: acceleration at 10,500 RPM (in powerband) > acceleration at 5,000 RPM (below band)
    const riderLowRpm = createRiderState({ id: 'low_rpm', bike: BIKES[0], s: 20, d: 0 });
    riderLowRpm.gear = 3;
    riderLowRpm.speed = 26; // ~5,000 RPM in 3rd gear
    stepRiderPhysics(riderLowRpm, { throttle: 1, brake: 0, steer: 0, tuck: true }, sakura, [riderLowRpm], FIXED_DT, 3);
    const dvLow = riderLowRpm.speed - 26;

    const riderBandRpm = createRiderState({ id: 'band_rpm', bike: BIKES[0], s: 20, d: 0 });
    riderBandRpm.gear = 3;
    riderBandRpm.speed = 48; // ~10,400 RPM in 3rd gear (inside powerband despite higher aero drag!)
    stepRiderPhysics(riderBandRpm, { throttle: 1, brake: 0, steer: 0, tuck: true }, sakura, [riderBandRpm], FIXED_DT, 3);
    const dvBand = riderBandRpm.speed - 48;
    assert.ok(dvBand > dvLow, `Expected 2-stroke powerband surge (dv=${dvBand.toFixed(4)}) > off-pipe low RPM (dv=${dvLow.toFixed(4)})`);

    // Now brake hard for 5 seconds on the straight and verify automatic downshifting to 1st gear
    const peakSpeed = rider.speed;
    const peakGear = rider.gear;
    for (let i = 0; i < 5 * 120; i++) {
      rider.s = 20;
      rider.d = 0;
      rider.psi = 0;
      stepRiderPhysics(rider, { throttle: 0, brake: 1, steer: 0, tuck: false }, sakura, [rider], FIXED_DT, 3);
    }

    assert.ok(rider.speed < peakSpeed * 0.2, `Expected braking to reduce speed significantly (${peakSpeed} -> ${rider.speed})`);
    assert.ok(rider.gear < peakGear && rider.gear === 1, `Expected automatic downshift to gear 1, got ${rider.gear}`);
  });

  await runTest('Lean-to-curvature physics (tan(theta) = v^2 / (g*r)): matched lean holds line vs zero lean drifts wide', () => {
    // Find a clear corner on Sakura with |curvature| >= 0.008
    let cornerS = 0;
    for (let s = 50; s < sakura.totalLength - 100; s += 5) {
      const smp = sakura.sampleAtS(s);
      if (Math.abs(smp.curvature) >= 0.008) {
        cornerS = s;
        break;
      }
    }
    assert.ok(cornerS > 0, 'Could not find a corner with |curvature| >= 0.008 on sakura');

    const testSpeed = 32; // m/s (~115 km/h)
    const startSample = sakura.sampleAtS(cornerS);
    const startIdealLean = Math.atan((startSample.curvature * testSpeed * testSpeed) / GRAVITY);

    // Rider A: matches lean angle to track curvature
    const riderMatched = createRiderState({ id: 'matched', bike: BIKES[0], s: cornerS, d: 0 });
    riderMatched.speed = testSpeed;
    riderMatched.gear = 3;
    riderMatched.lean = startIdealLean;

    // Rider B: enters same corner at same speed with zero lean (steer = 0)
    const riderNoLean = createRiderState({ id: 'nolean', bike: BIKES[0], s: cornerS, d: 0 });
    riderNoLean.speed = testSpeed;
    riderNoLean.gear = 3;
    riderNoLean.lean = 0;

    // Simulate 1.0 second (120 steps)
    for (let i = 0; i < 120; i++) {
      const smpA = sakura.sampleAtS(riderMatched.s);
      const reqLeanA = Math.atan((smpA.curvature * riderMatched.speed * riderMatched.speed) / GRAVITY);
      // Directly hold equilibrium lean and steer input
      const steerA = Math.max(-1, Math.min(1, reqLeanA / MAX_LEAN_RAD));
      riderMatched.lean = reqLeanA;
      riderMatched.leanRate = 0;
      stepRiderPhysics(riderMatched, { throttle: 0.35, brake: 0, steer: steerA, tuck: false }, sakura, [riderMatched], FIXED_DT, 3);

      stepRiderPhysics(riderNoLean, { throttle: 0.35, brake: 0, steer: 0, tuck: false }, sakura, [riderNoLean], FIXED_DT, 3);
    }

    const driftMatched = Math.abs(riderMatched.d);
    const driftNoLean = Math.abs(riderNoLean.d);

    assert.ok(
      driftMatched < 0.75,
      `Rider with matched lean tan(theta)=v^2/(g*r) should stay near centerline, got |d|=${driftMatched.toFixed(3)}m`
    );
    assert.ok(
      driftNoLean > 2.5 && driftNoLean > driftMatched + 2.0,
      `Rider with zero lean in corner should drift outward significantly, got |d|=${driftNoLean.toFixed(3)}m vs matched=${driftMatched.toFixed(3)}m`
    );
  });

  await runTest('Kerb detection (onKerb) and off-track gravel drag (offTrack when |d| > halfWidth)', () => {
    const kerbRider = createRiderState({ id: 'kerb', bike: BIKES[0], s: 10, d: sakura.halfWidth - 0.4 });
    kerbRider.speed = 40;
    stepRiderPhysics(kerbRider, { throttle: 0.5, brake: 0, steer: 0, tuck: false }, sakura, [kerbRider], FIXED_DT, 3);
    assert.equal(kerbRider.onKerb, true, `Expected onKerb=true at d=${kerbRider.d.toFixed(2)}`);
    assert.equal(kerbRider.offTrack, false, `Expected offTrack=false inside halfWidth`);

    const onTrackRider = createRiderState({ id: 'ontrack', bike: BIKES[0], s: 10, d: 0 });
    onTrackRider.speed = 55;
    onTrackRider.gear = 4;

    const gravelRider = createRiderState({ id: 'gravel', bike: BIKES[0], s: 10, d: sakura.halfWidth + 2.2 });
    gravelRider.speed = 55;
    gravelRider.gear = 4;

    for (let i = 0; i < 60; i++) {
      // Keep d fixed in their respective zones to compare longitudinal drag
      onTrackRider.d = 0;
      onTrackRider.psi = 0;
      gravelRider.d = sakura.halfWidth + 2.2;
      gravelRider.psi = 0;
      stepRiderPhysics(onTrackRider, { throttle: 0.5, brake: 0, steer: 0, tuck: false }, sakura, [onTrackRider], FIXED_DT, 3);
      stepRiderPhysics(gravelRider, { throttle: 0.5, brake: 0, steer: 0, tuck: false }, sakura, [gravelRider], FIXED_DT, 3);
    }

    assert.equal(gravelRider.offTrack, true, 'Expected offTrack=true when |d| > halfWidth');
    assert.ok(
      gravelRider.speed < onTrackRider.speed - 5.0,
      `Expected gravel drag to slow off-track rider (${gravelRider.speed.toFixed(1)} vs ${onTrackRider.speed.toFixed(1)} m/s)`
    );
  });

  await runTest('Simcade mechanics: rearSlip powerslide buildup, highsideTimer trigger, wheelieAngle, and slipstreamBoost', () => {
    // 1. Rear slip buildup & highside trigger when leaning hard at full throttle in powerband
    const slideRider = createRiderState({ id: 'slide', bike: BIKES[1], s: 100, d: 0 });
    slideRider.speed = 42;
    slideRider.gear = 2;
    slideRider.rpm = 10800;
    slideRider.lean = MAX_LEAN_RAD * 0.92;

    let maxSlip = 0;
    let highsideTriggered = false;
    for (let i = 0; i < 360; i++) {
      slideRider.lean = MAX_LEAN_RAD * 0.95;
      slideRider.rpm = 11000;
      slideRider.d = 0;
      stepRiderPhysics(slideRider, { throttle: 1, brake: 0, steer: 1, tuck: false }, sakura, [slideRider], FIXED_DT, 3);
      if (slideRider.rearSlip > maxSlip) maxSlip = slideRider.rearSlip;
      if (slideRider.highsideTimer > 0) {
        highsideTriggered = true;
        break;
      }
    }
    assert.ok(maxSlip > 0.25, `Expected rearSlip buildup at full lean + powerband throttle, got maxSlip=${maxSlip}`);
    assert.ok(highsideTriggered, `Expected highsideTimer > 0 when sustained extreme lean + full throttle pushes rearSlip >= 1.0`);

    // 2. Wheelie angle in low gears under hard acceleration
    const wheelieRider = createRiderState({ id: 'wheelie', bike: BIKES[1], s: 10, d: 0 });
    wheelieRider.gear = 1;
    wheelieRider.speed = 20;
    wheelieRider.rpm = 10500;
    let maxWheelie = 0;
    for (let i = 0; i < 60; i++) {
      stepRiderPhysics(wheelieRider, { throttle: 1, brake: 0, steer: 0, tuck: false }, sakura, [wheelieRider], FIXED_DT, 3);
      if (wheelieRider.wheelieAngle > maxWheelie) maxWheelie = wheelieRider.wheelieAngle;
    }
    assert.ok(maxWheelie > 0.01, `Expected wheelieAngle > 0 in 1st gear powerband, got ${maxWheelie}`);

    // 3. Slipstream boost when drafting behind another rider
    const leader = createRiderState({ id: 'leader', bike: BIKES[0], s: 150, d: 0 });
    leader.speed = 60;
    const drafter = createRiderState({ id: 'drafter', bike: BIKES[0], s: 132, d: 0.2 });
    drafter.speed = 60;
    drafter.gear = 5;

    stepRiderPhysics(drafter, { throttle: 1, brake: 0, steer: 0, tuck: true }, sakura, [leader, drafter], FIXED_DT, 3);
    assert.ok(drafter.slipstreamBoost > 0, `Expected slipstreamBoost > 0 when drafting 18m behind leader, got ${drafter.slipstreamBoost}`);
  });

  await runTest('Lap counting & anti-shortcutting protection', () => {
    // Anti-shortcutting: rider near s=0 who has NOT completed the lap sectors must not increment lap
    const cheatRider = createRiderState({ id: 'cheat', bike: BIKES[0], s: sakura.totalLength - 2, d: 0 });
    cheatRider.speed = 40;
    cheatRider.maxLapProgress = 0.1; // Has not traversed the circuit
    stepRiderPhysics(cheatRider, { throttle: 1, brake: 0, steer: 0, tuck: false }, sakura, [cheatRider], FIXED_DT * 4, 3);
    assert.equal(cheatRider.lap, 1, 'Rider crossing s=0 without completing lap progress must NOT increment lap');

    // Legitimate lap completion: simulate progressing through sectors then crossing finish line
    const legitRider = createRiderState({ id: 'legit', bike: BIKES[0], s: 10, d: 0 });
    legitRider.speed = 50;
    for (const frac of [0.25, 0.5, 0.75, 0.9, 0.995]) {
      legitRider.s = sakura.totalLength * frac;
      stepRiderPhysics(legitRider, { throttle: 1, brake: 0, steer: 0, tuck: false }, sakura, [legitRider], FIXED_DT, 3);
    }
    // Now step across s = totalLength -> 0
    legitRider.s = sakura.totalLength - 1.0;
    legitRider.speed = 60;
    for (let i = 0; i < 10; i++) {
      stepRiderPhysics(legitRider, { throttle: 1, brake: 0, steer: 0, tuck: false }, sakura, [legitRider], FIXED_DT, 3);
    }
    assert.equal(legitRider.lap, 2, `Expected legitimate finish-line crossing to increment lap to 2, got ${legitRider.lap}`);
    assert.ok(legitRider.lastLapTime > 0 && legitRider.bestLapTime > 0, 'Expected lastLapTime and bestLapTime to be recorded');
  });

  await runTest('rankRiders(riders) accurately orders 8 riders by finished state and totalDistance', () => {
    const riders = [];
    for (let i = 0; i < 8; i++) {
      const r = createRiderState({ id: `r${i}`, name: `Rider ${i}`, bike: BIKES[i % 4], s: i * 100, d: 0 });
      r.totalDistance = i * 250;
      riders.push(r);
    }
    // Mark rider 5 as finished 1st, rider 2 as finished 2nd
    riders[5].finished = true;
    riders[5].finishPosition = 1;
    riders[5].totalTime = 120.5;
    riders[2].finished = true;
    riders[2].finishPosition = 2;
    riders[2].totalTime = 122.1;

    const ranked = rankRiders(riders);
    assert.equal(ranked[0].id, 'r5');
    assert.equal(ranked[0].position, 1);
    assert.equal(ranked[1].id, 'r2');
    assert.equal(ranked[1].position, 2);
    // Remaining unfinished riders ordered by descending totalDistance: r7, r6, r4, r3, r1, r0
    assert.equal(ranked[2].id, 'r7');
    assert.equal(ranked[2].position, 3);
    assert.equal(ranked[7].id, 'r0');
    assert.equal(ranked[7].position, 8);
  });

  // ---------------------------------------------------------------------------
  // 4. AI CONTROLLER TESTS (ai.js)
  // ---------------------------------------------------------------------------
  console.log('\n4. AI Controller Full-Lap Simulation Test (ai.js)');
  const aiMod = await import('./ai.js');
  const { computeAIInput } = aiMod;

  await runTest('AI rider completes a full lap around Sakura monotonically within track boundaries', () => {
    const aiRider = createRiderState({ id: 'ai_pro', name: 'AI Pro', isAI: true, bike: BIKES[0], s: 5, d: 0 });
    let prevTotalDist = aiRider.totalDistance;
    let maxAbsD = 0;
    let offTrackSteps = 0;
    const maxSteps = 120 * 110; // up to 110 seconds at 120Hz
    let stepsRun = 0;

    for (let step = 0; step < maxSteps; step++) {
      stepsRun++;
      const input = computeAIInput(aiRider, sakura, [aiRider], 'pro');
      assert.ok(input.throttle >= 0 && input.throttle <= 1, 'Invalid AI throttle');
      assert.ok(input.brake >= 0 && input.brake <= 1, 'Invalid AI brake');
      assert.ok(input.steer >= -1 && input.steer <= 1, 'Invalid AI steer');

      stepRiderPhysics(aiRider, input, sakura, [aiRider], FIXED_DT, 3);

      assert.ok(
        aiRider.totalDistance >= prevTotalDist - 1e-3,
        `AI totalDistance regressed at step ${step}: ${prevTotalDist} -> ${aiRider.totalDistance}`
      );
      prevTotalDist = aiRider.totalDistance;

      if (Math.abs(aiRider.d) > maxAbsD) maxAbsD = Math.abs(aiRider.d);
      if (aiRider.offTrack) offTrackSteps++;

      if (aiRider.lap >= 2) break;
    }

    assert.ok(aiRider.lap >= 2, `AI failed to complete a lap within 110s (reached s=${aiRider.s.toFixed(1)}, lap=${aiRider.lap})`);
    assert.ok(maxAbsD <= sakura.halfWidth + 2.0, `AI strayed too far from track: max |d|=${maxAbsD.toFixed(2)}m`);
    assert.ok(offTrackSteps < stepsRun * 0.05, `AI spent too many steps off-track: ${offTrackSteps}/${stepsRun}`);
  });

  // ---------------------------------------------------------------------------
  // 5. HTTP SERVER, ES MODULES & INPUT/RENDERER INTEGRATION VERIFICATION
  // ---------------------------------------------------------------------------
  console.log('\n5. HTTP Server, ES Module & Input/Renderer Verification');

  await runTest('input.js uses Space / Enter for tuck-in, avoids Shift keys, and maps P1/P2 inputs accurately', async () => {
    const inputSource = fs.readFileSync(path.join(__dirname, 'input.js'), 'utf8');
    assert.ok(/Space/.test(inputSource), 'input.js must support Space for Player 1 tuck-in');
    assert.ok(/Enter/.test(inputSource), 'input.js must support Enter for Player 2 tuck-in');
    assert.ok(!/ShiftLeft|ShiftRight/.test(inputSource), 'input.js must NOT bind ShiftLeft or ShiftRight');

    const inputMod = await import('./input.js');
    const mgr = inputMod.createInputManager();
    mgr.setKeyState('KeyW', true);
    mgr.setKeyState('KeyD', true);
    mgr.setKeyState('Space', true);
    const p1 = mgr.getPlayerInput(0);
    assert.equal(p1.throttle, 1);
    assert.equal(p1.steer, 1);
    assert.equal(p1.tuck, true);

    mgr.setKeyState('ArrowUp', true);
    mgr.setKeyState('ArrowLeft', true);
    mgr.setKeyState('Enter', true);
    const p2 = mgr.getPlayerInput(1);
    assert.equal(p2.throttle, 1);
    assert.equal(p2.steer, -1);
    assert.equal(p2.tuck, true);
    mgr.dispose();
  });

  await runTest('index.html configures <script type="importmap"> for local three.module.js', () => {
    const htmlSource = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    assert.ok(/<script\s+type=["']importmap["']>/i.test(htmlSource), 'index.html missing <script type="importmap">');
    assert.ok(/\.\/vendor\/three\.module\.js/.test(htmlSource), 'index.html importmap must map three to ./vendor/three.module.js');
    assert.ok(/<script\s+type=["']module["']\s+src=["']\.\/game\.js["']><\/script>/i.test(htmlSource), 'index.html missing module script for ./game.js');
  });

  await runTest('vendor/three.module.js and audio.js load cleanly and execute headless scene render', async () => {
    const threeMod = await import('./vendor/three.module.js');
    for (const cls of ['Scene', 'PerspectiveCamera', 'WebGLRenderer', 'Mesh', 'InstancedMesh', 'BoxGeometry', 'Vector3', 'Color']) {
      assert.ok(cls in threeMod, `vendor/three.module.js missing export ${cls}`);
    }
    const renderer = new threeMod.WebGLRenderer({});
    const scene = new threeMod.Scene();
    const cam = new threeMod.PerspectiveCamera(60, 16 / 9, 0.5, 500);
    const inst = new threeMod.InstancedMesh(new threeMod.BoxGeometry(1, 1, 1), new threeMod.MeshLambertMaterial({ color: 0xff0000 }), 4);
    scene.add(inst);
    renderer.setSize(800, 600);
    renderer.setViewport(0, 0, 800, 300);
    renderer.setScissor(0, 0, 800, 300);
    renderer.setScissorTest(true);
    renderer.render(scene, cam);

    const audioMod = await import('./audio.js');
    assert.equal(typeof audioMod.createAudioEngine, 'function', 'audio.js must export createAudioEngine');
    const audio = audioMod.createAudioEngine();
    assert.equal(audio.toggleMute(), true);
    assert.equal(audio.toggleMute(), false);
  });

  await runTest('server.js serves all 11 application & ES module files with 200 OK and valid MIME types', async () => {
    const serverMod = await import('./server.js');
    assert.equal(typeof serverMod.createServer, 'function', 'server.js must export createServer()');

    const srv = serverMod.createServer();
    await new Promise((resolve, reject) => {
      srv.once('error', reject);
      srv.listen(0, '127.0.0.1', resolve);
    });

    const address = srv.address();
    const port = address.port;

    try {
      const filesToCheck = [
        { path: '/index.html', mime: /text\/html/i },
        { path: '/style.css', mime: /text\/css/i },
        { path: '/game.js', mime: /javascript/i },
        { path: '/bikes.js', mime: /javascript/i },
        { path: '/track.js', mime: /javascript/i },
        { path: '/physics.js', mime: /javascript/i },
        { path: '/ai.js', mime: /javascript/i },
        { path: '/input.js', mime: /javascript/i },
        { path: '/renderer.js', mime: /javascript/i },
        { path: '/audio.js', mime: /javascript/i },
        { path: '/vendor/three.module.js', mime: /javascript/i },
      ];

      for (const item of filesToCheck) {
        const res = await fetchUrl(port, item.path);
        assert.equal(res.statusCode, 200, `Expected 200 OK for ${item.path}, got ${res.statusCode}`);
        const contentType = res.headers['content-type'] || '';
        assert.ok(item.mime.test(contentType), `Invalid Content-Type '${contentType}' for ${item.path}`);
        assert.ok(res.body.length > 50, `File ${item.path} returned unexpectedly short body (${res.body.length} bytes)`);
      }
    } finally {
      await new Promise((resolve) => srv.close(resolve));
    }
  });

  // ---------------------------------------------------------------------------
  // 6. MAXIMUM GRAPHICS UPGRADE VERIFICATION (PBR, Textures, Models, Renderer)
  // ---------------------------------------------------------------------------
  console.log('\n6. Maximum Graphics Upgrade Verification (PBR Engine, Textures, Sculpted Models, Renderer)');

  await runTest('PBR WebGL Engine (vendor/three.module.js) exports PBR classes, geometries, lights, and constants', async () => {
    const threeMod = await import('./vendor/three.module.js');
    const requiredExports = [
      'Vector2',
      'CanvasTexture',
      'Texture',
      'TorusGeometry',
      'LatheGeometry',
      'MeshStandardMaterial',
      'MeshPhysicalMaterial',
      'HemisphereLight',
      'RepeatWrapping',
      'PCFSoftShadowMap',
    ];
    for (const exp of requiredExports) {
      assert.ok(exp in threeMod && threeMod[exp] !== undefined, `vendor/three.module.js missing export '${exp}'`);
    }
  });

  await runTest('PBR WebGL Engine geometries populate valid position, normal, and uv Float32BufferAttributes with matching vertex counts', async () => {
    const threeMod = await import('./vendor/three.module.js');
    const {
      Float32BufferAttribute,
      Vector2,
      BoxGeometry,
      CylinderGeometry,
      SphereGeometry,
      PlaneGeometry,
      TorusGeometry,
      LatheGeometry,
    } = threeMod;

    const geometries = [
      { name: 'BoxGeometry', geo: new BoxGeometry(2, 3, 4) },
      { name: 'CylinderGeometry', geo: new CylinderGeometry(0.5, 0.5, 2, 16, 1, false) },
      { name: 'SphereGeometry', geo: new SphereGeometry(1, 16, 12) },
      { name: 'PlaneGeometry', geo: new PlaneGeometry(10, 10, 2, 2) },
      { name: 'TorusGeometry', geo: new TorusGeometry(0.24, 0.095, 12, 24) },
      {
        name: 'LatheGeometry',
        geo: new LatheGeometry([new Vector2(0.05, 0), new Vector2(0.22, 0.3), new Vector2(0.15, 0.6)], 12),
      },
    ];

    for (const { name, geo } of geometries) {
      assert.ok(geo && geo.attributes, `${name} missing attributes object`);
      const pos = geo.attributes.position;
      const norm = geo.attributes.normal;
      const uv = geo.attributes.uv;

      assert.ok(pos instanceof Float32BufferAttribute, `${name}.attributes.position must be a Float32BufferAttribute`);
      assert.ok(norm instanceof Float32BufferAttribute, `${name}.attributes.normal must be a Float32BufferAttribute`);
      assert.ok(uv instanceof Float32BufferAttribute, `${name}.attributes.uv must be a Float32BufferAttribute`);

      assert.equal(pos.itemSize, 3, `${name} position itemSize should be 3`);
      assert.equal(norm.itemSize, 3, `${name} normal itemSize should be 3`);
      assert.equal(uv.itemSize, 2, `${name} uv itemSize should be 2`);

      const posCount = pos.count !== undefined ? pos.count : pos.array.length / pos.itemSize;
      const normCount = norm.count !== undefined ? norm.count : norm.array.length / norm.itemSize;
      const uvCount = uv.count !== undefined ? uv.count : uv.array.length / uv.itemSize;

      assert.ok(posCount > 0, `${name} must have > 0 vertices`);
      assert.equal(normCount, posCount, `${name} normal vertex count (${normCount}) must match position vertex count (${posCount})`);
      assert.equal(uvCount, posCount, `${name} uv vertex count (${uvCount}) must match position vertex count (${posCount})`);
    }
  });

  await runTest('MeshPhysicalMaterial preserves clearcoat, roughness, metalness, map, and polygonOffset', async () => {
    const threeMod = await import('./vendor/three.module.js');
    const mockTex = new threeMod.CanvasTexture({ width: 64, height: 64 });
    const mat = new threeMod.MeshPhysicalMaterial({
      color: 0xd91424,
      clearcoat: 1.0,
      roughness: 0.15,
      metalness: 0.25,
      map: mockTex,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });

    assert.equal(mat.clearcoat, 1.0, 'MeshPhysicalMaterial did not preserve clearcoat');
    assert.equal(mat.roughness, 0.15, 'MeshPhysicalMaterial did not preserve roughness');
    assert.equal(mat.metalness, 0.25, 'MeshPhysicalMaterial did not preserve metalness');
    assert.equal(mat.map, mockTex, 'MeshPhysicalMaterial did not preserve map');
    assert.equal(mat.polygonOffset, true, 'MeshPhysicalMaterial did not preserve polygonOffset');
  });

  await runTest('Procedural Textures (textures.js) createTextureSet() and createBikeLiveryTexture() return valid textures', async () => {
    const texturesMod = await import('./textures.js');
    const { createTextureSet, createBikeLiveryTexture } = texturesMod;
    assert.equal(typeof createTextureSet, 'function', 'textures.js must export createTextureSet');
    assert.equal(typeof createBikeLiveryTexture, 'function', 'textures.js must export createBikeLiveryTexture');

    const texSet = createTextureSet();
    assert.ok(texSet && typeof texSet === 'object', 'createTextureSet() must return an object');

    const requiredTexKeys = [
      'asphalt',
      'kerbRedWhite',
      'gravel',
      'grass',
      'startFinish',
      'crowd',
      'carbon',
      'brakeDisc',
    ];
    for (const key of requiredTexKeys) {
      assert.ok(texSet[key] && typeof texSet[key] === 'object', `textureSet missing valid texture for '${key}'`);
      assert.ok(texSet[key].image, `textureSet.${key} missing image backing`);
    }

    assert.ok(Array.isArray(texSet.banners) && texSet.banners.length >= 4, 'textureSet.banners must be an array of at least 4 textures');
    for (const bannerTex of texSet.banners) {
      assert.ok(bannerTex && bannerTex.image, 'Each banner in textureSet.banners must be a valid texture with image');
    }

    const livery = createBikeLiveryTexture(BIKES[0]);
    assert.ok(livery && typeof livery === 'object' && livery.image, 'createBikeLiveryTexture(BIKES[0]) must return a valid texture object');
  });

  await runTest('3D Sculpted Bike & Rider Models (models.js) build hierarchical rig and animate wheel spin, knee-down lean, and contact shadow', async () => {
    const texturesMod = await import('./textures.js');
    const modelsMod = await import('./models.js');
    const { createDetailedBikeRig, updateDetailedBikeRig } = modelsMod;

    assert.equal(typeof createDetailedBikeRig, 'function', 'models.js must export createDetailedBikeRig');
    assert.equal(typeof updateDetailedBikeRig, 'function', 'models.js must export updateDetailedBikeRig');

    const textures = texturesMod.createTextureSet();
    const livery = texturesMod.createBikeLiveryTexture(BIKES[0]);
    const rider = createRiderState({ id: 'model_rider', name: 'Rider 1', bike: BIKES[0], s: 100, d: 0 });

    const rig = createDetailedBikeRig(rider, textures, livery);
    const requiredRigParts = [
      'rootGroup',
      'pitchGroup',
      'leanGroup',
      'frontWheelGroup',
      'rearWheelGroup',
      'riderBody',
      'contactShadow',
      'leftLegPivot',
      'rightLegPivot',
    ];
    for (const part of requiredRigParts) {
      assert.ok(rig[part] && typeof rig[part] === 'object', `Detailed bike rig missing part '${part}'`);
    }

    // Configure rider in fast knee-down cornering state
    rider.speed = 48;
    rider.lean = 0.85;
    rider.tuck = true;
    rider.brake = 0.25;
    rider.wheelieAngle = 0.04;
    rider.world = { x: 120, y: 1.5, z: -40, heading: 0.6, pitch: 0.02, roll: 0.85 };

    const initialFrontSpin = rig.frontWheelGroup.rotation.z;
    const initialRearSpin = rig.rearWheelGroup.rotation.z;

    updateDetailedBikeRig(rig, rider, 1 / 60);

    assert.ok(
      rig.frontWheelGroup.rotation.z !== initialFrontSpin || rig.rearWheelGroup.rotation.z !== initialRearSpin,
      'updateDetailedBikeRig should spin frontWheelGroup and rearWheelGroup when speed > 0'
    );
    assert.ok(Math.abs(rig.leanGroup.rotation.x) > 0.1, 'updateDetailedBikeRig should apply bike lean angle to leanGroup');
    assert.ok(rig.contactShadow.position.y >= 0, 'contactShadow should remain positioned on/above the asphalt surface');
  });

  await runTest('Upgraded Renderer (renderer.js) builds all 3 tracks, syncs 8 riders, and renders horizontal & vertical split frames cleanly', async () => {
    const rendererMod = await import('./renderer.js');
    const { createRaceRenderer } = rendererMod;
    assert.equal(typeof createRaceRenderer, 'function', 'renderer.js must export createRaceRenderer');

    const mockCanvas = {
      width: 1280,
      height: 720,
      clientWidth: 1280,
      clientHeight: 720,
      style: {},
      getContext: () => null,
      addEventListener: () => {},
      removeEventListener: () => {},
    };

    const raceRenderer = createRaceRenderer(mockCanvas);
    for (const trackId of ['sakura', 'monterey', 'cathedral']) {
      const trk = createTrack(trackId);
      raceRenderer.buildTrackScene(trk);
    }

    const riders = [];
    for (let i = 0; i < 8; i++) {
      const r = createRiderState({
        id: `rider_${i}`,
        name: `Rider ${i + 1}`,
        isAI: i >= 2,
        playerIndex: i < 2 ? i : -1,
        bike: BIKES[i % BIKES.length],
        s: i * 18,
        d: (i % 2 === 0 ? -1 : 1) * 1.8,
      });
      r.speed = 68;
      r.throttle = 1.0;
      r.rearSlip = i === 0 ? 0.45 : 0.1;
      r.brake = i === 1 ? 0.9 : 0.0;
      r.lean = i === 0 ? 0.85 : -0.3;
      r.onKerb = i === 1;
      stepRiderPhysics(r, { throttle: r.throttle, brake: r.brake, steer: 0.2, tuck: i === 0 }, sakura, [], FIXED_DT, 3);
      riders.push(r);
    }

    raceRenderer.syncRiders(riders);
    raceRenderer.setStartLights(3, false);
    raceRenderer.renderFrame(riders, 'horizontal', 1 / 60);
    raceRenderer.setStartLights(5, true);
    raceRenderer.renderFrame(riders, 'vertical', 1 / 60);
  });

  await runTest('server.js serves textures.js and models.js with 200 OK and application/javascript', async () => {
    const serverMod = await import('./server.js');
    const srv = serverMod.createServer();
    await new Promise((resolve, reject) => {
      srv.once('error', reject);
      srv.listen(0, '127.0.0.1', resolve);
    });

    const port = srv.address().port;
    try {
      for (const reqPath of ['/textures.js', '/models.js']) {
        const res = await fetchUrl(port, reqPath);
        assert.equal(res.statusCode, 200, `Expected 200 OK for ${reqPath}, got ${res.statusCode}`);
        const contentType = res.headers['content-type'] || '';
        assert.ok(/application\/javascript/i.test(contentType), `Expected application/javascript for ${reqPath}, got '${contentType}'`);
        assert.ok(res.body.length > 100, `Expected non-empty JS module body for ${reqPath}`);
      }
    } finally {
      await new Promise((resolve) => srv.close(resolve));
    }
  });

  // ---------------------------------------------------------------------------
  // SUMMARY
  // ---------------------------------------------------------------------------
  console.log('\n==========================================================');
  console.log(` TEST SUMMARY: ${passed} passed, ${failed} failed`);
  console.log('==========================================================');

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Fatal error running test suite:', err);
  process.exit(1);
});
