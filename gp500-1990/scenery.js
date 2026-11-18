// Photographic scenery layer (assets/scenery/, built by tools/build_scenery_assets.py from
// CC0 Poly Haven sources). Loaded asynchronously in the browser and applied on top of the
// procedural track scene; if anything fails to load, the procedural scenery stays.
//
// renderer.js tags meshes with userData.sceneryRole; applyPhotoScenery() swaps their
// materials, hides the procedural mountains/sky/cone trees and adds billboard trees.
import * as THREE from 'three';

const BASE = './assets/scenery/';
const SKY_RADIUS = 1300;
const FOG_COLOR = new THREE.Color(0.66, 0.72, 0.78).convertSRGBToLinear();
const FOG_NEAR = 320;
const FOG_FAR = 2400;

// UV repeats per role, chosen from the UV scale renderer.js gives each mesh so one texture
// tile covers roughly 2.5-3.5 m of ground.
// `color` multiplies the photo (linear RGB) to match the brightness of the sky photo.
const ROLE_SURFACES = {
  ground: { surface: 'grass', repeat: [1200, 1200], antiTile: true, color: [0.5, 0.47, 0.4] },
  grassSkirt: { surface: 'grass', repeat: [5, 5], antiTile: true, vertexColors: true, color: [0.5, 0.47, 0.4] },
  asphalt: { surface: 'asphalt', repeat: [4.6, 2.8], antiTile: true, vertexColors: true, envMapIntensity: 0.55, color: [1.55, 1.55, 1.55] },
  gravel: { surface: 'gravel', repeat: [2.8, 4], antiTile: true, vertexColors: true, color: [0.78, 0.8, 0.86] },
  concrete: { surface: 'concrete', repeat: [4, 2] },
  standBase: { surface: 'concrete', repeat: [6, 1.2] },
  standRoof: { surface: 'metal', repeat: [8, 3], metalness: 0.55, color: [0.6, 0.63, 0.68] }
};

// Roles that keep their painted texture (signage) and gain photographic surface relief.
const ROLE_RELIEF = {
  pitFacade: { surface: 'concrete', repeat: [8, 3] }
};

// Real tree heights in metres for each billboard source (the scans are young trees).
const TREE_HEIGHT_RANGE = {
  island_tree_01: [8, 12],
  island_tree_02: [7, 10],
  searsia_lucida: [2.2, 3.4]
};

const NOISE_GLSL = /* glsl */ `
float gpHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float gpNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( gpHash( i ), gpHash( i + vec2( 1.0, 0.0 ) ), u.x ),
              mix( gpHash( i + vec2( 0.0, 1.0 ) ), gpHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
}
`;

// Hides texture repetition: blends the photo with a rescaled copy of itself and adds
// large, soft brightness variation.
const ANTI_TILE_MAP_GLSL = /* glsl */ `
#ifdef USE_MAP
  vec4 gpTexA = texture2D( map, vMapUv );
  vec4 gpTexB = texture2D( map, vMapUv * 0.37 + vec2( 0.41, 0.27 ) );
  vec4 sampledDiffuseColor = mix( gpTexA, gpTexB, smoothstep( 0.3, 0.7, gpNoise( vMapUv * 0.09 ) ) );
  sampledDiffuseColor.rgb *= mix( 0.84, 1.1, gpNoise( vMapUv * 0.021 + 7.3 ) );
  diffuseColor *= sampledDiffuseColor;
#endif
`;

function applyAntiTiling(material) {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${NOISE_GLSL}`)
      .replace('#include <map_fragment>', ANTI_TILE_MAP_GLSL);
  };
  material.customProgramCacheKey = () => 'gp500-anti-tile';
}

function loadTexture(loader, url, colorSpace, anisotropy) {
  return loader.loadAsync(url).then((tex) => {
    tex.colorSpace = colorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = anisotropy;
    return tex;
  });
}

function withRepeat(tex, repeat) {
  const t = tex.clone();
  t.repeat.set(repeat[0], repeat[1]);
  t.needsUpdate = true;
  return t;
}

function buildRoleMaterials(surfaces) {
  const materials = {};
  for (const [role, spec] of Object.entries(ROLE_SURFACES)) {
    const set = surfaces[spec.surface];
    const mat = new THREE.MeshStandardMaterial({
      map: withRepeat(set.diff, spec.repeat),
      normalMap: withRepeat(set.nor, spec.repeat),
      roughnessMap: withRepeat(set.rough, spec.repeat),
      roughness: 1,
      metalness: spec.metalness ?? 0,
      color: spec.color ? new THREE.Color(...spec.color) : 0xffffff,
      vertexColors: Boolean(spec.vertexColors),
      envMapIntensity: spec.envMapIntensity ?? 0.4
    });
    if (spec.antiTile) applyAntiTiling(mat);
    materials[role] = mat;
  }
  return materials;
}

// Two crossed vertical quads, bottom edge on y = 0; each shows one half of the atlas.
function createCrossedQuadGeometry(size) {
  const h = size / 2;
  const positions = [
    // quad A in the ZY plane (atlas left half)
    0, 0, -h, 0, 0, h, 0, size, h, 0, size, -h,
    // quad B in the XY plane (atlas right half)
    -h, 0, 0, h, 0, 0, h, size, 0, -h, size, 0
  ];
  const uvs = [0, 0, 0.5, 0, 0.5, 1, 0, 1, 0.5, 0, 1, 0, 1, 1, 0.5, 1];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  geo.computeVertexNormals();
  return geo;
}

function withRelief(photo, baseMaterial, spec) {
  let mat = photo.reliefMaterials.get(baseMaterial);
  if (!mat) {
    const set = photo.surfaces[spec.surface];
    mat = baseMaterial.clone();
    mat.normalMap = withRepeat(set.nor, spec.repeat);
    mat.roughnessMap = withRepeat(set.rough, spec.repeat);
    mat.roughness = 1;
    photo.reliefMaterials.set(baseMaterial, mat);
  }
  return mat;
}

function hash01(i, salt) {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function buildTrees(photo, positions) {
  const group = new THREE.Group();
  group.name = 'photo-trees';
  const kinds = photo.trees;
  const buckets = kinds.map(() => []);
  positions.forEach((p, i) => {
    // Mostly tall trees, roughly one shrub in five.
    const r = hash01(i, 1);
    const k = r < 0.2 ? kinds.findIndex((t) => t.id === 'searsia_lucida') : r < 0.6 ? 0 : 1;
    buckets[Math.max(0, k)].push({ ...p, i });
  });

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const v = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  kinds.forEach((kind, k) => {
    const list = buckets[k];
    if (!list.length) return;
    const mesh = new THREE.InstancedMesh(kind.geometry, kind.material, list.length);
    const [hMin, hMax] = TREE_HEIGHT_RANGE[kind.id] || [kind.heightM, kind.heightM];
    list.forEach((p, j) => {
      const scale = (hMin + (hMax - hMin) * hash01(p.i, 2)) / kind.heightM;
      q.setFromAxisAngle(up, hash01(p.i, 3) * Math.PI * 2);
      s.set(scale, scale, scale);
      v.set(p.tx, p.ty - 0.75, p.tz);
      m.compose(v, q, s);
      mesh.setMatrixAt(j, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = true;
    group.add(mesh);
  });
  return group;
}

export async function loadPhotoScenery(renderer) {
  try {
    const meta = await fetch(`${BASE}scenery.json`).then((r) => {
      if (!r.ok) throw new Error(`scenery.json ${r.status}`);
      return r.json();
    });
    const anisotropy = Math.min(16, renderer.capabilities?.getMaxAnisotropy?.() || 8);
    const loader = new THREE.TextureLoader();
    const { RGBELoader } = await import('three/addons/loaders/RGBELoader.js');

    const surfaceNames = Object.keys(meta.surfaces);
    const [sky, envHdr, surfaceSets, treeTextures] = await Promise.all([
      loadTexture(loader, BASE + meta.sky.file, THREE.SRGBColorSpace, anisotropy),
      new RGBELoader().loadAsync(BASE + meta.env.file),
      Promise.all(
        surfaceNames.map(async (name) => {
          const f = meta.surfaces[name];
          const [diff, nor, rough] = await Promise.all([
            loadTexture(loader, BASE + f.diff, THREE.SRGBColorSpace, anisotropy),
            loadTexture(loader, BASE + f.nor, THREE.NoColorSpace, anisotropy),
            loadTexture(loader, BASE + f.rough, THREE.NoColorSpace, anisotropy)
          ]);
          return [name, { diff, nor, rough }];
        })
      ),
      Promise.all(meta.trees.map((t) => loadTexture(loader, BASE + t.file, THREE.SRGBColorSpace, anisotropy)))
    ]);
    sky.wrapS = THREE.ClampToEdgeWrapping;
    sky.wrapT = THREE.ClampToEdgeWrapping;

    envHdr.mapping = THREE.EquirectangularReflectionMapping;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envMap = pmrem.fromEquirectangular(envHdr).texture;
    pmrem.dispose();
    envHdr.dispose();

    const trees = meta.trees.map((t, i) => {
      const tex = treeTextures[i];
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      return {
        ...t,
        geometry: createCrossedQuadGeometry(t.quadSizeM),
        material: new THREE.MeshBasicMaterial({
          map: tex,
          color: 0xdedede,
          alphaTest: 0.5,
          alphaToCoverage: true,
          side: THREE.DoubleSide,
          toneMapped: false
        })
      };
    });

    const surfaces = Object.fromEntries(surfaceSets);
    return {
      meta,
      sky,
      envMap,
      trees,
      surfaces,
      materials: buildRoleMaterials(surfaces),
      reliefMaterials: new Map()
    };
  } catch (err) {
    console.warn('[scenery] photographic scenery unavailable, keeping procedural scenery:', err);
    return null;
  }
}

/**
 * @param {object} photo result of loadPhotoScenery
 * @param {{ scene: THREE.Scene, trackRoot: THREE.Object3D, skyGroup: THREE.Group, sunDirection: THREE.Vector3 }} ctx
 */
export function applyPhotoScenery(photo, { scene, trackRoot, skyGroup, sunDirection }) {
  const sunAzimuth = Math.atan2(sunDirection.z, sunDirection.x);

  // Sky: the photo dome replaces the gradient dome, sun orb and puff clouds.
  if (!skyGroup.userData.photoDome) {
    for (const child of skyGroup.children) child.visible = false;
    const v = photo.meta.sky.vMax;
    const geo = new THREE.SphereGeometry(SKY_RADIUS, 128, 48, 0, Math.PI * 2, 0, Math.PI * v);
    geo.scale(-1, 1, 1);
    const dome = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ map: photo.sky, fog: false, depthWrite: false, toneMapped: false })
    );
    dome.renderOrder = -10;
    dome.frustumCulled = false;
    // Turn the photo so its sun sits where the shadow-casting sun light is.
    dome.rotation.y = 2 * Math.PI * photo.meta.sun.u - sunAzimuth;
    skyGroup.add(dome);
    skyGroup.userData.photoDome = dome;

    scene.environment = photo.envMap;
    scene.environmentIntensity = 1.0;
    scene.environmentRotation.set(0, 2 * Math.PI * photo.meta.sun.u - Math.PI - sunAzimuth, 0);
    scene.background = FOG_COLOR.clone();
    if (scene.fog) {
      scene.fog.color.copy(FOG_COLOR);
      scene.fog.near = FOG_NEAR;
      scene.fog.far = FOG_FAR;
    }
  }

  if (!trackRoot || trackRoot.userData.photoApplied) return;
  trackRoot.userData.photoApplied = true;

  let treePositions = null;
  trackRoot.traverse((obj) => {
    const role = obj.userData.sceneryRole;
    if (!role) return;
    if (role === 'mountains') {
      obj.visible = false;
    } else if (role === 'proceduralTree') {
      obj.visible = false;
      treePositions = treePositions || obj.userData.treePositions || null;
    } else if (photo.materials[role]) {
      obj.material = photo.materials[role];
    } else if (ROLE_RELIEF[role]) {
      obj.material = withRelief(photo, obj.material, ROLE_RELIEF[role]);
    }
  });
  if (treePositions?.length) {
    trackRoot.add(buildTrees(photo, treePositions));
  }
}
