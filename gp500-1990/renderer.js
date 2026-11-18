import * as THREE from 'three';
import { RoomEnvironment } from './vendor/addons/environments/RoomEnvironment.js';
import { createTextureSet, createBikeLiveryTexture } from './textures.js';
import { createDetailedBikeRig, updateDetailedBikeRig } from './models.js';
import { loadPhotoScenery, applyPhotoScenery } from './scenery.js';

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

const VALID_CAMERA_MODES = ['chase', 'chase-far', 'helmet'];
const SUN_OFFSET = new THREE.Vector3(-62, 82, 68);

export function createRaceRenderer(canvas, opts = {}) {
  // Phones: fewer pixels and a smaller shadow map keep the frame rate up and the device cool
  const mobile = Boolean(opts.mobile);
  const maxPixelRatio = mobile ? 1.5 : 2;
  let renderer = null;
  let hasWebGL = false;

  try {
    if (canvas && typeof canvas.getContext === 'function') {
      const gl =
        canvas.getContext('webgl2', { antialias: true, powerPreference: 'high-performance' }) ||
        canvas.getContext('webgl', { antialias: true, powerPreference: 'high-performance' });
      if (gl) {
        renderer = new THREE.WebGLRenderer({
          canvas,
          context: gl,
          antialias: true,
          powerPreference: 'high-performance'
        });
        hasWebGL = true;
      }
    }
  } catch (_err) {
    renderer = null;
    hasWebGL = false;
  }

  if (renderer && hasWebGL) {
    renderer.setPixelRatio(
      typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, maxPixelRatio) : 1
    );
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
    renderer.setClearColor(0x8eb4e6, 1);
    if (renderer.shadowMap) {
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
  } else {
    renderer = {
      domElement: canvas || { width: 1280, height: 720, style: {} },
      outputColorSpace: THREE.SRGBColorSpace,
      toneMapping: THREE.ACESFilmicToneMapping,
      toneMappingExposure: 1.06,
      shadowMap: { enabled: true, type: THREE.PCFSoftShadowMap },
      capabilities: { getMaxAnisotropy: () => 16 },
      setPixelRatio() {},
      setClearColor() {},
      setSize(w, h) {
        if (canvas) {
          canvas.width = w;
          canvas.height = h;
        }
      },
      setViewport() {},
      setScissor() {},
      setScissorTest() {},
      render() {},
      dispose() {}
    };
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8eb4e6);
  scene.fog = new THREE.Fog(0xb8cee8, 260, 960);

  // Motorsport lighting: Ambient + Hemisphere sky/ground fill + Directional Sun with 2048 shadow map
  const ambientLight = new THREE.AmbientLight(0xdce8f8, 0.26);
  scene.add(ambientLight);

  const hemiLight = new THREE.HemisphereLight(0xd8e8ff, 0x3a4636, 0.38);
  hemiLight.position.set(0, 300, 0);
  scene.add(hemiLight);

  const sunLight = new THREE.DirectionalLight(0xfff5e4, 3.15);
  sunLight.position.copy(SUN_OFFSET);
  sunLight.castShadow = true;
  if (sunLight.shadow) {
    sunLight.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
    const shadowHalf = 70; // Tight 140m x 140m ortho shadow box for crisp bike/rider silhouettes
    sunLight.shadow.camera.left = -shadowHalf;
    sunLight.shadow.camera.right = shadowHalf;
    sunLight.shadow.camera.top = shadowHalf;
    sunLight.shadow.camera.bottom = -shadowHalf;
    sunLight.shadow.camera.near = 10;
    sunLight.shadow.camera.far = 240;
    sunLight.shadow.bias = -0.0002;
    sunLight.shadow.normalBias = 0.015;
    sunLight.shadow.camera.updateProjectionMatrix();
  }
  scene.add(sunLight);
  scene.add(sunLight.target);

  // Shared procedural PBR texture set
  const textureSet = createTextureSet();
  const maxAniso =
    renderer?.capabilities && typeof renderer.capabilities.getMaxAnisotropy === 'function'
      ? Math.max(8, Math.min(16, renderer.capabilities.getMaxAnisotropy() || 16))
      : 16;
  if (textureSet?.asphalt) {
    textureSet.asphalt.anisotropy = maxAniso;
    textureSet.asphalt.needsUpdate = true;
  }

  // ---------------------------------------------------------------------------
  // 3D ATMOSPHERIC SKY DOME, SUN ORB & CORONA, AND HIGH-ALTITUDE 3D CLOUDS
  // ---------------------------------------------------------------------------
  const skyGroup = new THREE.Group();
  scene.add(skyGroup);

  const skyGeo = new THREE.SphereGeometry(980, 24, 16);
  const skyPosAttr = skyGeo.attributes.position;
  const sunDirLen = Math.hypot(SUN_OFFSET.x, SUN_OFFSET.y, SUN_OFFSET.z) || 1;
  const sdx = SUN_OFFSET.x / sunDirLen;
  const sdy = SUN_OFFSET.y / sunDirLen;
  const sdz = SUN_OFFSET.z / sunDirLen;

  if (skyPosAttr && skyPosAttr.array) {
    const skyColors = new Float32Array(skyPosAttr.count * 3);

    // Periwinkle-blue zenith -> soft mid-sky -> misty lavender-white horizon (matching 1999-2000 GP reference)
    const zenithR = 0.34, zenithG = 0.50, zenithB = 0.84;
    const midR = 0.54, midG = 0.68, midB = 0.92;
    const horizR = 0.82, horizG = 0.87, horizB = 0.96;

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
      if (elev < 0.32) {
        const t = elev / 0.32;
        r = horizR + (midR - horizR) * t;
        g = horizG + (midG - horizG) * t;
        b = horizB + (midB - horizB) * t;
      } else {
        const t = (elev - 0.32) / 0.68;
        r = midR + (zenithR - midR) * t;
        g = midG + (zenithG - midG) * t;
        b = midB + (zenithB - midB) * t;
      }

      const sunDot = Math.max(0, nx * sdx + ny * sdy + nz * sdz);
      const sunGlow = Math.pow(sunDot, 6) * 0.22;
      r = clamp(r + sunGlow * 1.0, 0, 1);
      g = clamp(g + sunGlow * 0.92, 0, 1);
      b = clamp(b + sunGlow * 0.75, 0, 1);

      skyColors[i * 3] = r;
      skyColors[i * 3 + 1] = g;
      skyColors[i * 3 + 2] = b;
    }
    skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(skyColors, 3));
  }

  const skyMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    vertexColors: true,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: false
  });
  const skyDomeMesh = new THREE.Mesh(skyGeo, skyMat);
  skyDomeMesh.frustumCulled = false;
  skyGroup.add(skyDomeMesh);

  // Glowing 3D Sun Orb & Corona aligned with sunLight
  const sunDist = 860;
  const sunPos = {
    x: sdx * sunDist,
    y: sdy * sunDist,
    z: sdz * sunDist
  };

  const sunOrbMesh = new THREE.Mesh(
    new THREE.SphereGeometry(26, 14, 12),
    new THREE.MeshBasicMaterial({
      color: 0xfffce6,
      depthWrite: false,
      fog: false,
      toneMapped: false
    })
  );
  sunOrbMesh.position.set(sunPos.x, sunPos.y, sunPos.z);
  skyGroup.add(sunOrbMesh);

  const sunCoronaMesh = new THREE.Mesh(
    new THREE.SphereGeometry(58, 14, 12),
    new THREE.MeshBasicMaterial({
      color: 0xffe6a8,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      fog: false,
      toneMapped: false
    })
  );
  sunCoronaMesh.position.set(sunPos.x, sunPos.y, sunPos.z);
  skyGroup.add(sunCoronaMesh);

  // High-altitude 3D cumulus cloud ring (bright unlit puffs so undersides never turn dark grey)
  const cloudsGroup = new THREE.Group();
  skyGroup.add(cloudsGroup);
  const cloudPuffGeo = new THREE.SphereGeometry(1, 10, 8);
  const cloudMat = new THREE.MeshBasicMaterial({
    color: 0xf7fbff,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    fog: true,
    toneMapped: false
  });
  for (let c = 0; c < 22; c++) {
    const angle = (c / 22) * Math.PI * 2 + (c % 3) * 0.14;
    const rad = 360 + (c % 4) * 75;
    const cy = 180 + (c % 5) * 22;
    const cluster = new THREE.Group();
    cluster.position.set(Math.cos(angle) * rad, cy, Math.sin(angle) * rad);
    cluster.rotation.y = -angle;

    for (let p = 0; p < 3; p++) {
      const puff = new THREE.Mesh(cloudPuffGeo, cloudMat);
      const sx = 28 + ((c + p) % 3) * 12;
      const sy = 7 + (p % 2) * 3.5;
      const sz = 16 + (p % 3) * 7;
      puff.scale.set(sx, sy, sz);
      puff.position.set((p - 1) * 18, p === 1 ? 3.5 : 0, p % 2 === 0 ? 4 : -4);
      cluster.add(puff);
    }
    cloudsGroup.add(cluster);
  }

  // ---------------------------------------------------------------------------
  // PMREM ENVIRONMENT MAP (Built from Sky Dome + Sun + Ground, fallback RoomEnvironment)
  // ---------------------------------------------------------------------------
  if (hasWebGL && typeof THREE.PMREMGenerator === 'function') {
    let pmremGenerator = null;
    try {
      pmremGenerator = new THREE.PMREMGenerator(renderer);
      if (typeof pmremGenerator.compileCubemapShader === 'function') {
        pmremGenerator.compileCubemapShader();
      }
      const envScene = new THREE.Scene();
      envScene.background = new THREE.Color(0x8eb4e6);
      const envSkyGeo = skyGeo.clone();
      const envSkyMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide });
      const envSkyMesh = new THREE.Mesh(envSkyGeo, envSkyMat);
      envScene.add(envSkyMesh);

      const envSunGeo = new THREE.SphereGeometry(54, 12, 10);
      const envSunMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.5, 3.3, 2.9) });
      const envSunMesh = new THREE.Mesh(envSunGeo, envSunMat);
      envSunMesh.position.set(sunPos.x, sunPos.y, sunPos.z);
      envScene.add(envSunMesh);

      const envGroundGeo = new THREE.SphereGeometry(760, 16, 8, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5);
      const envGroundMat = new THREE.MeshBasicMaterial({ color: 0x343a42, side: THREE.BackSide });
      const envGroundMesh = new THREE.Mesh(envGroundGeo, envGroundMat);
      envScene.add(envGroundMesh);

      const envRT = pmremGenerator.fromScene(envScene, 0.02, 0.1, 2000);
      scene.environment = envRT.texture;
      scene.environmentIntensity = 1.05;
      envSkyGeo.dispose();
      envSkyMat.dispose();
      envSunGeo.dispose();
      envSunMat.dispose();
      envGroundGeo.dispose();
      envGroundMat.dispose();
      pmremGenerator.dispose();
    } catch (_skyEnvErr) {
      try {
        if (!pmremGenerator) pmremGenerator = new THREE.PMREMGenerator(renderer);
        const roomEnv = new RoomEnvironment();
        const envRT = pmremGenerator.fromScene(roomEnv, 0.04);
        scene.environment = envRT.texture;
        if (typeof roomEnv.dispose === 'function') roomEnv.dispose();
        pmremGenerator.dispose();
      } catch (_fallbackErr) {
        scene.environment = new THREE.Texture();
      }
    }
  } else {
    scene.environment = new THREE.Texture();
  }

  const cameraP1 = new THREE.PerspectiveCamera(43, 16 / 9, 0.12, 1400);
  const cameraP2 = new THREE.PerspectiveCamera(43, 16 / 9, 0.12, 1400);
  const tvCamera = new THREE.PerspectiveCamera(34, 16 / 9, 0.5, 1400);

  const cameraModes = ['chase', 'chase'];
  let currentSplitMode = 'horizontal';
  let trackRoot = null;

  // Photographic sky, ground textures and billboard trees (scenery.js); procedural until loaded.
  let photoScenery = null;
  const sunDirection = SUN_OFFSET.clone().normalize();
  const applyPhotoIfReady = () => {
    if (photoScenery) applyPhotoScenery(photoScenery, { scene, trackRoot, skyGroup, sunDirection });
  };
  if (hasWebGL && typeof window !== 'undefined') {
    loadPhotoScenery(renderer).then((photo) => {
      photoScenery = photo;
      applyPhotoIfReady();
    });
  }
  let currentTrackRef = null;
  const tvCameraPosts = [];
  let activeTvPostIndex = -1;
  const tvLookAtTarget = new THREE.Vector3(0, 1, 0);
  let tvCamInitialized = false;

  const ridersRoot = new THREE.Group();
  scene.add(ridersRoot);

  const startLightBulbs = [];
  const startLightMats = [];
  const riderRigs = new Map();

  const camState = [
    { x: -12, y: 1.48, z: 0, heading: 0, roll: 0, pitchOffset: 0, fov: 43, vibPhase: 0, initialized: false },
    { x: -12, y: 1.48, z: 0, heading: 0, roll: 0, pitchOffset: 0, fov: 43, vibPhase: 0, initialized: false }
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
    side: THREE.DoubleSide
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
    geo.computeBoundingSphere();
    const mat = new THREE.MeshStandardMaterial(matOptions);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
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

  function enableGroupShadows(group, cast = true, receive = true) {
    group.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = cast;
        child.receiveShadow = receive;
      }
    });
  }

  // ---------------------------------------------------------------------------
  // PHOTOREALISTIC TEXTURED CIRCUIT & 1990 GP ARCHITECTURE
  // ---------------------------------------------------------------------------
  function tagRole(obj, role) {
    obj.userData.sceneryRole = role;
    return obj;
  }

  function buildTrackScene(track) {
    currentTrackRef = track;
    if (trackRoot) {
      scene.remove(trackRoot);
    }
    trackRoot = new THREE.Group();
    scene.add(trackRoot);
    startLightBulbs.length = 0;
    startLightMats.length = 0;
    tvCameraPosts.length = 0;
    activeTvPostIndex = -1;
    tvCamInitialized = false;

    for (let i = 0; i < skidPool.length; i++) {
      skidPool[i].visible = false;
    }

    // 1. Vast Mowed Stadium Grass Ground Plane (repeat 80x80)
    if (textureSet?.grass?.repeat?.set) {
      textureSet.grass.repeat.set(80, 80);
    }
    const groundGeo = new THREE.PlaneGeometry(4200, 4200);
    const groundMat = new THREE.MeshStandardMaterial({
      map: textureSet?.grass || null,
      color: 0xffffff,
      roughness: 0.90,
      metalness: 0.0,
      envMapIntensity: 0.25
    });
    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.position.y = -0.75;
    groundMesh.receiveShadow = true;
    groundMesh.userData.sceneryRole = 'ground';
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
            zoneFactor = Math.sin((1 - distAhead / 65) * Math.PI * 0.85);
          } else if (distAhead < 0) {
            zoneFactor = Math.max(0, 1 + distAhead / (6 * ds)) * 0.75;
          }
          const intensity = cornerStrength * zoneFactor;
          if (intensity > maxRubber) maxRubber = intensity;

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
      const base = idx % 2 === 0 ? 0.96 : 0.92;
      const c = base * (1 - darken);
      return [c, c, c * 1.02];
    };

    for (let i = 0; i < n; i++) {
      const s0 = samples[i];
      const s1 = samples[(i + 1) % n];
      const arc0 = i * ds;
      const arc1 = (i + 1) * ds;

      // A. Asphalt Track Ribbon with high-frequency UVs (arc / 8.5) for strong sense of speed
      const v0 = arc0 / 8.5;
      const v1 = arc1 / 8.5;
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

      // D. 3D Grassy Hillside Embankment Skirts down to ground plane
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

      // E. Crisp Painted White Track Edge Lines + Pit Straight Double White Lane Line
      pushUVQuad(
        paintPos, paintNrm, paintUv, paintCol,
        pt(s0, -halfW + 0.06, 0.016), pt(s0, -halfW + 0.24, 0.016),
        pt(s1, -halfW + 0.06, 0.016), pt(s1, -halfW + 0.24, 0.016),
        [0, 0], [1, 0], [0, 1], [1, 1],
        whiteCol
      );
      pushUVQuad(
        paintPos, paintNrm, paintUv, paintCol,
        pt(s0, halfW - 0.24, 0.016), pt(s0, halfW - 0.06, 0.016),
        pt(s1, halfW - 0.24, 0.016), pt(s1, halfW - 0.06, 0.016),
        [0, 0], [1, 0], [0, 1], [1, 1],
        whiteCol
      );

      // Pit-lane double white line along the main straight (matching the 1999-2000 GP reference images)
      if (arc0 <= 240 || arc0 >= totalLen - 35) {
        pushUVQuad(
          paintPos, paintNrm, paintUv, paintCol,
          pt(s0, halfW - 2.35, 0.017), pt(s0, halfW - 2.21, 0.017),
          pt(s1, halfW - 2.35, 0.017), pt(s1, halfW - 2.21, 0.017),
          [0, 0], [1, 0], [0, 1], [1, 1],
          whiteCol
        );
        pushUVQuad(
          paintPos, paintNrm, paintUv, paintCol,
          pt(s0, halfW - 2.05, 0.017), pt(s0, halfW - 1.91, 0.017),
          pt(s1, halfW - 2.05, 0.017), pt(s1, halfW - 1.91, 0.017),
          [0, 0], [1, 0], [0, 1], [1, 1],
          whiteCol
        );
      }
    }

    trackRoot.add(
      tagRole(buildUVRibbonMesh(asphaltPos, asphaltNrm, asphaltUv, asphaltCol, {
        map: textureSet?.asphalt || null,
        color: 0xffffff,
        roughness: 0.72,
        metalness: 0.04,
        envMapIntensity: 0.30,
        vertexColors: true
      }), 'asphalt')
    );

    if (kerbRedPos.length > 0) {
      trackRoot.add(
        buildUVRibbonMesh(kerbRedPos, kerbRedNrm, kerbRedUv, kerbRedCol, {
          map: textureSet?.kerbRedWhite || null,
          color: 0xffffff,
          roughness: 0.62,
          metalness: 0.04,
          envMapIntensity: 0.32,
          vertexColors: true
        })
      );
    }

    if (kerbBluePos.length > 0) {
      trackRoot.add(
        buildUVRibbonMesh(kerbBluePos, kerbBlueNrm, kerbBlueUv, kerbBlueCol, {
          map: textureSet?.kerbBlueWhite || null,
          color: 0xffffff,
          roughness: 0.62,
          metalness: 0.04,
          envMapIntensity: 0.32,
          vertexColors: true
        })
      );
    }

    trackRoot.add(
      tagRole(buildUVRibbonMesh(gravelPos, gravelNrm, gravelUv, gravelCol, {
        map: textureSet?.gravel || null,
        color: 0xffffff,
        roughness: 0.92,
        metalness: 0.0,
        envMapIntensity: 0.25,
        vertexColors: true
      }), 'gravel')
    );

    trackRoot.add(
      tagRole(buildUVRibbonMesh(skirtPos, skirtNrm, skirtUv, skirtCol, {
        map: textureSet?.grass || null,
        color: 0xffffff,
        roughness: 0.90,
        metalness: 0.0,
        envMapIntensity: 0.25,
        vertexColors: true
      }), 'grassSkirt')
    );

    // 3. Checkered Start/Finish Line & Painted P1..P8 Starting Grid Boxes
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

        pushUVQuad(
          paintPos, paintNrm, paintUv, paintCol,
          pt(boxFrontIn, gridD - 0.85, 0.02), pt(boxFrontIn, gridD + 0.85, 0.02),
          pt(boxFront, gridD - 0.85, 0.02), pt(boxFront, gridD + 0.85, 0.02),
          [0, 0], [1, 0], [0, 1], [1, 1],
          boxCol
        );
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

    enableGroupShadows(gantryGroup, true, true);

    const podGeo = new THREE.BoxGeometry(0.55, 0.95, 0.85);
    const bulbGeo = new THREE.SphereGeometry(0.32, 12, 10);
    for (let b = 0; b < 5; b++) {
      const zPos = (b - 2) * 1.55;
      const pod = new THREE.Mesh(podGeo, steelMat);
      pod.position.set(-0.55, 6.1, zPos);
      pod.castShadow = true;
      gantryGroup.add(pod);

      const bMat = new THREE.MeshBasicMaterial({ color: 0x2a1111, toneMapped: false });
      const bulb = new THREE.Mesh(bulbGeo, bMat);
      bulb.position.set(-0.82, 6.1, zPos);
      gantryGroup.add(bulb);
      startLightBulbs.push(bulb);
      startLightMats.push(bMat);
    }
    trackRoot.add(gantryGroup);

    // Continuous Pit Lane Garage Complex along s = 14..182m (Right side, matching reference images)
    if (typeof track.sampleAtS === 'function') {
      const pitBuildingMat = new THREE.MeshStandardMaterial({
        map: textureSet?.pitBuilding || null,
        color: 0xffffff,
        roughness: 0.50,
        metalness: 0.15
      });
      const concreteMat = new THREE.MeshStandardMaterial({
        color: 0xcfd6e0,
        roughness: 0.65,
        metalness: 0.08
      });
      const barrelMat = new THREE.MeshStandardMaterial({
        color: 0x1c2026,
        roughness: 0.35,
        metalness: 0.65
      });
      const glassMat = new THREE.MeshPhysicalMaterial({
        color: 0x1a3654,
        roughness: 0.10,
        metalness: 0.85,
        clearcoat: 1.0
      });

      const bayGeo = new THREE.BoxGeometry(24.4, 7.6, 9.2);
      const canopyGeo = new THREE.BoxGeometry(24.8, 0.55, 11.6);
      const barrelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.95, 10);

      for (let sPit = 16; sPit <= 232; sPit += 24) {
        const smp = track.sampleAtS(sPit);
        const bayGroup = new THREE.Group();
        bayGroup.position.set(smp.x, smp.y, smp.z);
        bayGroup.rotation.y = -smp.tangentAngle;

        const pitD = halfW + kerbW + 5.2;
        const garageMesh = tagRole(new THREE.Mesh(bayGeo, pitBuildingMat), 'pitFacade');
        garageMesh.position.set(0, 3.8, pitD);
        bayGroup.add(garageMesh);

        const roofCanopy = tagRole(new THREE.Mesh(canopyGeo, concreteMat), 'concrete');
        roofCanopy.position.set(0, 7.75, pitD - 0.9);
        bayGroup.add(roofCanopy);

        // Oil drums / fuel barrels standing inside the open garage bays (matching reference images)
        for (let dIdx = -1; dIdx <= 1; dIdx++) {
          const drum = new THREE.Mesh(barrelGeo, barrelMat);
          drum.position.set(dIdx * 6.2, 0.48, pitD - 4.25);
          bayGroup.add(drum);
        }

        enableGroupShadows(bayGroup, true, true);
        trackRoot.add(bayGroup);
      }

      // 4-Story FIM Race Control Tower at s = 6m
      const twSmp = track.sampleAtS(6);
      const towerGroup = new THREE.Group();
      towerGroup.position.set(twSmp.x, twSmp.y, twSmp.z);
      towerGroup.rotation.y = -twSmp.tangentAngle;
      const towerD = halfW + kerbW + 6.5;

      const towerCore = tagRole(new THREE.Mesh(new THREE.BoxGeometry(10, 17, 9), concreteMat), 'concrete');
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

      enableGroupShadows(towerGroup, true, true);
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
          post.castShadow = true;
          boardGroup.add(post);

          const panel = new THREE.Mesh(boardPanelGeo, boardGreenMat);
          panel.position.set(0, 1.05, 0);
          panel.castShadow = true;
          boardGroup.add(panel);

          const numStripes = 3 - m;
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
    // 6. OVERHEAD SPONSOR BRIDGES (including Pit-Straight Arch) & BILLBOARDS
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
      const bridgePositionsS = [244, totalLen * 0.34, totalLen * 0.62, totalLen * 0.86];
      const bridgeLegGeo = new THREE.BoxGeometry(0.9, 6.6, 0.9);
      const bridgeSpanGeo = new THREE.BoxGeometry(1.4, 1.75, (halfW + 3.2) * 2);

      for (let b = 0; b < bridgePositionsS.length; b++) {
        const smp = track.sampleAtS(bridgePositionsS[b] % totalLen);
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
        enableGroupShadows(arch, true, true);
        trackRoot.add(arch);
      }

      const bbGeo = new THREE.BoxGeometry(8.5, 2.1, 0.25);
      for (let k = 0; k < 16; k++) {
        const sPos = ((k + 0.5) / 16) * totalLen;
        if (sPos < 238) continue; // Keep pit lane clear
        const smp = track.sampleAtS(sPos);
        const side = k % 2 === 0 ? -1 : 1;
        const d = side * (halfW + kerbW + 6.4);

        const bb = new THREE.Mesh(bbGeo, bannerMats[k % bannerMats.length]);
        bb.position.set(smp.x + d * smp.nx, smp.y + 1.25, smp.z + d * smp.nz);
        bb.rotation.y = -smp.tangentAngle + (side > 0 ? 0.12 : -0.12);
        bb.castShadow = true;
        bb.receiveShadow = true;
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
      const side = k < 3 ? -1 : k % 2 === 0 ? -1 : 1;
      const d = side * (halfW + kerbW + 15.5);

      const standGroup = new THREE.Group();
      standGroup.position.set(s.x + d * s.nx, s.y, s.z + d * s.nz);
      standGroup.rotation.y = -s.tangentAngle + (side > 0 ? Math.PI : 0);

      const baseMesh = tagRole(new THREE.Mesh(baseGeo, standBaseMat), 'standBase');
      baseMesh.position.set(0, 2.1, -1.2);
      standGroup.add(baseMesh);

      const crowdMesh = new THREE.Mesh(crowdSlopeGeo, crowdMat);
      crowdMesh.position.set(0, 3.6, 0.4);
      crowdMesh.rotation.x = 0.38;
      standGroup.add(crowdMesh);

      const roofMesh = tagRole(new THREE.Mesh(roofGeo, canopyRoofMat), 'standRoof');
      roofMesh.position.set(0, 7.2, 0.2);
      roofMesh.rotation.x = -0.08;
      standGroup.add(roofMesh);

      const fasciaMesh = new THREE.Mesh(fasciaGeo, crimsonMetalMat);
      fasciaMesh.position.set(0, 7.45, 4.5);
      standGroup.add(fasciaMesh);

      enableGroupShadows(standGroup, true, true);
      trackRoot.add(standGroup);
    }

    // Helper to ensure props, trees, and mountains never overlap any part of the track loop
    const isClearOfTrack = (px, pz, minDistSq) => {
      const checkStep = Math.max(1, Math.floor(n / 180));
      for (let idx = 0; idx < n; idx += checkStep) {
        const dx = samples[idx].x - px;
        const dz = samples[idx].z - pz;
        if (dx * dx + dz * dz < minDistSq) return false;
      }
      return true;
    };

    // -------------------------------------------------------------------------
    // 8. 12 TRACKSIDE TV BROADCAST CAMERA POSTS AROUND THE CIRCUIT
    // -------------------------------------------------------------------------
    const tvPostCount = 12;
    const tvTowerGeo = new THREE.BoxGeometry(0.42, 2.8, 0.42);
    const tvPlatformGeo = new THREE.BoxGeometry(0.75, 0.16, 0.75);
    for (let p = 0; p < tvPostCount; p++) {
      const sPost = ((p + 0.15) / tvPostCount) * totalLen;
      const smp = track.sampleAtS ? track.sampleAtS(sPost) : samples[Math.floor((p / tvPostCount) * n)];
      // Place TV camera on outside of corners or alternating sides on straights
      const side = Math.abs(smp.curvature || 0) > 0.002
        ? -(Math.sign(smp.curvature) || 1)
        : (p % 2 === 0 ? -1 : 1);
      const postD = side * (halfW + kerbW + 6.0);
      const camD = side * (halfW + kerbW + 5.2);
      const postX = smp.x + postD * smp.nx;
      const postZ = smp.z + postD * smp.nz;
      const camX = smp.x + camD * smp.nx;
      const camY = smp.y + 4.4 + (p % 3) * 0.8;
      const camZ = smp.z + camD * smp.nz;

      tvCameraPosts.push({
        index: p,
        s: sPost,
        x: camX,
        y: camY,
        z: camZ
      });

      const towerMesh = new THREE.Mesh(tvTowerGeo, steelMat);
      towerMesh.position.set(postX, smp.y + 1.4, postZ);
      towerMesh.castShadow = true;
      towerMesh.receiveShadow = true;
      trackRoot.add(towerMesh);

      const platMesh = new THREE.Mesh(tvPlatformGeo, crimsonMetalMat);
      platMesh.position.set(postX, smp.y + 2.86, postZ);
      platMesh.castShadow = true;
      trackRoot.add(platMesh);
    }

    // -------------------------------------------------------------------------
    // 9. INSTANCED GUARDRAILS, CORNER TIRE WALLS, 3D TREES & MOUNTAIN RIDGES
    // -------------------------------------------------------------------------
    const dummyMat = new THREE.Matrix4();

    // A. Corrugated Armco Guardrails (skip right-hand pit building frontage s=12..190m)
    const barrierStep = 6;
    const barrierEntries = [];
    for (let i = 0; i < n; i += barrierStep) {
      const s = samples[i];
      const arc = i * ds;
      for (const side of [-1, 1]) {
        if (side === 1 && arc >= 10 && arc <= 190) continue;
        barrierEntries.push({ s, side, stepIdx: Math.floor(i / barrierStep) });
      }
    }
    const barrierGeo = new THREE.BoxGeometry(4.2, 0.85, 0.32);
    const barrierMat = new THREE.MeshStandardMaterial({
      color: 0xd8dfe8,
      roughness: 0.42,
      metalness: 0.58
    });
    const barriersInst = new THREE.InstancedMesh(barrierGeo, barrierMat, Math.max(1, barrierEntries.length));
    barriersInst.castShadow = true;
    barriersInst.receiveShadow = true;
    barriersInst.frustumCulled = true;
    for (let bIdx = 0; bIdx < barrierEntries.length; bIdx++) {
      const { s, side, stepIdx } = barrierEntries[bIdx];
      const d = side * (halfW + kerbW + 5.2);
      dummyMat.makeRotationY(-s.tangentAngle);
      dummyMat.setPosition(s.x + d * s.nx, s.y + 0.44, s.z + d * s.nz);
      barriersInst.setMatrixAt(bIdx, dummyMat);
      barriersInst.setColorAt(
        bIdx,
        new THREE.Color(stepIdx % 2 === 0 ? 0xe8edf5 : 0xd91424)
      );
    }
    barriersInst.instanceMatrix.needsUpdate = true;
    if (barriersInst.instanceColor) barriersInst.instanceColor.needsUpdate = true;
    barriersInst.computeBoundingSphere();
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
      tireWallsInst.castShadow = true;
      tireWallsInst.receiveShadow = true;
      tireWallsInst.frustumCulled = true;
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
      tireWallsInst.instanceMatrix.needsUpdate = true;
      if (tireWallsInst.instanceColor) tireWallsInst.instanceColor.needsUpdate = true;
      tireWallsInst.computeBoundingSphere();
      trackRoot.add(tireWallsInst);
    }

    // C. Lush 3D Multi-Tier Trees (Trunks + Lower & Upper Foliage Cones)
    const treeStep = 12;
    const treePositions = [];
    const minTreeClearSq = (halfW + 14) * (halfW + 14);
    const treeRows = [20, 38, 58];
    for (let i = 0; i < n; i += treeStep) {
      for (let row = 0; row < treeRows.length; row++) {
        const s = samples[(i + row * 5) % n];
        for (const side of [-1, 1]) {
          const d = side * (halfW + treeRows[row] + ((i * 7 + row * 11) % 14));
          const tx = s.x + d * s.nx;
          const tz = s.z + d * s.nz;
          if (isClearOfTrack(tx, tz, minTreeClearSq)) {
            treePositions.push({ tx, ty: s.y, tz, side });
          }
        }
      }
    }
    const treeCount = Math.max(1, treePositions.length);
    const trunkGeo = new THREE.CylinderGeometry(0.24, 0.38, 2.6, 7);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x4d3624 });
    const lowerCrownGeo = new THREE.CylinderGeometry(0.5, 2.7, 4.4, 8);
    const upperCrownGeo = new THREE.CylinderGeometry(0.15, 2.0, 3.8, 8);
    const foliageMat = new THREE.MeshLambertMaterial({ color: 0x265c28 });

    const trunksInst = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
    const lowerCrownInst = new THREE.InstancedMesh(lowerCrownGeo, foliageMat, treeCount);
    const upperCrownInst = new THREE.InstancedMesh(upperCrownGeo, foliageMat, treeCount);
    trunksInst.castShadow = true;
    lowerCrownInst.castShadow = true;
    upperCrownInst.castShadow = true;
    lowerCrownInst.receiveShadow = true;
    upperCrownInst.receiveShadow = true;

    for (let tIdx = 0; tIdx < treePositions.length; tIdx++) {
      const { tx, ty, tz, side } = treePositions[tIdx];
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
    }
    trunksInst.instanceMatrix.needsUpdate = true;
    lowerCrownInst.instanceMatrix.needsUpdate = true;
    upperCrownInst.instanceMatrix.needsUpdate = true;
    if (lowerCrownInst.instanceColor) lowerCrownInst.instanceColor.needsUpdate = true;
    if (upperCrownInst.instanceColor) upperCrownInst.instanceColor.needsUpdate = true;
    trunksInst.computeBoundingSphere();
    lowerCrownInst.computeBoundingSphere();
    upperCrownInst.computeBoundingSphere();
    for (const inst of [trunksInst, lowerCrownInst, upperCrownInst]) {
      tagRole(inst, 'proceduralTree');
    }
    trunksInst.userData.treePositions = treePositions;
    trackRoot.add(trunksInst, lowerCrownInst, upperCrownInst);

    // D. Distant 3D Mountain Ridges around the Circuit's Actual Bounding Perimeter
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < n; i += 2) {
      const sx = samples[i].x;
      const sz = samples[i].z;
      if (sx < minX) minX = sx;
      if (sx > maxX) maxX = sx;
      if (sz < minZ) minZ = sz;
      if (sz > maxZ) maxZ = sz;
    }
    const centerX = (minX + maxX) * 0.5;
    const centerZ = (minZ + maxZ) * 0.5;
    const rxBase = (maxX - minX) * 0.5 + 270;
    const rzBase = (maxZ - minZ) * 0.5 + 270;

    const mountainPositions = [];
    const mountainCountTarget = 40;
    const minMtnClearSq = 210 * 210;
    for (let m = 0; m < mountainCountTarget; m++) {
      const ang = (m / mountainCountTarget) * Math.PI * 2;
      const ringPad = (m % 3) * 65;
      const mx = centerX + Math.cos(ang) * (rxBase + ringPad);
      const mz = centerZ + Math.sin(ang) * (rzBase + ringPad);
      if (isClearOfTrack(mx, mz, minMtnClearSq)) {
        const hScale = 0.75 + ((m * 13) % 7) * 0.14;
        mountainPositions.push({ mx, mz, ang, hScale, idx: m });
      }
    }

    const mountainPeaks = Math.max(1, mountainPositions.length);
    const mountainGeo = new THREE.CylinderGeometry(4, 115, 115, 6);
    const mountainMat = new THREE.MeshLambertMaterial({ color: 0x4b6278 });
    const mountainsInst = new THREE.InstancedMesh(mountainGeo, mountainMat, mountainPeaks);
    mountainsInst.frustumCulled = true;

    const mPos = new THREE.Vector3();
    const mQuat = new THREE.Quaternion();
    const mScale = new THREE.Vector3();
    const yAxis = new THREE.Vector3(0, 1, 0);

    for (let m = 0; m < mountainPositions.length; m++) {
      const { mx, mz, ang, hScale, idx } = mountainPositions[m];
      mPos.set(mx, 48 * hScale - 6, mz);
      mQuat.setFromAxisAngle(yAxis, ang);
      mScale.set(1.35, hScale, 1.35);
      dummyMat.compose(mPos, mQuat, mScale);
      mountainsInst.setMatrixAt(m, dummyMat);
      mountainsInst.setColorAt(
        m,
        new THREE.Color(idx % 2 === 0 ? 0x4a607a : 0x586f88)
      );
    }
    mountainsInst.instanceMatrix.needsUpdate = true;
    if (mountainsInst.instanceColor) mountainsInst.instanceColor.needsUpdate = true;
    mountainsInst.computeBoundingSphere();
    trackRoot.add(tagRole(mountainsInst, 'mountains'));
    applyPhotoIfReady();
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
        if (rig && rig.rootGroup) {
          rig.rootGroup.traverse((child) => {
            if (child.isMesh && !child.userData?.noShadow) {
              child.castShadow = true;
              child.receiveShadow = true;
            } else if (child.isMesh) {
              child.castShadow = false;
              child.receiveShadow = false;
            }
          });
          ridersRoot.add(rig.rootGroup);
        }
        riderRigs.set(key, rig);
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

      if (rearSlip > 0.30 || (brake > 0.80 && speed > 14)) {
        spawnSkidDecal(wx, wy, wz, heading, lean);
        if (rearSlip > 0.30) {
          spawnTireSmokePuff(wx, wy, wz, heading);
        }
      }

      if (throttle > 0.35 && Math.random() < 0.65) {
        spawnExhaustWisp(wx, wy, wz, heading, speed);
      }

      if (Math.abs(lean) > 0.78 && speed > 20) {
        spawnKneeSpark(wx, wy, wz, heading, Math.sign(lean));
      }
    }

    for (const [key, rig] of riderRigs.entries()) {
      if (!activeIds.has(key)) {
        if (rig && rig.rootGroup) {
          ridersRoot.remove(rig.rootGroup);
        }
        riderRigs.delete(key);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // CAMERA MODES: 'chase' (1999-2000 GP Reference), 'chase-far', 'helmet', + TV
  // ---------------------------------------------------------------------------
  function setCameraMode(slot = 0, mode = 'chase') {
    const idx = slot === 1 ? 1 : 0;
    if (VALID_CAMERA_MODES.includes(mode)) {
      cameraModes[idx] = mode;
      camState[idx].initialized = false;
    }
    return cameraModes[idx];
  }

  function getCameraMode(slot = 0) {
    const idx = slot === 1 ? 1 : 0;
    return cameraModes[idx];
  }

  function updatePlayerCamera(cam, state, rider, dt, mode = 'chase') {
    if (!rider || !rider.world) return;
    const w = rider.world;
    const heading = w.heading || 0;
    const speed = rider.speed || 0;
    const lean = rider.lean || 0;

    if (mode === 'helmet') {
      // Onboard 1st-person helmet visor camera positioned at rider's eye level
      // so the tinted bubble windscreen, tach dial, and clip-on bars frame the bottom edge
      state.heading = heading;
      state.vibPhase += dt * (45 + speed * 0.9);
      const vibY = speed > 50 ? Math.sin(state.vibPhase * 2.1) * 0.006 : 0;
      const nx = -Math.sin(heading);
      const nz = Math.cos(heading);
      const leanNorm = clamp(lean / 0.96, -1, 1);
      const baseHeight = rider.tuck ? 1.01 : 1.09;
      const fwdOffset = rider.tuck ? 0.04 : 0.02;

      // Rotate eye point with bike lean + rider hang-off so cockpit stays centered below visor
      const localY = baseHeight * Math.cos(lean);
      const localZ = baseHeight * Math.sin(lean) + leanNorm * 0.12;

      cam.position.set(
        w.x + Math.cos(heading) * fwdOffset + nx * localZ,
        w.y + localY + vibY,
        w.z + Math.sin(heading) * fwdOffset + nz * localZ
      );

      const helmetRoll = lean * 0.72;
      cam.up.set(
        -Math.sin(heading) * Math.sin(helmetRoll),
        Math.cos(helmetRoll),
        Math.cos(heading) * Math.sin(helmetRoll)
      );

      const targetFov = 72 + clamp(speed / 88, 0, 1) * 6;
      state.fov += (targetFov - state.fov) * clamp(dt * 8, 0.08, 1);
      cam.fov = state.fov;
      cam.updateProjectionMatrix();

      const lookDist = 18.0;
      const pitchOff = (w.pitch || 0) * lookDist + (rider.wheelieAngle || 0) * 5.0 - (rider.brake || 0) * 0.6;
      cam.lookAt(
        w.x + Math.cos(heading) * lookDist + nx * localZ * 0.65,
        w.y + localY - 1.65 + pitchOff,
        w.z + Math.sin(heading) * lookDist + nz * localZ * 0.65
      );
      return;
    }

    const isFar = mode === 'chase-far';
    // Default 'chase' camera matches the 1999-2000 GP reference screenshots:
    // Low and close directly behind the rider (1.42-1.48m high, 3.95-4.25m back),
    // rider centered in the lower half, road vanishing point near screen center.
    // Anchored directly to rider world pos (no longitudinal velocity lag!) while smoothing heading.
    const baseDist = isFar ? 5.75 : 3.95;
    const speedPull = isFar ? 0.65 : 0.30;
    const baseY = isFar ? (rider.tuck ? 1.88 : 2.05) : (rider.tuck ? 1.42 : 1.48);
    const baseFov = isFar ? 54 : 43;
    const fovSpeedGain = isFar ? 8 : 4.5;
    const lookAhead = isFar ? 14.0 : 16.0;
    const lookHeight = isFar ? 1.02 : 0.98;

    if (!state.initialized) {
      state.heading = heading;
      state.yOffset = baseY;
      state.roll = 0;
      state.pitchOffset = 0;
      state.fov = baseFov;
      state.vibPhase = 0;
      state.initialized = true;
    }

    const followRate = clamp(dt * (isFar ? 12.0 : 16.0), 0.1, 1);
    state.heading = lerpAngle(state.heading, heading, followRate);

    const distBack = baseDist + clamp(speed / 88, 0, 1) * speedPull - (rider.brake || 0) * 0.16;
    state.yOffset = (state.yOffset ?? baseY) + (baseY - (state.yOffset ?? baseY)) * clamp(dt * 12, 0.1, 1);

    state.x = w.x - Math.cos(state.heading) * distBack;
    state.y = w.y + state.yOffset;
    state.z = w.z - Math.sin(state.heading) * distBack;

    const targetRoll = lean * (isFar ? 0.24 : 0.15);
    state.roll += (targetRoll - state.roll) * clamp(dt * 10, 0.08, 1);

    const targetPitchOffset =
      (w.pitch || 0) * 6.0 + (rider.wheelieAngle || 0) * 3.0 - (rider.brake || 0) * 0.35;
    state.pitchOffset += (targetPitchOffset - state.pitchOffset) * clamp(dt * 10, 0.08, 1);

    const targetFov =
      baseFov + clamp(speed / 88, 0, 1) * fovSpeedGain + (rider.slipstreamBoost > 0.1 ? 2.0 : 0);
    state.fov += (targetFov - state.fov) * clamp(dt * 6, 0.05, 1);
    cam.fov = state.fov;
    cam.updateProjectionMatrix();

    state.vibPhase += dt * (42 + speed * 0.8);
    let vibY = 0;
    let vibLat = 0;
    if (speed > 65) {
      const aeroAmp = clamp((speed - 65) / 25, 0, 1) * 0.012;
      vibY += Math.sin(state.vibPhase * 1.7) * aeroAmp;
      vibLat += Math.cos(state.vibPhase * 2.3) * aeroAmp * 0.7;
    }
    if (rider.onKerb && speed > 8) {
      const kerbAmp = clamp(speed / 50, 0.25, 1) * 0.022;
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

    const aimHeading = lerpAngle(state.heading, heading, 0.55);
    cam.lookAt(
      w.x + Math.cos(aimHeading) * lookAhead,
      w.y + lookHeight + state.pitchOffset,
      w.z + Math.sin(aimHeading) * lookAhead
    );
  }

  function updateTvBroadcastCamera(rider, width, height, dt) {
    tvCamera.aspect = width / Math.max(1, height);
    if (!rider || !rider.world) {
      tvCamera.updateProjectionMatrix();
      return;
    }

    const w = rider.world;
    const heading = w.heading || 0;

    // Pick nearest of the ~12 trackside camera posts around the circuit
    if (tvCameraPosts.length > 0) {
      let bestIdx = 0;
      let bestDistSq = Infinity;
      const probeX = w.x + Math.cos(heading) * 10;
      const probeZ = w.z + Math.sin(heading) * 10;

      for (let i = 0; i < tvCameraPosts.length; i++) {
        const post = tvCameraPosts[i];
        const dx = post.x - probeX;
        const dz = post.z - probeZ;
        let dSq = dx * dx + dz * dz;
        if (i === activeTvPostIndex) {
          dSq *= 0.78;
        }
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          bestIdx = i;
        }
      }

      if (bestIdx !== activeTvPostIndex) {
        activeTvPostIndex = bestIdx;
        tvCamInitialized = false;
      }

      const activePost = tvCameraPosts[activeTvPostIndex];
      tvCamera.position.set(activePost.x, activePost.y, activePost.z);
    } else {
      tvCamera.position.set(w.x + 18, w.y + 4.5, w.z + 18);
    }

    const targetX = w.x + Math.cos(heading) * 0.2;
    const targetY = w.y + 0.72;
    const targetZ = w.z + Math.sin(heading) * 0.2;

    if (!tvCamInitialized) {
      tvLookAtTarget.set(targetX, targetY, targetZ);
      tvCamInitialized = true;
    } else {
      const trackRate = clamp(dt * 18, 0.14, 1);
      tvLookAtTarget.x += (targetX - tvLookAtTarget.x) * trackRate;
      tvLookAtTarget.y += (targetY - tvLookAtTarget.y) * trackRate;
      tvLookAtTarget.z += (targetZ - tvLookAtTarget.z) * trackRate;
    }

    const distToRider = Math.hypot(
      w.x - tvCamera.position.x,
      w.y - tvCamera.position.y,
      w.z - tvCamera.position.z
    );

    // Broadcast telephoto zoom: tight FOV (~16 deg) when far, widening (~42 deg) on close fly-by
    const desiredFov = clamp(46 - distToRider * 0.40, 16, 42);
    tvCamera.fov += (desiredFov - tvCamera.fov) * clamp(dt * 8, 0.1, 1);
    tvCamera.up.set(0, 1, 0);
    tvCamera.lookAt(tvLookAtTarget);
    tvCamera.updateProjectionMatrix();
  }

  function recenterSunLightOnRider(rider) {
    const w = rider && rider.world ? rider.world : { x: 0, y: 0, z: 0, heading: 0 };
    const heading = w.heading || 0;
    // Offset shadow box center slightly ahead of the rider so the 140m box covers both the bike and road ahead
    const focusX = Math.round(((w.x || 0) + Math.cos(heading) * 14) * 2) / 2;
    const focusY = Math.round((w.y || 0) * 2) / 2;
    const focusZ = Math.round(((w.z || 0) + Math.sin(heading) * 14) * 2) / 2;

    sunLight.target.position.set(focusX, focusY, focusZ);
    sunLight.position.set(
      focusX + SUN_OFFSET.x,
      focusY + SUN_OFFSET.y,
      focusZ + SUN_OFFSET.z
    );
    sunLight.target.updateMatrixWorld();
    sunLight.updateMatrixWorld();
  }

  function renderCameraView(cam, focusRider, mode = 'chase') {
    recenterSunLightOnRider(focusRider);
    skyGroup.position.set(cam.position.x, 0, cam.position.z);

    // In first-person helmet cam, hide the active rider's upper body/helmet so it never clips the camera
    let hiddenBody = null;
    if (mode === 'helmet' && focusRider) {
      const rig = riderRigs.get(focusRider.id);
      if (rig && rig.riderBody && rig.riderBody.visible) {
        hiddenBody = rig.riderBody;
        hiddenBody.visible = false;
      }
    }

    if (hasWebGL) {
      renderer.render(scene, cam);
    }

    if (hiddenBody) {
      hiddenBody.visible = true;
    }
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

  const viewportSize = new THREE.Vector2();

  function renderFrame(riders = [], splitMode = currentSplitMode, dt = 1 / 60, options = {}) {
    if (splitMode && splitMode !== currentSplitMode) {
      currentSplitMode = splitMode;
    }

    syncRiders(riders, dt);
    updateParticles(dt);

    // Phones report stale sizes in the resize event after a rotation, so follow the canvas's real size
    if (canvas && canvas.clientWidth > 0 && canvas.clientHeight > 0 && typeof renderer.getSize === 'function') {
      renderer.getSize(viewportSize);
      if (viewportSize.x !== canvas.clientWidth || viewportSize.y !== canvas.clientHeight) {
        renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
      }
    }

    // Viewports are in CSS pixels; three.js multiplies them by the pixel ratio itself
    const cssSize = typeof renderer.getSize === 'function' ? renderer.getSize(viewportSize) : null;
    const width = (cssSize && cssSize.x) || (canvas && canvas.width) || 1280;
    const height = (cssSize && cssSize.y) || (canvas && canvas.height) || 720;

    // Full-screen Trackside TV Broadcast Camera (used by Replay & TV mode)
    if (options && options.tv === true) {
      const focusIdx = clamp(
        typeof options.focusIndex === 'number' ? options.focusIndex : 0,
        0,
        Math.max(0, riders.length - 1)
      );
      const focusRider = riders[focusIdx] || riders[0] || null;
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, width, height);
      updateTvBroadcastCamera(focusRider, width, height, dt);
      renderCameraView(tvCamera, focusRider, 'tv');
      return;
    }

    // The rider list is re-sorted by race position every frame; screens follow the fixed player ids instead
    const humanRiders = riders.filter((r) => r && !r.isAI).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const hasExplicitFocus = options && typeof options.focusIndex === 'number' && riders[options.focusIndex];
    const p1Rider = hasExplicitFocus ? riders[options.focusIndex] : (humanRiders[0] || riders[0] || null);
    const p2Rider = humanRiders[1] || riders[1] || null;

    if (currentSplitMode === 'single' || !p2Rider) {
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, width, height);
      cameraP1.aspect = width / Math.max(1, height);
      updatePlayerCamera(cameraP1, camState[0], p1Rider, dt, cameraModes[0]);
      renderCameraView(cameraP1, p1Rider, cameraModes[0]);
      return;
    }

    renderer.setScissorTest(true);

    if (currentSplitMode === 'vertical') {
      const halfW = Math.floor(width / 2);
      const aspect = halfW / Math.max(1, height);
      cameraP1.aspect = aspect;
      cameraP2.aspect = aspect;

      updatePlayerCamera(cameraP1, camState[0], p1Rider, dt, cameraModes[0]);
      updatePlayerCamera(cameraP2, camState[1], p2Rider, dt, cameraModes[1]);

      // Left viewport: Player 1
      renderer.setViewport(0, 0, halfW, height);
      renderer.setScissor(0, 0, halfW, height);
      renderCameraView(cameraP1, p1Rider, cameraModes[0]);

      // Right viewport: Player 2
      renderer.setViewport(halfW, 0, width - halfW, height);
      renderer.setScissor(halfW, 0, width - halfW, height);
      renderCameraView(cameraP2, p2Rider, cameraModes[1]);
    } else {
      // Horizontal split: Top half = Player 1, Bottom half = Player 2
      const halfH = Math.floor(height / 2);
      const topH = height - halfH;
      const aspectTop = width / Math.max(1, topH);
      const aspectBottom = width / Math.max(1, halfH);
      cameraP1.aspect = aspectTop;
      cameraP2.aspect = aspectBottom;

      updatePlayerCamera(cameraP1, camState[0], p1Rider, dt, cameraModes[0]);
      updatePlayerCamera(cameraP2, camState[1], p2Rider, dt, cameraModes[1]);

      // Top viewport: Player 1
      renderer.setViewport(0, halfH, width, topH);
      renderer.setScissor(0, halfH, width, topH);
      renderCameraView(cameraP1, p1Rider, cameraModes[0]);

      // Bottom viewport: Player 2
      renderer.setViewport(0, 0, width, halfH);
      renderer.setScissor(0, 0, width, halfH);
      renderCameraView(cameraP2, p2Rider, cameraModes[1]);
    }

    renderer.setScissorTest(false);
  }

  resize();

  return {
    scene,
    renderer,
    cameraP1,
    cameraP2,
    tvCamera,
    sunLight,
    buildTrackScene,
    syncRiders,
    setSplitMode,
    setStartLights,
    setCameraMode,
    getCameraMode,
    renderFrame,
    resize
  };
}
