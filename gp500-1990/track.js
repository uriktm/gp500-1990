// Pure JS 3D Closed Catmull-Rom Track Spline with Uniform Arc-Length Parameterization
// Zero external dependencies (runs identically in Node.js and browser ES modules)

export const TRACK_WIDTH = 14;
export const TRACK_HALF_WIDTH = 7;
export const KERB_WIDTH = 1.6;

export const TRACKS = [
  {
    id: 'sakura',
    name: 'Sakura GP Circuit',
    country: 'Japan',
    lengthLabel: '2.42 km',
    description: 'Flowing fast 1990 GP circuit with a long main straight, sweeping high-speed curves, and a tight final chicane.',
    controlPoints: [
      // Long 1990 Fuji/Hockenheim-style GP main straight & high-speed stretch along +X
      { x: 0,    y: 0.0,  z: 0 },
      { x: 220,  y: 0.0,  z: 0 },
      { x: 440,  y: 0.0,  z: 0 },
      { x: 660,  y: 0.0,  z: 0 },
      { x: 880,  y: 0.0,  z: 0 },
      { x: 1100, y: 0.0,  z: 0 },
      { x: 1300, y: 1.0,  z: 10 },
      // Turn 1-2 sweeping right-hander
      { x: 1430, y: 4.0,  z: 100 },
      { x: 1450, y: 7.0,  z: 240 },
      { x: 1340, y: 8.0,  z: 350 },
      // Infield S-curves & back return
      { x: 1150, y: 6.0,  z: 390 },
      { x: 920,  y: 4.0,  z: 320 },
      { x: 680,  y: 6.0,  z: 380 },
      { x: 420,  y: 9.0,  z: 410 },
      { x: 160,  y: 7.0,  z: 350 },
      // Final hairpin & entry onto main straight
      { x: -60,  y: 4.0,  z: 250 },
      { x: -160, y: 1.5,  z: 120 },
      { x: -120, y: 0.0,  z: 15 }
    ]
  },
  {
    id: 'monterey',
    name: 'Monterey Ridge',
    country: 'USA',
    lengthLabel: '2.28 km',
    description: 'Technical coastal hillside circuit featuring a steep uphill climb and the famous downhill Corkscrew S-drop.',
    controlPoints: [
      // Start/finish straight
      { x: 0,    y: 0.0,  z: 0 },
      { x: 130,  y: 1.0,  z: 0 },
      { x: 260,  y: 3.0,  z: 25 },
      // Andretti hairpin (smooth wide radius)
      { x: 360,  y: 6.0,  z: 110 },
      { x: 350,  y: 9.0,  z: 230 },
      { x: 240,  y: 12.0, z: 290 },
      // Rahal straight climbing the hill
      { x: 100,  y: 18.0, z: 280 },
      { x: -30,  y: 24.0, z: 330 },
      // Crest before the Corkscrew
      { x: -160, y: 26.0, z: 340 },
      // The Corkscrew downhill S-drop
      { x: -265, y: 19.0, z: 255 },
      { x: -255, y: 10.0, z: 145 },
      { x: -310, y: 4.0,  z: 45 },
      // Rainey curve & final corner
      { x: -245, y: 1.0,  z: -45 },
      { x: -120, y: 0.0,  z: -20 }
    ]
  },
  {
    id: 'cathedral',
    name: 'Cathedral TT',
    country: 'Netherlands',
    lengthLabel: '2.65 km',
    description: 'Ultra-fast classic TT circuit dominated by high-speed linked bends, banked sweepers, and a last-sector chicane.',
    controlPoints: [
      // Main TT straight
      { x: 0,    y: 0.0,  z: 0 },
      { x: 160,  y: 0.0,  z: 0 },
      { x: 320,  y: 1.0,  z: 15 },
      // Fast right kink into sweeping loop
      { x: 450,  y: 3.0,  z: 95 },
      { x: 490,  y: 4.5,  z: 230 },
      { x: 400,  y: 5.0,  z: 350 },
      { x: 250,  y: 4.0,  z: 390 },
      // Fast mid-sector ESSES
      { x: 110,  y: 2.5,  z: 310 },
      { x: -40,  y: 3.0,  z: 395 },
      { x: -210, y: 4.5,  z: 370 },
      // High-speed return curve
      { x: -340, y: 3.5,  z: 250 },
      { x: -350, y: 2.0,  z: 110 },
      { x: -250, y: 1.0,  z: 15 },
      { x: -125, y: 0.0,  z: -8 }
    ]
  },
  {
    id: 'andalucia',
    name: 'Andalucía Circuit',
    country: 'Spain',
    lengthLabel: '3.01 km',
    description: 'Layout of the Spanish GP venue: a stop-start sequence of hairpins and esses, the long fast right sweeper and a last-corner hairpin onto the main straight.',
    // Layout traced from the real Jerez circuit (OpenStreetMap), scaled to 0.69. Hairpins: T1 (pts 3-5), Dry Sac (18-22), final hairpin (40-42)
    controlPoints: [
      { x: 0, y: 0.7, z: 0 },
      { x: -24.5, y: 0.8, z: -65.8 },
      { x: -51.1, y: 1.7, z: -130.4 },
      { x: -77, y: 3.1, z: -192.2 },
      { x: -71.2, y: 3.8, z: -221.5 },
      { x: -41.4, y: 4.4, z: -228.8 },
      { x: 38, y: 5.4, z: -229.4 },
      { x: 70.8, y: 5.1, z: -228.5 },
      { x: 85.6, y: 4.7, z: -209.4 },
      { x: 72.4, y: 4.1, z: -188.4 },
      { x: 30.4, y: 3, z: -140.4 },
      { x: 33.5, y: 2.4, z: -74.1 },
      { x: 65.6, y: 2.7, z: 9.1 },
      { x: 137.5, y: 6.1, z: 31.4 },
      { x: 281.1, y: 6.1, z: 51.5 },
      { x: 329.5, y: 4.5, z: 96.3 },
      { x: 307.9, y: 4.1, z: 167.6 },
      { x: 200.8, y: 3, z: 253 },
      { x: 69, y: 2, z: 360.4 },
      { x: -12, y: 3.1, z: 425.6 },
      { x: -35.5, y: 3.5, z: 433.4 },
      { x: -50.6, y: 3.9, z: 415 },
      { x: -40.3, y: 4.3, z: 387.3 },
      { x: -6.4, y: 3.6, z: 320.4 },
      { x: 11.2, y: 1.6, z: 257.9 },
      { x: -35.2, y: 0.3, z: 184.7 },
      { x: -84.2, y: 0, z: 124 },
      { x: -140.1, y: 0, z: 109.7 },
      { x: -187.9, y: 0, z: 154.6 },
      { x: -228.3, y: 0.4, z: 268.3 },
      { x: -251.8, y: 0.7, z: 290 },
      { x: -284.9, y: 1.1, z: 276.4 },
      { x: -320.5, y: 1.7, z: 249.7 },
      { x: -325.4, y: 1.7, z: 221 },
      { x: -297.2, y: 0.8, z: 163.4 },
      { x: -249.2, y: 0.2, z: 67.4 },
      { x: -186.5, y: 0.7, z: 38.6 },
      { x: -99.9, y: 0.7, z: 46.6 },
      { x: -61.6, y: 0.5, z: 75.6 },
      { x: 15.6, y: 0.7, z: 171.2 },
      { x: 46.9, y: 0.9, z: 210.3 },
      { x: 71.6, y: 0.9, z: 215.4 },
      { x: 83.1, y: 0.9, z: 193.4 },
      { x: 69.6, y: 0.9, z: 159.3 },
      { x: 34, y: 0.8, z: 74.6 }
    ]
  },
  {
    id: 'basscoast',
    name: 'Bass Coast Circuit',
    country: 'Australia',
    lengthLabel: '3.00 km',
    description: 'Layout of the Australian GP venue on the coast: a downhill main straight into a fast right, the long Southern Loop, a climb over the crest and fast left sweepers back onto the straight.',
    // Layout traced from the real Phillip Island circuit (OpenStreetMap), scaled to 0.68. Crest at pt 26, hairpins at 13-16 and 28-30
    controlPoints: [
      { x: 0, y: 12.8, z: 0 },
      { x: 32, y: 11.7, z: 94.8 },
      { x: 63.9, y: 11, z: 189.5 },
      { x: 119.1, y: 6.8, z: 350.3 },
      { x: 126, y: 3.9, z: 455.2 },
      { x: 62.7, y: 5.1, z: 526.6 },
      { x: -15.4, y: 5.8, z: 576.9 },
      { x: -36.9, y: 6.1, z: 633.5 },
      { x: -1.8, y: 5.8, z: 683.5 },
      { x: 56.9, y: 4, z: 680.4 },
      { x: 109.4, y: 1.9, z: 633.3 },
      { x: 218.5, y: 0, z: 504.5 },
      { x: 240.4, y: 1.2, z: 386.2 },
      { x: 216.1, y: 4.3, z: 260.6 },
      { x: 218.3, y: 4.8, z: 235.1 },
      { x: 239.4, y: 4.8, z: 226.8 },
      { x: 257.9, y: 4.4, z: 243.2 },
      { x: 290.9, y: 2.2, z: 298.4 },
      { x: 315.4, y: 0.4, z: 356.9 },
      { x: 349.8, y: 0.9, z: 370.3 },
      { x: 380.4, y: 1.9, z: 345.9 },
      { x: 385.2, y: 3.2, z: 298.6 },
      { x: 369.5, y: 7.2, z: 181.2 },
      { x: 325.8, y: 9.3, z: 64.8 },
      { x: 354.2, y: 11.1, z: -30.9 },
      { x: 377.8, y: 17, z: -124.8 },
      { x: 341, y: 21, z: -185.9 },
      { x: 258, y: 19.3, z: -195.5 },
      { x: 202.6, y: 16.3, z: -182 },
      { x: 180, y: 15.6, z: -188.7 },
      { x: 177.7, y: 15.6, z: -211.7 },
      { x: 197.9, y: 17, z: -251.3 },
      { x: 181.9, y: 19.8, z: -304.9 },
      { x: 121.2, y: 21.1, z: -325.1 },
      { x: -8.1, y: 19.5, z: -305.3 },
      { x: -59.7, y: 17.1, z: -228.4 },
      { x: -45.4, y: 16, z: -134.3 }
    ]
  }
];

function wrapAngle(angle) {
  let a = (angle + Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a - Math.PI;
}

function catmullRomPoint(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
    z: 0.5 * ((2 * p1.z) + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3)
  };
}

function resampleByArcLength(points, numSamples) {
  const n = points.length;
  const cumLen = new Float64Array(n + 1);
  cumLen[0] = 0;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    cumLen[i + 1] = cumLen[i] + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  const totalLength = cumLen[n];
  const step = totalLength / numSamples;
  const resampled = new Array(numSamples);

  let seg = 0;
  for (let i = 0; i < numSamples; i++) {
    const targetS = i * step;
    while (seg < n - 1 && cumLen[seg + 1] < targetS) {
      seg++;
    }
    const segStart = cumLen[seg];
    const segLen = cumLen[seg + 1] - segStart || 1;
    const t = Math.max(0, Math.min(1, (targetS - segStart) / segLen));
    const a = points[seg];
    const b = points[(seg + 1) % n];
    resampled[i] = {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t
    };
  }
  return { points: resampled, totalLength };
}

function smoothClosedLoop(points, passes = 12) {
  let current = points;
  const n = current.length;
  for (let p = 0; p < passes; p++) {
    const next = new Array(n);
    for (let i = 0; i < n; i++) {
      const prev = current[(i - 1 + n) % n];
      const curr = current[i];
      const nxt = current[(i + 1) % n];
      next[i] = {
        x: 0.25 * prev.x + 0.5 * curr.x + 0.25 * nxt.x,
        y: 0.25 * prev.y + 0.5 * curr.y + 0.25 * nxt.y,
        z: 0.25 * prev.z + 0.5 * curr.z + 0.25 * nxt.z
      };
    }
    current = next;
  }
  return current;
}

export function createTrack(trackId = 'sakura', numSamples = 1000) {
  const meta = TRACKS.find((t) => t.id === trackId) || TRACKS[0];
  const ctrl = meta.controlPoints;
  const numCtrl = ctrl.length;

  // Step 1: Dense Catmull-Rom evaluation
  const subdivisions = 60;
  const rawPoints = [];
  for (let i = 0; i < numCtrl; i++) {
    const p0 = ctrl[(i - 1 + numCtrl) % numCtrl];
    const p1 = ctrl[i];
    const p2 = ctrl[(i + 1) % numCtrl];
    const p3 = ctrl[(i + 2) % numCtrl];
    for (let j = 0; j < subdivisions; j++) {
      rawPoints.push(catmullRomPoint(p0, p1, p2, p3, j / subdivisions));
    }
  }

  // Step 2: Uniform arc-length resample + C2 smoothing passes + final uniform arc-length resample
  const firstPass = resampleByArcLength(rawPoints, numSamples);
  const smoothed = smoothClosedLoop(firstPass.points, 16);
  const { points: uniformPts, totalLength } = resampleByArcLength(smoothed, numSamples);
  const ds = totalLength / numSamples;

  // Step 3: Compute tangent, right-hand normal, tangentAngle, pitch, and curvature
  const samples = new Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    const prev = uniformPts[(i - 1 + numSamples) % numSamples];
    const curr = uniformPts[i];
    const next = uniformPts[(i + 1) % numSamples];

    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const dz = next.z - prev.z;
    const len3D = Math.hypot(dx, dy, dz) || 1;
    const lenXZ = Math.hypot(dx, dz) || 1;

    // 3D unit tangent
    const tx = dx / len3D;
    const ty = dy / len3D;
    const tz = dz / len3D;

    // Horizontal unit tangent in XZ plane
    const hx = dx / lenXZ;
    const hz = dz / lenXZ;

    // Right-hand horizontal normal: Forward x Up = (hx, 0, hz) x (0, 1, 0) = (-hz, 0, hx)
    const nx = -hz;
    const ny = 0;
    const nz = hx;

    const tangentAngle = Math.atan2(hz, hx);
    const pitch = Math.atan2(dy, lenXZ);

    samples[i] = {
      s: i * ds,
      x: curr.x,
      y: curr.y,
      z: curr.z,
      tx,
      ty,
      tz,
      nx,
      ny,
      nz,
      tangentAngle,
      pitch,
      curvature: 0,
      width: TRACK_WIDTH,
      halfWidth: TRACK_HALF_WIDTH,
      kerbWidth: KERB_WIDTH
    };
  }

  // Compute curvature = d(tangentAngle)/ds (positive = right turn towards +normal)
  for (let i = 0; i < numSamples; i++) {
    const prev = samples[(i - 1 + numSamples) % numSamples];
    const next = samples[(i + 1) % numSamples];
    const dAngle = wrapAngle(next.tangentAngle - prev.tangentAngle);
    samples[i].curvature = dAngle / (2 * ds);
  }

  function wrapS(s) {
    let res = s % totalLength;
    if (res < 0) res += totalLength;
    // Guard against floating point -0 or res === totalLength
    if (res >= totalLength || Object.is(res, -0)) res = 0;
    return res;
  }

  function sampleAtS(s) {
    const wrappedS = wrapS(s);
    const exactIdx = (wrappedS / totalLength) * numSamples;
    const idx0 = Math.floor(exactIdx) % numSamples;
    const idx1 = (idx0 + 1) % numSamples;
    const frac = exactIdx - Math.floor(exactIdx);

    const a = samples[idx0];
    const b = samples[idx1];

    const x = a.x + (b.x - a.x) * frac;
    const y = a.y + (b.y - a.y) * frac;
    const z = a.z + (b.z - a.z) * frac;

    const dAngle = wrapAngle(b.tangentAngle - a.tangentAngle);
    const tangentAngle = wrapAngle(a.tangentAngle + dAngle * frac);
    const pitch = a.pitch + (b.pitch - a.pitch) * frac;
    const curvature = a.curvature + (b.curvature - a.curvature) * frac;

    const hx = Math.cos(tangentAngle);
    const hz = Math.sin(tangentAngle);
    const cosPitch = Math.cos(pitch);

    const tx = hx * cosPitch;
    const ty = Math.sin(pitch);
    const tz = hz * cosPitch;

    const nx = -hz;
    const ny = 0;
    const nz = hx;

    return {
      s: wrappedS,
      x,
      y,
      z,
      tx,
      ty,
      tz,
      nx,
      ny,
      nz,
      tangentAngle,
      curvature,
      pitch,
      width: TRACK_WIDTH,
      halfWidth: TRACK_HALF_WIDTH,
      kerbWidth: KERB_WIDTH
    };
  }

  function frenetToWorld(s, d = 0, psi = 0) {
    const sample = sampleAtS(s);
    const x = sample.x + d * sample.nx;
    const y = sample.y;
    const z = sample.z + d * sample.nz;
    const heading = wrapAngle(sample.tangentAngle + psi);

    return {
      x,
      y,
      z,
      heading,
      pitch: sample.pitch,
      tangentAngle: sample.tangentAngle,
      curvature: sample.curvature,
      tx: sample.tx,
      ty: sample.ty,
      tz: sample.tz,
      nx: sample.nx,
      ny: sample.ny,
      nz: sample.nz
    };
  }

  return {
    id: meta.id,
    name: meta.name,
    country: meta.country,
    description: meta.description,
    totalLength,
    width: TRACK_WIDTH,
    halfWidth: TRACK_HALF_WIDTH,
    kerbWidth: KERB_WIDTH,
    samples,
    wrapS,
    sampleAtS,
    frenetToWorld
  };
}
