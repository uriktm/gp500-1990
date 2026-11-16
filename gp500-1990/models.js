// High-Detail Sculpted 3D Models for 1990 500cc 2-Stroke Grand Prix Motorcycles & Articulated Riders
import * as THREE from 'three';

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function makePhysicalMat(opts = {}) {
  if (typeof THREE.MeshPhysicalMaterial === 'function') {
    return new THREE.MeshPhysicalMaterial(opts);
  }
  if (typeof THREE.MeshStandardMaterial === 'function') {
    return new THREE.MeshStandardMaterial(opts);
  }
  return new THREE.MeshPhongMaterial(opts);
}

function makeStandardMat(opts = {}) {
  if (typeof THREE.MeshStandardMaterial === 'function') {
    return new THREE.MeshStandardMaterial(opts);
  }
  return new THREE.MeshLambertMaterial(opts);
}

function createTorusTireGeometry(radius, tube, radialSegments = 14, tubularSegments = 28) {
  if (typeof THREE.TorusGeometry === 'function') {
    return new THREE.TorusGeometry(radius, tube, radialSegments, tubularSegments);
  }
  return new THREE.CylinderGeometry(radius + tube, radius + tube, tube * 2, tubularSegments);
}

function createNoseLatheGeometry() {
  if (typeof THREE.LatheGeometry === 'function' && typeof THREE.Vector2 === 'function') {
    const pts = [
      new THREE.Vector2(0.01, 0.34),
      new THREE.Vector2(0.065, 0.31),
      new THREE.Vector2(0.125, 0.23),
      new THREE.Vector2(0.168, 0.11),
      new THREE.Vector2(0.192, -0.02),
      new THREE.Vector2(0.198, -0.16)
    ];
    return new THREE.LatheGeometry(pts, 18);
  }
  return new THREE.CylinderGeometry(0.04, 0.2, 0.48, 16);
}

function isTorusInXZPlane(geo) {
  const pos = geo && geo.attributes && geo.attributes.position;
  if (!pos || !pos.array || pos.array.length < 9) return false;
  let maxY = 0;
  let maxZ = 0;
  const arr = pos.array;
  for (let i = 0; i < arr.length; i += 3) {
    const ay = Math.abs(arr[i + 1]);
    const az = Math.abs(arr[i + 2]);
    if (ay > maxY) maxY = ay;
    if (az > maxZ) maxZ = az;
  }
  return maxZ > maxY * 1.25;
}

let sharedGeos = null;

function getSharedGeometries() {
  if (sharedGeos) return sharedGeos;

  const frontTireGeo = createTorusTireGeometry(0.24, 0.092, 14, 28);
  const rearTireGeo = createTorusTireGeometry(0.24, 0.105, 14, 28);
  const torusXZ = isTorusInXZPlane(frontTireGeo);

  sharedGeos = {
    frontTireGeo,
    rearTireGeo,
    torusXZ,
    frontRimBarrel: new THREE.CylinderGeometry(0.195, 0.195, 0.105, 20),
    rearRimBarrel: new THREE.CylinderGeometry(0.195, 0.195, 0.145, 20),
    frontHub: new THREE.CylinderGeometry(0.056, 0.056, 0.15, 14),
    rearHub: new THREE.CylinderGeometry(0.064, 0.064, 0.18, 14),
    spokeBox: new THREE.BoxGeometry(0.036, 0.37, 0.034),
    frontBrakeDisc: new THREE.CylinderGeometry(0.156, 0.156, 0.012, 22),
    frontDiscCarrier: new THREE.CylinderGeometry(0.088, 0.088, 0.016, 14),
    rearBrakeDisc: new THREE.CylinderGeometry(0.115, 0.115, 0.012, 18),
    rearSprocket: new THREE.CylinderGeometry(0.132, 0.132, 0.014, 20),

    // Frame, swingarm, engine & forks
    frameSpar: new THREE.BoxGeometry(0.68, 0.095, 0.038),
    subframeRail: new THREE.CylinderGeometry(0.016, 0.016, 0.52, 8),
    swingarmBeam: new THREE.BoxGeometry(0.62, 0.072, 0.036),
    swingarmBrace: new THREE.BoxGeometry(0.38, 0.035, 0.028),
    engineBlock: new THREE.BoxGeometry(0.42, 0.32, 0.28),
    radiatorBox: new THREE.BoxGeometry(0.075, 0.28, 0.33),
    forkOuter: new THREE.CylinderGeometry(0.028, 0.026, 0.38, 12),
    forkInner: new THREE.CylinderGeometry(0.021, 0.021, 0.32, 12),
    caliperBox: new THREE.BoxGeometry(0.082, 0.095, 0.048),
    tripleClamp: new THREE.BoxGeometry(0.09, 0.026, 0.26),
    handlebarTube: new THREE.CylinderGeometry(0.012, 0.012, 0.22, 8),
    leverBlade: new THREE.BoxGeometry(0.015, 0.012, 0.12),
    tachDial: new THREE.CylinderGeometry(0.052, 0.052, 0.028, 16),
    tempDial: new THREE.CylinderGeometry(0.028, 0.028, 0.026, 12),
    dashFoam: new THREE.BoxGeometry(0.11, 0.04, 0.22),

    // Sculpted 1990 500cc bodywork
    noseCone: createNoseLatheGeometry(),
    bubbleScreen: new THREE.SphereGeometry(0.23, 18, 14),
    fuelTankMain: new THREE.SphereGeometry(0.24, 18, 14),
    fuelCap: new THREE.CylinderGeometry(0.042, 0.042, 0.018, 14),
    sideFairingShell: new THREE.SphereGeometry(0.32, 18, 14),
    bellyPan: new THREE.CylinderGeometry(0.15, 0.19, 0.88, 14),
    tailCowlMain: new THREE.SphereGeometry(0.22, 16, 12),
    tailNumberPlate: new THREE.BoxGeometry(0.36, 0.16, 0.018),
    seatPad: new THREE.BoxGeometry(0.34, 0.045, 0.25),
    seatBumStop: new THREE.CylinderGeometry(0.05, 0.06, 0.23, 12),
    frontFender: new THREE.SphereGeometry(0.18, 14, 12),
    rearHugger: new THREE.SphereGeometry(0.19, 12, 10),
    ventSlat: new THREE.BoxGeometry(0.16, 0.014, 0.02),

    // 2-stroke expansion chamber cones & carbon silencers
    expHeader: new THREE.CylinderGeometry(0.026, 0.036, 0.28, 12),
    expDiffuser: new THREE.CylinderGeometry(0.036, 0.068, 0.34, 14),
    expBelly: new THREE.CylinderGeometry(0.068, 0.064, 0.22, 14),
    expBaffle: new THREE.CylinderGeometry(0.064, 0.028, 0.28, 14),
    silencerCan: new THREE.CylinderGeometry(0.034, 0.034, 0.32, 14),
    silencerTip: new THREE.CylinderGeometry(0.02, 0.022, 0.065, 10),

    // Articulated Rider
    pelvisSphere: new THREE.SphereGeometry(0.148, 14, 12),
    torsoChest: new THREE.CylinderGeometry(0.145, 0.125, 0.38, 14),
    torsoShoulderCap: new THREE.SphereGeometry(0.078, 12, 10),
    aeroBackHump: new THREE.SphereGeometry(0.115, 12, 10),
    upperArm: new THREE.CylinderGeometry(0.048, 0.042, 0.24, 10),
    elbowSphere: new THREE.SphereGeometry(0.046, 10, 8),
    forearm: new THREE.CylinderGeometry(0.04, 0.034, 0.23, 10),
    gloveSphere: new THREE.SphereGeometry(0.042, 10, 8),
    thighCyl: new THREE.CylinderGeometry(0.072, 0.058, 0.29, 12),
    kneeSphere: new THREE.SphereGeometry(0.062, 12, 10),
    kneePuck: new THREE.CylinderGeometry(0.048, 0.042, 0.03, 12),
    shinCyl: new THREE.CylinderGeometry(0.056, 0.044, 0.27, 12),
    bootBox: new THREE.BoxGeometry(0.19, 0.078, 0.088),
    helmetShell: new THREE.SphereGeometry(0.155, 18, 14),
    helmetVisor: new THREE.SphereGeometry(0.151, 16, 12),
    helmetChin: new THREE.CylinderGeometry(0.095, 0.11, 0.09, 14),

    // Contact shadow & knee sparks
    shadowOuter: new THREE.CylinderGeometry(0.96, 0.96, 0.004, 24),
    shadowInner: new THREE.CylinderGeometry(0.68, 0.68, 0.005, 20),
    sparkStreak: new THREE.BoxGeometry(0.24, 0.018, 0.018),
    sparkCore: new THREE.SphereGeometry(0.048, 8, 8)
  };

  return sharedGeos;
}

function buildSparkCluster() {
  const G = getSharedGeometries();
  const group = new THREE.Group();
  const coreMat = new THREE.MeshBasicMaterial({
    color: 0xfff6b0,
    transparent: true,
    opacity: 0.95
  });
  const streakMat = new THREE.MeshBasicMaterial({
    color: 0xff8c1a,
    transparent: true,
    opacity: 0.9
  });

  const core = new THREE.Mesh(G.sparkCore, coreMat);
  group.add(core);

  const angles = [
    [0.15, 0.1, -0.2],
    [-0.25, 0.28, 0.15],
    [0.35, -0.22, 0.3],
    [-0.1, -0.35, -0.28],
    [0.05, 0.42, 0.08]
  ];
  for (let i = 0; i < angles.length; i++) {
    const s = new THREE.Mesh(G.sparkStreak, i % 2 === 0 ? streakMat : coreMat);
    s.position.set(-0.11, 0.01 * i, 0);
    s.rotation.set(angles[i][0], angles[i][1], angles[i][2]);
    group.add(s);
  }
  group.visible = false;
  return group;
}

/**
 * Builds a realistic, multi-part hierarchical 1990 500cc GP motorcycle + articulated rider rig.
 * Local coordinate convention inside leanGroup: +X is forward, +Y is up, +Z is right.
 */
export function createDetailedBikeRig(rider = {}, textureSet = null, liveryTexture = null) {
  const G = getSharedGeometries();
  const bikeSpec = rider.bike || {};
  const cPrimary = bikeSpec.colorPrimary ?? 0xd91424;
  const cSecondary = bikeSpec.colorSecondary ?? 0xffffff;
  const cAccent = bikeSpec.colorAccent ?? 0x151515;

  // Root hierarchy
  const rootGroup = new THREE.Group();
  const pitchGroup = new THREE.Group();
  const leanGroup = new THREE.Group();
  rootGroup.add(pitchGroup);
  pitchGroup.add(leanGroup);

  // Soft Grounding Contact Shadow right at y = 0.025 beneath the bike (stays flat on road)
  const contactShadow = new THREE.Group();
  contactShadow.position.set(0, 0.025, 0);
  const shadowOuterMat = new THREE.MeshBasicMaterial({
    color: 0x05070a,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2
  });
  const shadowInnerMat = new THREE.MeshBasicMaterial({
    color: 0x020305,
    transparent: true,
    opacity: 0.52,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -3
  });
  const outerShadowMesh = new THREE.Mesh(G.shadowOuter, shadowOuterMat);
  outerShadowMesh.scale.set(1.06, 1.0, 0.44);
  const innerShadowMesh = new THREE.Mesh(G.shadowInner, shadowInnerMat);
  innerShadowMesh.scale.set(1.08, 1.0, 0.36);
  innerShadowMesh.position.y = 0.001;
  contactShadow.add(outerShadowMesh, innerShadowMesh);
  rootGroup.add(contactShadow);

  // PBR Materials
  const liveryBodyMat = makePhysicalMat({
    color: liveryTexture ? 0xffffff : cPrimary,
    map: liveryTexture || null,
    roughness: 0.14,
    metalness: 0.12,
    clearcoat: 1.0,
    clearcoatRoughness: 0.07
  });

  const primaryGlossMat = makePhysicalMat({
    color: cPrimary,
    roughness: 0.15,
    metalness: 0.14,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08
  });

  const secondaryGlossMat = makePhysicalMat({
    color: cSecondary,
    roughness: 0.16,
    metalness: 0.12,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08
  });

  const accentMat = makePhysicalMat({
    color: cAccent,
    roughness: 0.28,
    metalness: 0.18,
    clearcoat: 0.65
  });

  const tireSlickMat = makeStandardMat({
    color: textureSet?.tireTread ? 0x26292e : 0x17191c,
    map: textureSet?.tireTread || null,
    roughness: 0.72,
    metalness: 0.06
  });

  const magWheelMat = makeStandardMat({
    color: cSecondary === 0xf5c542 ? 0xe8be3c : 0xe8edf2,
    roughness: 0.24,
    metalness: 0.78
  });

  const aluminumFrameMat = makeStandardMat({
    color: 0xd8dfe8,
    roughness: 0.21,
    metalness: 0.86
  });

  const chromeMat = makePhysicalMat({
    color: 0xf4f8ff,
    roughness: 0.06,
    metalness: 0.96,
    clearcoat: 1.0
  });

  const goldAnodizedMat = makeStandardMat({
    color: 0xe2b032,
    roughness: 0.2,
    metalness: 0.86
  });

  const brakeDiscMat = makeStandardMat({
    color: 0xcfd6df,
    map: textureSet?.brakeDisc || null,
    roughness: 0.24,
    metalness: 0.88
  });

  const carbonMat = makeStandardMat({
    color: textureSet?.carbon ? 0x889098 : 0x24282e,
    map: textureSet?.carbon || null,
    roughness: 0.32,
    metalness: 0.25
  });

  const exhaustExpansionMat = makeStandardMat({
    color: 0xbba486,
    roughness: 0.25,
    metalness: 0.85
  });

  const darkEngineMat = makeStandardMat({
    color: 0x2b3038,
    roughness: 0.42,
    metalness: 0.68
  });

  const blackRubberMat = makeStandardMat({
    color: 0x16181c,
    roughness: 0.8,
    metalness: 0.05
  });

  const windscreenMat = makePhysicalMat({
    color: 0xd4ecff,
    roughness: 0.06,
    metalness: 0.08,
    clearcoat: 1.0,
    clearcoatRoughness: 0.04,
    transparent: true,
    opacity: 0.52
  });

  const visorChromeMat = makePhysicalMat({
    color: 0x101622,
    roughness: 0.06,
    metalness: 0.92,
    clearcoat: 1.0
  });

  const leatherPrimaryMat = makePhysicalMat({
    color: cPrimary,
    roughness: 0.34,
    metalness: 0.08,
    clearcoat: 0.45,
    clearcoatRoughness: 0.25
  });

  const leatherSecondaryMat = makePhysicalMat({
    color: cSecondary,
    roughness: 0.34,
    metalness: 0.08,
    clearcoat: 0.45,
    clearcoatRoughness: 0.25
  });

  const leatherDarkMat = makeStandardMat({
    color: 0x1a1d24,
    roughness: 0.42,
    metalness: 0.1
  });

  const puckMat = makeStandardMat({
    color: 0xf5d428,
    roughness: 0.5,
    metalness: 0.05
  });

  // =========================================================================
  // 1. FRONT & REAR PROFILED RACING SLICK WHEELS (Spin around local Z axis)
  // =========================================================================
  const frontWheelGroup = new THREE.Group();
  frontWheelGroup.position.set(0.74, 0.33, 0);
  leanGroup.add(frontWheelGroup);

  const frontTireMesh = new THREE.Mesh(G.frontTireGeo, tireSlickMat);
  if (G.torusXZ) frontTireMesh.rotation.x = Math.PI / 2;
  frontWheelGroup.add(frontTireMesh);

  const frontRimMesh = new THREE.Mesh(G.frontRimBarrel, magWheelMat);
  frontRimMesh.rotation.x = Math.PI / 2;
  frontWheelGroup.add(frontRimMesh);

  const frontHubMesh = new THREE.Mesh(G.frontHub, aluminumFrameMat);
  frontHubMesh.rotation.x = Math.PI / 2;
  frontWheelGroup.add(frontHubMesh);

  for (let s = 0; s < 3; s++) {
    const spoke = new THREE.Mesh(G.spokeBox, magWheelMat);
    spoke.rotation.z = (s * Math.PI) / 3;
    frontWheelGroup.add(spoke);
  }

  // Dual ventilated steel front brake discs + gold carrier spiders
  for (const side of [-1, 1]) {
    const disc = new THREE.Mesh(G.frontBrakeDisc, brakeDiscMat);
    disc.rotation.x = Math.PI / 2;
    disc.position.z = side * 0.068;
    const carrier = new THREE.Mesh(G.frontDiscCarrier, goldAnodizedMat);
    carrier.rotation.x = Math.PI / 2;
    carrier.position.z = side * 0.068;
    frontWheelGroup.add(disc, carrier);
  }

  const rearWheelGroup = new THREE.Group();
  rearWheelGroup.position.set(-0.72, 0.34, 0);
  leanGroup.add(rearWheelGroup);

  const rearTireMesh = new THREE.Mesh(G.rearTireGeo, tireSlickMat);
  if (G.torusXZ) {
    rearTireMesh.rotation.x = Math.PI / 2;
    rearTireMesh.scale.set(1.0, 1.24, 1.0);
  } else {
    rearTireMesh.scale.set(1.0, 1.0, 1.24);
  }
  rearWheelGroup.add(rearTireMesh);

  const rearRimMesh = new THREE.Mesh(G.rearRimBarrel, magWheelMat);
  rearRimMesh.rotation.x = Math.PI / 2;
  rearWheelGroup.add(rearRimMesh);

  const rearHubMesh = new THREE.Mesh(G.rearHub, aluminumFrameMat);
  rearHubMesh.rotation.x = Math.PI / 2;
  rearWheelGroup.add(rearHubMesh);

  for (let s = 0; s < 3; s++) {
    const spoke = new THREE.Mesh(G.spokeBox, magWheelMat);
    spoke.rotation.z = (s * Math.PI) / 3;
    spoke.scale.set(1.08, 1.0, 1.25);
    rearWheelGroup.add(spoke);
  }

  // Rear chain sprocket (left side -Z) & rear brake rotor (right side +Z)
  const sprocketMesh = new THREE.Mesh(G.rearSprocket, goldAnodizedMat);
  sprocketMesh.rotation.x = Math.PI / 2;
  sprocketMesh.position.z = -0.095;
  const rearDiscMesh = new THREE.Mesh(G.rearBrakeDisc, brakeDiscMat);
  rearDiscMesh.rotation.x = Math.PI / 2;
  rearDiscMesh.position.z = 0.092;
  rearWheelGroup.add(sprocketMesh, rearDiscMesh);

  // =========================================================================
  // 2. TWIN-SPAR ALUMINUM CHASSIS, SWINGARM, V4 ENGINE & USD FRONT FORKS
  // =========================================================================
  // V4 2-Stroke Engine & Radiator
  const engineMesh = new THREE.Mesh(G.engineBlock, darkEngineMat);
  engineMesh.position.set(0.05, 0.43, 0);
  leanGroup.add(engineMesh);

  const radiatorMesh = new THREE.Mesh(G.radiatorBox, aluminumFrameMat);
  radiatorMesh.position.set(0.39, 0.46, 0);
  radiatorMesh.rotation.z = 0.28;
  leanGroup.add(radiatorMesh);

  // Twin-Spar Brushed Aluminum Frame Beams & Braced Rear Swingarm
  for (const side of [-1, 1]) {
    const spar = new THREE.Mesh(G.frameSpar, aluminumFrameMat);
    spar.position.set(0.14, 0.58, side * 0.175);
    spar.rotation.z = 0.34;
    leanGroup.add(spar);

    const subframe = new THREE.Mesh(G.subframeRail, aluminumFrameMat);
    subframe.position.set(-0.38, 0.63, side * 0.13);
    subframe.rotation.z = Math.PI / 2 - 0.28;
    leanGroup.add(subframe);

    const swingarm = new THREE.Mesh(G.swingarmBeam, aluminumFrameMat);
    swingarm.position.set(-0.42, 0.365, side * 0.145);
    swingarm.rotation.z = 0.08;
    leanGroup.add(swingarm);

    const brace = new THREE.Mesh(G.swingarmBrace, aluminumFrameMat);
    brace.position.set(-0.39, 0.425, side * 0.145);
    brace.rotation.z = -0.18;
    leanGroup.add(brace);
  }

  // Carbon-Kevlar Rear Tire Hugger Fender
  const rearHuggerMesh = new THREE.Mesh(G.rearHugger, carbonMat);
  rearHuggerMesh.position.set(-0.56, 0.51, 0);
  rearHuggerMesh.scale.set(1.2, 0.85, 0.82);
  leanGroup.add(rearHuggerMesh);

  // USD Front Fork & Cockpit Group
  const frontForkGroup = new THREE.Group();
  frontForkGroup.position.set(0.58, 0.56, 0);
  leanGroup.add(frontForkGroup);

  for (const side of [-1, 1]) {
    // Gold anodized USD upper fork tubes
    const outerFork = new THREE.Mesh(G.forkOuter, goldAnodizedMat);
    outerFork.position.set(-0.02, 0.08, side * 0.115);
    outerFork.rotation.z = 0.42;
    frontForkGroup.add(outerFork);

    // Chrome lower fork sliders reaching front axle
    const innerFork = new THREE.Mesh(G.forkInner, chromeMat);
    innerFork.position.set(0.09, -0.14, side * 0.112);
    innerFork.rotation.z = 0.42;
    frontForkGroup.add(innerFork);

    // Gold Brembo-style twin brake calipers
    const caliper = new THREE.Mesh(G.caliperBox, goldAnodizedMat);
    caliper.position.set(0.08, -0.21, side * 0.088);
    caliper.rotation.z = 0.35;
    frontForkGroup.add(caliper);

    // Clip-on handlebars + rubber grips + brake/clutch levers
    const bar = new THREE.Mesh(G.handlebarTube, aluminumFrameMat);
    bar.position.set(-0.11, 0.21, side * 0.18);
    bar.rotation.x = Math.PI / 2 + side * 0.16;
    bar.rotation.z = -0.18;
    frontForkGroup.add(bar);

    const grip = new THREE.Mesh(G.handlebarTube, blackRubberMat);
    grip.scale.set(1.22, 0.58, 1.22);
    grip.position.set(-0.13, 0.2, side * 0.23);
    grip.rotation.x = Math.PI / 2 + side * 0.16;
    frontForkGroup.add(grip);

    const lever = new THREE.Mesh(G.leverBlade, chromeMat);
    lever.position.set(-0.08, 0.2, side * 0.23);
    lever.rotation.y = -side * 0.18;
    frontForkGroup.add(lever);
  }

  // CNC Top Triple Clamp & 1990 Foam/Carbon Tachometer Dash
  const topClamp = new THREE.Mesh(G.tripleClamp, aluminumFrameMat);
  topClamp.position.set(-0.09, 0.23, 0);
  topClamp.rotation.z = 0.42;
  frontForkGroup.add(topClamp);

  const dashPad = new THREE.Mesh(G.dashFoam, carbonMat);
  dashPad.position.set(-0.02, 0.26, 0);
  dashPad.rotation.z = 0.48;
  frontForkGroup.add(dashPad);

  const tachFace = new THREE.Mesh(G.tachDial, secondaryGlossMat);
  tachFace.position.set(-0.03, 0.28, 0);
  tachFace.rotation.z = Math.PI / 2 - 0.45;
  const tempGauge = new THREE.Mesh(G.tempDial, accentMat);
  tempGauge.position.set(-0.03, 0.275, 0.075);
  tempGauge.rotation.z = Math.PI / 2 - 0.45;
  frontForkGroup.add(tachFace, tempGauge);

  // Sculpted Front Fender hugging front slick tire
  const frontFenderMesh = new THREE.Mesh(G.frontFender, primaryGlossMat);
  frontFenderMesh.position.set(0.14, -0.06, 0);
  frontFenderMesh.scale.set(1.28, 0.72, 0.72);
  frontForkGroup.add(frontFenderMesh);

  // =========================================================================
  // 3. SCULPTED 1990 500cc AERODYNAMIC BODYWORK & BUBBLE WINDSCREEN
  // =========================================================================
  // Curved Lathe Aerodynamic Nose Cone
  const noseMesh = new THREE.Mesh(G.noseCone, liveryBodyMat);
  noseMesh.position.set(0.58, 0.71, 0);
  noseMesh.rotation.z = -Math.PI / 2 + 0.08;
  noseMesh.scale.set(0.95, 1.08, 1.18);
  leanGroup.add(noseMesh);

  // Glossy Translucent Curved Bubble Windscreen
  const screenMesh = new THREE.Mesh(G.bubbleScreen, windscreenMat);
  screenMesh.position.set(0.50, 0.85, 0);
  screenMesh.rotation.z = -0.46;
  screenMesh.scale.set(1.38, 0.68, 0.86);
  leanGroup.add(screenMesh);

  // Sculpted Knee-Indented Fuel Tank + Brushed Silver Racing Fuel Cap
  const tankMesh = new THREE.Mesh(G.fuelTankMain, liveryBodyMat);
  tankMesh.position.set(0.14, 0.77, 0);
  tankMesh.rotation.z = -0.12;
  tankMesh.scale.set(1.42, 0.72, 0.88);
  leanGroup.add(tankMesh);

  const fuelCapMesh = new THREE.Mesh(G.fuelCap, chromeMat);
  fuelCapMesh.position.set(0.22, 0.94, 0);
  fuelCapMesh.rotation.z = -0.14;
  leanGroup.add(fuelCapMesh);

  // Twin Sculpted Aerodynamic Side Fairings with Heat Vents
  for (const side of [-1, 1]) {
    const sideFairing = new THREE.Mesh(G.sideFairingShell, liveryBodyMat);
    sideFairing.position.set(0.22, 0.56, side * 0.115);
    sideFairing.rotation.z = -0.08;
    sideFairing.scale.set(1.58, 0.78, 0.42);
    leanGroup.add(sideFairing);

    // Side fairing heat extractor gill vents
    for (let v = 0; v < 3; v++) {
      const vent = new THREE.Mesh(G.ventSlat, accentMat);
      vent.position.set(0.18 - v * 0.045, 0.55 - v * 0.038, side * 0.238);
      vent.rotation.z = 0.45;
      leanGroup.add(vent);
    }
  }

  // Sculpted Lower Aerodynamic Belly Pan
  const bellyMesh = new THREE.Mesh(G.bellyPan, secondaryGlossMat);
  bellyMesh.position.set(0.08, 0.34, 0);
  bellyMesh.rotation.z = Math.PI / 2 - 0.05;
  bellyMesh.scale.set(0.88, 1.0, 1.18);
  leanGroup.add(bellyMesh);

  // Upswept 1990 GP Tail Cowl, Racing Seat & Number Plates
  const tailCowl = new THREE.Mesh(G.tailCowlMain, liveryBodyMat);
  tailCowl.position.set(-0.56, 0.79, 0);
  tailCowl.rotation.z = 0.22;
  tailCowl.scale.set(1.68, 0.64, 0.88);
  leanGroup.add(tailCowl);

  for (const side of [-1, 1]) {
    const numPlate = new THREE.Mesh(G.tailNumberPlate, secondaryGlossMat);
    numPlate.position.set(-0.54, 0.80, side * 0.185);
    numPlate.rotation.z = 0.22;
    numPlate.rotation.y = side * 0.12;
    leanGroup.add(numPlate);
  }

  const seatPadMesh = new THREE.Mesh(G.seatPad, blackRubberMat);
  seatPadMesh.position.set(-0.14, 0.71, 0);
  seatPadMesh.rotation.z = 0.08;
  const seatStopMesh = new THREE.Mesh(G.seatBumStop, blackRubberMat);
  seatStopMesh.position.set(-0.32, 0.755, 0);
  seatStopMesh.rotation.x = Math.PI / 2;
  leanGroup.add(seatPadMesh, seatStopMesh);

  // =========================================================================
  // 4. AUTHENTIC TWIN 2-STROKE EXPANSION CHAMBER EXHAUSTS & CARBON SILENCERS
  // =========================================================================
  for (const side of [-1, 1]) {
    const zOff = side * 0.185;
    // Lower forward header pipe
    const header = new THREE.Mesh(G.expHeader, exhaustExpansionMat);
    header.position.set(0.24, 0.26, zOff * 0.78);
    header.rotation.z = Math.PI / 2 - 0.12;

    // Divergent diffuser cone
    const diffuser = new THREE.Mesh(G.expDiffuser, exhaustExpansionMat);
    diffuser.position.set(-0.04, 0.25, zOff * 0.92);
    diffuser.rotation.z = Math.PI / 2 + 0.08;

    // Fat 2-stroke expansion chamber belly section
    const bellyCone = new THREE.Mesh(G.expBelly, exhaustExpansionMat);
    bellyCone.position.set(-0.28, 0.30, zOff);
    bellyCone.rotation.z = Math.PI / 2 + 0.32;

    // Upswept convergent baffle cone
    const baffleCone = new THREE.Mesh(G.expBaffle, exhaustExpansionMat);
    baffleCone.position.set(-0.48, 0.43, zOff);
    baffleCone.rotation.z = Math.PI / 2 + 0.56;

    // Carbon-Kevlar stinger silencer canister & polished tip
    const silencer = new THREE.Mesh(G.silencerCan, carbonMat);
    silencer.position.set(-0.69, 0.59, zOff * 0.96);
    silencer.rotation.z = Math.PI / 2 + 0.52;

    const tip = new THREE.Mesh(G.silencerTip, chromeMat);
    tip.position.set(-0.84, 0.68, zOff * 0.96);
    tip.rotation.z = Math.PI / 2 + 0.52;

    // Upper under-tail V4 bank stinger silencer + tip
    const upperSilencer = new THREE.Mesh(G.silencerCan, carbonMat);
    upperSilencer.scale.set(0.82, 0.85, 0.82);
    upperSilencer.position.set(-0.72, 0.74, side * 0.085);
    upperSilencer.rotation.z = Math.PI / 2 + 0.22;

    const upperTip = new THREE.Mesh(G.silencerTip, chromeMat);
    upperTip.position.set(-0.87, 0.77, side * 0.085);
    upperTip.rotation.z = Math.PI / 2 + 0.22;

    leanGroup.add(
      header,
      diffuser,
      bellyCone,
      baffleCone,
      silencer,
      tip,
      upperSilencer,
      upperTip
    );
  }

  // =========================================================================
  // 5. SCULPTED ARTICULATED RACING RIDER, HELMET & KNEE-DOWN SPARK EMITTERS
  // =========================================================================
  const riderBody = new THREE.Group();
  riderBody.position.set(-0.10, 0.75, 0);
  leanGroup.add(riderBody);

  // Sculpted Leather Pelvis / Hips
  const pelvisMesh = new THREE.Mesh(G.pelvisSphere, leatherDarkMat);
  pelvisMesh.scale.set(1.15, 0.82, 1.06);
  riderBody.add(pelvisMesh);

  // Articulated Torso Group (pivots from hips for tuck-in and corner hang-off)
  const torsoGroup = new THREE.Group();
  torsoGroup.position.set(0.02, 0.05, 0);
  torsoGroup.rotation.z = -0.55;
  riderBody.add(torsoGroup);

  const chestMesh = new THREE.Mesh(G.torsoChest, leatherPrimaryMat);
  chestMesh.position.set(0, 0.19, 0);
  chestMesh.scale.set(0.95, 1.0, 1.16);
  torsoGroup.add(chestMesh);

  // Aerodynamic Speed Hump on Back of Suit
  const humpMesh = new THREE.Mesh(G.aeroBackHump, leatherSecondaryMat);
  humpMesh.position.set(-0.08, 0.23, 0);
  humpMesh.scale.set(0.95, 1.35, 0.82);
  torsoGroup.add(humpMesh);

  // Sculpted Shoulders & Articulated Left/Right Arms reaching Clip-Ons
  const buildArm = (side) => {
    const armGroup = new THREE.Group();
    armGroup.position.set(0.02, 0.34, side * 0.175);

    const shoulderCap = new THREE.Mesh(G.torsoShoulderCap, leatherSecondaryMat);
    armGroup.add(shoulderCap);

    const upperArm = new THREE.Mesh(G.upperArm, leatherPrimaryMat);
    upperArm.position.set(0.09, -0.06, side * 0.03);
    upperArm.rotation.z = -1.05;
    upperArm.rotation.x = side * 0.18;
    armGroup.add(upperArm);

    const elbow = new THREE.Mesh(G.elbowSphere, leatherSecondaryMat);
    elbow.position.set(0.19, -0.12, side * 0.05);
    armGroup.add(elbow);

    const forearm = new THREE.Mesh(G.forearm, leatherDarkMat);
    forearm.position.set(0.30, -0.10, side * 0.02);
    forearm.rotation.z = -1.42;
    forearm.rotation.y = -side * 0.18;
    armGroup.add(forearm);

    const glove = new THREE.Mesh(G.gloveSphere, leatherSecondaryMat);
    glove.position.set(0.41, -0.08, 0);
    armGroup.add(glove);

    return armGroup;
  };

  const leftArmGroup = buildArm(-1);
  const rightArmGroup = buildArm(1);
  torsoGroup.add(leftArmGroup, rightArmGroup);

  // Sculpted Full-Face 1990 GP Helmet & Dark Chrome Reflective Visor
  const headGroup = new THREE.Group();
  headGroup.position.set(0.06, 0.42, 0);
  headGroup.rotation.z = 0.42;
  torsoGroup.add(headGroup);

  const helmetShellMesh = new THREE.Mesh(G.helmetShell, secondaryGlossMat);
  helmetShellMesh.scale.set(1.12, 1.0, 0.96);
  headGroup.add(helmetShellMesh);

  const helmetStripeMesh = new THREE.Mesh(G.helmetShell, primaryGlossMat);
  helmetStripeMesh.scale.set(1.13, 1.01, 0.42);
  headGroup.add(helmetStripeMesh);

  const helmetChinMesh = new THREE.Mesh(G.helmetChin, primaryGlossMat);
  helmetChinMesh.position.set(0.06, -0.065, 0);
  helmetChinMesh.rotation.z = -0.25;
  headGroup.add(helmetChinMesh);

  const visorMesh = new THREE.Mesh(G.helmetVisor, visorChromeMat);
  visorMesh.position.set(0.042, 0.012, 0);
  visorMesh.scale.set(1.04, 0.56, 0.96);
  headGroup.add(visorMesh);

  // Articulated Left & Right Legs with Knee Pucks, Racing Boots & Spark Emitters
  const buildLeg = (side) => {
    const legPivot = new THREE.Group();
    legPivot.position.set(-0.02, -0.02, side * 0.145);

    // Thigh angled forward and down to knee
    const thigh = new THREE.Mesh(G.thighCyl, leatherPrimaryMat);
    thigh.position.set(0.11, -0.09, side * 0.035);
    thigh.rotation.z = -0.88;
    thigh.rotation.x = side * 0.14;
    legPivot.add(thigh);

    // Knee joint + prominent replaceable Knee Slider Puck
    const knee = new THREE.Mesh(G.kneeSphere, leatherDarkMat);
    knee.position.set(0.22, -0.17, side * 0.065);
    legPivot.add(knee);

    const puck = new THREE.Mesh(G.kneePuck, puckMat);
    puck.position.set(0.22, -0.18, side * 0.115);
    puck.rotation.x = Math.PI / 2 + side * 0.25;
    legPivot.add(puck);

    // Lower leg / shin guard angled back to rearset footpeg
    const shin = new THREE.Mesh(G.shinCyl, leatherSecondaryMat);
    shin.position.set(0.10, -0.28, side * 0.045);
    shin.rotation.z = 0.82;
    legPivot.add(shin);

    // Armored GP Racing Boot on footpeg
    const boot = new THREE.Mesh(G.bootBox, leatherDarkMat);
    boot.position.set(-0.01, -0.37, side * 0.038);
    boot.rotation.z = 0.18;
    legPivot.add(boot);

    // Knee-down spark burst emitter right at the knee puck
    const sparkMesh = buildSparkCluster();
    sparkMesh.position.set(0.20, -0.20, side * 0.145);
    legPivot.add(sparkMesh);

    return { legPivot, sparkMesh };
  };

  const leftLeg = buildLeg(-1);
  const rightLeg = buildLeg(1);
  const leftLegPivot = leftLeg.legPivot;
  const rightLegPivot = rightLeg.legPivot;
  const leftSparkMesh = leftLeg.sparkMesh;
  const rightSparkMesh = rightLeg.sparkMesh;
  riderBody.add(leftLegPivot, rightLegPivot);

  return {
    rootGroup,
    pitchGroup,
    leanGroup,
    frontWheelGroup,
    rearWheelGroup,
    frontForkGroup,
    riderBody,
    torsoGroup,
    headGroup,
    leftLegPivot,
    rightLegPivot,
    leftArmGroup,
    rightArmGroup,
    contactShadow,
    leftSparkMesh,
    rightSparkMesh,
    torsoMesh: torsoGroup,
    helmetMesh: headGroup,
    wheelAngle: 0
  };
}

/**
 * Animates the hierarchical 1990 500cc GP bike rig & rider each frame:
 * - World position & heading, braking fork dive, wheelie lift, lean roll
 * - High-speed wheel rotation
 * - Realistic MotoGP rider hang-off, knee-down extension, horizon counter-roll, aero tuck, and knee sparks
 * - Grounding contact shadow tracking on the asphalt
 */
export function updateDetailedBikeRig(rig, rider, dt = 1 / 60) {
  if (!rig || !rider) return;
  const safeDt = typeof dt === 'number' && dt > 0 ? dt : 1 / 60;

  const w = rider.world || { x: 0, y: 0, z: 0, heading: 0, pitch: 0 };
  rig.rootGroup.position.set(w.x || 0, w.y || 0, w.z || 0);
  rig.rootGroup.rotation.y = -(w.heading || 0);

  const speed = rider.speed || 0;
  const lean = rider.lean || 0;
  const brake = clamp(rider.brake || 0, 0, 1);
  const wheelie = rider.wheelieAngle || 0;
  const highsideWobble =
    (rider.highsideTimer || 0) > 0 ? Math.sin(rider.highsideTimer * 36) * 0.38 : 0;

  // Pitch group: track pitch + wheelieAngle - nose dive under braking
  const noseDive = brake * 0.045;
  rig.pitchGroup.rotation.z = (w.pitch || 0) + wheelie - noseDive;
  rig.pitchGroup.position.y = Math.max(0, Math.sin(wheelie) * 0.62) - brake * 0.014;

  // Lean group: bike lean roll around X
  rig.leanGroup.rotation.x = lean + highsideWobble;

  // Front fork compression & subtle steering input
  if (rig.frontForkGroup) {
    rig.frontForkGroup.position.y = 0.56 - brake * 0.022;
    rig.frontForkGroup.rotation.y = -clamp(lean * 0.08, -0.08, 0.08);
  }

  // Spin front and rear wheels proportional to linear speed
  rig.wheelAngle = (rig.wheelAngle || 0) - (speed / 0.32) * safeDt;
  if (rig.frontWheelGroup) {
    rig.frontWheelGroup.rotation.z = rig.wheelAngle;
  }
  if (rig.rearWheelGroup) {
    rig.rearWheelGroup.rotation.z = rig.wheelAngle;
  }

  // Animate Rider Hang-Off, Knee-Down & Aero Tuck
  const leanNorm = clamp(lean / 0.96, -1, 1);
  const absLean = Math.abs(leanNorm);
  const isTuck = Boolean(rider.tuck);

  if (rig.riderBody) {
    // Shift hips laterally off the seat into the inside of the turn
    rig.riderBody.position.z = leanNorm * 0.22;
    rig.riderBody.position.y = (isTuck ? 0.69 : 0.75) - absLean * 0.04;
    rig.riderBody.position.x = isTuck ? -0.13 : -0.10;
  }

  if (rig.torsoGroup) {
    // Tuck torso behind bubble windscreen or lean chest down across tank in corners
    rig.torsoGroup.rotation.z = (isTuck ? -0.84 : -0.54) - absLean * 0.14;
    rig.torsoGroup.rotation.x = leanNorm * 0.26;
    rig.torsoGroup.rotation.y = -leanNorm * 0.16;
  }

  if (rig.headGroup) {
    // Counter-roll helmet to keep eyes level with horizon and looking into corner apex
    rig.headGroup.rotation.x = -lean * 0.62;
    rig.headGroup.rotation.z = isTuck ? 0.62 : 0.38 + absLean * 0.12;
    rig.headGroup.rotation.y = -leanNorm * 0.24;
  }

  // Inside knee splay outward toward asphalt; outside knee locks against fuel tank
  const rightKneeOut = Math.max(0, leanNorm) * 0.82;
  const leftKneeOut = Math.max(0, -leanNorm) * 0.82;
  if (rig.rightLegPivot) {
    rig.rightLegPivot.rotation.x = rightKneeOut > 0 ? rightKneeOut : -leftKneeOut * 0.12;
    rig.rightLegPivot.rotation.y = -rightKneeOut * 0.22;
  }
  if (rig.leftLegPivot) {
    rig.leftLegPivot.rotation.x = leftKneeOut > 0 ? -leftKneeOut : rightKneeOut * 0.12;
    rig.leftLegPivot.rotation.y = leftKneeOut * 0.22;
  }

  if (rig.leftArmGroup && rig.rightArmGroup) {
    rig.leftArmGroup.rotation.z = isTuck ? 0.22 : 0.0;
    rig.rightArmGroup.rotation.z = isTuck ? 0.22 : 0.0;
  }

  // Knee-slider titanium/ceramic sparks when heeled over > 0.78 rad at speed > 20 m/s
  const sparkActive = Math.abs(lean) > 0.78 && speed > 20;
  const jitter = 0.78 + Math.abs(Math.sin((rig.wheelAngle || 0) * 2.9)) * 0.45;
  if (rig.rightSparkMesh) {
    const showRight = sparkActive && lean > 0.78;
    rig.rightSparkMesh.visible = showRight;
    if (showRight) {
      rig.rightSparkMesh.scale.set(jitter, jitter, jitter);
      rig.rightSparkMesh.rotation.x = (rig.wheelAngle || 0) * 1.7;
    }
  }
  if (rig.leftSparkMesh) {
    const showLeft = sparkActive && lean < -0.78;
    rig.leftSparkMesh.visible = showLeft;
    if (showLeft) {
      rig.leftSparkMesh.scale.set(jitter, jitter, jitter);
      rig.leftSparkMesh.rotation.x = -(rig.wheelAngle || 0) * 1.7;
    }
  }

  // Grounding contact shadow stays flat on asphalt at y = 0.025 and tracks lateral lean offset
  if (rig.contactShadow) {
    rig.contactShadow.position.set(0, 0.025, Math.sin(lean) * 0.16);
    rig.contactShadow.rotation.z = w.pitch || 0;
    const shadowStretchZ = 1.0 + Math.abs(Math.sin(lean)) * 0.34;
    const shadowStretchX = 1.0 - Math.min(0.22, wheelie * 0.35);
    rig.contactShadow.scale.set(shadowStretchX, 1.0, shadowStretchZ);
  }
}
