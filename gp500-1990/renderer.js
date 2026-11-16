import * as THREE from 'three';
import { createTextureSet, createBikeLiveryTexture } from './textures.js';
import { createDetailedBikeRig, updateDetailedBikeRig } from './models.js';

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function wrapAngle(a) {
  let r = (a + Math.PI) % (2 * Math.PI);
  if (r < 0) r += 2 * Math.PI;
  return r - Math.PI;
}

function lerpAngle(a, b, t) {
  return a + wrapAngle(b - a) * t;
}

export function createRaceRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance'
  });
  renderer.setPixelRatio(
    typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1
  );
  renderer.setClearColor(0x9bc8f5, 1);
  if (renderer.shadowMap) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap ?? 2;
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9bc8f5);
  scene.fog = new THREE.Fog(0xb8d8f8, 210, 780);

  // Rich motorsport lighting: Ambient + Hemisphere sky/ground fill + Directional Sun
  const ambientLight = new THREE.AmbientLight(0xdbe8f8, 0.56);
  scene.add(ambientLight);

  if (typeof THREE.HemisphereLight === 'function') {
    const hemiLight = new THREE.HemisphereLight(0xd8ecff, 0x3b4d34, 0.65);
    hemiLight.position.set(0, 300, 0);
    scene.add(hemiLight);
  }

  const sunLight = new THREE.DirectionalLight(0xfff4dc, 1.15);
  sunLight.position.set(240, 380, 160);
  sunLight.castShadow = true;
  scene.add(sunLight);

  // Shared procedural PBR texture set
  const textureSet = createTextureSet();

  // ---------------------------------------------------------------------------
  // 3D ATMOSPHERIC SKY DOME, SUN ORB & CORONA, AND HIGH-ALTITUDE 3D CLOUDS
  // ---------------------------------------------------------------------------
  const skyGroup = new THREE.Group();
  scene.add(skyGroup);

  const skyGeo = new THREE.SphereGeometry(820, 24, 16);
  const skyPosAttr = skyGeo.attributes.position;
  if (skyPosAttr && skyPosAttr.array) {
    const skyColors = new Float32Array(skyPosAttr.count * 3);
    const sunDirLen = Math.hypot(240, 380, 160) || 1;
    const sdx = 240 / sunDirLen;
    const sdy = 380 / sunDirLen;
    const sdz = 160 / sunDirLen;

    // Zenith (0x1b4f9c) -> Mid sky (0x4b8be0) -> Warm horizon haze (0xcce6ff)
    const zenithR = 0x1b / 255, zenithG = 0x4f / 255, zenithB = 0x9c / 255;
    const midR = 0x4b / 255, midG = 0x8b / 255, midB = 0xe0 / 255;
    const horizR = 0xcc / 255, horizG = 0xe6 / 255, horizB = 0xff / 255;

    for (let i = 0; i < skyPosAttr.count; i++) {
      const vx = skyPosAttr.array[i * 3];
      const vy = skyPosAttr.array[i * 3 + 1];
      const vz = skyPosAttr.array[i * 3 + 2];
      const vLen = Math.hypot(vx, vy, vz) || 1;
      const nx = vx / vLen;
      const ny = vy / vLen;
      const nz = vz / vLen;

      const elev = clamp(ny, 0, 1);
      let r, g, b;
      if (elev < 0.35) {
        const t = elev / 0.35;
        r = horizR + (midR - horizR) * t;
        g = horizG + (midG - horizG) * t;
        b = horizB + (midB - horizB) * t;
      } else {
        const t = (elev - 0.35) / 0.65;
        r = midR + (zenithR - midR) * t;
        g = midG + (zenithG - midG) * t;
        b = midB + (zenithB - midB) * t;
      }

      // Subtle warm solar scatter toward the sun
      const sunDot = Math.max(0, nx * sdx + ny * sdy + nz * sdz);
      const sunGlow = Math.pow(sunDot, 6) * 0.28;
      r = clamp(r + sunGlow * 1.0, 0, 1);
      g = clamp(g + sunGlow * 0.85, 0, 1);
      b = clamp(b + sunGlow * 0.55, 0, 1);

      skyColors[i * 3] = r;
      skyColors[i * 3 + 1] = g;
      skyColors[i * 3 + 2] = b;
    }
    skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(skyColors, 3));
  }

  const skyMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    vertexColors: true,
    side: THREE.DoubleSide ?? 2,
    depthWrite: false,
    fog: false
  });
  const skyDomeMesh = new THREE.Mesh(skyGeo, skyMat);
  skyGroup.add(skyDomeMesh);

  // Glowing 3D Sun Orb & Corona aligned with sunLight
  const sunDist = 720;
  const sunNorm = Math.hypot(240, 380, 160) || 1;
  const sunPos = {
    x: (240 / sunNorm) * sunDist,
    y: (380 / sunNorm) * sunDist,
    z: (160 / sunNorm) * sunDist
  };

  const sunOrbMesh = new THREE.Mesh(
    new THREE.SphereGeometry(26, 14, 12),
    new THREE.MeshBasicMaterial({
      color: 0xfffce6,
      depthWrite: false,
      fog: false
    })
  );
  sunOrbMesh.position.set(sunPos.x, sunPos.y, sunPos.z);
  skyGroup.add(sunOrbMesh);

  const sunCoronaMesh = new THREE.Mesh(
    new THREE.SphereGeometry(58, 14, 12),
    new THREE.MeshBasicMaterial({
      color: 0xffe29a,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      fog: false
    })
  );
  sunCoronaMesh.position.set(sunPos.x, sunPos.y, sunPos.z);
  skyGroup.add(sunCoronaMesh);

  // High-altitude 3D cumulus cloud ring
  const cloudsGroup = new THREE.Group();
  skyGroup.add(cloudsGroup);
  const cloudPuffGeo = new THREE.SphereGeometry(1, 10, 8);
  const cloudMat = new THREE.MeshLambertMaterial({
    color: 0xf7fbff,
    transparent: true,
    opacity: 0.78,
    depthWrite: false
  });
  for (let c = 0; c < 22; c++) {
    const angle = (c / 22) * Math.PI * 2 + (c % 3) * 0.14;
    const rad = 360 + (c % 4) * 75;
    const cy = 195 + (c % 5) * 22;
    const cluster = new THREE.Group();
    cluster.position.set(Math.cos(angle) * rad, cy, Math.sin(angle) * rad);
    cluster.rotation.y = -angle;

    for (let p = 0; p < 3; p++) {
      const puff = new THREE.Mesh(cloudPuffGeo, cloudMat);
      const sx = 28 + ((c + p) % 3) * 12;
      const sy = 7 + (p % 2) * 3.5;
      const sz = 16 + (p % 3) * 7;
      puff.scale.set(sx, sy, sz);
      puff.position.set((p - 1) * 18, (p === 1 ? 3.5 : 0), (p % 2 === 0 ? 4 : -4));
      cluster.add(puff);
    }
    cloudsGroup.add(cluster);
  }

  const cameraP1 = new THREE.PerspectiveCamera(62, 16 / 9, 0.5, 1100);
  const cameraP2 = new THREE.PerspectiveCamera(62, 16 / 9, 0.5, 1100);

  let currentSplitMode = 'horizontal';
  let trackRoot = null;
  const ridersRoot = new THREE.Group();
  scene.add(ridersRoot);

  const startLightBulbs = [];
  const startLightMats = [];
  const riderRigs = new Map();

  const camState = [
    { x: -12, y: 3.5, z: 0, heading: 0, roll: 0, pitchOffset: 0, fov: 62, vibPhase: 0, initialized: false },
    { x: -12, y: 3.5, z: 0, heading: 0, roll: 0, pitchOffset: 0, fov: 62, vibPhase: 0, initialized: false }
  ];

  // ---------------------------------------------------------------------------
  // DYNAMIC PARTICLE & DECAL POOLS:
  // 1. Powerslide White Tire Smoke Puffs
  // 2. 2-Stroke Blue-White Exhaust Wisps
  // 3. Knee-Down Titanium Sparks
  // 4. Dynamic Asphalt Tire Skidmark Decals
  // ---------------------------------------------------------------------------
  const effectsGroup = new THREE.Group();
  scene.add(effectsGroup);

  // 1. White Tire Smoke Pool
  const smokePool = [];
  let smokeCursor = 0;
  const smokeGeo = new THREE.SphereGeometry(0.32, 8, 6);
  const smokeMat = new THREE.MeshLambertMaterial({
    color: 0xf2f5fa,
    transparent: true,
    opacity: 0.65,
    depthWrite: false
  });
  for (let i = 0; i < 56; i++) {
    const puff = new THREE.Mesh(smokeGeo, smokeMat);
    puff.visible = false;
    puff.userData = { life: 0, maxLife: 0.48, vx: 0, vy: 0, vz: 0, baseScale: 0.55 };
    effectsGroup.add(puff);
    smokePool.push(puff);
  }

  // 2. 2-Stroke Blue-White Exhaust Smoke Pool
  const exhaustPool = [];
  let exhaustCursor = 0;
  const exhaustGeo = new THREE.SphereGeometry(0.16, 6, 5);
  const exhaustMat = new THREE.MeshBasicMaterial({
    color: 0xb8d4ff,
    transparent: true,
    opacity: 0.34,
    depthWrite: false
  });
  for (let i = 0; i < 64; i++) {
    const wisp = new THREE.Mesh(exhaustGeo, exhaustMat);
    wisp.visible = false;
    wisp.userData = { life: 0, maxLife: 0.28, vx: 0, vy: 0, vz: 0 };
    effectsGroup.add(wisp);
    exhaustPool.push(wisp);
  }

  // 3. Knee-Slider Spark Pool
  const sparkPool = [];
  let sparkCursor = 0;
  const sparkGeo = new THREE.BoxGeometry(0.06, 0.06, 0.24);
  const sparkMat = new THREE.MeshBasicMaterial({
    color: 0xffc438,
    transparent: true,
    opacity: 0.92,
    depthWrite: false
  });
  for (let i = 0; i < 36; i++) {
    const sp = new THREE.Mesh(sparkGeo, sparkMat);
    sp.visible = false;
    sp.userData = { life: 0, vx: 0, vy: 0, vz: 0 };
    effectsGroup.add(sp);
    sparkPool.push(sp);
  }

  // 4. Dynamic Asphalt Tire Skidmark Decal Pool
  const skidPool = [];
  let skidCursor = 0;
  const skidGeo = new THREE.PlaneGeometry(1.35, 0.22);
  const skidMat = new THREE.MeshBasicMaterial({
    color: 0x101216,
    transparent: true,
    opacity: 0.56,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    side: THREE.DoubleSide ?? 2
  });
  for (let i = 0; i < 160; i++) {
    const decal = new THREE.Mesh(skidGeo, skidMat);
    decal.visible = false;
    decal.rotation.x = -Math.PI / 2;
    effectsGroup.add(decal);
    skidPool.push(decal);
  }

  function spawnTireSmokePuff(x, y, z, heading) {
    const puff = smokePool[smokeCursor];
    smokeCursor = (smokeCursor + 1) % smokePool.length;
    puff.position.set(
      x - Math.cos(heading) * 0.78 + (Math.random() - 0.5) * 0.32,
      y + 0.16,
      z - Math.sin(heading) * 0.78 + (Math.random() - 0.5) * 0.32
    );
    puff.scale.set(0.55, 0.45, 0.55);
    puff.visible = true;
    puff.userData.life = 0.46;
    puff.userData.vx = (Math.random() - 0.5) * 1.5;
    puff.userData.vy = 1.15 + Math.random() * 0.85;
    puff.userData.vz = (Math.random() - 0.5) * 1.5;
  }

  function spawnExhaustWisp(x, y, z, heading, speed) {
    const wisp = exhaustPool[exhaustCursor];
    exhaustCursor = (exhaustCursor + 1) % exhaustPool.length;
    const side = exhaustCursor % 2 === 0 ? -0.16 : 0.16;
    const nx = -Math.sin(heading);
    const nz = Math.cos(heading);
    wisp.position.set(
      x - Math.cos(heading) * 0.92 + nx * side,
      y + 0.56 + (Math.random() - 0.5) * 0.05,
      z - Math.sin(heading) * 0.92 + nz * side
    );
    wisp.scale.set(0.45, 0.45, 0.45);
    wisp.visible = true;
    wisp.userData.life = 0.24;
    const backSpeed = Math.max(2, speed * 0.15);
    wisp.userData.vx = -Math.cos(heading) * backSpeed + (Math.random() - 0.5) * 0.8;
    wisp.userData.vy = 0.65 + Math.random() * 0.45;
    wisp.userData.vz = -Math.sin(heading) * backSpeed + (Math.random() - 0.5) * 0.8;
  }

  function spawnKneeSpark(x, y, z, heading, leanSign) {
    const sp = sparkPool[sparkCursor];
    sparkCursor = (sparkCursor + 1) % sparkPool.length;
    const nx = -Math.sin(heading);
    const nz = Math.cos(heading);
    const lat = leanSign * 0.46;
    sp.position.set(
      x + nx * lat + (Math.random() - 0.5) * 0.12,
      y + 0.08 + Math.random() * 0.06,
      z + nz * lat + (Math.random() - 0.5) * 0.12
    );
    sp.rotation.y = -heading + (Math.random() - 0.5) * 0.4;
    sp.visible = true;
    sp.userData.life = 0.14;
    sp.userData.vx = -Math.cos(heading) * (3 + Math.random() * 3) + (Math.random() - 0.5) * 2.2;
    sp.userData.vy = 1.4 + Math.random() * 2.0;
    sp.userData.vz = -Math.sin(heading) * (3 + Math.random() * 3) + (Math.random() - 0.5) * 2.2;
  }

  function spawnSkidDecal(x, y, z, heading, lean = 0) {
    const decal = skidPool[skidCursor];
    skidCursor = (skidCursor + 1) % skidPool.length;
    const nx = -Math.sin(heading);
    const nz = Math.cos(heading);
    const slipOffset = clamp(lean * 0.12, -0.15, 0.15);
    decal.position.set(
      x - Math.cos(heading) * 0.62 + nx * slipOffset,
      y + 0.022,
      z - Math.sin(heading) * 0.62 + nz * slipOffset
    );
    decal.rotation.set(-Math.PI / 2, -heading, 0);
    decal.visible = true;
  }

  function updateParticles(dt) {
    for (let i = 0; i < smokePool.length; i++) {
      const p = smokePool[i];
      if (!p.visible) continue;
      p.userData.life -= dt;
      if (p.userData.life <= 0) {
        p.visible = false;
        continue;
      }
      p.position.x += p.userData.vx * dt;
      p.position.y += p.userData.vy * dt;
      p.position.z += p.userData.vz * dt;
      const s = 0.55 + (0.46 - p.userData.life) * 3.4;
      p.scale.set(s, s * 0.78, s);
    }

    for (let i = 0; i < exhaustPool.length; i++) {
      const w = exhaustPool[i];
      if (!w.visible) continue;
      w.userData.life -= dt;
      if (w.userData.life <= 0) {
        w.visible = false;
        continue;
      }
      w.position.x += w.userData.vx * dt;
      w.position.y += w.userData.vy * dt;
      w.position.z += w.userData.vz * dt;
      const s = 0.45 + (0.24 - w.userData.life) * 2.6;
      w.scale.set(s, s, s);
    }

    for (let i = 0; i < sparkPool.length; i++) {
      const sp = sparkPool[i];
      if (!sp.visible) continue;
      sp.userData.life -= dt;
      if (sp.userData.life <= 0) {
        sp.visible = false;
        continue;
      }
      sp.position.x += sp.userData.vx * dt;
      sp.position.y += sp.userData.vy * dt;
      sp.position.z += sp.userData.vz * dt;
      sp.userData.vy -= 9.8 * dt;
    }

    // Slowly drift high-altitude clouds
    cloudsGroup.rotation.y += dt * 0.0035;
  }

  // ---------------------------------------------------------------------------
  // UV-MAPPED & VERTEX-COLORED RIBBON MESH BUILDERS
  // ---------------------------------------------------------------------------
  function buildUVRibbonMesh(positions, normals, uvs, colors, matOptions) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    if (colors && colors.length > 0) {
      geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    }
    const mat = new THREE.MeshStandardMaterial(matOptions);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    return mesh;
  }

  function pushUVQuad(
    positions,
    normals,
    uvs,
    colors,
    p00,
    p10,
    p01,
    p11,
    uv00,
    uv10,
    uv01,
    uv11,
    c00,
    c10 = c00,
    c01 = c00,
    c11 = c10
  ) {
    const ux = p10.x - p00.x;
    const uy = p10.y - p00.y;
    const uz = p10.z - p00.z;
    const vx = p01.x - p00.x;
    const vy = p01.y - p00.y;
    const vz = p01.z - p00.z;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    if (ny < 0) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;

    const verts = [p00, p10, p11, p00, p11, p01];
    const texCoords = [uv00, uv10, uv11, uv00, uv11, uv01];
    const vertCols = [c00, c10, c11, c00, c11, c01];

    for (let i = 0; i < 6; i++) {
      const v = verts[i];
      const t = texCoords[i];
      const c = vertCols[i];
      positions.push(v.x, v.y, v.z);
      normals.push(nx, ny, nz);
      uvs.push(t[0], t[1]);
      if (colors) {
        colors.push(c[0], c[1], c[2]);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // PHOTOREALISTIC TEXTURED CIRCUIT & 1990 GP ARCHITECTURE
  // ---------------------------------------------------------------------------
  function buildTrackScene(track) {
    if (trackRoot) {
      scene.remove(trackRoot);
    }
    trackRoot = new THREE.Group();
    scene.add(trackRoot);
    startLightBulbs.length = 0;
    startLightMats.length = 0;
    for (let i = 0; i < skidPool.length; i++) {
      skidPool[i].visible = false;
    }

    // 1. Vast Mowed Stadium Grass Ground Plane (repeat 80x80)
    if (textureSet?.grass?.repeat?.set) {
      textureSet.grass.repeat.set(80, 80);
    }
    const groundGeo = new THREE.PlaneGeometry(3600, 3600);
    const groundMat = new THREE.MeshStandardMaterial({
      map: textureSet?.grass || null,
      color: 0xffffff,
      roughness: 0.88,
      metalness: 0.02
    });
    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.position.y = -0.75;
    groundMesh.receiveShadow = true;
    trackRoot.add(groundMesh);

    const samples = track.samples || [];
    const n = samples.length;
    if (n < 3) return;

    const totalLen = track.totalLength || n * 2.4;
    const ds = totalLen / n;
    const halfW = track.halfWidth || 7;
    const kerbW = track.kerbWidth || 1.6;
    const vergeW = 10.5;

    // 2. Scan track samples for corners (|curvature| > 0.004) and compute
    //    65m braking zone + apex racing-line rubber darkening
    const brakingRubber = new Float32Array(n);
    const racingLineOffset = new Float32Array(n);
    const lookAheadSteps = Math.max(1, Math.ceil(65 / ds));

    for (let i = 0; i < n; i++) {
      let maxRubber = 0;
      let weightedLineD = 0;
      let weightSum = 0;

      for (let k = -6; k <= lookAheadSteps; k++) {
        const j = (i + k + n) % n;
        const curv = samples[j].curvature || 0;
        const absCurv = Math.abs(curv);
        if (absCurv > 0.004) {
          const distAhead = k * ds;
          const cornerStrength = clamp((absCurv - 0.004) / 0.011, 0.15, 1.0);
          let zoneFactor = 0;
          if (distAhead >= 0 && distAhead <= 65) {
            // Braking zone leading into corner (strongest 10m..55m before apex)
            zoneFactor = Math.sin((1 - distAhead / 65) * Math.PI * 0.85);
          } else if (distAhead < 0) {
            // Apex exit trail
            zoneFactor = Math.max(0, 1 + distAhead / (6 * ds)) * 0.75;
          }
          const intensity = cornerStrength * zoneFactor;
          if (intensity > maxRubber) maxRubber = intensity;

          // Racing line sweeps from outside on braking entry to inside at apex
          const sign = Math.sign(curv) || 1;
          const entryToApex = clamp(1 - Math.max(0, distAhead) / 55, 0, 1);
          const targetD = sign * halfW * (-0.48 + entryToApex * 1.02);
          weightedLineD += targetD * (intensity + 0.05);
          weightSum += intensity + 0.05;
        }
      }

      brakingRubber[i] = clamp(maxRubber, 0, 1);
      racingLineOffset[i] = weightSum > 0 ? weightedLineD / weightSum : 0;
    }

    // Smooth racingLineOffset and brakingRubber along loop
    const smoothRubber = new Float32Array(n);
    const smoothLineD = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let rSum = 0;
      let dSum = 0;
      for (let m = -3; m <= 3; m++) {
        const idx = (i + m + n) % n;
        rSum += brakingRubber[idx];
        dSum += racingLineOffset[idx];
      }
      smoothRubber[i] = rSum / 7;
      smoothLineD[i] = dSum / 7;
    }

    // Geometry attribute accumulators for separate textured meshes
    const asphaltPos = [], asphaltNrm = [], asphaltUv = [], asphaltCol = [];
    const kerbRedPos = [], kerbRedNrm = [], kerbRedUv = [], kerbRedCol = [];
    const kerbBluePos = [], kerbBlueNrm = [], kerbBlueUv = [], kerbBlueCol = [];
    const gravelPos = [], gravelNrm = [], gravelUv = [], gravelCol = [];
    const skirtPos = [], skirtNrm = [], skirtUv = [], skirtCol = [];
    const paintPos = [], paintNrm = [], paintUv = [], paintCol = [];

    const pt = (samp, d, yOff = 0) => ({
      x: samp.x + d * samp.nx,
      y: samp.y + yOff,
      z: samp.z + d * samp.nz
    });

    const asphaltStrips = 6;
    const whiteCol = [0.95, 0.96, 0.98];

    const sampleAsphaltColor = (idx, d) => {
      const mIdx = idx % n;
      const rub = smoothRubber[mIdx];
      const lineD = smoothLineD[mIdx];
      const distToLine = Math.abs(d - lineD);
      const groove = Math.exp(-(distToLine * distToLine) / (2 * 2.1 * 2.1));
      const centerWear = Math.exp(-(d * d) / (2 * 3.2 * 3.2)) * 0.08;
      const darken = clamp(rub * groove * 0.58 + centerWear, 0, 0.62);
      const base = idx % 2 === 0 ? 0.96 : 0.93;
      const c = base * (1 - darken);
      return [c, c, c * 1.02];
    };

    for (let i = 0; i < n; i++) {
      const s0 = samples[i];
      const s1 = samples[(i + 1) % n];
      const arc0 = i * ds;
      const arc1 = (i + 1) * ds;

      // A. Asphalt Track Ribbon with continuous UVs (s/14, 0..1) & Braking Zone Skidmarks
      const v0 = arc0 / 14;
      const v1 = arc1 / 14;
      for (let st = 0; st < asphaltStrips; st++) {
        const uL = st / asphaltStrips;
        const uR = (st + 1) / asphaltStrips;
        const dL = -halfW + uL * (halfW * 2);
        const dR = -halfW + uR * (halfW * 2);

        const c00 = sampleAsphaltColor(i, dL);
        const c10 = sampleAsphaltColor(i, dR);
        const c01 = sampleAsphaltColor(i + 1, dL);
        const c11 = sampleAsphaltColor(i + 1, dR);

        pushUVQuad(
          asphaltPos, asphaltNrm, asphaltUv, asphaltCol,
          pt(s0, dL, 0), pt(s0, dR, 0), pt(s1, dL, 0), pt(s1, dR, 0),
          [uL, v0], [uR, v0], [uL, v1], [uR, v1],
          c00, c10, c01, c11
        );
      }

      // B. 3D Beveled Rumble Kerbs (Red/White on corners, Blue/White on straights)
      const isCorner = Math.abs(s0.curvature) > 0.0022;
      const kv0 = arc0 / 3.2;
      const kv1 = arc1 / 3.2;
      const kPos = isCorner ? kerbRedPos : kerbBluePos;
      const kNrm = isCorner ? kerbRedNrm : kerbBlueNrm;
      const kUv = isCorner ? kerbRedUv : kerbBlueUv;
      const kCol = isCorner ? kerbRedCol : kerbBlueCol;
      const kHeight = isCorner ? 0.075 : 0.032;
      const kTint = [0.98, 0.98, 0.98];

      // Left 3D Beveled Kerb (inner bevel + raised top deck)
      const lInner = -halfW;
      const lMid = -halfW - kerbW * 0.28;
      const lOuter = -halfW - kerbW;
      pushUVQuad(
        kPos, kNrm, kUv, kCol,
        pt(s0, lMid, kHeight), pt(s0, lInner, 0.008), pt(s1, lMid, kHeight), pt(s1, lInner, 0.008),
        [0.72, kv0], [1.0, kv0], [0.72, kv1], [1.0, kv1],
        kTint
      );
      pushUVQuad(
        kPos, kNrm, kUv, kCol,
        pt(s0, lOuter, 0.015), pt(s0, lMid, kHeight), pt(s1, lOuter, 0.015), pt(s1, lMid, kHeight),
        [0.0, kv0], [0.72, kv0], [0.0, kv1], [0.72, kv1],
        kTint
      );

      // Right 3D Beveled Kerb (inner bevel + raised top deck)
      const rInner = halfW;
      const rMid = halfW + kerbW * 0.28;
      const rOuter = halfW + kerbW;
      pushUVQuad(
        kPos, kNrm, kUv, kCol,
        pt(s0, rInner, 0.008), pt(s0, rMid, kHeight), pt(s1, rInner, 0.008), pt(s1, rMid, kHeight),
        [0.0, kv0], [0.28, kv0], [0.0, kv1], [0.28, kv1],
        kTint
      );
      pushUVQuad(
        kPos, kNrm, kUv, kCol,
        pt(s0, rMid, kHeight), pt(s0, rOuter, 0.015), pt(s1, rMid, kHeight), pt(s1, rOuter, 0.015),
        [0.28, kv0], [1.0, kv0], [0.28, kv1], [1.0, kv1],
        kTint
      );

      // C. Textured Gravel Traps & Run-Off Verges
      const gv0 = arc0 / 10;
      const gv1 = arc1 / 10;
      const gTint = i % 2 === 0 ? [0.97, 0.95, 0.91] : [0.93, 0.91, 0.87];
      pushUVQuad(
        gravelPos, gravelNrm, gravelUv, gravelCol,
        pt(s0, -halfW - kerbW - vergeW, -0.05), pt(s0, -halfW - kerbW, 0.01),
        pt(s1, -halfW - kerbW - vergeW, -0.05), pt(s1, -halfW - kerbW, 0.01),
        [0, gv0], [1.5, gv0], [0, gv1], [1.5, gv1],
        gTint
      );
      pushUVQuad(
        gravelPos, gravelNrm, gravelUv, gravelCol,
        pt(s0, halfW + kerbW, 0.01), pt(s0, halfW + kerbW + vergeW, -0.05),
        pt(s1, halfW + kerbW, 0.01), pt(s1, halfW + kerbW + vergeW, -0.05),
        [0, gv0], [1.5, gv0], [0, gv1], [1.5, gv1],
        gTint
      );

      // D. 3D Grassy Hillside Embankment Skirts down to ground plane (grounds elevated sections)
      const skirtOuter = halfW + kerbW + vergeW + 34;
      const sv0 = arc0 / 18;
      const sv1 = arc1 / 18;
      const sTint = [0.88, 0.92, 0.86];
      pushUVQuad(
        skirtPos, skirtNrm, skirtUv, skirtCol,
        { x: s0.x - skirtOuter * s0.nx, y: -0.75, z: s0.z - skirtOuter * s0.nz },
        pt(s0, -halfW - kerbW - vergeW, -0.05),
        { x: s1.x - skirtOuter * s1.nx, y: -0.75, z: s1.z - skirtOuter * s1.nz },
        pt(s1, -halfW - kerbW - vergeW, -0.05),
        [0, sv0], [2, sv0], [0, sv1], [2, sv1],
        sTint
      );
      pushUVQuad(
        skirtPos, skirtNrm, skirtUv, skirtCol,
        pt(s0, halfW + kerbW + vergeW, -0.05),
        { x: s0.x + skirtOuter * s0.nx, y: -0.75, z: s0.z + skirtOuter * s0.nz },
        pt(s1, halfW + kerbW + vergeW, -0.05),
        { x: s1.x + skirtOuter * s1.nx, y: -0.75, z: s1.z + skirtOuter * s1.nz },
        [0, sv0], [2, sv0], [0, sv1], [2, sv1],
        sTint
      );

      // E. Crisp Painted White Track Edge Lines
      pushUVQuad(
        paintPos, paintNrm, paintUv, paintCol,
        pt(s0, -halfW + 0.06, 0.016), pt(s0, -halfW + 0.26, 0.016),
        pt(s1, -halfW + 0.06, 0.016), pt(s1, -halfW + 0.26, 0.016),
        [0, 0], [1, 0], [0, 1], [1, 1],
        whiteCol
      );
      pushUVQuad(
        paintPos, paintNrm, paintUv, paintCol,
        pt(s0, halfW - 0.26, 0.016), pt(s0, halfW - 0.06, 0.016),
        pt(s1, halfW - 0.26, 0.016), pt(s1, halfW - 0.06, 0.016),
        [0, 0], [1, 0], [0, 1], [1, 1],
        whiteCol
      );
    }

    // Add Track Meshes to trackRoot
    trackRoot.add(
      buildUVRibbonMesh(asphaltPos, asphaltNrm, asphaltUv, asphaltCol, {
        map: textureSet?.asphalt || null,
        color: 0xffffff,
        roughness: 0.62,
        metalness: 0.08,
        vertexColors: true
      })
    );

    if (kerbRedPos.length > 0) {
      trackRoot.add(
        buildUVRibbonMesh(kerbRedPos, kerbRedNrm, kerbRedUv, kerbRedCol, {
          map: textureSet?.kerbRedWhite || null,
          color: 0xffffff,
          roughness: 0.52,
          metalness: 0.05,
          vertexColors: true
        })
      );
    }

    if (kerbBluePos.length > 0) {
      trackRoot.add(
        buildUVRibbonMesh(kerbBluePos, kerbBlueNrm, kerbBlueUv, kerbBlueCol, {
          map: textureSet?.kerbBlueWhite || null,
          color: 0xffffff,
          roughness: 0.55,
          metalness: 0.05,
          vertexColors: true
        })
      );
    }

    trackRoot.add(
      buildUVRibbonMesh(gravelPos, gravelNrm, gravelUv, gravelCol, {
        map: textureSet?.gravel || null,
        color: 0xffffff,
        roughness: 0.9,
        metalness: 0.02,
        vertexColors: true
      })
    );

    trackRoot.add(
      buildUVRibbonMesh(skirtPos, skirtNrm, skirtUv, skirtCol, {
        map: textureSet?.grass || null,
        color: 0xffffff,
        roughness: 0.88,
        metalness: 0.02,
        vertexColors: true
      })
    );

    // 3. Checkered Start/Finish Line (polygonOffset: true) & Painted P1..P8 Starting Grid Boxes
    const sf0 = track.sampleAtS ? track.sampleAtS(0) : samples[0];
    const sf1 = track.sampleAtS ? track.sampleAtS(3.4) : samples[1];
    const sfPos = [], sfNrm = [], sfUv = [], sfCol = [];
    pushUVQuad(
      sfPos, sfNrm, sfUv, sfCol,
      pt(sf0, -halfW, 0.024), pt(sf0, halfW, 0.024),
      pt(sf1, -halfW, 0.024), pt(sf1, halfW, 0.024),
      [0, 0], [1, 0], [0, 1], [1, 1],
      [1, 1, 1]
    );
    const startFinishMesh = buildUVRibbonMesh(sfPos, sfNrm, sfUv, sfCol, {
      map: textureSet?.startFinish || null,
      color: 0xffffff,
      roughness: 0.45,
      metalness: 0.06,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    });
    trackRoot.add(startFinishMesh);

    // Starting Grid Slots (P1..P8) painted on the main straight
    if (typeof track.sampleAtS === 'function') {
      for (let slot = 0; slot < 8; slot++) {
        const row = Math.floor(slot / 2);
        const col = slot % 2;
        const gridS = Math.max(2.5, 18.0 - row * 3.8 - col * 1.1);
        const gridD = col === 0 ? -2.25 : 2.25;
        const boxFront = track.sampleAtS(gridS + 0.9);
        const boxFrontIn = track.sampleAtS(gridS + 0.72);
        const boxBack = track.sampleAtS(gridS - 0.85);
        const boxCol = slot < 2 ? [1.0, 0.92, 0.35] : [0.95, 0.96, 0.98];

        // Front line of grid box
        pushUVQuad(
          paintPos, paintNrm, paintUv, paintCol,
          pt(boxFrontIn, gridD - 0.85, 0.02), pt(boxFrontIn, gridD + 0.85, 0.02),
          pt(boxFront, gridD - 0.85, 0.02), pt(boxFront, gridD + 0.85, 0.02),
          [0, 0], [1, 0], [0, 1], [1, 1],
          boxCol
        );
        // Left & right side brackets of grid box
        pushUVQuad(
          paintPos, paintNrm, paintUv, paintCol,
          pt(boxBack, gridD - 0.85, 0.02), pt(boxBack, gridD - 0.7, 0.02),
          pt(boxFront, gridD - 0.85, 0.02), pt(boxFront, gridD - 0.7, 0.02),
          [0, 0], [1, 0], [0, 1], [1, 1],
          boxCol
        );
        pushUVQuad(
          paintPos, paintNrm, paintUv, paintCol,
          pt(boxBack, gridD + 0.7, 0.02), pt(boxBack, gridD + 0.85, 0.02),
          pt(boxFront, gridD + 0.7, 0.02), pt(boxFront, gridD + 0.85, 0.02),
          [0, 0], [1, 0], [0, 1], [1, 1],
          boxCol
        );
      }
    }

    const paintMesh = buildUVRibbonMesh(paintPos, paintNrm, paintUv, paintCol, {
      color: 0xffffff,
      roughness: 0.48,
      metalness: 0.05,
      vertexColors: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1
    });
    trackRoot.add(paintMesh);

    // -------------------------------------------------------------------------
    // 4. START/FINISH GANTRY BRIDGE & PIT LANE GARAGE / CONTROL TOWER COMPLEX
    // -------------------------------------------------------------------------
    const gantryGroup = new THREE.Group();
    gantryGroup.position.set(sf0.x, sf0.y, sf0.z);
    gantryGroup.rotation.y = -sf0.tangentAngle;

    const steelMat = new THREE.MeshStandardMaterial({
      color: 0x262c36,
      roughness: 0.35,
      metalness: 0.75
    });
    const crimsonMetalMat = new THREE.MeshStandardMaterial({
      color: 0xd91424,
      roughness: 0.28,
      metalness: 0.35
    });

    const pillarGeo = new THREE.BoxGeometry(0.75, 6.8, 0.75);
    const leftPillar = new THREE.Mesh(pillarGeo, steelMat);
    leftPillar.position.set(0, 3.4, -(halfW + 2.0));
    const rightPillar = new THREE.Mesh(pillarGeo, steelMat);
    rightPillar.position.set(0, 3.4, halfW + 2.0);
    gantryGroup.add(leftPillar, rightPillar);

    const spanW = (halfW + 2.3) * 2;
    const crossbar = new THREE.Mesh(new THREE.BoxGeometry(1.25, 1.45, spanW), crimsonMetalMat);
    crossbar.position.set(0, 6.2, 0);
    gantryGroup.add(crossbar);

    // Sponsor banner board atop gantry
    const bannerTex0 = textureSet?.banners?.[0] || null;
    const gantryBanner = new THREE.Mesh(
      new THREE.BoxGeometry(0.25, 1.35, halfW * 1.85),
      new THREE.MeshStandardMaterial({
        map: bannerTex0,
        color: 0xffffff,
        roughness: 0.4,
        metalness: 0.1
      })
    );
    gantryBanner.position.set(-0.58, 7.55, 0);
    gantryGroup.add(gantryBanner);

    // 5 Start Light Pods & Glowing Lenses
    const podGeo = new THREE.BoxGeometry(0.55, 0.95, 0.85);
    const bulbGeo = new THREE.SphereGeometry(0.32, 12, 10);
    for (let b = 0; b < 5; b++) {
      const zPos = (b - 2) * 1.55;
      const pod = new THREE.Mesh(podGeo, steelMat);
      pod.position.set(-0.55, 6.1, zPos);
      gantryGroup.add(pod);

      const bMat = new THREE.MeshBasicMaterial({ color: 0x2a1111 });
      const bulb = new THREE.Mesh(bulbGeo, bMat);
      bulb.position.set(-0.82, 6.1, zPos);
      gantryGroup.add(bulb);
      startLightBulbs.push(bulb);
      startLightMats.push(bMat);
    }
    trackRoot.add(gantryGroup);

    // Pit Lane Garage Complex & Race Control Tower along s = 0..180m (Right side)
    if (typeof track.sampleAtS === 'function') {
      const pitBuildingMat = new THREE.MeshStandardMaterial({
        map: textureSet?.pitBuilding || null,
        color: 0xffffff,
        roughness: 0.48,
        metalness: 0.18
      });
      const concreteMat = new THREE.MeshStandardMaterial({
        color: 0xd4dae3,
        roughness: 0.65,
        metalness: 0.08
      });
      const glassMat = new THREE.MeshPhysicalMaterial
        ? new THREE.MeshPhysicalMaterial({
            color: 0x1a3654,
            roughness: 0.12,
            metalness: 0.85,
            clearcoat: 1.0
          })
        : new THREE.MeshStandardMaterial({
            color: 0x1a3654,
            roughness: 0.15,
            metalness: 0.8
          });

      // Modular Pit Garage Bays along s = 15..175m
      const bayGeo = new THREE.BoxGeometry(26, 7.5, 9.5);
      const canopyGeo = new THREE.BoxGeometry(26.4, 0.45, 11.8);
      const pitWallGeo = new THREE.BoxGeometry(26, 1.15, 0.45);
      for (let sPit = 22; sPit <= 170; sPit += 28) {
        const smp = track.sampleAtS(sPit);
        const bayGroup = new THREE.Group();
        bayGroup.position.set(smp.x, smp.y, smp.z);
        bayGroup.rotation.y = -smp.tangentAngle;

        const pitD = halfW + kerbW + 10.2;
        const garageMesh = new THREE.Mesh(bayGeo, pitBuildingMat);
        garageMesh.position.set(0, 3.75, pitD);
        bayGroup.add(garageMesh);

        const roofCanopy = new THREE.Mesh(canopyGeo, concreteMat);
        roofCanopy.position.set(0, 7.65, pitD - 0.8);
        bayGroup.add(roofCanopy);

        const pitWall = new THREE.Mesh(pitWallGeo, concreteMat);
        pitWall.position.set(0, 0.58, halfW + kerbW + 2.4);
        bayGroup.add(pitWall);

        trackRoot.add(bayGroup);
      }

      // 4-Story FIM Race Control Tower at s = 8m
      const twSmp = track.sampleAtS(8);
      const towerGroup = new THREE.Group();
      towerGroup.position.set(twSmp.x, twSmp.y, twSmp.z);
      towerGroup.rotation.y = -twSmp.tangentAngle;
      const towerD = halfW + kerbW + 10.5;

      const towerCore = new THREE.Mesh(new THREE.BoxGeometry(10, 17, 9), concreteMat);
      towerCore.position.set(0, 8.5, towerD);
      towerGroup.add(towerCore);

      const controlDeck = new THREE.Mesh(new THREE.BoxGeometry(11.6, 3.6, 10.6), glassMat);
      controlDeck.position.set(0, 13.8, towerD - 0.8);
      towerGroup.add(controlDeck);

      const towerCrown = new THREE.Mesh(new THREE.BoxGeometry(12.2, 0.9, 11.2), crimsonMetalMat);
      towerCrown.position.set(0, 16.2, towerD - 0.8);
      towerGroup.add(towerCrown);

      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.14, 5.5, 8), steelMat);
      mast.position.set(0, 19.2, towerD - 0.8);
      towerGroup.add(mast);

      trackRoot.add(towerGroup);
    }

    // -------------------------------------------------------------------------
    // 5. CORNER BRAKING DISTANCE MARKER BOARDS (150m, 100m, 50m)
    // -------------------------------------------------------------------------
    if (typeof track.sampleAtS === 'function') {
      const cornerApexS = [];
      for (let i = 0; i < n; i++) {
        const c = Math.abs(samples[i].curvature);
        if (c > 0.0045) {
          const sHere = samples[i].s;
          const prevCorner = cornerApexS[cornerApexS.length - 1];
          if (!prevCorner || Math.abs(sHere - prevCorner.s) > 175) {
            cornerApexS.push({ s: sHere, curv: samples[i].curvature });
          } else if (c > Math.abs(prevCorner.curv)) {
            prevCorner.s = sHere;
            prevCorner.curv = samples[i].curvature;
          }
        }
      }

      const boardPostGeo = new THREE.CylinderGeometry(0.06, 0.06, 1.3, 6);
      const boardPanelGeo = new THREE.BoxGeometry(0.12, 0.95, 1.35);
      const stripeGeo = new THREE.BoxGeometry(0.15, 0.12, 1.15);
      const boardGreenMat = new THREE.MeshStandardMaterial({ color: 0x0f5c2e, roughness: 0.5 });
      const stripeWhiteMat = new THREE.MeshBasicMaterial({ color: 0xf8fafc });

      for (let cIdx = 0; cIdx < cornerApexS.length; cIdx++) {
        const corner = cornerApexS[cIdx];
        const outsideSign = -(Math.sign(corner.curv) || 1);
        const distances = [150, 100, 50];

        for (let m = 0; m < distances.length; m++) {
          const distM = distances[m];
          const markerS = track.wrapS(corner.s - distM);
          const smp = track.sampleAtS(markerS);
          const markerD = outsideSign * (halfW + kerbW + 2.35);

          const boardGroup = new THREE.Group();
          boardGroup.position.set(smp.x + markerD * smp.nx, smp.y, smp.z + markerD * smp.nz);
          boardGroup.rotation.y = -smp.tangentAngle + outsideSign * 0.22;

          const post = new THREE.Mesh(boardPostGeo, steelMat);
          post.position.set(0, 0.65, 0);
          boardGroup.add(post);

          const panel = new THREE.Mesh(boardPanelGeo, boardGreenMat);
          panel.position.set(0, 1.05, 0);
          boardGroup.add(panel);

          const numStripes = 3 - m; // 3 stripes = 150m, 2 = 100m, 1 = 50m
          for (let st = 0; st < numStripes; st++) {
            const stripe = new THREE.Mesh(stripeGeo, stripeWhiteMat);
            stripe.position.set(0, 0.82 + st * 0.24, 0);
            boardGroup.add(stripe);
          }

          trackRoot.add(boardGroup);
        }
      }
    }

    // -------------------------------------------------------------------------
    // 6. OVERHEAD SPONSOR BRIDGES & TRACKSIDE BILLBOARDS
    // -------------------------------------------------------------------------
    const banners = textureSet?.banners || [];
    const bannerMats = [0, 1, 2, 3].map(
      (idx) =>
        new THREE.MeshStandardMaterial({
          map: banners[idx % Math.max(1, banners.length)] || null,
          color: 0xffffff,
          roughness: 0.42,
          metalness: 0.1
        })
    );

    if (typeof track.sampleAtS === 'function') {
      const bridgeFracs = [0.28, 0.58, 0.84];
      const bridgeLegGeo = new THREE.BoxGeometry(0.9, 6.6, 0.9);
      const bridgeSpanGeo = new THREE.BoxGeometry(1.4, 1.75, (halfW + 3.2) * 2);

      for (let b = 0; b < bridgeFracs.length; b++) {
        const smp = track.sampleAtS(totalLen * bridgeFracs[b]);
        const arch = new THREE.Group();
        arch.position.set(smp.x, smp.y, smp.z);
        arch.rotation.y = -smp.tangentAngle;

        const legL = new THREE.Mesh(bridgeLegGeo, steelMat);
        legL.position.set(0, 3.3, -(halfW + 2.8));
        const legR = new THREE.Mesh(bridgeLegGeo, steelMat);
        legR.position.set(0, 3.3, halfW + 2.8);
        const span = new THREE.Mesh(bridgeSpanGeo, bannerMats[b % bannerMats.length]);
        span.position.set(0, 6.1, 0);

        arch.add(legL, legR, span);
        trackRoot.add(arch);
      }

      // Trackside Advertising Billboards
      const bbGeo = new THREE.BoxGeometry(8.5, 2.1, 0.25);
      for (let k = 0; k < 16; k++) {
        const sPos = ((k + 0.5) / 16) * totalLen;
        if (sPos < 160) continue; // Keep pit lane clear
        const smp = track.sampleAtS(sPos);
        const side = k % 2 === 0 ? -1 : 1;
        const d = side * (halfW + kerbW + 6.4);

        const bb = new THREE.Mesh(bbGeo, bannerMats[k % bannerMats.length]);
        bb.position.set(smp.x + d * smp.nx, smp.y + 1.25, smp.z + d * smp.nz);
        bb.rotation.y = -smp.tangentAngle + (side > 0 ? 0.12 : -0.12);
        trackRoot.add(bb);
      }
    }

    // -------------------------------------------------------------------------
    // 7. GRANDSTANDS WITH 3D CANOPY ROOFS & CROWD MOSAIC
    // -------------------------------------------------------------------------
    const crowdMat = new THREE.MeshStandardMaterial({
      map: textureSet?.crowd || null,
      color: 0xffffff,
      roughness: 0.72,
      metalness: 0.05
    });
    const canopyRoofMat = new THREE.MeshStandardMaterial({
      color: 0xf2f5fa,
      roughness: 0.4,
      metalness: 0.25
    });
    const standBaseMat = new THREE.MeshStandardMaterial({
      color: 0x344156,
      roughness: 0.65,
      metalness: 0.15
    });

    const standFracs = [0.02, 0.05, 0.08, 0.22, 0.36, 0.52, 0.69, 0.88];
    const baseGeo = new THREE.BoxGeometry(24, 4.2, 7.5);
    const crowdSlopeGeo = new THREE.BoxGeometry(23.6, 4.6, 6.2);
    const roofGeo = new THREE.BoxGeometry(24.6, 0.5, 8.8);
    const fasciaGeo = new THREE.BoxGeometry(24.8, 0.65, 0.35);

    for (let k = 0; k < standFracs.length; k++) {
      const idx = Math.floor(standFracs[k] * n) % n;
      const s = samples[idx];
      // Place main straight grandstands on left (-1) opposite pit garages
      const side = k < 3 ? -1 : k % 2 === 0 ? -1 : 1;
      const d = side * (halfW + kerbW + 15.5);

      const standGroup = new THREE.Group();
      standGroup.position.set(s.x + d * s.nx, s.y, s.z + d * s.nz);
      standGroup.rotation.y = -s.tangentAngle + (side > 0 ? Math.PI : 0);

      const baseMesh = new THREE.Mesh(baseGeo, standBaseMat);
      baseMesh.position.set(0, 2.1, -1.2);
      standGroup.add(baseMesh);

      const crowdMesh = new THREE.Mesh(crowdSlopeGeo, crowdMat);
      crowdMesh.position.set(0, 3.6, 0.4);
      crowdMesh.rotation.x = 0.38;
      standGroup.add(crowdMesh);

      const roofMesh = new THREE.Mesh(roofGeo, canopyRoofMat);
      roofMesh.position.set(0, 7.2, 0.2);
      roofMesh.rotation.x = -0.08;
      standGroup.add(roofMesh);

      const fasciaMesh = new THREE.Mesh(fasciaGeo, crimsonMetalMat);
      fasciaMesh.position.set(0, 7.45, 4.5);
      standGroup.add(fasciaMesh);

      trackRoot.add(standGroup);
    }

    // -------------------------------------------------------------------------
    // 8. INSTANCED GUARDRAILS, CORNER TIRE WALLS, 3D TREES & MOUNTAIN RIDGES
    // -------------------------------------------------------------------------
    const dummyMat = new THREE.Matrix4();

    // A. Corrugated Armco Guardrails
    const barrierStep = 6;
    const barrierCount = Math.floor(n / barrierStep) * 2;
    const barrierGeo = new THREE.BoxGeometry(4.2, 0.85, 0.32);
    const barrierMat = new THREE.MeshStandardMaterial({
      color: 0xd8dfe8,
      roughness: 0.42,
      metalness: 0.58
    });
    const barriersInst = new THREE.InstancedMesh(barrierGeo, barrierMat, barrierCount);
    let bIdx = 0;
    for (let i = 0; i < n; i += barrierStep) {
      const s = samples[i];
      for (const side of [-1, 1]) {
        const d = side * (halfW + kerbW + 5.2);
        dummyMat.makeRotationY(-s.tangentAngle);
        dummyMat.setPosition(s.x + d * s.nx, s.y + 0.44, s.z + d * s.nz);
        barriersInst.setMatrixAt(bIdx, dummyMat);
        barriersInst.setColorAt(
          bIdx,
          new THREE.Color((i / barrierStep) % 2 === 0 ? 0xe8edf5 : 0xd91424)
        );
        bIdx++;
      }
    }
    trackRoot.add(barriersInst);

    // B. Red/White Tire Walls on Outside of Corners
    const tireSamples = [];
    for (let i = 0; i < n; i += 3) {
      if (Math.abs(samples[i].curvature) > 0.0032) {
        tireSamples.push(samples[i]);
      }
    }
    if (tireSamples.length > 0) {
      const tireWallGeo = new THREE.CylinderGeometry(0.52, 0.52, 1.08, 10);
      const tireWallMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.78,
        metalness: 0.05
      });
      const tireWallsInst = new THREE.InstancedMesh(tireWallGeo, tireWallMat, tireSamples.length);
      for (let t = 0; t < tireSamples.length; t++) {
        const s = tireSamples[t];
        const outsideSide = -(Math.sign(s.curvature) || 1);
        const d = outsideSide * (halfW + kerbW + 4.45);
        dummyMat.identity();
        dummyMat.setPosition(s.x + d * s.nx, s.y + 0.54, s.z + d * s.nz);
        tireWallsInst.setMatrixAt(t, dummyMat);
        tireWallsInst.setColorAt(
          t,
          new THREE.Color(t % 2 === 0 ? 0xd91424 : 0xf4f6fa)
        );
      }
      trackRoot.add(tireWallsInst);
    }

    // C. Lush 3D Multi-Tier Trees (Trunks + Lower & Upper Foliage Cones)
    const treeStep = 12;
    const treeCount = Math.floor(n / treeStep) * 2;
    const trunkGeo = new THREE.CylinderGeometry(0.24, 0.38, 2.6, 7);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x4d3624 });
    const lowerCrownGeo = new THREE.CylinderGeometry(0.5, 2.7, 4.4, 8);
    const upperCrownGeo = new THREE.CylinderGeometry(0.15, 2.0, 3.8, 8);
    const foliageMat = new THREE.MeshLambertMaterial({ color: 0x265c28 });

    const trunksInst = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
    const lowerCrownInst = new THREE.InstancedMesh(lowerCrownGeo, foliageMat, treeCount);
    const upperCrownInst = new THREE.InstancedMesh(upperCrownGeo, foliageMat, treeCount);

    let tIdx = 0;
    for (let i = 0; i < n; i += treeStep) {
      const s = samples[i];
      for (const side of [-1, 1]) {
        const d = side * (halfW + 20 + ((i * 7) % 14));
        const tx = s.x + d * s.nx;
        const ty = s.y;
        const tz = s.z + d * s.nz;

        dummyMat.identity();
        dummyMat.setPosition(tx, ty + 1.2, tz);
        trunksInst.setMatrixAt(tIdx, dummyMat);

        dummyMat.setPosition(tx, ty + 3.6, tz);
        lowerCrownInst.setMatrixAt(tIdx, dummyMat);
        lowerCrownInst.setColorAt(
          tIdx,
          new THREE.Color(side > 0 ? 0x245e28 : 0x2d6b30)
        );

        dummyMat.setPosition(tx, ty + 6.0, tz);
        upperCrownInst.setMatrixAt(tIdx, dummyMat);
        upperCrownInst.setColorAt(
          tIdx,
          new THREE.Color(side > 0 ? 0x2f7332 : 0x387d3b)
        );
        tIdx++;
      }
    }
    trackRoot.add(trunksInst, lowerCrownInst, upperCrownInst);

    // D. Distant 3D Mountain Ridges around the Circuit Perimeter
    let centerX = 0;
    let centerZ = 0;
    for (let i = 0; i < n; i += 4) {
      centerX += samples[i].x;
      centerZ += samples[i].z;
    }
    const denom = Math.ceil(n / 4) || 1;
    centerX /= denom;
    centerZ /= denom;

    const mountainPeaks = 36;
    const mountainGeo = new THREE.CylinderGeometry(4, 115, 115, 6);
    const mountainMat = new THREE.MeshLambertMaterial({ color: 0x4b6278 });
    const mountainsInst = new THREE.InstancedMesh(mountainGeo, mountainMat, mountainPeaks);

    for (let m = 0; m < mountainPeaks; m++) {
      const ang = (m / mountainPeaks) * Math.PI * 2;
      const dist = 680 + (m % 3) * 55;
      const hScale = 0.75 + ((m * 13) % 7) * 0.14;
      const mx = centerX + Math.cos(ang) * dist;
      const mz = centerZ + Math.sin(ang) * dist;

      dummyMat.makeRotationY(ang);
      dummyMat.elements[0] *= 1.35;
      dummyMat.elements[5] *= hScale;
      dummyMat.elements[10] *= 1.35;
      dummyMat.setPosition(mx, 48 * hScale - 6, mz);
      mountainsInst.setMatrixAt(m, dummyMat);
      mountainsInst.setColorAt(
        m,
        new THREE.Color(m % 2 === 0 ? 0x4a607a : 0x586f88)
      );
    }
    trackRoot.add(mountainsInst);
  }

  // ---------------------------------------------------------------------------
  // DETAILED 1990 BIKE & RIDER SYNCHRONIZATION + SKIDMARKS / EXHAUST / SPARKS
  // ---------------------------------------------------------------------------
  function syncRiders(riders = [], dt = 1 / 60) {
    const activeIds = new Set();

    for (let i = 0; i < riders.length; i++) {
      const r = riders[i];
      if (!r) continue;
      const key = r.id || `rider_${i}`;
      activeIds.add(key);

      let rig = riderRigs.get(key);
      if (!rig) {
        const liveryTex = createBikeLiveryTexture(r.bike || {});
        rig = createDetailedBikeRig(r, textureSet, liveryTex);
        riderRigs.set(key, rig);
        ridersRoot.add(rig.rootGroup);
      }

      updateDetailedBikeRig(rig, r, dt);

      const w = r.world || { x: 0, y: 0, z: 0, heading: 0, pitch: 0 };
      const wx = w.x || 0;
      const wy = w.y || 0;
      const wz = w.z || 0;
      const heading = w.heading || 0;
      const speed = r.speed || 0;
      const rearSlip = r.rearSlip || 0;
      const brake = r.brake || 0;
      const throttle = r.throttle || 0;
      const lean = r.lean || 0;

      // 1. Dynamic Asphalt Tire Skidmarks + White Tire Smoke on Powerslide or Hard Braking
      if (rearSlip > 0.30 || (brake > 0.80 && speed > 14)) {
        spawnSkidDecal(wx, wy, wz, heading, lean);
        if (rearSlip > 0.30) {
          spawnTireSmokePuff(wx, wy, wz, heading);
        }
      }

      // 2. Subtle 2-Stroke Blue-White Exhaust Smoke under acceleration
      if (throttle > 0.35 && Math.random() < 0.65) {
        spawnExhaustWisp(wx, wy, wz, heading, speed);
      }

      // 3. Titanium Knee-Slider Sparks at extreme lean angles (> 45 deg)
      if (Math.abs(lean) > 0.78 && speed > 20) {
        spawnKneeSpark(wx, wy, wz, heading, Math.sign(lean));
      }
    }

    for (const [key, rig] of riderRigs.entries()) {
      if (!activeIds.has(key)) {
        ridersRoot.remove(rig.rootGroup);
        riderRigs.delete(key);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // DYNAMIC MOTOGP CHASE CAMERA (HORIZON TILT, PITCH DIVE, HIGH-SPEED & KERB VIBRATION)
  // ---------------------------------------------------------------------------
  function updateChaseCamera(cam, state, rider, dt) {
    if (!rider || !rider.world) return;
    const w = rider.world;
    const heading = w.heading || 0;
    const speed = rider.speed || 0;

    if (!state.initialized) {
      state.heading = heading;
      state.x = w.x - Math.cos(heading) * 6.3;
      state.y = w.y + 2.3;
      state.z = w.z - Math.sin(heading) * 6.3;
      state.roll = 0;
      state.pitchOffset = 0;
      state.fov = 62;
      state.vibPhase = 0;
      state.initialized = true;
    }

    const followRate = clamp(dt * 12.0, 0.05, 1);
    state.heading = lerpAngle(state.heading, heading, followRate);

    const distBack = 5.65 + clamp(speed / 86, 0, 1) * 1.15 - (rider.brake || 0) * 0.28;
    const targetX = w.x - Math.cos(state.heading) * distBack;
    const targetY = w.y + (rider.tuck ? 1.98 : 2.28);
    const targetZ = w.z - Math.sin(state.heading) * distBack;

    state.x += (targetX - state.x) * clamp(dt * 14, 0.08, 1);
    state.y += (targetY - state.y) * clamp(dt * 10, 0.08, 1);
    state.z += (targetZ - state.z) * clamp(dt * 14, 0.08, 1);

    // Smooth MotoGP horizon roll (~27% of bike lean)
    const targetRoll = (rider.lean || 0) * 0.27;
    state.roll += (targetRoll - state.roll) * clamp(dt * 10, 0.08, 1);

    // Braking pitch dive & wheelie pitch lift
    const targetPitchOffset =
      (w.pitch || 0) * 6.0 + (rider.wheelieAngle || 0) * 3.4 - (rider.brake || 0) * 0.45;
    state.pitchOffset += (targetPitchOffset - state.pitchOffset) * clamp(dt * 10, 0.08, 1);

    // Speed-dependent FOV warp + slipstream boost
    const targetFov = 60 + clamp(speed / 88, 0, 1) * 15 + (rider.slipstreamBoost > 0.1 ? 3.5 : 0);
    state.fov += (targetFov - state.fov) * clamp(dt * 6, 0.05, 1);
    cam.fov = state.fov;
    cam.updateProjectionMatrix();

    // High-speed aerodynamic vibration (> 65 m/s) + Rumble kerb vibration (rider.onKerb)
    state.vibPhase += dt * (42 + speed * 0.8);
    let vibY = 0;
    let vibLat = 0;
    if (speed > 65) {
      const aeroAmp = clamp((speed - 65) / 25, 0, 1) * 0.018;
      vibY += Math.sin(state.vibPhase * 1.7) * aeroAmp;
      vibLat += Math.cos(state.vibPhase * 2.3) * aeroAmp * 0.7;
    }
    if (rider.onKerb && speed > 8) {
      const kerbAmp = clamp(speed / 50, 0.25, 1) * 0.032;
      vibY += Math.sin(state.vibPhase * 3.1) * kerbAmp;
      vibLat += Math.cos(state.vibPhase * 2.7) * kerbAmp * 0.5;
    }

    const nx = -Math.sin(state.heading);
    const nz = Math.cos(state.heading);
    cam.position.set(state.x + nx * vibLat, state.y + vibY, state.z + nz * vibLat);
    cam.up.set(
      -Math.sin(state.heading) * Math.sin(state.roll),
      Math.cos(state.roll),
      Math.cos(state.heading) * Math.sin(state.roll)
    );

    const lookAhead = 11.2;
    cam.lookAt(
      w.x + Math.cos(heading) * lookAhead,
      w.y + 1.05 + state.pitchOffset,
      w.z + Math.sin(heading) * lookAhead
    );
  }

  function setSplitMode(mode = 'horizontal') {
    currentSplitMode = mode;
    resize();
  }

  function setStartLights(litCount = 0, greenGo = false) {
    for (let i = 0; i < startLightMats.length; i++) {
      const mat = startLightMats[i];
      if (greenGo) {
        mat.color.setHex(0x18e64c);
      } else if (i < litCount) {
        mat.color.setHex(0xff1e27);
      } else {
        mat.color.setHex(0x2a1111);
      }
    }
  }

  function resize() {
    if (!canvas) return;
    const width =
      canvas.clientWidth ||
      (typeof window !== 'undefined' ? window.innerWidth : 1280) ||
      1280;
    const height =
      canvas.clientHeight ||
      (typeof window !== 'undefined' ? window.innerHeight : 720) ||
      720;
    renderer.setSize(width, height, false);
  }

  function renderCameraView(cam) {
    // Keep atmospheric sky dome centered around active camera so horizon never clips
    skyGroup.position.set(cam.position.x, 0, cam.position.z);
    renderer.render(scene, cam);
  }

  function renderFrame(riders = [], splitMode = currentSplitMode, dt = 1 / 60) {
    if (splitMode && splitMode !== currentSplitMode) {
      currentSplitMode = splitMode;
    }

    syncRiders(riders, dt);
    updateParticles(dt);

    const width = canvas.width || 1280;
    const height = canvas.height || 720;

    const humanRiders = riders.filter((r) => r && !r.isAI);
    const p1Rider = humanRiders[0] || riders[0] || null;
    const p2Rider = humanRiders[1] || riders[1] || null;

    if (currentSplitMode === 'single' || !p2Rider) {
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, width, height);
      cameraP1.aspect = width / Math.max(1, height);
      updateChaseCamera(cameraP1, camState[0], p1Rider, dt);
      renderCameraView(cameraP1);
      return;
    }

    renderer.setScissorTest(true);

    if (currentSplitMode === 'vertical') {
      const halfW = Math.floor(width / 2);
      const aspect = halfW / Math.max(1, height);
      cameraP1.aspect = aspect;
      cameraP2.aspect = aspect;

      updateChaseCamera(cameraP1, camState[0], p1Rider, dt);
      updateChaseCamera(cameraP2, camState[1], p2Rider, dt);

      // Left viewport: Player 1
      renderer.setViewport(0, 0, halfW, height);
      renderer.setScissor(0, 0, halfW, height);
      renderCameraView(cameraP1);

      // Right viewport: Player 2
      renderer.setViewport(halfW, 0, width - halfW, height);
      renderer.setScissor(halfW, 0, width - halfW, height);
      renderCameraView(cameraP2);
    } else {
      // Horizontal split: Top half = Player 1, Bottom half = Player 2
      const halfH = Math.floor(height / 2);
      const topH = height - halfH;
      const aspectTop = width / Math.max(1, topH);
      const aspectBottom = width / Math.max(1, halfH);
      cameraP1.aspect = aspectTop;
      cameraP2.aspect = aspectBottom;

      updateChaseCamera(cameraP1, camState[0], p1Rider, dt);
      updateChaseCamera(cameraP2, camState[1], p2Rider, dt);

      // Top viewport: Player 1
      renderer.setViewport(0, halfH, width, topH);
      renderer.setScissor(0, halfH, width, topH);
      renderCameraView(cameraP1);

      // Bottom viewport: Player 2
      renderer.setViewport(0, 0, width, halfH);
      renderer.setScissor(0, 0, width, halfH);
      renderCameraView(cameraP2);
    }

    renderer.setScissorTest(false);
  }

  resize();

  return {
    scene,
    renderer,
    cameraP1,
    cameraP2,
    buildTrackScene,
    syncRiders,
    setSplitMode,
    setStartLights,
    renderFrame,
    resize
  };
}
