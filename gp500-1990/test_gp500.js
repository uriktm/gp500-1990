/**
 * Automated Verification Suite for 500cc Grand Prix '90 (gp500-1990)
 * Executable via: node c:\projects\game\gp500-1990\test_gp500.js
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Map bare specifier 'three' and 'three/addons/*' to './vendor/...' in Node.js (matching index.html importmap)
if (typeof registerHooks === 'function') {
  const threeUrl = pathToFileURL(path.join(__dirname, 'vendor', 'three.module.js')).href;
  const addonsDir = path.join(__dirname, 'vendor', 'addons');
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === 'three') {
        return { url: threeUrl, shortCircuit: true };
      }
      if (specifier.startsWith('three/addons/')) {
        const subPath = specifier.slice('three/addons/'.length);
        const addonUrl = pathToFileURL(path.join(addonsDir, subPath)).href;
        return { url: addonUrl, shortCircuit: true };
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
        const buffer = Buffer.concat(chunks);
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: buffer.toString('utf8'),
          buffer,
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

  await runTest('Exports TRACKS metadata and createTrack for all five circuits', () => {
    assert.ok(Array.isArray(TRACKS) && TRACKS.length >= 3, 'TRACKS should list 3 circuits');
    for (const id of ['sakura', 'monterey', 'cathedral', 'andalucia', 'basscoast']) {
      const t = createTrack(id);
      assert.equal(t.id, id);
      assert.ok(t.totalLength > 800, `Track ${id} totalLength (${t.totalLength}) should be > 800m`);
      assert.equal(t.width, 14);
      assert.equal(t.halfWidth, 7);
      assert.ok(Math.abs(t.kerbWidth - 1.6) < 0.2);
    }
  });

  for (const trackId of ['sakura', 'monterey', 'cathedral', 'andalucia', 'basscoast']) {
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
    const slideRider = createRiderState({ id: 'slide', bike: BIKES[1], s: 100, d: 0, tractionControl: false });
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

    // 1b. Traction control (default): keyboard full lean + full throttle powerslides but never highsides
    const tcRider = createRiderState({ id: 'tc', bike: BIKES[1], s: 100, d: 0 });
    let tcMaxSlip = 0;
    for (let i = 0; i < 600; i++) {
      tcRider.lean = MAX_LEAN_RAD * 0.95;
      tcRider.rpm = 11000;
      tcRider.speed = 42;
      tcRider.d = 0;
      stepRiderPhysics(tcRider, { throttle: 1, brake: 0, steer: 1, tuck: false }, sakura, [tcRider], FIXED_DT, 3);
      tcMaxSlip = Math.max(tcMaxSlip, tcRider.rearSlip);
      assert.equal(tcRider.highsideTimer, 0, `Traction control should prevent the highside (step ${i}, slip ${tcRider.rearSlip.toFixed(2)})`);
    }
    assert.ok(tcMaxSlip > 0.4 && tcMaxSlip < 0.9, `Expected a controlled powerslide under traction control, got maxSlip=${tcMaxSlip.toFixed(2)}`);

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
      const input = computeAIInput(aiRider, sakura, [aiRider], 'easy');
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

  await runTest('input.js uses Space / Enter for tuck-in, KeyC / Period for camera cycle, avoids Shift/Ctrl/Alt keys, and maps P1/P2 inputs accurately', async () => {
    const inputSource = fs.readFileSync(path.join(__dirname, 'input.js'), 'utf8');
    assert.ok(/Space/.test(inputSource), 'input.js must support Space for Player 1 tuck-in');
    assert.ok(/Enter/.test(inputSource), 'input.js must support Enter for Player 2 tuck-in');
    assert.ok(/KeyC/.test(inputSource), 'input.js must support KeyC for Player 1 camera cycle');
    assert.ok(/Period/.test(inputSource), 'input.js must support Period for Player 2 camera cycle');
    assert.ok(!/ShiftLeft|ShiftRight|ControlLeft|ControlRight|AltLeft|AltRight/.test(inputSource), 'input.js must NOT bind Shift/Ctrl/Alt');

    const inputMod = await import('./input.js');
    const cycledSlots = [];
    const mgr = inputMod.createInputManager({
      onCycleCamera: (slot) => cycledSlots.push(slot),
    });
    mgr.setKeyState('KeyW', true);
    mgr.setKeyState('KeyD', true);
    mgr.setKeyState('Space', true);
    mgr.setKeyState('KeyC', true);
    const p1 = mgr.getPlayerInput(0);
    assert.equal(p1.throttle, 1);
    assert.equal(p1.steer, 1);
    assert.equal(p1.tuck, true);

    mgr.setKeyState('ArrowUp', true);
    mgr.setKeyState('ArrowLeft', true);
    mgr.setKeyState('Enter', true);
    mgr.setKeyState('Period', true);
    const p2 = mgr.getPlayerInput(1);
    assert.equal(p2.throttle, 1);
    assert.equal(p2.steer, -1);
    assert.equal(p2.tuck, true);

    assert.deepEqual(cycledSlots, [0, 1], 'KeyC and Period should trigger camera cycle for slots 0 and 1');
    mgr.dispose();
  });

  await runTest('index.html configures <script type="importmap"> for local three.module.js and three/addons/', () => {
    const htmlSource = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    assert.ok(/<script\s+type=["']importmap["']>/i.test(htmlSource), 'index.html missing <script type="importmap">');
    assert.ok(/\.\/vendor\/three\.module\.js/.test(htmlSource), 'index.html importmap must map three to ./vendor/three.module.js');
    assert.ok(/three\/addons\//.test(htmlSource), 'index.html importmap must map three/addons/ to ./vendor/addons/');
    assert.ok(/<script\s+type=["']module["']\s+src=["']\.\/game\.js["']><\/script>/i.test(htmlSource), 'index.html missing module script for ./game.js');
  });

  await runTest('Official Three.js r170 (vendor/three.module.js) and audio.js load cleanly and construct scene graph', async () => {
    const threeMod = await import('./vendor/three.module.js');
    assert.equal(threeMod.REVISION, '170', `Expected official Three.js r170, got REVISION=${threeMod.REVISION}`);
    for (const cls of [
      'Scene',
      'PerspectiveCamera',
      'WebGLRenderer',
      'Mesh',
      'InstancedMesh',
      'BoxGeometry',
      'ExtrudeGeometry',
      'TubeGeometry',
      'CapsuleGeometry',
      'CatmullRomCurve3',
      'Vector3',
      'Color',
      'ACESFilmicToneMapping',
      'SRGBColorSpace',
    ]) {
      assert.ok(cls in threeMod, `vendor/three.module.js missing export ${cls}`);
    }
    const scene = new threeMod.Scene();
    const cam = new threeMod.PerspectiveCamera(60, 16 / 9, 0.5, 500);
    const inst = new threeMod.InstancedMesh(
      new threeMod.BoxGeometry(1, 1, 1),
      new threeMod.MeshLambertMaterial({ color: 0xff0000 }),
      4
    );
    scene.add(inst);
    scene.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    assert.equal(scene.children.length, 1);

    const audioMod = await import('./audio.js');
    assert.equal(typeof audioMod.createAudioEngine, 'function', 'audio.js must export createAudioEngine');
    const audio = audioMod.createAudioEngine();
    assert.equal(audio.toggleMute(), true);
    assert.equal(audio.toggleMute(), false);
  });

  await runTest('server.js serves all application & ES module files with 200 OK and valid MIME types', async () => {
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
        { path: '/audio-worklet.js', mime: /javascript/i },
        { path: '/textures.js', mime: /javascript/i },
        { path: '/models.js', mime: /javascript/i },
        { path: '/livery.js', mime: /javascript/i },
        { path: '/replay.js', mime: /javascript/i },
        { path: '/championship.js', mime: /javascript/i },
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
  // 6. OFFICIAL THREE.JS R170, TEXTURES, LIVERY, SCULPTED MODELS & RENDERER
  // ---------------------------------------------------------------------------
  console.log('\n6. Official Three.js r170, Textures, Livery, Sculpted Models & Headless Renderer');

  await runTest('PBR WebGL Engine (vendor/three.module.js) exports PBR classes, geometries, lights, and constants', async () => {
    const threeMod = await import('./vendor/three.module.js');
    const requiredExports = [
      'Vector2',
      'CanvasTexture',
      'Texture',
      'TorusGeometry',
      'LatheGeometry',
      'ExtrudeGeometry',
      'TubeGeometry',
      'CapsuleGeometry',
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

  await runTest('PBR WebGL Engine geometries populate valid position, normal, and uv BufferAttributes with matching vertex counts', async () => {
    const threeMod = await import('./vendor/three.module.js');
    const {
      BufferAttribute,
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

      assert.ok(pos instanceof BufferAttribute, `${name}.attributes.position must be a BufferAttribute`);
      assert.ok(norm instanceof BufferAttribute, `${name}.attributes.normal must be a BufferAttribute`);
      assert.ok(uv instanceof BufferAttribute, `${name}.attributes.uv must be a BufferAttribute`);

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

  await runTest('Bike & Rider Livery Generator (livery.js) generates headless-safe fictional liveries for all 4 bikes', async () => {
    const liverySource = fs.readFileSync(path.join(__dirname, 'livery.js'), 'utf8');
    // Verify no real-world motorcycle/sponsor brands are rendered onto liveries
    const codeWithoutComments = liverySource
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    const forbidden = /\b(honda|yamaha|suzuki|cagiva|marlboro|lucky\s*strike|rothmans|pepsi|repsol)\b/i;
    assert.ok(
      !forbidden.test(codeWithoutComments),
      'livery.js must use only fictional brands (Akagi, Shiden, Kaze, Corsa) and never real-world trademarks'
    );

    const liveryMod = await import('./livery.js');
    const createFn =
      liveryMod.createLiverySet ||
      liveryMod.getBikeLivery ||
      liveryMod.createBikeLivery ||
      liveryMod.createBikeLiveryTextures ||
      liveryMod.getLiveryTextures ||
      liveryMod.default;
    assert.equal(typeof createFn, 'function', 'livery.js must export a livery generator function');

    for (const bike of BIKES) {
      const result = createFn(bike, { number: bike.number, name: bike.name });
      assert.ok(result && typeof result === 'object', `livery generator must return an object/texture for ${bike.id}`);
      // Verify either result is a Texture with .image, or an object containing Texture properties (fairing/leathers/helmet/tail)
      if (result.isTexture) {
        assert.ok(result.image && result.image.width > 0, `Texture for ${bike.id} missing image dimensions`);
      } else {
        const texValues = Object.values(result).filter((v) => v && typeof v === 'object' && (v.isTexture || v.image));
        assert.ok(texValues.length >= 1, `Livery bundle for ${bike.id} must contain at least one valid Texture`);
        for (const tex of texValues) {
          assert.ok(tex.image && tex.image.width > 0 && tex.image.height > 0, `Livery texture for ${bike.id} missing valid mock/canvas image dimensions`);
        }
      }
    }
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
      'frontForkGroup',
      'riderBody',
      'torsoGroup',
      'headGroup',
      'leftLegPivot',
      'rightLegPivot',
      'leftArmGroup',
      'rightArmGroup',
      'contactShadow',
      'leftSparkMesh',
      'rightSparkMesh',
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

    const initialFrontSpin = rig.frontWheelGroup.rotation.x + rig.frontWheelGroup.rotation.z;
    const initialRearSpin = rig.rearWheelGroup.rotation.x + rig.rearWheelGroup.rotation.z;

    updateDetailedBikeRig(rig, rider, 1 / 60);

    const afterFrontSpin = rig.frontWheelGroup.rotation.x + rig.frontWheelGroup.rotation.z;
    const afterRearSpin = rig.rearWheelGroup.rotation.x + rig.rearWheelGroup.rotation.z;

    assert.ok(
      afterFrontSpin !== initialFrontSpin || afterRearSpin !== initialRearSpin || rig.wheelAngle !== 0,
      'updateDetailedBikeRig should spin frontWheelGroup and rearWheelGroup when speed > 0'
    );
    assert.ok(
      Math.abs(rig.leanGroup.rotation.x) > 0.1 || Math.abs(rig.leanGroup.rotation.z) > 0.1,
      'updateDetailedBikeRig should apply bike lean angle to leanGroup'
    );
    assert.ok(rig.contactShadow.position.y >= 0, 'contactShadow should remain positioned on/above the asphalt surface');
  });

  await runTest('Headless Renderer (renderer.js) builds all 3 tracks, syncs 8 riders, cycles camera modes (chase/chase-far/helmet), and renders split + TV replay frames cleanly', async () => {
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
    for (const trackId of ['sakura', 'monterey', 'cathedral', 'andalucia', 'basscoast']) {
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

    // Camera modes: 'chase' -> 'chase-far' -> 'helmet'
    assert.equal(typeof raceRenderer.setCameraMode, 'function', 'renderer must expose setCameraMode(slot, mode)');
    assert.equal(typeof raceRenderer.getCameraMode, 'function', 'renderer must expose getCameraMode(slot)');
    assert.equal(raceRenderer.getCameraMode(0), 'chase');
    for (const mode of ['chase-far', 'helmet', 'chase']) {
      raceRenderer.setCameraMode(0, mode);
      assert.equal(raceRenderer.getCameraMode(0), mode, `Expected slot 0 camera mode '${mode}'`);
      raceRenderer.renderFrame(riders, 'horizontal', 1 / 60);
    }

    // Trackside TV replay camera mode
    raceRenderer.renderFrame(riders, 'single', 1 / 60, { tv: true, focusIndex: 0 });
    raceRenderer.renderFrame(riders, 'single', 1 / 60, { tv: true, focusIndex: 1 });
  });

  // ---------------------------------------------------------------------------
  // 7. REPLAY SYSTEM VERIFICATION (replay.js)
  // ---------------------------------------------------------------------------
  console.log('\n7. 60 Hz Replay System Verification (replay.js)');
  const replayMod = await import('./replay.js');
  const { createReplayRecorder, REPLAY_HZ, REPLAY_SPEEDS } = replayMod;

  await runTest('replay.js records 60 Hz rider telemetry during simulation and playback reproduces positions accurately', () => {
    assert.equal(REPLAY_HZ, 60, 'REPLAY_HZ should be 60');
    assert.deepEqual(REPLAY_SPEEDS, [0.25, 0.5, 1, 2], 'REPLAY_SPEEDS must support 0.25x, 0.5x, 1x, 2x');

    const recorder = createReplayRecorder({ hz: 60, maxDuration: 600 });
    recorder.reset({ trackId: 'sakura', trackLength: sakura.totalLength });

    const r1 = createRiderState({ id: 'p1', name: 'Player 1', isAI: false, playerIndex: 0, bike: BIKES[0], s: 18, d: -2.0, track: sakura });
    const r2 = createRiderState({ id: 'p2', name: 'Player 2', isAI: false, playerIndex: 1, bike: BIKES[1], s: 18, d: 2.0, track: sakura });
    const simRiders = [r1, r2];

    const recordedAt1Sec = [];

    // Simulate 3.0 seconds at 120 Hz (360 fixed steps -> ~181 60Hz replay frames)
    for (let step = 0; step < 360; step++) {
      stepRiderPhysics(r1, { throttle: 1, brake: 0, steer: 0.15, tuck: true }, sakura, simRiders, FIXED_DT, 3);
      stepRiderPhysics(r2, { throttle: 0.85, brake: 0, steer: -0.1, tuck: false }, sakura, simRiders, FIXED_DT, 3);
      rankRiders(simRiders);
      recorder.record(simRiders, FIXED_DT);

      if (step === 120) {
        recordedAt1Sec.push(
          { s: r1.s, d: r1.d, speed: r1.speed, lean: r1.lean, x: r1.world.x, z: r1.world.z, position: r1.position },
          { s: r2.s, d: r2.d, speed: r2.speed, lean: r2.lean, x: r2.world.x, z: r2.world.z, position: r2.position }
        );
      }
    }

    const frameCount = recorder.getFrameCount();
    assert.ok(frameCount >= 180 && frameCount <= 182, `Expected ~181 frames for 3.0s at 60Hz, got ${frameCount}`);
    assert.ok(Math.abs(recorder.getDuration() - 3.0) < 0.05, `Expected replay duration ~3.0s, got ${recorder.getDuration()}`);

    // Start playback and seek to t = 1.0s (frame 60)
    recorder.startPlayback();
    const snap1s = recorder.seek(1.0);
    assert.equal(snap1s.length, 2, 'Snapshot at t=1.0s must contain 2 riders');

    assert.ok(Math.abs(snap1s[0].s - recordedAt1Sec[0].s) < 0.5, `P1 replay s (${snap1s[0].s}) should match recorded (${recordedAt1Sec[0].s})`);
    assert.ok(Math.abs(snap1s[0].d - recordedAt1Sec[0].d) < 0.05, `P1 replay d (${snap1s[0].d}) should match recorded (${recordedAt1Sec[0].d})`);
    assert.ok(Math.abs(snap1s[0].speed - recordedAt1Sec[0].speed) < 0.3, `P1 replay speed should match recorded`);
    assert.ok(Math.abs(snap1s[0].world.x - recordedAt1Sec[0].x) < 0.5, `P1 replay world.x should match recorded`);
    assert.ok(Math.abs(snap1s[0].world.z - recordedAt1Sec[0].z) < 0.5, `P1 replay world.z should match recorded`);
    assert.equal(snap1s[0].position, recordedAt1Sec[0].position);

    assert.ok(Math.abs(snap1s[1].s - recordedAt1Sec[1].s) < 0.5, `P2 replay s (${snap1s[1].s}) should match recorded (${recordedAt1Sec[1].s})`);
    assert.equal(snap1s[1].position, recordedAt1Sec[1].position);

    // Verify playback controls: speed cycling, focus cycling (p1/p2/leader), TV/chase cam toggle
    assert.equal(recorder.setSpeed(0.5), 0.5);
    const stepState = recorder.stepPlayback(0.2); // 0.2s * 0.5x = +0.1s -> t = 1.1s
    assert.ok(Math.abs(stepState.currentTime - 1.1) < 1e-4, `Expected playback time 1.1s at 0.5x speed, got ${stepState.currentTime}`);
    assert.equal(stepState.tvMode, true);

    assert.equal(recorder.toggleCameraMode(), 'chase');
    assert.equal(recorder.isTvMode(), false);
    assert.equal(recorder.toggleCameraMode(), 'tv');
    assert.equal(recorder.isTvMode(), true);

    assert.equal(recorder.setFocusMode('p2'), 'p2');
    assert.equal(recorder.stepPlayback(0).focusIndex, 1);
    assert.equal(recorder.setFocusMode('leader'), 'leader');
    assert.equal(recorder.stepPlayback(0).focusIndex, 0);
  });

  // ---------------------------------------------------------------------------
  // 8. CHAMPIONSHIP MODE VERIFICATION (championship.js)
  // ---------------------------------------------------------------------------
  console.log('\n8. 3-Round 1990 500cc Championship Verification (championship.js)');
  const champMod = await import('./championship.js');
  const { createChampionshipManager, CHAMPIONSHIP_POINTS, CHAMPIONSHIP_ROUNDS, getPointsForPosition } = champMod;

  await runTest('championship.js awards 1990 FIM 500cc points (20,17,15,13,11,10,9,8), tracks standings across 3 rounds, and persists to storage', () => {
    assert.deepEqual(CHAMPIONSHIP_POINTS, [20, 17, 15, 13, 11, 10, 9, 8]);
    assert.deepEqual(CHAMPIONSHIP_ROUNDS, ['sakura', 'monterey', 'cathedral']);
    assert.equal(getPointsForPosition(1), 20);
    assert.equal(getPointsForPosition(2), 17);
    assert.equal(getPointsForPosition(3), 15);
    assert.equal(getPointsForPosition(4), 13);
    assert.equal(getPointsForPosition(5), 11);
    assert.equal(getPointsForPosition(6), 10);
    assert.equal(getPointsForPosition(7), 9);
    assert.equal(getPointsForPosition(8), 8);
    assert.equal(getPointsForPosition(9), 0);

    // Mock localStorage to verify save/load/resume/reset
    const mockData = new Map();
    const mockStorage = {
      getItem: (k) => (mockData.has(k) ? mockData.get(k) : null),
      setItem: (k, v) => mockData.set(k, String(v)),
      removeItem: (k) => mockData.delete(k),
    };

    const champ = createChampionshipManager({ storage: mockStorage, storageKey: 'test_champ_1990', autoLoad: false });
    champ.startNewChampionship({ laps: 3, difficulty: 'easy', p1BikeId: 'akagi', p2BikeId: 'shiden' });

    assert.equal(champ.isActive(), true);
    assert.equal(champ.isCompleted(), false);
    assert.equal(champ.getCurrentRoundIndex(), 0);
    assert.equal(champ.getCurrentTrackId(), 'sakura');

    const makeRoundClassification = (orderedIds) =>
      orderedIds.map((id, idx) => ({
        id,
        name: id.toUpperCase(),
        isAI: id !== 'p1' && id !== 'p2',
        playerIndex: id === 'p1' ? 0 : id === 'p2' ? 1 : -1,
        bike: BIKES[idx % BIKES.length],
        finishPosition: idx + 1,
        position: idx + 1,
        totalTime: 120 + idx * 1.5,
      }));

    // Round 1 (Sakura): p1 wins (20), p2 2nd (17), ai1 3rd (15)...
    const r1Summary = champ.recordRoundResult(
      makeRoundClassification(['p1', 'p2', 'ai1', 'ai2', 'ai3', 'ai4', 'ai5', 'ai6'])
    );
    assert.equal(r1Summary.trackId, 'sakura');
    assert.equal(r1Summary.completed, false);
    assert.equal(champ.getCurrentRoundIndex(), 1);
    assert.equal(champ.getCurrentTrackId(), 'monterey');
    assert.equal(champ.canResume(), true);

    // Verify persistence by loading into a second manager instance from the same mockStorage
    const resumedChamp = createChampionshipManager({ storage: mockStorage, storageKey: 'test_champ_1990', autoLoad: true });
    assert.equal(resumedChamp.isActive(), true);
    assert.equal(resumedChamp.getCurrentRoundIndex(), 1);
    assert.equal(resumedChamp.getCurrentTrackId(), 'monterey');
    assert.equal(resumedChamp.getStandings()[0].id, 'p1');
    assert.equal(resumedChamp.getStandings()[0].points, 20);

    // Round 2 (Monterey): p2 wins (20 -> 37), ai1 2nd (17 -> 32), p1 3rd (15 -> 35)
    const r2Summary = resumedChamp.recordRoundResult(
      makeRoundClassification(['p2', 'ai1', 'p1', 'ai2', 'ai3', 'ai4', 'ai5', 'ai6'])
    );
    assert.equal(r2Summary.trackId, 'monterey');
    assert.equal(r2Summary.completed, false);
    assert.equal(resumedChamp.getCurrentRoundIndex(), 2);
    assert.equal(resumedChamp.getCurrentTrackId(), 'cathedral');
    assert.equal(resumedChamp.getStandings()[0].id, 'p2');
    assert.equal(resumedChamp.getStandings()[0].points, 37);
    assert.equal(resumedChamp.getStandings()[1].id, 'p1');
    assert.equal(resumedChamp.getStandings()[1].points, 35);

    // Round 3 (Cathedral): p1 wins (20 -> 55), p2 2nd (17 -> 54), ai1 3rd (15 -> 47)
    const r3Summary = resumedChamp.recordRoundResult(
      makeRoundClassification(['p1', 'p2', 'ai1', 'ai2', 'ai3', 'ai4', 'ai5', 'ai6'])
    );
    assert.equal(r3Summary.trackId, 'cathedral');
    assert.equal(r3Summary.completed, true);
    assert.equal(resumedChamp.isCompleted(), true);
    assert.equal(resumedChamp.canResume(), false);

    const finalStandings = resumedChamp.getStandings();
    assert.equal(finalStandings.length, 8);
    assert.equal(finalStandings[0].id, 'p1');
    assert.equal(finalStandings[0].points, 55); // 20 + 15 + 20
    assert.equal(finalStandings[0].wins, 2);
    assert.equal(finalStandings[1].id, 'p2');
    assert.equal(finalStandings[1].points, 54); // 17 + 20 + 17
    assert.equal(finalStandings[2].id, 'ai1');
    assert.equal(finalStandings[2].points, 47); // 15 + 17 + 15

    const champion = resumedChamp.getChampion();
    assert.equal(champion.id, 'p1');
    assert.equal(champion.points, 55);

    // Reset clears saved championship
    resumedChamp.resetChampionship();
    assert.equal(resumedChamp.hasSavedChampionship(), false);
    assert.equal(resumedChamp.isActive(), false);
  });

  // ---------------------------------------------------------------------------
  // 9. 2-STROKE V4 AUDIO ENGINE & WORKLET DSP VERIFICATION
  // ---------------------------------------------------------------------------
  console.log('\n9. 2-Stroke V4 Audio Engine & Worklet DSP Verification (audio.js, audio-worklet.js)');

  await runTest('audio-worklet.js defines TwoStrokeV4Processor with required AudioParams and SVF stability guards', async () => {
    const workletSrc = fs.readFileSync(path.join(__dirname, 'audio-worklet.js'), 'utf8');
    assert.ok(
      /registerProcessor\s*\(\s*['"]two-stroke-v4-processor['"]/.test(workletSrc),
      'audio-worklet.js must register two-stroke-v4-processor'
    );
    for (const param of ['rpm', 'throttle', 'speed', 'shiftCut', 'crankPattern', 'pipeFreqBase', 'dopplerRatio']) {
      assert.ok(workletSrc.includes(`'${param}'`), `audio-worklet.js missing parameterDescriptor '${param}'`);
    }

    // Evaluate processor class in a tiny mock AudioWorkletGlobalScope to exercise sample generation
    const registered = {};
    const fn = new Function(
      'AudioWorkletProcessor',
      'registerProcessor',
      'sampleRate',
      workletSrc + '\nreturn TwoStrokeV4Processor;'
    );
    class MockWorkletBase {
      constructor() {}
    }
    const ProcClass = fn(
      MockWorkletBase,
      (name, cls) => {
        registered[name] = cls;
      },
      48000
    );
    assert.ok(registered['two-stroke-v4-processor'], 'Processor failed to register in mock scope');

    const proc = new ProcClass();
    const outBlock = new Float32Array(128);
    // Test idle -> high-RPM powerband -> closed-throttle overrun -> quickshifter cut
    const scenarios = [
      { rpm: 4200, throttle: 0.0, speed: 0, shiftCut: 0, pattern: 0 },
      { rpm: 11800, throttle: 1.0, speed: 78, shiftCut: 0, pattern: 1 },
      { rpm: 9600, throttle: 0.0, speed: 62, shiftCut: 0, pattern: 2 },
      { rpm: 12200, throttle: 1.0, speed: 80, shiftCut: 1, pattern: 3 },
    ];
    for (const sc of scenarios) {
      let peak = 0;
      for (let b = 0; b < 6; b++) {
        proc.process(
          [],
          [[outBlock]],
          {
            rpm: [sc.rpm],
            throttle: [sc.throttle],
            speed: [sc.speed],
            shiftCut: [sc.shiftCut],
            crankPattern: [sc.pattern],
            pipeFreqBase: [110],
            harmonicRatio: [2.0],
            filterResBase: [1350],
            dopplerRatio: [1.05],
          }
        );
        for (let i = 0; i < outBlock.length; i++) {
          assert.ok(Number.isFinite(outBlock[i]), `Non-finite DSP sample produced at rpm=${sc.rpm}`);
          const a = Math.abs(outBlock[i]);
          if (a > peak) peak = a;
        }
      }
      if (sc.shiftCut === 0) {
        assert.ok(peak > 1e-4, `Expected audible DSP signal for rpm=${sc.rpm} throttle=${sc.throttle}, got peak=${peak}`);
      }
    }
  });

  await runTest('audio.js builds compressor, noise layers, rival Doppler voice, and shift/road transients cleanly', async () => {
    const audioMod = await import('./audio.js');
    const makeParam = (val = 0) => ({
      value: val,
      setValueAtTime(v) { this.value = v; },
      setTargetAtTime(v) { this.value = v; },
      exponentialRampToValueAtTime(v) { this.value = v; },
    });

    let compressorCreated = 0;
    let periodicWaveCreated = 0;
    let pannerCreated = 0;
    const buffersCreated = [];
    const createdPanners = [];

    class MockAudioContext {
      constructor() {
        this.sampleRate = 44100;
        this.currentTime = 1.0;
        this.state = 'running';
        this.destination = {};
        this.audioWorklet = {
          addModule: () => Promise.reject(new Error('No worklet in Node mock')),
        };
      }
      resume() { return Promise.resolve(); }
      close() { return Promise.resolve(); }
      createGain() { return { gain: makeParam(1), connect() {} }; }
      createDynamicsCompressor() {
        compressorCreated++;
        return {
          threshold: makeParam(-14),
          knee: makeParam(12),
          ratio: makeParam(4.5),
          attack: makeParam(0.004),
          release: makeParam(0.14),
          connect() {},
        };
      }
      createStereoPanner() {
        pannerCreated++;
        const p = { pan: makeParam(0), connect() {} };
        createdPanners.push(p);
        return p;
      }
      createBuffer(ch, len, sr) {
        const arr = new Float32Array(len);
        const buf = { numberOfChannels: ch, length: len, sampleRate: sr, getChannelData: () => arr };
        buffersCreated.push(buf);
        return buf;
      }
      createPeriodicWave() {
        periodicWaveCreated++;
        return {};
      }
      createOscillator() {
        return {
          type: 'sine',
          frequency: makeParam(440),
          setPeriodicWave() {},
          connect() {},
          start() {},
          stop() {},
        };
      }
      createBufferSource() {
        return { buffer: null, loop: false, connect() {}, start() {}, stop() {} };
      }
      createBiquadFilter() {
        return { type: 'lowpass', frequency: makeParam(1000), Q: makeParam(1), connect() {} };
      }
      createWaveShaper() {
        return { curve: null, oversample: 'none', connect() {} };
      }
    }

    const prevWindow = globalThis.window;
    globalThis.window = {
      AudioContext: MockAudioContext,
      addEventListener() {},
      removeEventListener() {},
    };

    try {
      const audio = audioMod.createAudioEngine();
      assert.equal(audio.init(), true, 'audio.init() should succeed with mock AudioContext');
      const dbg = audio.getDebugState();
      assert.equal(dbg.ready, true);
      assert.equal(dbg.voiceCount, 2);
      assert.equal(dbg.hasRivalVoice, true);
      assert.equal(compressorCreated, 1, 'Expected master DynamicsCompressorNode');
      assert.equal(periodicWaveCreated, 4, 'Expected 4 custom PeriodicWaves for 1990 V4 bikes');
      assert.ok(pannerCreated >= 3, 'Expected StereoPannerNodes for P1, P2, and rival pass-by');
      assert.equal(buffersCreated.length, 1, 'Expected shared 2s noise buffer');

      const r1 = createRiderState({ id: 'p1', isAI: false, playerIndex: 0, bike: BIKES[0], s: 100, d: -1.0, track: sakura });
      const r2 = createRiderState({ id: 'p2', isAI: false, playerIndex: 1, bike: BIKES[1], s: 102, d: 1.5, track: sakura });
      const rAi = createRiderState({ id: 'ai1', isAI: true, bike: BIKES[2], s: 112, d: -0.5, track: sakura });

      r1.rpm = 11200; r1.throttle = 1.0; r1.speed = 68; r1.gear = 5; r1.rearSlip = 0.65; r1.onKerb = true;
      r2.rpm = 9400; r2.throttle = 0.0; r2.speed = 55; r2.gear = 4; r2.offTrack = true; r2.tuck = true;
      rAi.rpm = 12000; rAi.throttle = 1.0; rAi.speed = 76; rAi.gear = 6;

      audio.update([r1, r2, rAi], { splitMode: 'vertical' });
      assert.ok(createdPanners[0].pan.value < 0, 'Vertical split should pan P1 slightly left');
      assert.ok(createdPanners[1].pan.value > 0, 'Vertical split should pan P2 slightly right');

      // Gear upshift + horizontal split centering
      r1.gear = 6;
      audio.update([r1, r2, rAi], { splitMode: 'horizontal' });
      assert.equal(createdPanners[0].pan.value, 0, 'Horizontal split should center P1');
      assert.equal(createdPanners[1].pan.value, 0, 'Horizontal split should center P2');

      audio.playStartBeep(false);
      audio.playStartBeep(true);
      audio.silence();
      audio.dispose();
    } finally {
      if (prevWindow === undefined) delete globalThis.window;
      else globalThis.window = prevWindow;
    }
  });

  // ---------------------------------------------------------------------------
  // 10. WEBSITE SHOWCASE, 3D SHOWROOM, BLENDER GLB ASSETS & PACKAGING
  // ---------------------------------------------------------------------------
  console.log('\n10. Website Showcase, 3D Showroom, Blender GLB Assets & Packaging Verification');

  await runTest('Blender GLB assets (paddock_stage.glb & champion_trophy.glb) exist with valid glTF binary headers', () => {
    const glbFiles = ['paddock_stage.glb', 'champion_trophy.glb'];
    let combinedBytes = 0;

    for (const file of glbFiles) {
      const fullPath = path.join(__dirname, 'assets', 'showcase', file);
      assert.ok(fs.existsSync(fullPath), `Missing GLB showcase asset: ${fullPath}`);
      const buf = fs.readFileSync(fullPath);
      assert.ok(buf.length >= 4096, `GLB ${file} unexpectedly small (${buf.length} bytes)`);
      assert.equal(buf.subarray(0, 4).toString('ascii'), 'glTF', `GLB ${file} missing 'glTF' magic header`);
      assert.equal(buf.readUInt32LE(4), 2, `GLB ${file} expected glTF binary version 2`);
      assert.equal(buf.readUInt32LE(8), buf.length, `GLB ${file} header length mismatch`);
      combinedBytes += buf.length;
    }

    assert.ok(combinedBytes < 1.2 * 1024 * 1024, `Combined GLB size (${combinedBytes} bytes) exceeds 1.2 MB budget`);
  });

  await runTest('Generated website artwork (hero_gp1990.png & pitlane_blueprint.png) exist with valid PNG headers', () => {
    const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    for (const file of ['hero_gp1990.png', 'pitlane_blueprint.png']) {
      const fullPath = path.join(__dirname, 'assets', 'art', file);
      assert.ok(fs.existsSync(fullPath), `Missing generated artwork file: ${fullPath}`);
      const buf = fs.readFileSync(fullPath);
      assert.ok(buf.length > 1024, `Artwork ${file} unexpectedly small (${buf.length} bytes)`);
      assert.equal(buf.subarray(0, 8).equals(pngSignature), true, `Artwork ${file} missing valid PNG signature`);
    }
  });

  await runTest('showroom.js exports createBikeShowroom and operates headlessly with mock canvas', async () => {
    const showroomMod = await import('./showroom.js');
    const { createBikeShowroom } = showroomMod;
    assert.equal(typeof createBikeShowroom, 'function', 'showroom.js must export createBikeShowroom');

    const mockCanvas = {
      width: 800,
      height: 500,
      clientWidth: 800,
      clientHeight: 500,
      style: {},
      getContext: () => null,
      addEventListener: () => {},
      removeEventListener: () => {},
    };

    const showroom = createBikeShowroom(mockCanvas);
    assert.ok(showroom && typeof showroom === 'object', 'createBikeShowroom must return a controller object');

    for (const method of ['setBike', 'setLeanPreview', 'setTuckPreview', 'setActive', 'dispose']) {
      assert.equal(typeof showroom[method], 'function', `showroom controller missing method '${method}'`);
    }

    for (const bikeId of ['shiden', 'kaze', 'corsa', 'akagi']) {
      assert.equal(showroom.setBike(bikeId), bikeId);
      assert.equal(showroom.getState().bikeId, bikeId);
    }

    showroom.setLeanPreview(true);
    showroom.setTuckPreview(true);
    showroom.stepFrame(1 / 60);
    showroom.setActive(false);
    assert.equal(showroom.getState().active, false);
    showroom.setActive(true);
    assert.equal(showroom.getState().active, true);
    assert.equal(showroom.getState().leanPreview, true);
    assert.equal(showroom.getState().tuckPreview, true);

    showroom.dispose();
    assert.equal(showroom.getState().disposed, true);
  });

  await runTest('showcase.js exports initWebsiteShowcase and initializes safely headlessly', async () => {
    const showcaseMod = await import('./showcase.js');
    const { initWebsiteShowcase } = showcaseMod;
    assert.equal(typeof initWebsiteShowcase, 'function', 'showcase.js must export initWebsiteShowcase');

    const controller = initWebsiteShowcase({});
    assert.ok(controller && typeof controller === 'object', 'initWebsiteShowcase must return a controller object');
    for (const method of ['setActive', 'syncGamepadStatus', 'setSelectedBike', 'setSelectedTrack', 'updateMuteUi', 'dispose']) {
      assert.equal(typeof controller[method], 'function', `showcase controller missing method '${method}'`);
      controller[method]();
    }
  });

  await runTest('server.js serves showroom.js, showcase.js, Blender GLBs, and PNG art with 200 OK and valid MIME types', async () => {
    const serverMod = await import('./server.js');
    const srv = serverMod.createServer();
    await new Promise((resolve, reject) => {
      srv.once('error', reject);
      srv.listen(0, '127.0.0.1', resolve);
    });

    const port = srv.address().port;
    try {
      const assetsToCheck = [
        { path: '/showroom.js', mime: /javascript/i, minBytes: 500 },
        { path: '/showcase.js', mime: /javascript/i, minBytes: 500 },
        { path: '/assets/showcase/paddock_stage.glb', mime: /^(model\/gltf-binary|application\/octet-stream)$/i, minBytes: 4096, magic: 'glTF' },
        { path: '/assets/showcase/champion_trophy.glb', mime: /^(model\/gltf-binary|application\/octet-stream)$/i, minBytes: 4096, magic: 'glTF' },
        { path: '/assets/art/hero_gp1990.png', mime: /^image\/png$/i, minBytes: 1024 },
        { path: '/assets/art/pitlane_blueprint.png', mime: /^image\/png$/i, minBytes: 1024 },
      ];

      for (const item of assetsToCheck) {
        const res = await fetchUrl(port, item.path);
        assert.equal(res.statusCode, 200, `Expected 200 OK for ${item.path}, got ${res.statusCode}`);
        const contentType = (res.headers['content-type'] || '').split(';')[0].trim();
        assert.ok(item.mime.test(contentType), `Invalid Content-Type '${res.headers['content-type']}' for ${item.path}`);
        assert.ok(res.buffer.length >= item.minBytes, `Asset ${item.path} returned unexpectedly short body (${res.buffer.length} bytes)`);
        if (item.magic) {
          assert.equal(res.buffer.subarray(0, item.magic.length).toString('ascii'), item.magic, `Served asset ${item.path} missing '${item.magic}' header`);
        }
      }
    } finally {
      await new Promise((resolve) => srv.close(resolve));
    }
  });

  await runTest('index.html contains all required website landing sections, 3D showroom canvas, and Paddock overlay IDs', () => {
    const htmlSource = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    const requiredIds = [
      'site-navbar',
      'site-landing',
      'hero-section',
      'showroom-section',
      'showroom-canvas',
      'circuits-section',
      'engineering-section',
      'controls-section',
      'paddock-menu',
      'btn-paddock-home',
      'showroom-bike-tabs',
      'site-circuit-canvas',
      'site-physics-canvas',
      'sim-speed-slider',
      'sim-radius-slider',
    ];
    for (const id of requiredIds) {
      assert.ok(
        new RegExp(`id=["']${id}["']`).test(htmlSource),
        `index.html missing required element #${id}`
      );
    }
  });

  await runTest('tools/package_site.mjs executes cleanly and builds dist/gp500-1990-web.zip', () => {
    const pkgScript = path.join(__dirname, 'tools', 'package_site.mjs');
    assert.ok(fs.existsSync(pkgScript), 'Missing tools/package_site.mjs');

    const stdout = execFileSync(process.execPath, [pkgScript], {
      cwd: __dirname,
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.ok(/gp500-1990-web\.zip/i.test(stdout), `Unexpected packager output: ${stdout}`);

    const zipPath = path.join(__dirname, 'dist', 'gp500-1990-web.zip');
    assert.ok(fs.existsSync(zipPath), `Expected archive not found at ${zipPath}`);
    const zipBuf = fs.readFileSync(zipPath);
    assert.ok(zipBuf.length > 1024 * 1024, `Archive unexpectedly small (${zipBuf.length} bytes)`);
    assert.equal(zipBuf.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])), true, 'Archive missing PKZIP local header signature');

    for (const expectedEntry of [
      'index.html',
      'style.css',
      'game.js',
      'showroom.js',
      'showcase.js',
      'assets/showcase/paddock_stage.glb',
      'assets/showcase/champion_trophy.glb',
      'assets/art/hero_gp1990.png',
      'assets/art/pitlane_blueprint.png',
      'vendor/three.module.js',
    ]) {
      assert.ok(zipBuf.includes(Buffer.from(expectedEntry, 'utf8')), `Archive missing expected file entry: ${expectedEntry}`);
    }
    assert.equal(zipBuf.includes(Buffer.from('test_gp500.js', 'utf8')), false, 'Archive should exclude test_gp500.js');
    assert.equal(zipBuf.includes(Buffer.from('server.js', 'utf8')), false, 'Archive should exclude server.js');
  });

  // ---------------------------------------------------------------------------
  // 11. ONLINE 1v1 DUEL: SIGNALING API, NETCODE CORE, VERCEL CONFIG & LOBBY UI
  // ---------------------------------------------------------------------------
  console.log('\n11. Online 1v1 Duel: Signaling API (/api/room), Netcode Core (netcode.js), Config & UI');

  function httpJsonRequest(port, method, reqPath, bodyObj = null) {
    return new Promise((resolve, reject) => {
      const payload = bodyObj !== null ? JSON.stringify(bodyObj) : null;
      const headers = payload !== null
        ? {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          }
        : {};
      const req = http.request(
        { hostname: '127.0.0.1', port, path: reqPath, method, headers, timeout: 4000 },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            let json = null;
            try {
              json = JSON.parse(text);
            } catch {
              json = null;
            }
            resolve({ statusCode: res.statusCode, headers: res.headers, body: text, json });
          });
        }
      );
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error(`Timeout ${method} ${reqPath}`)));
      if (payload !== null) req.write(payload);
      req.end();
    });
  }

  function invokeMockRoomReq(handler, { method = 'GET', url = '/api/room', query = {}, body = undefined, ip = '203.0.113.10' }) {
    return new Promise((resolve, reject) => {
      const resHeaders = {};
      let resolved = false;
      const req = {
        method,
        url,
        query,
        body,
        headers: { 'x-forwarded-for': ip },
        socket: { remoteAddress: ip },
      };
      const res = {
        statusCode: 200,
        setHeader(k, v) {
          resHeaders[String(k).toLowerCase()] = String(v);
        },
        writeHead(status, hdrs = {}) {
          this.statusCode = status;
          for (const [k, v] of Object.entries(hdrs)) {
            resHeaders[String(k).toLowerCase()] = String(v);
          }
        },
        end(raw = '') {
          if (resolved) return;
          resolved = true;
          const text = String(raw || '');
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = null;
          }
          resolve({ statusCode: this.statusCode, headers: resHeaders, body: text, json });
        },
      };
      Promise.resolve(handler(req, res)).catch(reject);
    });
  }

  await runTest('/api/room createRoomHandler handles ICE discovery, create -> get -> answer, 404, 409, 600s TTL, and IP rate limit (429)', async () => {
    const { createRoomHandler } = await import('./api/room.js');
    const store = new Map();
    let fakeNowMs = 1_700_000_000_000;
    const handler = createRoomHandler({
      store,
      nowFn: () => fakeNowMs,
      env: {},
    });

    // 1. GET ?action=ice returns STUN servers and Cache-Control: no-store
    const iceRes = await invokeMockRoomReq(handler, {
      method: 'GET',
      url: '/api/room?action=ice',
      query: { action: 'ice' },
    });
    assert.equal(iceRes.statusCode, 200);
    assert.equal(iceRes.headers['cache-control'], 'no-store');
    assert.ok(Array.isArray(iceRes.json?.iceServers) && iceRes.json.iceServers.length >= 2, 'Expected STUN iceServers');
    assert.ok(
      iceRes.json.iceServers.some((s) => String(s.urls).includes('stun:')),
      'Expected at least one STUN server in iceServers'
    );

    // 2. POST ?action=create -> GET ?code=... -> POST ?action=answer -> GET ?code=...
    const hostOffer = { type: 'offer', sdp: 'v=0\r\no=- 123 2 IN IP4 127.0.0.1\r\n' };
    const guestAnswer = { type: 'answer', sdp: 'v=0\r\no=- 456 2 IN IP4 127.0.0.1\r\n' };
    const createRes = await invokeMockRoomReq(handler, {
      method: 'POST',
      url: '/api/room?action=create',
      query: { action: 'create' },
      body: { offer: hostOffer, hostMeta: { trackId: 'sakura', laps: 3, hostBikeId: 'akagi' } },
      ip: '198.51.100.1',
    });
    assert.equal(createRes.statusCode, 200);
    assert.equal(createRes.json?.expiresIn, 600);
    const roomCode = createRes.json?.code;
    assert.ok(/^[A-Z2-9]{5}$/.test(roomCode), `Expected 5-char room code, got ${roomCode}`);

    const getBeforeAns = await invokeMockRoomReq(handler, {
      method: 'GET',
      url: `/api/room?code=${roomCode}`,
      query: { code: roomCode },
    });
    assert.equal(getBeforeAns.statusCode, 200);
    assert.equal(getBeforeAns.json.code, roomCode);
    assert.deepEqual(getBeforeAns.json.offer, hostOffer);
    assert.equal(getBeforeAns.json.answer, null);
    assert.equal(getBeforeAns.json.hostMeta?.trackId, 'sakura');
    assert.ok(Array.isArray(getBeforeAns.json.iceServers));

    const ansRes = await invokeMockRoomReq(handler, {
      method: 'POST',
      url: '/api/room?action=answer',
      query: { action: 'answer' },
      body: { code: roomCode, answer: guestAnswer, guestMeta: { guestBikeId: 'shiden' } },
    });
    assert.equal(ansRes.statusCode, 200);
    assert.equal(ansRes.json?.ok, true);
    assert.equal(ansRes.json?.code, roomCode);

    const getAfterAns = await invokeMockRoomReq(handler, {
      method: 'GET',
      url: `/api/room?code=${roomCode}`,
      query: { code: roomCode },
    });
    assert.equal(getAfterAns.statusCode, 200);
    assert.deepEqual(getAfterAns.json.answer, guestAnswer);
    assert.equal(getAfterAns.json.guestMeta?.guestBikeId, 'shiden');

    // 3. 409 on duplicate answer (room full)
    const dupAns = await invokeMockRoomReq(handler, {
      method: 'POST',
      url: '/api/room?action=answer',
      query: { action: 'answer' },
      body: { code: roomCode, answer: { type: 'answer', sdp: 'v=0\r\n' } },
    });
    assert.equal(dupAns.statusCode, 409, `Expected 409 on duplicate answer, got ${dupAns.statusCode}`);

    // 4. 404 on unknown room code
    const missingGet = await invokeMockRoomReq(handler, {
      method: 'GET',
      url: '/api/room?code=NOPE9',
      query: { code: 'NOPE9' },
    });
    assert.equal(missingGet.statusCode, 404);
    const missingAns = await invokeMockRoomReq(handler, {
      method: 'POST',
      url: '/api/room?action=answer',
      query: { action: 'answer' },
      body: { code: 'NOPE9', answer: guestAnswer },
    });
    assert.equal(missingAns.statusCode, 404);

    // 5. 600s TTL expiration using simulated clock
    fakeNowMs += 599_000;
    const stillValid = await invokeMockRoomReq(handler, {
      method: 'GET',
      url: `/api/room?code=${roomCode}`,
      query: { code: roomCode },
    });
    assert.equal(stillValid.statusCode, 200, 'Room should still be valid at 599s');

    fakeNowMs += 1_000; // 600s elapsed
    const expiredGet = await invokeMockRoomReq(handler, {
      method: 'GET',
      url: `/api/room?code=${roomCode}`,
      query: { code: roomCode },
    });
    assert.equal(expiredGet.statusCode, 404, 'Room must expire and return 404 at 600s');

    // 6. IP rate limit: 20 creates/hour allowed, 21st returns 429
    const rateIp = '198.51.100.77';
    for (let i = 0; i < 20; i++) {
      const r = await invokeMockRoomReq(handler, {
        method: 'POST',
        url: '/api/room?action=create',
        query: { action: 'create' },
        body: { offer: hostOffer },
        ip: rateIp,
      });
      assert.equal(r.statusCode, 200, `Create #${i + 1} for ${rateIp} should return 200, got ${r.statusCode}`);
    }
    const overLimit = await invokeMockRoomReq(handler, {
      method: 'POST',
      url: '/api/room?action=create',
      query: { action: 'create' },
      body: { offer: hostOffer },
      ip: rateIp,
    });
    assert.equal(overLimit.statusCode, 429, `21st create in 1h must return 429, got ${overLimit.statusCode}`);

    // Different IP is unaffected
    const otherIp = await invokeMockRoomReq(handler, {
      method: 'POST',
      url: '/api/room?action=create',
      query: { action: 'create' },
      body: { offer: hostOffer },
      ip: '198.51.100.88',
    });
    assert.equal(otherIp.statusCode, 200);

    // Rate limit resets after 3600s
    fakeNowMs += 3_600_000;
    const afterWindow = await invokeMockRoomReq(handler, {
      method: 'POST',
      url: '/api/room?action=create',
      query: { action: 'create' },
      body: { offer: hostOffer },
      ip: rateIp,
    });
    assert.equal(afterWindow.statusCode, 200);

    // 7. TURN_KEY_ID + TURN_API_TOKEN fetches temporary TURN iceServers
    const turnHandler = createRoomHandler({
      store: new Map(),
      nowFn: () => fakeNowMs,
      env: { TURN_KEY_ID: 'cf-key-1', TURN_API_TOKEN: 'cf-secret-tok' },
      fetchFn: async (url, init) => {
        assert.match(String(url), /rtc\.live\.cloudflare\.com\/v1\/turn\/keys\/cf-key-1\/credentials\/generate-ice-servers/);
        assert.equal(init.method, 'POST');
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              iceServers: [
                { urls: ['turn:turn.cloudflare.com:3478?transport=udp'], username: 'u1', credential: 'c1' },
              ],
            };
          },
        };
      },
    });
    const turnIceRes = await invokeMockRoomReq(turnHandler, {
      method: 'GET',
      url: '/api/room?action=ice',
      query: { action: 'ice' },
    });
    assert.equal(turnIceRes.statusCode, 200);
    assert.ok(
      turnIceRes.json.iceServers.some((s) => JSON.stringify(s.urls).includes('turn:turn.cloudflare.com')),
      'Expected TURN server entry when TURN_KEY_ID & TURN_API_TOKEN are set'
    );
  });

  await runTest('/api/room security: closed by default, per-action rate limits, no short custom codes, atomic Upstash join', async () => {
    const roomMod = await import('./api/room.js');
    const { createRoomHandler } = roomMod;
    const offer = { type: 'offer', sdp: 'v=0\r\n' };

    // 1. Deployed handler answers 503 until GP500_ONLINE=1 and Upstash are both configured
    const savedEnv = { ...process.env };
    try {
      delete process.env.GP500_ONLINE;
      let r = await invokeMockRoomReq(roomMod.default, { url: '/api/room?action=ice', query: { action: 'ice' } });
      assert.equal(r.statusCode, 503, 'API must be closed while online play is off');
      process.env.GP500_ONLINE = '1';
      delete process.env.KV_REST_API_URL;
      delete process.env.KV_REST_API_TOKEN;
      delete process.env.UPSTASH_REDIS_REST_URL;
      delete process.env.UPSTASH_REDIS_REST_TOKEN;
      r = await invokeMockRoomReq(roomMod.default, { url: '/api/room?action=ice', query: { action: 'ice' } });
      assert.equal(r.statusCode, 503, 'API must refuse to run on per-instance memory in production');
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
      Object.assign(process.env, savedEnv);
    }

    // 2. ICE (TURN credentials) is rate limited per IP: 30 per hour
    const handler = createRoomHandler({ store: new Map(), nowFn: () => 1_700_000_000_000, env: {} });
    for (let i = 0; i < 30; i++) {
      const r = await invokeMockRoomReq(handler, { url: '/api/room?action=ice', query: { action: 'ice' }, ip: '198.51.100.5' });
      assert.equal(r.statusCode, 200, `ice #${i + 1} should pass`);
    }
    const iceOver = await invokeMockRoomReq(handler, { url: '/api/room?action=ice', query: { action: 'ice' }, ip: '198.51.100.5' });
    assert.equal(iceOver.statusCode, 429, '31st ice request in an hour must be refused');

    // 3. Room reads are rate limited too (240 per hour), so codes cannot be brute-forced
    let lastRead = null;
    for (let i = 0; i < 241; i++) {
      lastRead = await invokeMockRoomReq(handler, { url: '/api/room?code=ABCDE', query: { code: 'ABCDE' }, ip: '198.51.100.6' });
    }
    assert.equal(lastRead.statusCode, 429, '241st room read in an hour must be refused');

    // 4. Custom room codes shorter than 6 characters are rejected
    const shortCode = await invokeMockRoomReq(handler, {
      method: 'POST', url: '/api/room?action=create', query: { action: 'create' }, body: { offer, code: 'ABCD' }, ip: '198.51.100.7',
    });
    assert.equal(shortCode.statusCode, 400);

    // 5. Upstash: two guests answering the same room at once -> exactly one wins
    const kv = new Map();
    const fakeUpstash = async (_url, init) => {
      const [cmd, ...args] = JSON.parse(init.body);
      let result = null;
      if (cmd === 'INCR') { result = Number(kv.get(args[0]) || 0) + 1; kv.set(args[0], String(result)); }
      else if (cmd === 'EXPIRE') result = 1;
      else if (cmd === 'GET') result = kv.has(args[0]) ? kv.get(args[0]) : null;
      else if (cmd === 'MGET') result = args.map((k) => (kv.has(k) ? kv.get(k) : null));
      else if (cmd === 'SET') {
        const [key, value, ...opts] = args;
        if (opts.includes('NX') && kv.has(key)) result = null;
        else if (opts.includes('XX') && !kv.has(key)) result = null;
        else { kv.set(key, value); result = 'OK'; }
      }
      return { ok: true, status: 200, async json() { return { result }; } };
    };
    const upstashHandler = createRoomHandler({
      nowFn: () => 1_700_000_000_000,
      fetchFn: fakeUpstash,
      env: { KV_REST_API_URL: 'https://kv.example', KV_REST_API_TOKEN: 'tok' },
    });
    const created = await invokeMockRoomReq(upstashHandler, {
      method: 'POST', url: '/api/room?action=create', query: { action: 'create' }, body: { offer }, ip: '198.51.100.8',
    });
    assert.equal(created.statusCode, 200);
    const code = created.json.code;
    const answers = await Promise.all(['g1', 'g2'].map((g) => invokeMockRoomReq(upstashHandler, {
      method: 'POST', url: '/api/room?action=answer', query: { action: 'answer' },
      body: { code, answer: { type: 'answer', sdp: g }, guestMeta: { guestBikeId: g } }, ip: '198.51.100.9',
    })));
    const statuses = answers.map((a) => a.statusCode).sort();
    assert.deepEqual(statuses, [200, 409], `Exactly one guest may join, got ${statuses}`);
    const winner = answers.find((a) => a.statusCode === 200);
    const roomAfter = await invokeMockRoomReq(upstashHandler, { url: `/api/room?code=${code}`, query: { code }, ip: '198.51.100.9' });
    assert.equal(roomAfter.statusCode, 200);
    assert.ok(roomAfter.json.answer && ['g1', 'g2'].includes(roomAfter.json.answer.sdp), 'Room must expose the winning answer');
    assert.equal(roomAfter.json.guestMeta.guestBikeId, roomAfter.json.answer.sdp);
    assert.ok(winner);
  });

  await runTest('vercel.json security headers: CSP allows exactly the inline import map, no other inline script', () => {
    const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, 'vercel.json'), 'utf8'));
    const all = vercel.headers.find((h) => h.source === '/(.*)');
    assert.ok(all, 'Expected a catch-all header rule');
    const get = (k) => all.headers.find((h) => h.key.toLowerCase() === k.toLowerCase())?.value || '';
    const csp = get('Content-Security-Policy');
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /object-src 'none'/);
    assert.ok(!/'unsafe-eval'/.test(csp), 'CSP must not allow unsafe-eval');
    assert.equal(get('X-Frame-Options'), 'DENY');
    assert.equal(get('X-Content-Type-Options'), 'nosniff');

    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    assert.equal(inline.length, 1, 'Only the import map may be inline (move other scripts to files)');
    assert.ok(!/[\r\n]/.test(inline[0]), 'Import map must stay on one line so its hash is identical on Windows and Linux');
    const hash = crypto.createHash('sha256').update(inline[0], 'utf8').digest('base64');
    assert.ok(csp.includes(`'sha256-${hash}'`), `CSP script-src must include the import map hash sha256-${hash}`);
  });

  await runTest('server.js mounts /api/room over live HTTP and serves netcode.js + .glb MIME types', async () => {
    const serverMod = await import('./server.js');
    const srv = serverMod.createServer();
    await new Promise((resolve, reject) => {
      srv.once('error', reject);
      srv.listen(0, '127.0.0.1', resolve);
    });
    const port = srv.address().port;

    try {
      const netRes = await fetchUrl(port, '/netcode.js');
      assert.equal(netRes.statusCode, 200);
      assert.match(netRes.headers['content-type'] || '', /javascript/i);

      const iceHttp = await httpJsonRequest(port, 'GET', '/api/room?action=ice');
      assert.equal(iceHttp.statusCode, 200);
      assert.equal(iceHttp.headers['cache-control'], 'no-store');
      assert.ok(Array.isArray(iceHttp.json?.iceServers) && iceHttp.json.iceServers.length >= 2);

      const created = await httpJsonRequest(port, 'POST', '/api/room?action=create', {
        offer: { type: 'offer', sdp: 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n' },
        hostMeta: { trackId: 'monterey', laps: 5 },
      });
      assert.equal(created.statusCode, 200);
      const code = created.json?.code;
      assert.ok(code && code.length === 5);

      const fetched = await httpJsonRequest(port, 'GET', `/api/room?code=${code}`);
      assert.equal(fetched.statusCode, 200);
      assert.equal(fetched.json.hostMeta?.trackId, 'monterey');

      const answered = await httpJsonRequest(port, 'POST', '/api/room?action=answer', {
        code,
        answer: { type: 'answer', sdp: 'v=0\r\no=- 2 2 IN IP4 127.0.0.1\r\n' },
        guestMeta: { guestBikeId: 'kaze' },
      });
      assert.equal(answered.statusCode, 200);
      assert.equal(answered.json?.ok, true);

      const fullRoom = await httpJsonRequest(port, 'POST', '/api/room?action=answer', {
        code,
        answer: { type: 'answer', sdp: 'v=0\r\n' },
      });
      assert.equal(fullRoom.statusCode, 409);

      const missingRoom = await httpJsonRequest(port, 'GET', '/api/room?code=NOPE9');
      assert.equal(missingRoom.statusCode, 404);
    } finally {
      await new Promise((resolve) => srv.close(resolve));
    }
  });

  await runTest('netcode.js encodeRiderState / decodeRiderState round-trip and validation', async () => {
    const netcodeMod = await import('./netcode.js');
    const { encodeRiderState, decodeRiderState } = netcodeMod;

    const rider = createRiderState({ id: 'p1', bike: BIKES[2], s: 1234.56, d: -2.75, track: sakura });
    rider.psi = 0.28;
    rider.speed = 68.4;
    rider.rpm = 11420;
    rider.gear = 5;
    rider.lean = -0.74;
    rider.wheelieAngle = 0.035;
    rider.rearSlip = 0.42;
    rider.brake = 0.15;
    rider.throttle = 0.92;
    rider.tuck = true;
    rider.onKerb = true;
    rider.offTrack = false;
    rider.lap = 2;
    rider.lapTime = 34.125;
    rider.bestLapTime = 51.89;
    rider.totalTime = 86.015;
    rider.finished = false;

    const packet = encodeRiderState(rider, 77, 4567.8);
    assert.equal(packet.seq, 77);
    assert.equal(packet.t, 4567.8);
    assert.equal(packet.s, 1234.56);
    assert.equal(packet.gear, 5);
    assert.equal(packet.tuck, true);
    assert.equal(packet.onKerb, true);
    assert.equal(packet.offTrack, false);
    assert.equal(packet.bestLapTime, 51.89);

    const jsonStr = JSON.stringify(packet);
    const decoded = decodeRiderState(jsonStr);
    assert.deepEqual(decoded, packet, 'JSON encode -> decode round-trip must match packet identically');

    const decodedObj = decodeRiderState(packet);
    assert.deepEqual(decodedObj, packet);

    assert.equal(decodeRiderState('not-valid-json{'), null);
    assert.equal(decodeRiderState(''), null);
    assert.equal(decodeRiderState(null), null);
    assert.equal(decodeRiderState([1, 2, 3]), null);
  });

  await runTest('netcode.js interpolateRider handles track wraparound (L-1 -> 2) and bounded extrapolation (<= 150ms)', async () => {
    const netcodeMod = await import('./netcode.js');
    const { interpolateRider } = netcodeMod;

    const L = 2400;
    const snapA = {
      seq: 10, t: 1000, s: L - 1, d: -1.0, psi: 0.02, speed: 60, rpm: 11000, gear: 5,
      lean: -0.2, wheelieAngle: 0, rearSlip: 0.1, brake: 0, throttle: 1, tuck: true,
      onKerb: false, offTrack: false, lap: 1, lapTime: 52.0, bestLapTime: null, totalTime: 52.0, finished: false,
    };
    const snapB = {
      seq: 11, t: 1030, s: 2, d: 0.5, psi: -0.02, speed: 63, rpm: 11400, gear: 5,
      lean: 0.2, wheelieAngle: 0, rearSlip: 0.1, brake: 0, throttle: 1, tuck: true,
      onKerb: false, offTrack: false, lap: 2, lapTime: 0.03, bestLapTime: 52.01, totalTime: 52.04, finished: false,
    };

    // Midpoint across s = L-1 -> 2: shortest circular delta is +3m, midpoint is s = 0.5m (NOT L/2!)
    const mid = interpolateRider([snapA, snapB], 1015, L, 150);
    assert.ok(Math.abs(mid.s - 0.5) < 1e-6, `Expected wrapped midpoint s=0.5, got ${mid.s}`);
    assert.ok(Math.abs(mid.d - (-0.25)) < 1e-6, `Expected interpolated d=-0.25, got ${mid.d}`);
    assert.equal(mid.lap, 2, 'Past s=L line at midpoint should reflect new lap');

    // Early point before s=0 line (1/6 of 30ms -> s = L - 0.5)
    const beforeLine = interpolateRider([snapA, snapB], 1005, L, 150);
    assert.ok(Math.abs(beforeLine.s - (L - 0.5)) < 1e-6, `Expected s=${L - 0.5}, got ${beforeLine.s}`);
    assert.equal(beforeLine.lap, 1);

    // Bounded extrapolation: 100ms ahead -> +6.0m; 600ms ahead -> capped at 150ms (+9.0m, NOT +36.0m)
    const latest = { ...snapB, t: 2000, s: 100, d: 1.0, psi: 0, speed: 60 };
    const extrap100 = interpolateRider([latest], 2100, L, 150);
    assert.ok(Math.abs(extrap100.s - 106.0) < 1e-6, `Expected s=106.0 at +100ms, got ${extrap100.s}`);

    const extrap600 = interpolateRider([latest], 2600, L, 150);
    assert.ok(Math.abs(extrap600.s - 109.0) < 1e-6, `Expected s=109.0 capped at 150ms, got ${extrap600.s}`);
    assert.equal(extrap600.t, 2150);
  });

  await runTest('netcode.js estimateClockOffset applies median filtering over up to 5 samples', async () => {
    const netcodeMod = await import('./netcode.js');
    const { estimateClockOffset } = netcodeMod;

    // 7 samples total -> keeps last 5: rtts [34, 30, 950, 32, 36] -> median 34; offsets [122, 118, 5000, 120, 121] -> median 121
    const samples = [
      { rtt: 10, offset: 999 },
      { rtt: 12, offset: 999 },
      { rtt: 34, offset: 122 },
      { rtt: 30, offset: 118 },
      { rtt: 950, offset: 5000 },
      { rtt: 32, offset: 120 },
      { rtt: 36, offset: 121 },
    ];
    const est = estimateClockOffset(samples);
    assert.equal(est.rttMs, 34, `Expected median RTT 34ms resisting 950ms spike, got ${est.rttMs}`);
    assert.equal(est.offsetMs, 121, `Expected median offset 121ms resisting 5000ms spike, got ${est.offsetMs}`);
    assert.deepEqual(estimateClockOffset([]), { rttMs: 0, offsetMs: 0 });
  });

  await runTest('vercel.json, README.md, and index.html contain Online 1v1 Duel config, docs, and UI IDs', async () => {
    const vercelCfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'vercel.json'), 'utf8'));
    assert.ok(Array.isArray(vercelCfg.headers) && vercelCfg.headers.length >= 2, 'vercel.json missing headers array');
    const hasApiNoStore = vercelCfg.headers.some(
      (rule) => /\/api\//.test(rule.source) && rule.headers?.some((h) => h.key === 'Cache-Control' && h.value === 'no-store')
    );
    const hasGlbMime = vercelCfg.headers.some(
      (rule) => /glb/.test(rule.source) && rule.headers?.some((h) => h.key === 'Content-Type' && h.value === 'model/gltf-binary')
    );
    assert.ok(hasApiNoStore, 'vercel.json must configure Cache-Control: no-store for /api/*');
    assert.ok(hasGlbMime, 'vercel.json must configure Content-Type: model/gltf-binary for *.glb');

    const readme = fs.readFileSync(path.join(__dirname, 'README.md'), 'utf8');
    assert.ok(/Vercel/i.test(readme), 'README.md must document Vercel deployment');
    assert.ok(/KV_REST_API|Upstash/i.test(readme), 'README.md must document Upstash Redis env vars');
    assert.ok(/TURN_KEY_ID|TURN_API_TOKEN/i.test(readme), 'README.md must document TURN env vars');
    assert.ok(/\?relay=1/.test(readme), 'README.md must document ?relay=1 verification');

    const htmlSource = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    assert.ok(htmlSource.includes('ONLINE 1v1 DUEL'), 'index.html missing ONLINE 1v1 DUEL mode option/pill');
    assert.ok(/value=["']online-duel["']/.test(htmlSource), 'index.html missing online-duel value');
    for (const id of [
      'online-lobby-overlay',
      'online-net-badge',
      'online-away-banner',
      'btn-nav-online',
      'btn-online-create',
      'btn-online-join',
      'btn-online-ready',
      'btn-online-start',
      'online-room-code',
      'online-status-pill',
    ]) {
      assert.ok(new RegExp(`id=["']${id}["']`).test(htmlSource), `index.html missing #${id}`);
    }

    const gameMod = await import('./game.js');
    const parsedOnline = gameMod.parseUrlConfig('?room=ab12c&relay=1');
    assert.equal(parsedOnline.room, 'AB12C');
    assert.equal(parsedOnline.relay, true);

    const zipBuf = fs.readFileSync(path.join(__dirname, 'dist', 'gp500-1990-web.zip'));
    assert.ok(zipBuf.includes(Buffer.from('netcode.js', 'utf8')), 'Web ZIP archive must include netcode.js');
    assert.equal(zipBuf.includes(Buffer.from('api/room.js', 'utf8')), false, 'Web ZIP archive should exclude serverless api/room.js');
  });

  await runTest('netcode.js createOnlineSession configures iceTransportPolicy=relay when relayOnly=true', async () => {
    const netcodeMod = await import('./netcode.js');
    const seenConfigs = [];
    class MockPeerConnection {
      constructor(rtcConfig) {
        seenConfigs.push(rtcConfig);
        this.iceGatheringState = 'complete';
        this.signalingState = 'stable';
        this.localDescription = { type: 'offer', sdp: 'v=0\r\n' };
      }
      createDataChannel() {
        return { readyState: 'connecting', send() {}, close() {} };
      }
      async createOffer() { return { type: 'offer', sdp: 'v=0\r\n' }; }
      async setLocalDescription(d) { this.localDescription = d; }
      async getStats() { return new Map(); }
      close() {}
    }

    const sess = netcodeMod.createOnlineSession({
      role: 'host',
      relayOnly: true,
      RTCPeerConnectionClass: MockPeerConnection,
      fetchFn: async (url) => {
        if (String(url).includes('action=ice')) {
          return {
            ok: true,
            status: 200,
            async json() {
              return { iceServers: [{ urls: 'turn:turn.example.com:3478', username: 'u', credential: 'p' }] };
            },
          };
        }
        return {
          ok: true,
          status: 200,
          async json() {
            return { code: 'K8M4P', expiresIn: 600 };
          },
        };
      },
      pollIntervalMs: 5000,
    });

    const started = await sess.start();
    assert.equal(started.ok, true);
    assert.equal(started.code, 'K8M4P');
    assert.equal(seenConfigs.length, 1);
    assert.equal(seenConfigs[0].iceTransportPolicy, 'relay');
    sess.close();
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
