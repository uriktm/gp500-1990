/**
 * Interactive 3D Paddock Showroom for 500cc Grand Prix '90
 * Renders the 4 fictional 1990 GP bikes on a studio turntable stage with
 * RoomEnvironment PMREM reflections, ACES Filmic tone mapping, soft shadows,
 * asynchronous GLB paddock stage & trophy loading (with instant procedural fallback),
 * smooth 42-deg knee-down lean & aero-tuck previews, and 360-deg orbit + zoom.
 */

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BIKES, getBikeById } from './bikes.js';
import { createTextureSet, createBikeLiveryTexture } from './textures.js';
import { createDetailedBikeRig, updateDetailedBikeRig } from './models.js';

const LEAN_PREVIEW_RAD = (42 * Math.PI) / 180;
const DEFAULT_AZIMUTH = 0.68;
const DEFAULT_ELEVATION = 0.24;
const DEFAULT_RADIUS = 3.28;
const MIN_RADIUS = 2.25;
const MAX_RADIUS = 4.85;
const MIN_ELEVATION = 0.06;
const MAX_ELEVATION = 1.05;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function disposeObjectResources(root) {
  if (!root || typeof root.traverse !== 'function') return;
  const geometries = new Set();
  const materials = new Set();
  root.traverse((obj) => {
    if (obj.geometry) geometries.add(obj.geometry);
    if (obj.material) {
      if (Array.isArray(obj.material)) {
        for (const m of obj.material) materials.add(m);
      } else {
        materials.add(obj.material);
      }
    }
  });
  for (const g of geometries) {
    if (typeof g.dispose === 'function') g.dispose();
  }
  for (const m of materials) {
    if (typeof m.dispose === 'function') m.dispose();
  }
}

function buildFallbackPodiumStage() {
  const group = new THREE.Group();
  group.name = 'ProceduralFallbackPodium';

  const plinthMat = new THREE.MeshStandardMaterial({
    color: 0x161a22,
    roughness: 0.36,
    metalness: 0.55
  });
  const deckMat = new THREE.MeshStandardMaterial({
    color: 0x11141b,
    roughness: 0.42,
    metalness: 0.38
  });
  const trimMetalMat = new THREE.MeshStandardMaterial({
    color: 0xcfd7e3,
    roughness: 0.22,
    metalness: 0.88
  });
  const accentRingMat = new THREE.MeshStandardMaterial({
    color: 0xd91424,
    emissive: 0xff2b1f,
    emissiveIntensity: 1.35,
    roughness: 0.25,
    metalness: 0.35
  });

  // Main beveled slate plinth (top flush at y = 0)
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(1.66, 1.78, 0.14, 56), plinthMat);
  plinth.position.y = -0.072;
  plinth.receiveShadow = true;
  plinth.castShadow = true;
  group.add(plinth);

  // Satin turntable top plate (y = 0)
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(1.50, 1.50, 0.008, 56), deckMat);
  deck.position.y = -0.004;
  deck.receiveShadow = true;
  group.add(deck);

  // Outer glowing GP accent ring
  const glowRing = new THREE.Mesh(new THREE.TorusGeometry(1.69, 0.017, 12, 64), accentRingMat);
  glowRing.rotation.x = Math.PI / 2;
  glowRing.position.y = -0.018;
  group.add(glowRing);

  // Flush brushed aluminum inner bezel ring
  const innerRing = new THREE.Mesh(new THREE.RingGeometry(1.44, 1.49, 64), trimMetalMat);
  innerRing.rotation.x = -Math.PI / 2;
  innerRing.position.y = 0.001;
  innerRing.receiveShadow = true;
  group.add(innerRing);

  // Radial aluminum trim bolts around deck perimeter
  const boltGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.01, 10);
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2;
    const bolt = new THREE.Mesh(boltGeo, trimMetalMat);
    bolt.position.set(Math.cos(angle) * 1.57, 0.001, Math.sin(angle) * 1.57);
    bolt.receiveShadow = true;
    group.add(bolt);
  }

  // Two low-profile perimeter spotlight pods framing the stage
  const podHousingGeo = new THREE.CylinderGeometry(0.055, 0.07, 0.09, 14);
  const lensMat = new THREE.MeshBasicMaterial({ color: 0xfff0cc });
  const lensGeo = new THREE.CircleGeometry(0.042, 12);
  for (const angle of [2.35, -2.35]) {
    const pod = new THREE.Group();
    pod.position.set(Math.cos(angle) * 1.54, 0.032, Math.sin(angle) * 1.54);
    pod.lookAt(0, 0.45, 0);
    const housing = new THREE.Mesh(podHousingGeo, plinthMat);
    housing.rotation.x = Math.PI / 2;
    housing.castShadow = true;
    const lens = new THREE.Mesh(lensGeo, lensMat);
    lens.position.z = 0.047;
    pod.add(housing, lens);
    group.add(pod);
  }

  return { group, accentRingMat };
}

function createNoopRenderer(canvas) {
  return {
    domElement: canvas || { width: 800, height: 520, style: {} },
    outputColorSpace: THREE.SRGBColorSpace,
    toneMapping: THREE.ACESFilmicToneMapping,
    toneMappingExposure: 1.12,
    shadowMap: { enabled: true, type: THREE.PCFSoftShadowMap },
    setPixelRatio() {},
    setClearColor() {},
    setSize(w, h) {
      if (canvas) {
        canvas.width = w;
        canvas.height = h;
      }
    },
    render() {},
    dispose() {}
  };
}

/**
 * Creates the interactive 3D showroom viewer for the 1990 500cc GP motorcycles.
 * @param {HTMLCanvasElement|object|null} canvas
 * @param {object} [opts]
 */
export function createBikeShowroom(canvas, opts = {}) {
  const initialBikeId = getBikeById(opts.bikeId || opts.initialBikeId || BIKES[0].id).id;
  const autoRotateEnabled = opts.autoRotate !== false;

  let renderer = null;
  let hasWebGL = false;

  try {
    if (canvas && typeof canvas.getContext === 'function') {
      const gl =
        canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' }) ||
        canvas.getContext('webgl', { antialias: true, alpha: false, powerPreference: 'high-performance' });
      if (gl) {
        renderer = new THREE.WebGLRenderer({
          canvas,
          context: gl,
          antialias: true,
          alpha: false,
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
      typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1
    );
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.14;
    renderer.setClearColor(0x090c11, 1);
    if (renderer.shadowMap) {
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
  } else {
    renderer = createNoopRenderer(canvas);
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x090c11);
  scene.fog = new THREE.Fog(0x090c11, 9.0, 22.0);

  let envRenderTarget = null;
  if (hasWebGL && typeof THREE.PMREMGenerator === 'function') {
    let pmremGenerator = null;
    try {
      pmremGenerator = new THREE.PMREMGenerator(renderer);
      if (typeof pmremGenerator.compileEquirectangularShader === 'function') {
        pmremGenerator.compileEquirectangularShader();
      }
      const roomEnv = new RoomEnvironment();
      envRenderTarget = pmremGenerator.fromScene(roomEnv, 0.04);
      scene.environment = envRenderTarget.texture;
      scene.environmentIntensity = 1.15;
      if (typeof roomEnv.dispose === 'function') roomEnv.dispose();
      pmremGenerator.dispose();
    } catch (_envErr) {
      if (pmremGenerator && typeof pmremGenerator.dispose === 'function') {
        pmremGenerator.dispose();
      }
      scene.environment = new THREE.Texture();
    }
  }

  // Dramatic studio key / rim / fill lighting
  const hemiLight = new THREE.HemisphereLight(0xdceaff, 0x181c24, 0.48);
  hemiLight.position.set(0, 8, 0);
  scene.add(hemiLight);

  const keyLight = new THREE.DirectionalLight(0xfff5e4, 2.85);
  keyLight.position.set(3.8, 5.4, 3.6);
  keyLight.castShadow = true;
  if (keyLight.shadow) {
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.left = -2.6;
    keyLight.shadow.camera.right = 2.6;
    keyLight.shadow.camera.top = 2.6;
    keyLight.shadow.camera.bottom = -2.6;
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 16;
    keyLight.shadow.bias = -0.00025;
    keyLight.shadow.normalBias = 0.015;
    keyLight.shadow.camera.updateProjectionMatrix();
  }
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0x74c6ff, 2.15);
  rimLight.position.set(-4.2, 3.0, -3.6);
  scene.add(rimLight);

  const fillLight = new THREE.DirectionalLight(0xffe9dc, 0.72);
  fillLight.position.set(-2.6, 1.9, 3.5);
  scene.add(fillLight);

  const accentLight = new THREE.PointLight(0xff2c24, 3.8, 8.5, 1.6);
  accentLight.position.set(-1.3, 0.55, -1.6);
  scene.add(accentLight);

  // Studio floor shadow receiver
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x0b0e14,
    roughness: 0.78,
    metalness: 0.14
  });
  const studioFloor = new THREE.Mesh(new THREE.CircleGeometry(14, 56), floorMat);
  studioFloor.rotation.x = -Math.PI / 2;
  studioFloor.position.y = -0.145;
  studioFloor.receiveShadow = true;
  scene.add(studioFloor);

  // Stage container (procedural fallback podium immediately visible; swapped when GLB loads)
  const stageGroup = new THREE.Group();
  scene.add(stageGroup);

  const fallbackPodium = buildFallbackPodiumStage();
  stageGroup.add(fallbackPodium.group);

  const bikesGroup = new THREE.Group();
  scene.add(bikesGroup);

  const textureSet = createTextureSet();
  const bikeRigCache = new Map();

  let currentBikeId = initialBikeId;
  let activeRig = null;
  let leanPreview = Boolean(opts.leanPreview);
  let tuckPreview = Boolean(opts.tuckPreview);
  let active = true;
  let disposed = false;
  let stageLoaded = false;
  let trophyLoaded = false;

  const previewRider = {
    id: 'showroom-preview',
    name: 'Factory GP500',
    isAI: false,
    playerIndex: 0,
    bike: getBikeById(currentBikeId),
    speed: 0,
    rpm: 4200,
    gear: 1,
    lean: leanPreview ? LEAN_PREVIEW_RAD : 0,
    throttle: 0,
    brake: 0,
    steer: 0,
    tuck: tuckPreview,
    rearSlip: 0,
    highsideTimer: 0,
    wheelieAngle: 0,
    world: { x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0 }
  };

  function getOrBuildBikeRig(bikeId) {
    const bike = getBikeById(bikeId);
    if (bikeRigCache.has(bike.id)) {
      return bikeRigCache.get(bike.id);
    }
    const liveryTex = createBikeLiveryTexture(bike);
    const rig = createDetailedBikeRig({ ...previewRider, bike }, textureSet, liveryTex);
    if (rig?.rootGroup) {
      rig.rootGroup.traverse((child) => {
        if (child.isMesh && !child.userData?.noShadow) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      rig.rootGroup.visible = false;
      bikesGroup.add(rig.rootGroup);
    }
    bikeRigCache.set(bike.id, rig);
    return rig;
  }

  function applyBikeAccentTint(bike) {
    if (!bike) return;
    const primaryHex = bike.colorPrimary ?? 0xd91424;
    accentLight.color.setHex(primaryHex);
    if (fallbackPodium.accentRingMat) {
      fallbackPodium.accentRingMat.color.setHex(primaryHex);
      fallbackPodium.accentRingMat.emissive.setHex(primaryHex);
    }
  }

  function setBike(bikeId) {
    const bike = getBikeById(bikeId);
    currentBikeId = bike.id;
    previewRider.bike = bike;

    for (const [id, rig] of bikeRigCache.entries()) {
      if (rig?.rootGroup) {
        rig.rootGroup.visible = id === bike.id;
      }
    }

    activeRig = getOrBuildBikeRig(bike.id);
    if (activeRig?.rootGroup) {
      activeRig.rootGroup.visible = true;
      updateDetailedBikeRig(activeRig, previewRider, 1 / 60);
    }
    applyBikeAccentTint(bike);
    return bike.id;
  }

  setBike(initialBikeId);

  // Camera & interactive 360-deg orbit + zoom state
  const camera = new THREE.PerspectiveCamera(34, 16 / 10, 0.1, 60);
  const lookTarget = new THREE.Vector3(0, 0.62, 0);

  let camAzimuth = DEFAULT_AZIMUTH;
  let targetAzimuth = DEFAULT_AZIMUTH;
  let camElevation = DEFAULT_ELEVATION;
  let targetElevation = DEFAULT_ELEVATION;
  let camRadius = DEFAULT_RADIUS;
  let targetRadius = DEFAULT_RADIUS;
  let idleElapsed = 0;

  function updateCameraTransform() {
    const cosEl = Math.cos(camElevation);
    const x = lookTarget.x + camRadius * cosEl * Math.cos(camAzimuth);
    const y = lookTarget.y + camRadius * Math.sin(camElevation);
    const z = lookTarget.z + camRadius * cosEl * Math.sin(camAzimuth);
    camera.position.set(x, y, z);
    camera.lookAt(lookTarget);
  }

  function resize() {
    if (!canvas) return;
    const width = Math.max(1, Math.round(canvas.clientWidth || canvas.width || 800));
    const height = Math.max(1, Math.round(canvas.clientHeight || canvas.height || 500));
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (hasWebGL) {
      renderer.setSize(width, height, false);
    }
  }

  resize();
  updateCameraTransform();

  // Asynchronous Blender GLB loading (browser-only; skipped cleanly in Node)
  let stageGlbScene = null;
  let trophyGlbScene = null;

  function loadBlenderAssets() {
    if (!hasWebGL || typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }

    const loader = new GLTFLoader();

    loader.load(
      './assets/showcase/paddock_stage.glb',
      (gltf) => {
        if (disposed || !gltf?.scene) return;
        const model = gltf.scene;
        model.traverse((node) => {
          if (node.isMesh) {
            node.castShadow = true;
            node.receiveShadow = true;
          }
        });
        if (typeof THREE.Box3 === 'function') {
          const box = new THREE.Box3().setFromObject(model);
          if (Number.isFinite(box.min.y)) {
            studioFloor.position.y = Math.min(-0.02, box.min.y - 0.002);
          }
        }
        fallbackPodium.group.visible = false;
        stageGlbScene = model;
        stageGroup.add(model);
        stageLoaded = true;
      },
      undefined,
      () => {
        // Keep procedural fallback podium seamlessly if GLB is unavailable
      }
    );

    loader.load(
      './assets/showcase/champion_trophy.glb',
      (gltf) => {
        if (disposed || !gltf?.scene) return;
        const trophy = gltf.scene;
        trophy.traverse((node) => {
          if (node.isMesh) {
            node.castShadow = true;
            node.receiveShadow = true;
          }
        });

        // Ground trophy cleanly on a compact dark obsidian plinth on the right-side deck
        // (inside the 1.24m seam ring, clear of spotlight pods at (-0.67, +/-1.375) and opposite the +Z lean side)
        const trophyAnchor = new THREE.Group();
        trophyAnchor.position.set(0.28, 0, -1.15);
        trophyAnchor.rotation.y = 0.68;

        const pedGeo = new THREE.CylinderGeometry(0.16, 0.19, 0.18, 28);
        const pedMat = new THREE.MeshStandardMaterial({
          color: 0x14171f,
          roughness: 0.32,
          metalness: 0.65
        });
        const pedMesh = new THREE.Mesh(pedGeo, pedMat);
        pedMesh.position.y = 0.09;
        pedMesh.castShadow = true;
        pedMesh.receiveShadow = true;
        trophyAnchor.add(pedMesh);

        if (typeof THREE.Box3 === 'function') {
          const box = new THREE.Box3().setFromObject(trophy);
          const size = new THREE.Vector3();
          const center = new THREE.Vector3();
          box.getSize(size);
          box.getCenter(center);
          const h = Math.max(size.y, 0.01);
          const targetHeight = 0.45;
          if (h > 0.9 || h < 0.15) {
            trophy.scale.multiplyScalar(targetHeight / h);
          }
          const scaledBox = new THREE.Box3().setFromObject(trophy);
          const scaledCenter = new THREE.Vector3();
          scaledBox.getCenter(scaledCenter);
          trophy.position.set(-scaledCenter.x, 0.18 - scaledBox.min.y, -scaledCenter.z);
        } else {
          trophy.position.set(0, 0.18, 0);
        }

        trophyAnchor.add(trophy);
        trophyGlbScene = trophyAnchor;
        stageGroup.add(trophyAnchor);
        trophyLoaded = true;
      },
      undefined,
      () => {
        // Silent fallback if trophy GLB is unavailable
      }
    );
  }

  loadBlenderAssets();

  // Interactive pointer drag 360-deg orbit & scroll / pinch zoom
  const activePointers = new Map();
  let lastDragPos = null;
  let lastPinchDist = null;
  let isDragging = false;

  const prefersReducedMotion =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;

  function onPointerDown(e) {
    if (!canvas) return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    idleElapsed = 0;

    if (activePointers.size === 1) {
      isDragging = true;
      lastDragPos = { x: e.clientX, y: e.clientY };
      lastPinchDist = null;
      if (typeof canvas.setPointerCapture === 'function') {
        try {
          canvas.setPointerCapture(e.pointerId);
        } catch (_err) {
          // Ignore synthetic pointer events
        }
      }
    } else if (activePointers.size === 2) {
      isDragging = false;
      const pts = Array.from(activePointers.values());
      lastPinchDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    }
  }

  function onPointerMove(e) {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    idleElapsed = 0;

    if (activePointers.size === 2) {
      const pts = Array.from(activePointers.values());
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      if (lastPinchDist !== null) {
        const delta = lastPinchDist - dist;
        targetRadius = clamp(targetRadius + delta * 0.009, MIN_RADIUS, MAX_RADIUS);
      }
      lastPinchDist = dist;
      return;
    }

    if (isDragging && lastDragPos) {
      const dx = e.clientX - lastDragPos.x;
      const dy = e.clientY - lastDragPos.y;
      lastDragPos = { x: e.clientX, y: e.clientY };
      targetAzimuth += dx * 0.0085;
      targetElevation = clamp(targetElevation + dy * 0.0055, MIN_ELEVATION, MAX_ELEVATION);
    }
  }

  function onPointerUp(e) {
    activePointers.delete(e.pointerId);
    if (activePointers.size < 2) {
      lastPinchDist = null;
    }
    if (activePointers.size === 1) {
      const remaining = Array.from(activePointers.values())[0];
      lastDragPos = { x: remaining.x, y: remaining.y };
      isDragging = true;
    } else if (activePointers.size === 0) {
      isDragging = false;
      lastDragPos = null;
    }
  }

  function onWheel(e) {
    if (!active || disposed) return;
    const nextRadius = clamp(targetRadius + e.deltaY * 0.0022, MIN_RADIUS, MAX_RADIUS);
    if (Math.abs(nextRadius - targetRadius) > 1e-4 || e.ctrlKey) {
      e.preventDefault();
      idleElapsed = 0;
      targetRadius = nextRadius;
    }
  }

  function onDoubleClick() {
    resetView();
  }

  let resizeObserver = null;
  if (canvas && typeof canvas.addEventListener === 'function') {
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('dblclick', onDoubleClick);
  }

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('resize', resize);
  }
  if (canvas && typeof ResizeObserver === 'function') {
    resizeObserver = new ResizeObserver(() => resize());
    resizeObserver.observe(canvas);
  }

  function resetView() {
    targetAzimuth = DEFAULT_AZIMUTH;
    targetElevation = DEFAULT_ELEVATION;
    targetRadius = DEFAULT_RADIUS;
    idleElapsed = 0;
  }

  function setLeanPreview(enabled) {
    leanPreview = Boolean(enabled);
    return leanPreview;
  }

  function setTuckPreview(enabled) {
    tuckPreview = Boolean(enabled);
    previewRider.tuck = tuckPreview;
    return tuckPreview;
  }

  // Render / animation loop
  let rafId = null;
  let lastTimeMs = typeof performance !== 'undefined' ? performance.now() : Date.now();

  function stepFrame(dtSec) {
    const dt = clamp(dtSec, 0.001, 0.08);
    const targetLean = leanPreview ? LEAN_PREVIEW_RAD : 0;
    const leanBlend = 1 - Math.exp(-8.5 * dt);
    previewRider.lean += (targetLean - previewRider.lean) * leanBlend;
    previewRider.tuck = tuckPreview;

    if (!isDragging && activePointers.size === 0) {
      idleElapsed += dt;
      if (autoRotateEnabled && !prefersReducedMotion && idleElapsed > 1.6) {
        targetAzimuth += 0.16 * dt;
      }
    }

    const camBlend = 1 - Math.exp(-10.0 * dt);
    camAzimuth += (targetAzimuth - camAzimuth) * camBlend;
    camElevation += (targetElevation - camElevation) * camBlend;
    camRadius += (targetRadius - camRadius) * camBlend;

    updateCameraTransform();
    if (activeRig) {
      updateDetailedBikeRig(activeRig, previewRider, dt);
    }
    renderer.render(scene, camera);
  }

  function loop(nowMs) {
    if (!active || disposed) {
      rafId = null;
      return;
    }
    const dt = (nowMs - lastTimeMs) / 1000;
    lastTimeMs = nowMs;
    stepFrame(dt > 0 ? dt : 1 / 60);
    if (typeof requestAnimationFrame === 'function') {
      rafId = requestAnimationFrame(loop);
    }
  }

  function startLoop() {
    if (disposed || !active || rafId !== null) return;
    if (typeof requestAnimationFrame === 'function') {
      lastTimeMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
      rafId = requestAnimationFrame(loop);
    }
  }

  function stopLoop() {
    if (rafId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function setActive(flag) {
    active = Boolean(flag);
    if (active && !disposed) {
      resize();
      startLoop();
    } else {
      stopLoop();
    }
    return active;
  }

  // Run one initial render frame safely and start loop if running in browser
  stepFrame(1 / 60);
  if (hasWebGL && typeof window !== 'undefined') {
    startLoop();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    active = false;
    stopLoop();

    if (canvas && typeof canvas.removeEventListener === 'function') {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('dblclick', onDoubleClick);
    }
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('resize', resize);
    }
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }

    disposeObjectResources(stageGroup);
    disposeObjectResources(bikesGroup);
    disposeObjectResources(studioFloor);
    if (stageGlbScene) stageGlbScene = null;
    if (trophyGlbScene) trophyGlbScene = null;
    bikeRigCache.clear();

    if (envRenderTarget && typeof envRenderTarget.dispose === 'function') {
      envRenderTarget.dispose();
      envRenderTarget = null;
    }
    if (typeof renderer.dispose === 'function') {
      renderer.dispose();
    }
  }

  return {
    scene,
    camera,
    renderer,
    setBike,
    setLeanPreview,
    setTuckPreview,
    setActive,
    isActive: () => active,
    resetView,
    resize,
    stepFrame,
    dispose,
    getState: () => ({
      bikeId: currentBikeId,
      leanPreview,
      tuckPreview,
      active,
      disposed,
      hasWebGL,
      stageLoaded,
      trophyLoaded,
      azimuth: camAzimuth,
      elevation: camElevation,
      radius: camRadius
    })
  };
}
