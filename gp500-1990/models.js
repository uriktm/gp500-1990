// High-Detail Sculpted 3D Models for 1990 500cc 2-Stroke Grand Prix Motorcycles & Articulated Riders
// Proportions: 1.40m wheelbase (axles at x = +0.70m and x = -0.70m), 17" wheels (0.60m tire OD, y = 0.30m),
// ~0.185m wide round-profile rear slick, ~0.78m seat height, ~1.75m rider in crouched GP racing tuck.

import * as THREE from 'three';
import { createLiverySet } from './livery.js';

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

// ============================================================================
// UV & VERTEX SCULPTING UTILITIES
// ============================================================================
function computePositionBounds(geo) {
  const pos = geo?.attributes?.position;
  if (!pos || !pos.array) {
    return { minX: -0.5, maxX: 0.5, minY: -0.5, maxY: 0.5, minZ: -0.5, maxZ: 0.5 };
  }
  const arr = pos.array;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < arr.length; i += 3) {
    const x = arr[i];
    const y = arr[i + 1];
    const z = arr[i + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

function normalizePlanarUVs(geo, mode = 'xy') {
  const pos = geo?.attributes?.position;
  if (!pos || !pos.array) return geo;
  const bounds = computePositionBounds(geo);
  const spanX = Math.max(1e-5, bounds.maxX - bounds.minX);
  const spanY = Math.max(1e-5, bounds.maxY - bounds.minY);
  const spanZ = Math.max(1e-5, bounds.maxZ - bounds.minZ);
  const count = pos.count ?? pos.array.length / 3;
  const uvs = new Float32Array(count * 2);
  const arr = pos.array;

  for (let i = 0; i < count; i++) {
    const x = arr[i * 3];
    const y = arr[i * 3 + 1];
    const z = arr[i * 3 + 2];
    if (mode === 'tail') {
      // u across width Z (0 left flank -> 0.5 center -> 1 right flank)
      // v along length X (0 rear exhaust tip -> 1 front seat bum-stop)
      uvs[i * 2] = clamp((z - bounds.minZ) / spanZ, 0.01, 0.99);
      uvs[i * 2 + 1] = clamp((x - bounds.minX) / spanX, 0.01, 0.99);
    } else {
      // u along X (0 rear -> 1 front), v along Y (0 bottom -> 1 top)
      uvs[i * 2] = clamp((x - bounds.minX) / spanX, 0.01, 0.99);
      uvs[i * 2 + 1] = clamp((y - bounds.minY) / spanY, 0.01, 0.99);
    }
  }
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return geo;
}

function centerExtrudeZ(geo) {
  const pos = geo?.attributes?.position;
  if (!pos || !pos.array) return geo;
  const bounds = computePositionBounds(geo);
  const midZ = (bounds.minZ + bounds.maxZ) * 0.5;
  const arr = pos.array;
  for (let i = 2; i < arr.length; i += 3) {
    arr[i] -= midZ;
  }
  pos.needsUpdate = true;
  return geo;
}

function alignLimbBetween(mesh, pStart, pEnd) {
  const mx = (pStart.x + pEnd.x) * 0.5;
  const my = (pStart.y + pEnd.y) * 0.5;
  const mz = (pStart.z + pEnd.z) * 0.5;
  mesh.position.set(mx, my, mz);

  const dx = pEnd.x - pStart.x;
  const dy = pEnd.y - pStart.y;
  const dz = pEnd.z - pStart.z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len > 1e-5 && typeof THREE.Quaternion === 'function' && typeof THREE.Vector3 === 'function') {
    const up = new THREE.Vector3(0, 1, 0);
    // Capsule proximal (+Y) starts at pStart and distal (-Y) ends at pEnd, so +Y points from pEnd -> pStart
    const dir = new THREE.Vector3(-dx / len, -dy / len, -dz / len);
    mesh.quaternion.setFromUnitVectors(up, dir);
  }
  return mesh;
}

// ============================================================================
// CUSTOM SCULPTED GEOMETRY BUILDERS (Shape+Extrude, Lathe, Tube, Capsule)
// ============================================================================

/**
 * Builds a realistic 17" GP racing slick tire using LatheGeometry.
 * Revolving around Y (then rotated so axis is Z):
 * - Outer radius = outerR (0.30m -> 0.60m OD)
 * - Rim radius = rimR (0.214m -> 17" rim)
 * - Width = width (0.186m rear, 0.125m front)
 */
function createRacingSlickTireGeometry(outerR = 0.30, rimR = 0.214, width = 0.186, segments = 36) {
  const hw = width * 0.5;
  const beadW = hw * 0.84;
  const crownR = outerR;
  const shoulderR = outerR - width * 0.14;
  const midSidewallR = (rimR + shoulderR) * 0.52;

  if (typeof THREE.LatheGeometry === 'function' && typeof THREE.Vector2 === 'function') {
    const pts = [
      new THREE.Vector2(rimR - 0.006, -beadW * 0.92),
      new THREE.Vector2(rimR, -beadW),
      new THREE.Vector2(midSidewallR, -hw * 0.99),
      new THREE.Vector2(shoulderR, -hw * 0.95),
      new THREE.Vector2(outerR - width * 0.055, -hw * 0.72),
      new THREE.Vector2(outerR - width * 0.015, -hw * 0.38),
      new THREE.Vector2(crownR, 0.0),
      new THREE.Vector2(outerR - width * 0.015, hw * 0.38),
      new THREE.Vector2(outerR - width * 0.055, hw * 0.72),
      new THREE.Vector2(shoulderR, hw * 0.95),
      new THREE.Vector2(midSidewallR, hw * 0.99),
      new THREE.Vector2(rimR, beadW),
      new THREE.Vector2(rimR - 0.006, beadW * 0.92),
      new THREE.Vector2(rimR - 0.006, -beadW * 0.92)
    ];
    const geo = new THREE.LatheGeometry(pts, segments);
    geo.computeVertexNormals();
    return geo;
  }
  return new THREE.CylinderGeometry(outerR, outerR, width, segments);
}

/**
 * Deep-dish 17" cast magnesium wheel rim barrel (LatheGeometry).
 */
function createWheelRimLatheGeometry(rimR = 0.214, width = 0.155, segments = 24) {
  const hw = width * 0.5;
  if (typeof THREE.LatheGeometry === 'function' && typeof THREE.Vector2 === 'function') {
    const pts = [
      new THREE.Vector2(rimR, -hw),
      new THREE.Vector2(rimR - 0.018, -hw * 0.82),
      new THREE.Vector2(rimR - 0.022, 0),
      new THREE.Vector2(rimR - 0.018, hw * 0.82),
      new THREE.Vector2(rimR, hw)
    ];
    const geo = new THREE.LatheGeometry(pts, segments);
    geo.computeVertexNormals();
    return geo;
  }
  return new THREE.CylinderGeometry(rimR, rimR, width, segments);
}

/**
 * Aerodynamic 1990 500cc GP nose cone (LatheGeometry with smooth ogive profile).
 */
function createNoseLatheGeometry() {
  if (typeof THREE.LatheGeometry === 'function' && typeof THREE.Vector2 === 'function') {
    const pts = [
      new THREE.Vector2(0.008, 0.36),
      new THREE.Vector2(0.055, 0.33),
      new THREE.Vector2(0.115, 0.25),
      new THREE.Vector2(0.162, 0.14),
      new THREE.Vector2(0.190, 0.01),
      new THREE.Vector2(0.204, -0.14),
      new THREE.Vector2(0.196, -0.24)
    ];
    const geo = new THREE.LatheGeometry(pts, 24);
    // Slightly flatten bottom & widen sides for authentic 1990 GP upper fairing cowl
    const pos = geo.attributes?.position;
    if (pos && pos.array) {
      const arr = pos.array;
      for (let i = 0; i < arr.length; i += 3) {
        // After rotation.z = -PI/2, local X becomes -Y (vertical), local Z stays Z (lateral)
        arr[i] *= 0.78;
        arr[i + 2] *= 1.15;
      }
      pos.needsUpdate = true;
    }
    geo.computeVertexNormals();
    normalizePlanarUVs(geo, 'xy');
    return geo;
  }
  return new THREE.CylinderGeometry(0.04, 0.2, 0.48, 16);
}

/**
 * Sculpted Side Fairing Panel using THREE.Shape side profile + ExtrudeGeometry with bevel.
 */
function createSideFairingExtrudeGeometry() {
  if (typeof THREE.Shape === 'function' && typeof THREE.ExtrudeGeometry === 'function') {
    const shape = new THREE.Shape();
    // Side profile in XY (X forward, Y up)
    shape.moveTo(-0.18, 0.22); // Rear lower belly pan corner ahead of rear tire
    shape.quadraticCurveTo(0.12, 0.18, 0.42, 0.23); // Lower belly pan keel
    shape.quadraticCurveTo(0.55, 0.27, 0.56, 0.44); // Forward lower chin curve
    shape.quadraticCurveTo(0.45, 0.58, 0.62, 0.68); // Upper fairing wing below nose
    shape.quadraticCurveTo(0.42, 0.74, 0.22, 0.68); // Fairing top edge under fuel tank
    shape.quadraticCurveTo(0.06, 0.54, -0.08, 0.46); // Cutout around rider knee / frame spar
    shape.quadraticCurveTo(-0.19, 0.36, -0.18, 0.22);

    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.045,
      steps: 1,
      curveSegments: 8,
      bevelEnabled: true,
      bevelThickness: 0.036,
      bevelSize: 0.032,
      bevelSegments: 4
    });
    centerExtrudeZ(geo);

    // Sculpt organic 3D curvature: tuck lower belly pan inward and flare mid-fairing outward
    const pos = geo.attributes?.position;
    if (pos && pos.array) {
      const arr = pos.array;
      for (let i = 0; i < arr.length; i += 3) {
        const x = arr[i];
        const y = arr[i + 1];
        const bellyTuck = clamp((0.36 - y) * 0.22, 0, 0.06);
        const midBulge = Math.sin(clamp((y - 0.20) / 0.52, 0, 1) * Math.PI) * 0.025;
        const noseTaper = clamp((x - 0.35) * 0.16, 0, 0.05);
        arr[i + 2] += midBulge - bellyTuck - noseTaper;
      }
      pos.needsUpdate = true;
    }

    normalizePlanarUVs(geo, 'xy');
    geo.computeVertexNormals();
    return geo;
  }
  return new THREE.SphereGeometry(0.32, 18, 14);
}

/**
 * Sculpted 1990 GP Fuel Tank using THREE.Shape side profile + ExtrudeGeometry with wide bevels
 * and concave knee indents on the rear flanks.
 */
function createFuelTankExtrudeGeometry() {
  if (typeof THREE.Shape === 'function' && typeof THREE.ExtrudeGeometry === 'function') {
    const shape = new THREE.Shape();
    shape.moveTo(-0.14, 0.70); // Rear base at front of seat
    shape.quadraticCurveTo(-0.10, 0.85, 0.04, 0.90); // Rear tank slope where rider chest tucks
    shape.quadraticCurveTo(0.18, 0.93, 0.32, 0.86); // Top tank crown
    shape.quadraticCurveTo(0.38, 0.80, 0.35, 0.69); // Front edge near steering head
    shape.quadraticCurveTo(0.12, 0.66, -0.14, 0.70); // Bottom edge along frame spars

    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.19,
      steps: 2,
      curveSegments: 8,
      bevelEnabled: true,
      bevelThickness: 0.068,
      bevelSize: 0.052,
      bevelSegments: 4
    });
    centerExtrudeZ(geo);

    // Sculpt knee indents at rear-lower tank sides so rider thighs hug the tank seamlessly
    const pos = geo.attributes?.position;
    if (pos && pos.array) {
      const arr = pos.array;
      for (let i = 0; i < arr.length; i += 3) {
        const x = arr[i];
        const y = arr[i + 1];
        const z = arr[i + 2];
        // Knee indent zone: x in [-0.14, 0.12], y in [0.68, 0.82]
        const kx = clamp(1.0 - Math.abs(x + 0.02) / 0.16, 0, 1);
        const ky = clamp(1.0 - Math.abs(y - 0.74) / 0.09, 0, 1);
        const indent = kx * ky * 0.24;
        // Dome top crown
        const topDome = clamp((y - 0.82) / 0.12, 0, 1) * (1.0 - (z * z) / 0.04) * 0.025;
        arr[i + 2] = z * (1.0 - indent);
        arr[i + 1] = y + Math.max(0, topDome);
      }
      pos.needsUpdate = true;
    }

    normalizePlanarUVs(geo, 'xy');
    geo.computeVertexNormals();
    return geo;
  }
  return new THREE.SphereGeometry(0.24, 18, 14);
}

/**
 * Sculpted 1990 GP Tail Cowl / Seat Unit using THREE.Shape side profile + ExtrudeGeometry with bevels.
 * Viewed from directly behind (chase cam priority!), forms the signature wide-shouldered 1990s GP
 * aerodynamic tail section tapering over the twin under-tail exhaust stingers.
 */
function createTailCowlExtrudeGeometry() {
  if (typeof THREE.Shape === 'function' && typeof THREE.ExtrudeGeometry === 'function') {
    const shape = new THREE.Shape();
    // Side profile from x = -0.22 (behind rider hips) back to x = -0.85 (rear tail tip)
    shape.moveTo(-0.22, 0.71);
    shape.lineTo(-0.26, 0.84); // Angled bum-stop backrest behind rider hips
    shape.quadraticCurveTo(-0.44, 0.89, -0.64, 0.84); // Rounded upper aero tail hump
    shape.quadraticCurveTo(-0.79, 0.80, -0.85, 0.72); // Tapered rear tail tip above exhaust stingers
    shape.lineTo(-0.80, 0.65); // Recessed lower rear lip framing under-tail stingers
    shape.quadraticCurveTo(-0.56, 0.64, -0.34, 0.67); // Lower tail edge above rear wheel
    shape.closePath();

    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.24,
      steps: 3,
      curveSegments: 8,
      bevelEnabled: true,
      bevelThickness: 0.065,
      bevelSize: 0.048,
      bevelSegments: 4
    });
    centerExtrudeZ(geo);

    // Sculpt 3D rear taper and rounded upper arch so from directly behind it looks like a real GP tail unit
    const pos = geo.attributes?.position;
    if (pos && pos.array) {
      const arr = pos.array;
      for (let i = 0; i < arr.length; i += 3) {
        const x = arr[i];
        const y = arr[i + 1];
        const z = arr[i + 2];
        // Longitudinal progress from front (-0.22) to rear tip (-0.85)
        const rearT = clamp((-0.22 - x) / 0.64, 0, 1);
        // Taper width smoothly toward the rear tip, widest around rider hips / number plates
        const widthScale = 1.04 - rearT * rearT * 0.36;
        const zNew = z * widthScale;
        // Arch the top surface so the centerline is higher than the outer flanks (classic GP tail cross-section)
        const zNorm = clamp(Math.abs(zNew) / 0.18, 0, 1);
        const archDrop = zNorm * zNorm * 0.048 * clamp((y - 0.66) / 0.20, 0, 1);
        arr[i + 2] = zNew;
        arr[i + 1] = y - archDrop;
      }
      pos.needsUpdate = true;
    }

    normalizePlanarUVs(geo, 'tail');
    geo.computeVertexNormals();
    return geo;
  }
  return new THREE.SphereGeometry(0.22, 16, 12);
}

/**
 * Twin-Spar Brushed Aluminum Frame Beam (THREE.Shape + ExtrudeGeometry with bevel).
 */
function createFrameSparExtrudeGeometry() {
  if (typeof THREE.Shape === 'function' && typeof THREE.ExtrudeGeometry === 'function') {
    const shape = new THREE.Shape();
    shape.moveTo(-0.18, 0.30); // Swingarm pivot plate bottom
    shape.lineTo(-0.10, 0.30); // Swingarm pivot plate front
    shape.quadraticCurveTo(0.02, 0.45, 0.44, 0.66); // Lower spar edge to steering head
    shape.lineTo(0.46, 0.75); // Steering head top
    shape.quadraticCurveTo(0.04, 0.56, -0.14, 0.50); // Upper spar edge
    shape.quadraticCurveTo(-0.19, 0.41, -0.18, 0.30);

    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.026,
      steps: 1,
      bevelEnabled: true,
      bevelThickness: 0.008,
      bevelSize: 0.008,
      bevelSegments: 3
    });
    centerExtrudeZ(geo);
    geo.computeVertexNormals();
    return geo;
  }
  return new THREE.BoxGeometry(0.68, 0.095, 0.038);
}

/**
 * Gullwing Braced Aluminum Swingarm (THREE.Shape + ExtrudeGeometry with bevel).
 */
function createSwingarmExtrudeGeometry() {
  if (typeof THREE.Shape === 'function' && typeof THREE.ExtrudeGeometry === 'function') {
    const shape = new THREE.Shape();
    shape.moveTo(-0.73, 0.275); // Rear axle block bottom
    shape.lineTo(-0.14, 0.315); // Swingarm pivot bottom
    shape.lineTo(-0.14, 0.385); // Swingarm pivot top
    shape.lineTo(-0.34, 0.445); // Triangulated top gullwing brace apex
    shape.lineTo(-0.73, 0.330); // Rear axle block top
    shape.closePath();

    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.028,
      steps: 1,
      bevelEnabled: true,
      bevelThickness: 0.007,
      bevelSize: 0.007,
      bevelSegments: 3
    });
    centerExtrudeZ(geo);
    geo.computeVertexNormals();
    return geo;
  }
  return new THREE.BoxGeometry(0.60, 0.075, 0.036);
}

/**
 * Continuous Roller Drive Chain Loop (TubeGeometry + closed CatmullRomCurve3)
 * wrapping around the rear sprocket (x = -0.70, y = 0.30) and countershaft (x = -0.14, y = 0.35).
 */
function createDriveChainGeometry() {
  if (typeof THREE.CatmullRomCurve3 === 'function' && typeof THREE.TubeGeometry === 'function') {
    const rRear = 0.114;
    const rFront = 0.048;
    const pts = [
      new THREE.Vector3(-0.70, 0.30 + rRear, 0),
      new THREE.Vector3(-0.42, 0.335 + 0.082, 0),
      new THREE.Vector3(-0.14, 0.35 + rFront, 0),
      new THREE.Vector3(-0.09, 0.35, 0),
      new THREE.Vector3(-0.14, 0.35 - rFront, 0),
      new THREE.Vector3(-0.42, 0.315 - 0.082, 0),
      new THREE.Vector3(-0.70, 0.30 - rRear, 0),
      new THREE.Vector3(-0.785, 0.30 - rRear * 0.68, 0),
      new THREE.Vector3(-0.815, 0.30, 0),
      new THREE.Vector3(-0.785, 0.30 + rRear * 0.68, 0)
    ];
    const curve = new THREE.CatmullRomCurve3(pts, true);
    const geo = new THREE.TubeGeometry(curve, 44, 0.011, 6, true);
    geo.computeVertexNormals();
    return geo;
  }
  return new THREE.BoxGeometry(0.58, 0.02, 0.02);
}

/**
 * 2-Stroke Expansion Chamber Pipe using TubeGeometry + CatmullRomCurve3 with
 * variable-radius expansion belly shaping (header -> diffuser -> fat belly -> convergent baffle -> stinger).
 */
function createExpansionChamberTubeGeometry(side = 1) {
  if (typeof THREE.CatmullRomCurve3 === 'function' && typeof THREE.TubeGeometry === 'function') {
    const pts = [
      new THREE.Vector3(0.28, 0.30, side * 0.068),
      new THREE.Vector3(0.30, 0.21, side * 0.092),
      new THREE.Vector3(0.08, 0.19, side * 0.112),
      new THREE.Vector3(-0.18, 0.21, side * 0.120),
      new THREE.Vector3(-0.40, 0.29, side * 0.125),
      new THREE.Vector3(-0.58, 0.40, side * 0.128),
      new THREE.Vector3(-0.76, 0.52, side * 0.126)
    ];
    const curve = new THREE.CatmullRomCurve3(pts, false);
    const tubularSegments = 32;
    const radialSegments = 10;
    const baseRadius = 0.017;
    const geo = new THREE.TubeGeometry(curve, tubularSegments, baseRadius, radialSegments, false);

    // Modulate cross-section radius along the curve to form a sleek 2-stroke expansion belly
    const pos = geo.attributes?.position;
    if (pos && pos.array) {
      const arr = pos.array;
      const ringVerts = radialSegments + 1;
      for (let i = 0; i <= tubularSegments; i++) {
        const t = i / tubularSegments;
        const center = curve.getPointAt(t);
        let scale = 1.0;
        if (t < 0.18) {
          scale = 0.92 + (t / 0.18) * 0.33;
        } else if (t < 0.48) {
          scale = 1.25 + ((t - 0.18) / 0.30) * 0.90;
        } else if (t < 0.62) {
          scale = 2.15 - ((t - 0.48) / 0.14) * 0.15;
        } else if (t < 0.78) {
          scale = 2.00 - ((t - 0.62) / 0.16) * 0.95;
        } else {
          scale = 1.22;
        }
        for (let j = 0; j < ringVerts; j++) {
          const idx = (i * ringVerts + j) * 3;
          arr[idx] = center.x + (arr[idx] - center.x) * scale;
          arr[idx + 1] = center.y + (arr[idx + 1] - center.y) * scale;
          arr[idx + 2] = center.z + (arr[idx + 2] - center.z) * scale;
        }
      }
      pos.needsUpdate = true;
    }
    geo.computeVertexNormals();
    return geo;
  }
  return new THREE.CylinderGeometry(0.032, 0.032, 0.7, 12);
}

/**
 * Under-Tail V4 Rear-Bank 2-Stroke Exhaust Pipe (TubeGeometry + CatmullRomCurve3).
 */
function createUnderTailExhaustGeometry(side = 1) {
  if (typeof THREE.CatmullRomCurve3 === 'function' && typeof THREE.TubeGeometry === 'function') {
    const pts = [
      new THREE.Vector3(0.02, 0.48, side * 0.055),
      new THREE.Vector3(-0.22, 0.58, side * 0.062),
      new THREE.Vector3(-0.52, 0.665, side * 0.052),
      new THREE.Vector3(-0.82, 0.662, side * 0.046)
    ];
    const curve = new THREE.CatmullRomCurve3(pts, false);
    const geo = new THREE.TubeGeometry(curve, 20, 0.021, 10, false);
    geo.computeVertexNormals();
    return geo;
  }
  return new THREE.CylinderGeometry(0.021, 0.021, 0.5, 10);
}

/**
 * Hollow Exhaust Stinger Tip Nozzle (LatheGeometry with dark inner bore lip).
 */
function createStingerNozzleLatheGeometry() {
  if (typeof THREE.LatheGeometry === 'function' && typeof THREE.Vector2 === 'function') {
    const pts = [
      new THREE.Vector2(0.010, -0.016),
      new THREE.Vector2(0.015, 0.028),
      new THREE.Vector2(0.019, 0.028),
      new THREE.Vector2(0.021, -0.028),
      new THREE.Vector2(0.025, -0.038)
    ];
    const geo = new THREE.LatheGeometry(pts, 14);
    geo.computeVertexNormals();
    return geo;
  }
  return new THREE.CylinderGeometry(0.018, 0.020, 0.06, 12);
}

// ============================================================================
// SCULPTED ANATOMICAL RIDER GEOMETRIES (TORSO+BACK+HUMP, PELVIS, HELMET, LIMBS)
// ============================================================================

/**
 * Builds a single continuous, smooth-shaded anatomical Rider Torso + Broad Shoulders +
 * Integrated Aerodynamic Speed Hump geometry.
 * UVs are mapped directly across the back (u: left-to-right across Z, v: waist-to-collar along Y)
 * so livery.leathers (arched brand name, sponsor patches, rider number, shoulder yoke, waist belt)
 * renders with zero seams from the rear chase camera!
 */
function createSculptedRiderTorsoGeometry() {
  const stacks = 22;
  const slices = 32;
  const height = 0.43;
  const positions = [];
  const uvs = [];
  const indices = [];

  for (let i = 0; i <= stacks; i++) {
    const t = i / stacks; // 0 = waist/belt, 1 = neck collar
    const y = t * height;

    // Anatomical V-taper width (Z half-width):
    // Waist ~0.155m -> broad muscular shoulders ~0.218m at t=0.72 -> smooth trapezius taper to collar ~0.105m
    let halfW;
    if (t < 0.72) {
      const s = t / 0.72;
      halfW = 0.155 + Math.pow(s, 1.25) * 0.063;
    } else {
      const s = (t - 0.72) / 0.28;
      halfW = 0.218 - Math.pow(s, 1.55) * 0.113;
    }

    // Anatomical chest/back depth (X half-depth)
    const halfD = 0.108 + Math.sin(t * Math.PI) * 0.030;

    // Forward anatomical spine curve as rider hunches over tank
    const spineForwardX = Math.sin(t * Math.PI * 0.85) * 0.025;

    // Aerodynamic speed hump profile flowing smoothly up into the collar behind the helmet (t in [0.34, 0.94])
    const humpT = clamp((t - 0.34) / 0.60, 0, 1);
    const humpLongitudinal = Math.sin(humpT * Math.PI) * (0.85 + 0.25 * humpT);

    for (let j = 0; j <= slices; j++) {
      const uFrac = j / slices;
      // theta = 0 at front (+X), PI at back center (-X)
      const theta = uFrac * Math.PI * 2;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);

      let z = sinT * halfW;
      let x = cosT * halfD + spineForwardX;

      // Flatten the back slightly and add the 3D aerodynamic speed hump along the spine (cosT < 0)
      if (cosT < 0) {
        const backness = -cosT; // 1 at spine centerline
        const zCenterWeight = Math.exp(-(z * z) / (0.088 * 0.088));
        const humpOut = backness * zCenterWeight * humpLongitudinal * 0.064;
        // Muscular shoulder blade / lat contour
        const latContour = backness * Math.sin(clamp(t / 0.85, 0, 1) * Math.PI) * 0.018;
        x -= humpOut + latContour;
      }

      positions.push(x, y, z);

      // Direct planar back projection for UVs so rear chase view is 100% distortion-free
      const uBack = clamp(0.5 + (z / 0.228) * 0.42, 0.04, 0.96);
      const vBack = clamp(0.18 + t * 0.78, 0.18, 0.96);
      uvs.push(uBack, vBack);
    }
  }

  const ring = slices + 1;
  for (let i = 0; i < stacks; i++) {
    for (let j = 0; j < slices; j++) {
      const a = i * ring + j;
      const b = (i + 1) * ring + j;
      const c = (i + 1) * ring + (j + 1);
      const d = i * ring + (j + 1);
      indices.push(a, b, d);
      indices.push(b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setIndex(indices);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Sculpted Rider Pelvis / Hips geometry mapped to the lower hip region (v: 0.02..0.20) of livery.leathers.
 */
function createSculptedPelvisGeometry() {
  const geo = new THREE.SphereGeometry(0.168, 20, 14);
  const pos = geo.attributes?.position;
  const uv = geo.attributes?.uv;
  if (pos && pos.array && uv && uv.array) {
    const pArr = pos.array;
    const uArr = uv.array;
    for (let i = 0; i < pArr.length / 3; i++) {
      const x = pArr[i * 3] * 1.02;
      const y = pArr[i * 3 + 1] * 0.86;
      const z = pArr[i * 3 + 2] * 1.15;
      pArr[i * 3] = x;
      pArr[i * 3 + 1] = y;
      pArr[i * 3 + 2] = z;

      uArr[i * 2] = clamp(0.5 + (z / 0.20) * 0.42, 0.05, 0.95);
      uArr[i * 2 + 1] = clamp(0.02 + ((y + 0.145) / 0.29) * 0.18, 0.02, 0.20);
    }
    pos.needsUpdate = true;
    uv.needsUpdate = true;
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Sculpted Full-Face 1990s GP Helmet using LatheGeometry.
 * Compact, slightly wider-than-tall GP shell (~0.278m wide x 0.228m tall x 0.325m long).
 * UV seam is placed at the front (+X, under the dark visor) so u = 0.5 is dead-center on the BACK (-X).
 */
function createHelmetLatheGeometry() {
  if (typeof THREE.LatheGeometry === 'function' && typeof THREE.Vector2 === 'function') {
    const pts = [
      new THREE.Vector2(0.094, -0.098), // Neck roll bottom opening
      new THREE.Vector2(0.124, -0.082), // Rubber neck trim flare
      new THREE.Vector2(0.140, -0.040), // Lower cheek/jaw shell
      new THREE.Vector2(0.145, 0.008),  // Visor & temple equator
      new THREE.Vector2(0.138, 0.056),  // Forehead / upper shell
      new THREE.Vector2(0.112, 0.096),  // Upper crown curve
      new THREE.Vector2(0.064, 0.120),  // Top dome
      new THREE.Vector2(0.001, 0.128)   // Crown apex
    ];
    const geo = new THREE.LatheGeometry(pts, 28);
    const pos = geo.attributes?.position;
    const uv = geo.attributes?.uv;
    if (pos && pos.array && uv && uv.array) {
      const pArr = pos.array;
      const uArr = uv.array;
      for (let i = 0; i < pArr.length / 3; i++) {
        let x = pArr[i * 3];
        let y = pArr[i * 3 + 1];
        let z = pArr[i * 3 + 2];

        // Elongate front-to-back (+X chin bar & -X rear aero shell)
        x *= 1.14;
        z *= 0.99;
        if (x > 0.02 && y < 0.0) {
          x += 0.016 * clamp(-y / 0.10, 0, 1);
        }
        // Subtle rear aero spoiler ridge on back of helmet
        if (x < -0.06 && y > -0.02 && y < 0.07) {
          x -= 0.012 * (1.0 - Math.abs(y - 0.025) / 0.045);
        }

        pArr[i * 3] = x;
        pArr[i * 3 + 1] = y;
        pArr[i * 3 + 2] = z;

        const angleFromBack = Math.atan2(z, -x);
        uArr[i * 2] = clamp(0.5 + angleFromBack / (Math.PI * 2), 0.001, 0.999);
        uArr[i * 2 + 1] = clamp((y + 0.098) / 0.226, 0.01, 0.99);
      }
      pos.needsUpdate = true;
      uv.needsUpdate = true;
    }
    geo.computeVertexNormals();
    return geo;
  }
  return new THREE.SphereGeometry(0.145, 20, 16);
}

/**
 * Curved Wrap-Around Helmet Visor (Front arc of cylinder).
 */
function createHelmetVisorGeometry() {
  const geo = new THREE.CylinderGeometry(0.148, 0.152, 0.068, 20, 2, false, -Math.PI * 0.42, Math.PI * 0.84);
  geo.rotateY(Math.PI * 0.5);
  const pos = geo.attributes?.position;
  if (pos && pos.array) {
    const arr = pos.array;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i] *= 1.11;
      arr[i + 2] *= 0.99;
    }
    pos.needsUpdate = true;
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Anatomical Limb Capsule (CapsuleGeometry with fallback for headless mocks).
 */
function createLimbCapsuleGeometry(radiusTop, radiusBottom, length, capSegments = 8, radialSegments = 14) {
  const avgR = (radiusTop + radiusBottom) * 0.5;
  let geo;
  if (typeof THREE.CapsuleGeometry === 'function') {
    geo = new THREE.CapsuleGeometry(avgR, length, capSegments, radialSegments);
  } else {
    geo = new THREE.CylinderGeometry(radiusTop, radiusBottom, length + avgR * 2, radialSegments);
  }

  // Taper from top (proximal joint) to bottom (distal joint)
  const pos = geo.attributes?.position;
  if (pos && pos.array && Math.abs(radiusTop - radiusBottom) > 1e-4) {
    const arr = pos.array;
    const halfH = length * 0.5 + avgR;
    for (let i = 0; i < arr.length; i += 3) {
      const y = arr[i + 1];
      const t = clamp((y + halfH) / (2 * halfH), 0, 1); // 0 distal, 1 proximal
      const targetR = radiusBottom + (radiusTop - radiusBottom) * t;
      const scale = targetR / Math.max(1e-4, avgR);
      arr[i] *= scale;
      arr[i + 2] *= scale;
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  }
  return geo;
}

/**
 * Sculpted Armored GP Racing Boot (THREE.Shape + ExtrudeGeometry with bevel).
 */
function createRacingBootGeometry() {
  if (typeof THREE.Shape === 'function' && typeof THREE.ExtrudeGeometry === 'function') {
    const shape = new THREE.Shape();
    shape.moveTo(-0.08, -0.035); // Heel base on footpeg
    shape.lineTo(0.11, -0.038);  // Sole to toe slider
    shape.quadraticCurveTo(0.135, -0.015, 0.105, 0.012); // Toe box curve
    shape.lineTo(0.015, 0.038);  // Instep
    shape.lineTo(-0.015, 0.115); // Front shin cuff
    shape.lineTo(-0.085, 0.095); // Rear calf cuff
    shape.quadraticCurveTo(-0.092, 0.02, -0.08, -0.035); // Achilles & heel cup

    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.062,
      steps: 1,
      bevelEnabled: true,
      bevelThickness: 0.014,
      bevelSize: 0.012,
      bevelSegments: 3
    });
    centerExtrudeZ(geo);
    geo.computeVertexNormals();
    return geo;
  }
  return new THREE.BoxGeometry(0.19, 0.078, 0.085);
}

// ============================================================================
// SHARED GEOMETRY & MATERIAL CACHES (Keeps 8 bikes x 2 viewports at 60 FPS)
// ============================================================================
let sharedGeos = null;
const cachedMaterialSets = new Map();

function getSharedGeometries() {
  if (sharedGeos) return sharedGeos;

  // 17" GP Wheels: 0.60m OD (radius 0.30m), rear 0.186m wide, front 0.125m wide
  const frontTireGeo = createRacingSlickTireGeometry(0.296, 0.214, 0.125, 32);
  const rearTireGeo = createRacingSlickTireGeometry(0.300, 0.214, 0.186, 36);

  // Curved clip-on handlebar tube
  let handlebarGeo;
  if (typeof THREE.CatmullRomCurve3 === 'function' && typeof THREE.TubeGeometry === 'function') {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.06, 0.22, 0.10),
      new THREE.Vector3(-0.11, 0.205, 0.18),
      new THREE.Vector3(-0.145, 0.185, 0.265)
    ]);
    handlebarGeo = new THREE.TubeGeometry(curve, 8, 0.011, 8, false);
  } else {
    handlebarGeo = new THREE.CylinderGeometry(0.011, 0.011, 0.20, 8);
  }

  // Tubular rear subframe rail
  let subframeGeo;
  if (typeof THREE.CatmullRomCurve3 === 'function' && typeof THREE.TubeGeometry === 'function') {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.14, 0.50, 0),
      new THREE.Vector3(-0.42, 0.61, 0),
      new THREE.Vector3(-0.68, 0.70, 0),
      new THREE.Vector3(-0.42, 0.52, 0),
      new THREE.Vector3(-0.15, 0.37, 0)
    ]);
    subframeGeo = new THREE.TubeGeometry(curve, 16, 0.012, 6, false);
  } else {
    subframeGeo = new THREE.CylinderGeometry(0.014, 0.014, 0.52, 8);
  }

  sharedGeos = {
    // Tires & 17" wheels
    frontTireGeo,
    rearTireGeo,
    frontRimBarrel: createWheelRimLatheGeometry(0.214, 0.105, 24),
    rearRimBarrel: createWheelRimLatheGeometry(0.214, 0.158, 24),
    frontHub: new THREE.CylinderGeometry(0.052, 0.052, 0.135, 16),
    rearHub: new THREE.CylinderGeometry(0.062, 0.062, 0.175, 16),
    wheelSpoke: new THREE.BoxGeometry(0.032, 0.39, 0.022),
    frontBrakeDisc: new THREE.CylinderGeometry(0.158, 0.158, 0.008, 24),
    frontDiscCarrier: new THREE.CylinderGeometry(0.092, 0.092, 0.012, 16),
    rearBrakeDisc: new THREE.CylinderGeometry(0.108, 0.108, 0.008, 20),
    rearSprocket: new THREE.CylinderGeometry(0.118, 0.118, 0.010, 24),
    driveChain: createDriveChainGeometry(),

    // Sculpted chassis, swingarm, forks & rearsets
    frameSpar: createFrameSparExtrudeGeometry(),
    subframeRail: subframeGeo,
    swingarmBeam: createSwingarmExtrudeGeometry(),
    swingarmBridge: new THREE.BoxGeometry(0.10, 0.055, 0.25),
    rearShockSpring: new THREE.CylinderGeometry(0.036, 0.036, 0.19, 12),
    engineBlock: new THREE.CylinderGeometry(0.16, 0.18, 0.26, 12),
    radiatorCurved: new THREE.CylinderGeometry(0.26, 0.26, 0.28, 12, 1, false, -0.45, 0.90),
    forkOuter: new THREE.CylinderGeometry(0.027, 0.025, 0.38, 14),
    forkInner: new THREE.CylinderGeometry(0.020, 0.020, 0.32, 14),
    caliperBody: new THREE.SphereGeometry(0.048, 10, 8),
    tripleClamp: new THREE.BoxGeometry(0.085, 0.024, 0.25),
    handlebarCurve: handlebarGeo,
    gripCyl: new THREE.CylinderGeometry(0.015, 0.015, 0.11, 10),
    leverBlade: new THREE.BoxGeometry(0.014, 0.010, 0.11),
    tachDial: new THREE.CylinderGeometry(0.048, 0.048, 0.026, 18),
    tempDial: new THREE.CylinderGeometry(0.026, 0.026, 0.024, 14),
    dashFoam: new THREE.BoxGeometry(0.10, 0.036, 0.21),
    footpegRod: new THREE.CylinderGeometry(0.011, 0.011, 0.065, 8),
    heelGuard: new THREE.BoxGeometry(0.09, 0.065, 0.008),

    // Sculpted 1990 500cc GP Bodywork
    noseCone: createNoseLatheGeometry(),
    bubbleScreen: new THREE.SphereGeometry(0.22, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.58),
    fuelTankMain: createFuelTankExtrudeGeometry(),
    fuelCap: new THREE.CylinderGeometry(0.040, 0.040, 0.014, 16),
    sideFairingShell: createSideFairingExtrudeGeometry(),
    bellyPanKeel: new THREE.CylinderGeometry(0.125, 0.145, 0.70, 14),
    tailCowlMain: createTailCowlExtrudeGeometry(),
    underTailRecess: new THREE.BoxGeometry(0.14, 0.068, 0.19),
    seatPad: new THREE.SphereGeometry(0.16, 14, 10),
    seatBumStop: new THREE.CylinderGeometry(0.045, 0.052, 0.22, 12),
    frontFender: new THREE.SphereGeometry(0.175, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
    rearHugger: new THREE.SphereGeometry(0.312, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.24),
    ventSlat: new THREE.BoxGeometry(0.14, 0.012, 0.016),

    // 2-Stroke Expansion Chambers & Stingers (TubeGeometry + LatheGeometry nozzles)
    lowerExhaustLeft: createExpansionChamberTubeGeometry(-1),
    lowerExhaustRight: createExpansionChamberTubeGeometry(1),
    underTailExhaustLeft: createUnderTailExhaustGeometry(-1),
    underTailExhaustRight: createUnderTailExhaustGeometry(1),
    silencerCan: new THREE.CylinderGeometry(0.025, 0.025, 0.24, 14),
    stingerNozzle: createStingerNozzleLatheGeometry(),
    exhaustBore: new THREE.CylinderGeometry(0.013, 0.013, 0.02, 12),

    // Sculpted Anatomical Rider & Helmet
    riderTorso: createSculptedRiderTorsoGeometry(),
    riderPelvis: createSculptedPelvisGeometry(),
    upperArm: createLimbCapsuleGeometry(0.060, 0.044, 0.165, 5, 12),
    forearm: createLimbCapsuleGeometry(0.044, 0.034, 0.215, 5, 12),
    gloveSphere: new THREE.SphereGeometry(0.038, 10, 8),
    thighCapsule: createLimbCapsuleGeometry(0.078, 0.058, 0.19, 5, 12),
    kneePuck: new THREE.CylinderGeometry(0.040, 0.035, 0.020, 12),
    shinCapsule: createLimbCapsuleGeometry(0.058, 0.042, 0.24, 5, 12),
    racingBoot: createRacingBootGeometry(),
    neckCyl: new THREE.CylinderGeometry(0.070, 0.084, 0.05, 12),
    helmetShell: createHelmetLatheGeometry(),
    helmetVisor: createHelmetVisorGeometry(),

    // Contact shadow & knee sparks
    shadowOuter: new THREE.CylinderGeometry(0.92, 0.92, 0.004, 24),
    shadowInner: new THREE.CylinderGeometry(0.66, 0.66, 0.005, 20),
    sparkStreak: new THREE.BoxGeometry(0.24, 0.016, 0.016),
    sparkCore: new THREE.SphereGeometry(0.044, 8, 8)
  };

  return sharedGeos;
}

function getMaterialSet(bikeSpec = {}, textureSet = null, liveryOverride = null) {
  const bikeId = bikeSpec.id || 'akagi';
  const cPrimary = bikeSpec.colorPrimary ?? 0xd91424;
  const cSecondary = bikeSpec.colorSecondary ?? 0xffffff;
  const cAccent = bikeSpec.colorAccent ?? 0x151515;
  const cacheKey = `${bikeId}_${cPrimary}_${cSecondary}_${cAccent}_${Boolean(textureSet)}_${Boolean(liveryOverride)}`;

  if (cachedMaterialSets.has(cacheKey)) {
    return cachedMaterialSets.get(cacheKey);
  }

  const liverySet = createLiverySet(bikeSpec);

  const fairingMat = makePhysicalMat({
    color: 0xffffff,
    map: liverySet.fairing || liveryOverride || null,
    roughness: 0.13,
    metalness: 0.10,
    clearcoat: 1.0,
    clearcoatRoughness: 0.06
  });

  const tailMat = makePhysicalMat({
    color: 0xffffff,
    map: liverySet.tail || liverySet.fairing || null,
    roughness: 0.13,
    metalness: 0.10,
    clearcoat: 1.0,
    clearcoatRoughness: 0.06
  });

  const primaryGlossMat = makePhysicalMat({
    color: cPrimary,
    roughness: 0.14,
    metalness: 0.12,
    clearcoat: 1.0,
    clearcoatRoughness: 0.07
  });

  const secondaryGlossMat = makePhysicalMat({
    color: cSecondary,
    roughness: 0.15,
    metalness: 0.10,
    clearcoat: 1.0,
    clearcoatRoughness: 0.07
  });

  const accentMat = makePhysicalMat({
    color: cAccent,
    roughness: 0.26,
    metalness: 0.16,
    clearcoat: 0.65
  });

  const tireSlickMat = makeStandardMat({
    color: 0xffffff,
    map: liverySet.tireSidewall || textureSet?.tireTread || null,
    roughness: 0.56,
    metalness: 0.06
  });

  const magWheelMat = makeStandardMat({
    color: bikeId === 'shiden' ? 0xf2f4f8 : bikeId === 'corsa' ? 0x22262e : 0xe8edf4,
    roughness: 0.24,
    metalness: 0.78
  });

  const aluminumFrameMat = makeStandardMat({
    color: 0xdbe2ec,
    roughness: 0.20,
    metalness: 0.88
  });

  const chromeMat = makePhysicalMat({
    color: 0xf6faff,
    roughness: 0.05,
    metalness: 0.96,
    clearcoat: 1.0
  });

  const goldAnodizedMat = makeStandardMat({
    color: 0xe4b234,
    roughness: 0.20,
    metalness: 0.86
  });

  const brakeDiscMat = makeStandardMat({
    color: 0xd0d8e2,
    map: textureSet?.brakeDisc || null,
    roughness: 0.24,
    metalness: 0.88
  });

  const carbonMat = makeStandardMat({
    color: textureSet?.carbon ? 0x8e96a0 : 0x22262c,
    map: textureSet?.carbon || null,
    roughness: 0.30,
    metalness: 0.26
  });

  const exhaustExpansionMat = makeStandardMat({
    color: 0x6f737c,
    roughness: 0.26,
    metalness: 0.85
  });

  const darkEngineMat = makeStandardMat({
    color: 0x282d36,
    roughness: 0.42,
    metalness: 0.68
  });

  const blackRubberMat = makeStandardMat({
    color: 0x14161b,
    roughness: 0.82,
    metalness: 0.04
  });

  const exhaustBoreMat = new THREE.MeshBasicMaterial({
    color: 0x050608
  });

  const windscreenMat = makePhysicalMat({
    color: 0xcce6ff,
    roughness: 0.05,
    metalness: 0.06,
    clearcoat: 1.0,
    clearcoatRoughness: 0.03,
    transparent: true,
    opacity: 0.48
  });

  const visorChromeMat = makePhysicalMat({
    color: 0x0c121d,
    roughness: 0.04,
    metalness: 0.94,
    clearcoat: 1.0
  });

  const leathersBackMat = makePhysicalMat({
    color: 0xffffff,
    map: liverySet.leathers,
    roughness: 0.36,
    metalness: 0.06,
    clearcoat: 0.38,
    clearcoatRoughness: 0.26
  });

  const leathersLimbMat = makePhysicalMat({
    color: 0xffffff,
    map: liverySet.limbs,
    roughness: 0.36,
    metalness: 0.06,
    clearcoat: 0.38,
    clearcoatRoughness: 0.26
  });

  const shoulderYokeMat = makePhysicalMat({
    color: liverySet.theme?.suitYoke || cSecondary,
    roughness: 0.32,
    metalness: 0.08,
    clearcoat: 0.45
  });

  const leatherDarkMat = makeStandardMat({
    color: 0x171a22,
    roughness: 0.44,
    metalness: 0.08
  });

  const helmetShellMat = makePhysicalMat({
    color: 0xffffff,
    map: liverySet.helmet,
    roughness: 0.10,
    metalness: 0.12,
    clearcoat: 1.0,
    clearcoatRoughness: 0.05
  });

  const puckMat = makeStandardMat({
    color: 0xf5d428,
    roughness: 0.48,
    metalness: 0.05
  });

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

  const sparkCoreMat = new THREE.MeshBasicMaterial({
    color: 0xfff6b0,
    transparent: true,
    opacity: 0.95
  });

  const sparkStreakMat = new THREE.MeshBasicMaterial({
    color: 0xff8c1a,
    transparent: true,
    opacity: 0.90
  });

  const mats = {
    fairingMat,
    tailMat,
    primaryGlossMat,
    secondaryGlossMat,
    accentMat,
    tireSlickMat,
    magWheelMat,
    aluminumFrameMat,
    chromeMat,
    goldAnodizedMat,
    brakeDiscMat,
    carbonMat,
    exhaustExpansionMat,
    darkEngineMat,
    blackRubberMat,
    exhaustBoreMat,
    windscreenMat,
    visorChromeMat,
    leathersBackMat,
    leathersLimbMat,
    shoulderYokeMat,
    leatherDarkMat,
    helmetShellMat,
    puckMat,
    shadowOuterMat,
    shadowInnerMat,
    sparkCoreMat,
    sparkStreakMat
  };

  cachedMaterialSets.set(cacheKey, mats);
  return mats;
}

function buildSparkCluster(G, M) {
  const group = new THREE.Group();
  const core = new THREE.Mesh(G.sparkCore, M.sparkCoreMat);
  group.add(core);

  const angles = [
    [0.15, 0.1, -0.2],
    [-0.25, 0.28, 0.15],
    [0.35, -0.22, 0.3],
    [-0.1, -0.35, -0.28],
    [0.05, 0.42, 0.08]
  ];
  for (let i = 0; i < angles.length; i++) {
    const s = new THREE.Mesh(G.sparkStreak, i % 2 === 0 ? M.sparkStreakMat : M.sparkCoreMat);
    s.position.set(-0.11, 0.01 * i, 0);
    s.rotation.set(angles[i][0], angles[i][1], angles[i][2]);
    group.add(s);
  }
  group.visible = false;
  return group;
}

function enableShadowsRecursive(root) {
  if (!root || typeof root.traverse !== 'function') return;
  root.traverse((obj) => {
    if (obj && obj.isMesh && !obj.userData?.noShadow) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });
}

// ============================================================================
// GLB WORKS BIKE (assets/bikes/gp500_works.glb, built by tools/prepare_bike_glb.py)
// Authored in the rig frame: +X forward, axle midpoint at the origin, 1.40m wheelbase.
// Nodes: body, wheel_front / wheel_rear (pivot on the axle), seat_anchor.
// Swaps in for the procedural bike body; the procedural rider rides on top.
// Skipped in Node; on any load failure the procedural bike stays.
// ============================================================================
const GLB_BIKE_URL = './assets/bikes/gp500_works.glb';
const GLB_DRACO_DECODER_PATH = './vendor/addons/libs/draco/gltf/';
const GLB_EMBEDDED_LIVERY_ID = 'akagi';
// Procedural seat point the rider pose was tuned on (seat pad centre, top surface).
const PROCEDURAL_SEAT = { x: -0.12, y: 0.755 };
// Racers sit at the front of the seat, ahead of its lowest point.
const GLB_SEAT_FORWARD = 0.06;
const NO_SEAT_OFFSET = { x: 0, y: 0 };

let glbManifestPromise = null;
let glbTemplatePromise = null;
const glbLiveryMaterials = new Map();

function getEnabledGlbSet() {
  if (typeof window === 'undefined' || typeof document === 'undefined' || typeof fetch !== 'function') {
    return Promise.resolve(new Set());
  }
  if (window.__GP500_GLB_BIKES) {
    if (Array.isArray(window.__GP500_GLB_BIKES)) {
      return Promise.resolve(new Set(window.__GP500_GLB_BIKES));
    }
    return Promise.resolve(new Set(['all']));
  }
  try {
    const params = new URLSearchParams(window.location?.search || '');
    const glbParam = params.get('glb');
    if (glbParam === '1' || glbParam === 'true') return Promise.resolve(new Set(['all']));
    if (glbParam === '0' || glbParam === 'false') return Promise.resolve(new Set());
  } catch {
    // ignore URL parse error
  }
  if (!glbManifestPromise) {
    glbManifestPromise = fetch('./assets/bikes/README.md')
      .then((res) => (res && res.ok ? res.text() : ''))
      .then((text) => {
        const set = new Set();
        const match = text.match(/^[ \t]*ENABLE_GLB[ \t]*:[ \t]*([^\r\n#]+)/im);
        if (match && match[1]) {
          for (const token of match[1].split(/[,\s]+/)) {
            const clean = token.trim().toLowerCase();
            if (clean && clean !== 'none') set.add(clean);
          }
        }
        return set;
      })
      .catch(() => new Set());
  }
  return glbManifestPromise;
}

function loadGlbTemplate() {
  if (!glbTemplatePromise) {
    glbTemplatePromise = Promise.all([
      import('three/addons/loaders/GLTFLoader.js'),
      import('three/addons/loaders/DRACOLoader.js')
    ])
      .then(([{ GLTFLoader }, { DRACOLoader }]) => {
        const draco = new DRACOLoader();
        draco.setDecoderPath(GLB_DRACO_DECODER_PATH);
        const loader = new GLTFLoader();
        loader.setDRACOLoader(draco);
        return loader.loadAsync(GLB_BIKE_URL);
      })
      .then((gltf) => (gltf?.scene?.getObjectByName('wheel_front') ? gltf.scene : null))
      .catch(() => null);
  }
  return glbTemplatePromise;
}

// One painted material per team, shared by every rig of that bike.
function getGlbLiveryMaterial(bikeId, baseMaterial) {
  if (bikeId === GLB_EMBEDDED_LIVERY_ID) return Promise.resolve(baseMaterial);
  if (!glbLiveryMaterials.has(bikeId)) {
    const promise = new THREE.TextureLoader()
      .loadAsync(`./assets/bikes/livery_${bikeId}.jpg`)
      .then((tex) => {
        tex.flipY = false;
        tex.colorSpace = THREE.SRGBColorSpace;
        if (baseMaterial.map) {
          tex.wrapS = baseMaterial.map.wrapS;
          tex.wrapT = baseMaterial.map.wrapT;
          tex.anisotropy = baseMaterial.map.anisotropy;
        }
        const mat = baseMaterial.clone();
        mat.map = tex;
        return mat;
      })
      .catch(() => baseMaterial);
    glbLiveryMaterials.set(bikeId, promise);
  }
  return glbLiveryMaterials.get(bikeId);
}

export async function tryLoadOptionalBikeGLB(bikeId, rig, force = false) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (!bikeId || !rig || !rig.leanGroup) return false;

  try {
    if (!force) {
      const enabledSet = await getEnabledGlbSet();
      if (!enabledSet.has(bikeId) && !enabledSet.has('all')) {
        return false;
      }
    }

    const template = await loadGlbTemplate();
    if (!template) return false;

    const model = template.clone(true);
    const liveryMeshes = [];
    model.traverse((node) => {
      if (!node.isMesh) return;
      node.castShadow = true;
      node.receiveShadow = true;
      if (node.material?.name === 'livery_paint') liveryMeshes.push(node);
    });
    if (liveryMeshes.length) {
      const liveryMat = await getGlbLiveryMaterial(bikeId, liveryMeshes[0].material);
      for (const mesh of liveryMeshes) mesh.material = liveryMat;
    }

    if (rig.bikeBodyGroup) rig.bikeBodyGroup.visible = false;
    if (rig.frontWheelGroup) rig.frontWheelGroup.visible = false;
    if (rig.rearWheelGroup) rig.rearWheelGroup.visible = false;
    if (rig.frontForkGroup) rig.frontForkGroup.visible = false;

    rig.leanGroup.add(model);
    rig.glbModel = model;
    rig.glbFrontWheel = model.getObjectByName('wheel_front');
    rig.glbRearWheel = model.getObjectByName('wheel_rear');
    const seat = model.getObjectByName('seat_anchor');
    if (seat) {
      rig.riderSeatOffset = {
        x: seat.position.x + GLB_SEAT_FORWARD - PROCEDURAL_SEAT.x,
        y: seat.position.y - PROCEDURAL_SEAT.y
      };
    }
    return true;
  } catch {
    // Fail silently: the procedural bike stays.
    return false;
  }
}

/**
 * Builds a realistic, multi-part hierarchical 1990 500cc GP motorcycle + articulated rider rig.
 * Local coordinate convention inside leanGroup: +X is forward, +Y is up, +Z is right.
 */
export function createDetailedBikeRig(rider = {}, textureSet = null, liveryTexture = null) {
  const G = getSharedGeometries();
  const bikeSpec = rider.bike || {};
  const M = getMaterialSet(bikeSpec, textureSet, liveryTexture);

  // Root hierarchy
  const rootGroup = new THREE.Group();
  const pitchGroup = new THREE.Group();
  const leanGroup = new THREE.Group();
  const bikeBodyGroup = new THREE.Group();
  rootGroup.add(pitchGroup);
  pitchGroup.add(leanGroup);
  leanGroup.add(bikeBodyGroup);

  // Soft Grounding Contact Shadow right at y = 0.022 beneath the bike (stays flat on road)
  const contactShadow = new THREE.Group();
  contactShadow.position.set(0, 0.022, 0);
  const outerShadowMesh = new THREE.Mesh(G.shadowOuter, M.shadowOuterMat);
  outerShadowMesh.scale.set(1.08, 1.0, 0.42);
  outerShadowMesh.userData.noShadow = true;
  const innerShadowMesh = new THREE.Mesh(G.shadowInner, M.shadowInnerMat);
  innerShadowMesh.scale.set(1.08, 1.0, 0.34);
  innerShadowMesh.position.y = 0.001;
  innerShadowMesh.userData.noShadow = true;
  contactShadow.add(outerShadowMesh, innerShadowMesh);
  rootGroup.add(contactShadow);

  // =========================================================================
  // 1. FRONT & REAR 17" PROFILED RACING SLICK WHEELS (Wheelbase = 1.40m)
  // Front axle: x = +0.70m, y = 0.30m | Rear axle: x = -0.70m, y = 0.30m
  // =========================================================================
  const frontWheelGroup = new THREE.Group();
  frontWheelGroup.position.set(0.70, 0.30, 0);
  leanGroup.add(frontWheelGroup);

  const frontTireMesh = new THREE.Mesh(G.frontTireGeo, M.tireSlickMat);
  frontTireMesh.rotation.x = Math.PI / 2;
  frontWheelGroup.add(frontTireMesh);

  const frontRimMesh = new THREE.Mesh(G.frontRimBarrel, M.magWheelMat);
  frontRimMesh.rotation.x = Math.PI / 2;
  frontWheelGroup.add(frontRimMesh);

  const frontHubMesh = new THREE.Mesh(G.frontHub, M.aluminumFrameMat);
  frontHubMesh.rotation.x = Math.PI / 2;
  frontWheelGroup.add(frontHubMesh);

  for (let s = 0; s < 3; s++) {
    const spoke = new THREE.Mesh(G.wheelSpoke, M.magWheelMat);
    spoke.rotation.z = (s * Math.PI) / 3;
    frontWheelGroup.add(spoke);
  }

  for (const side of [-1, 1]) {
    const disc = new THREE.Mesh(G.frontBrakeDisc, M.brakeDiscMat);
    disc.rotation.x = Math.PI / 2;
    disc.position.z = side * 0.058;
    const carrier = new THREE.Mesh(G.frontDiscCarrier, M.goldAnodizedMat);
    carrier.rotation.x = Math.PI / 2;
    carrier.position.z = side * 0.058;
    frontWheelGroup.add(disc, carrier);
  }

  const rearWheelGroup = new THREE.Group();
  rearWheelGroup.position.set(-0.70, 0.30, 0);
  leanGroup.add(rearWheelGroup);

  const rearTireMesh = new THREE.Mesh(G.rearTireGeo, M.tireSlickMat);
  rearTireMesh.rotation.x = Math.PI / 2;
  rearWheelGroup.add(rearTireMesh);

  const rearRimMesh = new THREE.Mesh(G.rearRimBarrel, M.magWheelMat);
  rearRimMesh.rotation.x = Math.PI / 2;
  rearWheelGroup.add(rearRimMesh);

  const rearHubMesh = new THREE.Mesh(G.rearHub, M.aluminumFrameMat);
  rearHubMesh.rotation.x = Math.PI / 2;
  rearWheelGroup.add(rearHubMesh);

  for (let s = 0; s < 3; s++) {
    const spoke = new THREE.Mesh(G.wheelSpoke, M.magWheelMat);
    spoke.rotation.z = (s * Math.PI) / 3;
    spoke.scale.set(1.06, 1.0, 1.25);
    rearWheelGroup.add(spoke);
  }

  // Rear chain sprocket (left side -Z) & rear brake rotor (right side +Z)
  const sprocketMesh = new THREE.Mesh(G.rearSprocket, M.goldAnodizedMat);
  sprocketMesh.rotation.x = Math.PI / 2;
  sprocketMesh.position.z = -0.104;
  const rearDiscMesh = new THREE.Mesh(G.rearBrakeDisc, M.brakeDiscMat);
  rearDiscMesh.rotation.x = Math.PI / 2;
  rearDiscMesh.position.z = 0.102;
  rearWheelGroup.add(sprocketMesh, rearDiscMesh);

  // =========================================================================
  // 2. TWIN-SPAR ALUMINUM CHASSIS, GULLWING SWINGARM, CHAIN & USD FORKS
  // =========================================================================
  const engineMesh = new THREE.Mesh(G.engineBlock, M.darkEngineMat);
  engineMesh.rotation.x = Math.PI / 2;
  engineMesh.position.set(0.06, 0.38, 0);
  bikeBodyGroup.add(engineMesh);

  const radiatorMesh = new THREE.Mesh(G.radiatorCurved, M.aluminumFrameMat);
  radiatorMesh.position.set(0.18, 0.42, 0);
  radiatorMesh.rotation.y = Math.PI / 2;
  bikeBodyGroup.add(radiatorMesh);

  // Continuous Gold/Steel Roller Drive Chain Loop on Left Side (z = -0.105)
  const chainMesh = new THREE.Mesh(G.driveChain, M.goldAnodizedMat);
  chainMesh.position.z = -0.105;
  bikeBodyGroup.add(chainMesh);

  // Yellow/Gold Rear Monoshock Coil Spring ahead of rear tire
  const shockMesh = new THREE.Mesh(G.rearShockSpring, M.goldAnodizedMat);
  shockMesh.position.set(-0.24, 0.42, 0);
  shockMesh.rotation.z = -0.26;
  bikeBodyGroup.add(shockMesh);

  // Swingarm Cross-Bridge
  const swingBridge = new THREE.Mesh(G.swingarmBridge, M.aluminumFrameMat);
  swingBridge.position.set(-0.34, 0.34, 0);
  bikeBodyGroup.add(swingBridge);

  for (const side of [-1, 1]) {
    // Sculpted Twin-Spar Brushed Aluminum Frame Beams
    const spar = new THREE.Mesh(G.frameSpar, M.aluminumFrameMat);
    spar.position.set(0, 0, side * 0.155);
    bikeBodyGroup.add(spar);

    // Tubular Aluminum Rear Subframe
    const subframe = new THREE.Mesh(G.subframeRail, M.aluminumFrameMat);
    subframe.position.set(0, 0, side * 0.115);
    bikeBodyGroup.add(subframe);

    // Sculpted Gullwing Braced Swingarm Arms
    const swingarm = new THREE.Mesh(G.swingarmBeam, M.aluminumFrameMat);
    swingarm.position.set(0, 0, side * 0.128);
    bikeBodyGroup.add(swingarm);

    // CNC Aluminum Rearset Footpegs & Carbon Heel Guards right under rider's boots
    const footpeg = new THREE.Mesh(G.footpegRod, M.chromeMat);
    footpeg.rotation.x = Math.PI / 2;
    footpeg.position.set(-0.13, 0.38, side * 0.185);
    const heelGuard = new THREE.Mesh(G.heelGuard, M.carbonMat);
    heelGuard.position.set(-0.16, 0.42, side * 0.158);
    heelGuard.rotation.z = 0.25;
    bikeBodyGroup.add(footpeg, heelGuard);
  }

  // Rear Underslung Gold Brake Caliper on Right Swingarm
  const rearCaliper = new THREE.Mesh(G.caliperBody, M.goldAnodizedMat);
  rearCaliper.scale.set(1.1, 0.75, 0.65);
  rearCaliper.position.set(-0.65, 0.22, 0.106);
  bikeBodyGroup.add(rearCaliper);

  // Carbon-Fiber Rear Tire Hugger centered over forward-top quadrant of rear slick
  const rearHuggerMesh = new THREE.Mesh(G.rearHugger, M.carbonMat);
  rearHuggerMesh.position.set(-0.70, 0.30, 0);
  rearHuggerMesh.rotation.set(0, 0, -0.78);
  rearHuggerMesh.scale.set(1.0, 1.0, 0.46);
  bikeBodyGroup.add(rearHuggerMesh);

  // USD Front Fork & Cockpit Group
  const frontForkGroup = new THREE.Group();
  frontForkGroup.position.set(0.55, 0.54, 0);
  leanGroup.add(frontForkGroup);

  for (const side of [-1, 1]) {
    // Gold anodized USD upper fork tubes
    const outerFork = new THREE.Mesh(G.forkOuter, M.goldAnodizedMat);
    outerFork.position.set(-0.02, 0.08, side * 0.108);
    outerFork.rotation.z = 0.40;
    frontForkGroup.add(outerFork);

    // Chrome lower fork sliders reaching front axle
    const innerFork = new THREE.Mesh(G.forkInner, M.chromeMat);
    innerFork.position.set(0.09, -0.14, side * 0.106);
    innerFork.rotation.z = 0.40;
    frontForkGroup.add(innerFork);

    // Gold Twin-Piston Front Brake Calipers
    const caliper = new THREE.Mesh(G.caliperBody, M.goldAnodizedMat);
    caliper.scale.set(1.25, 0.92, 0.68);
    caliper.position.set(0.08, -0.20, side * 0.082);
    frontForkGroup.add(caliper);

    // Curved Clip-On Handlebars + Rubber Grips + Chrome Levers
    const bar = new THREE.Mesh(G.handlebarCurve, M.aluminumFrameMat);
    bar.scale.set(1, 1, side);
    frontForkGroup.add(bar);

    const grip = new THREE.Mesh(G.gripCyl, M.blackRubberMat);
    grip.position.set(-0.13, 0.195, side * 0.225);
    grip.rotation.x = Math.PI / 2 + side * 0.18;
    grip.rotation.z = -0.16;
    frontForkGroup.add(grip);

    const lever = new THREE.Mesh(G.leverBlade, M.chromeMat);
    lever.position.set(-0.085, 0.195, side * 0.225);
    lever.rotation.y = -side * 0.18;
    frontForkGroup.add(lever);
  }

  const topClamp = new THREE.Mesh(G.tripleClamp, M.aluminumFrameMat);
  topClamp.position.set(-0.08, 0.22, 0);
  topClamp.rotation.z = 0.40;
  frontForkGroup.add(topClamp);

  const dashPad = new THREE.Mesh(G.dashFoam, M.carbonMat);
  dashPad.position.set(-0.01, 0.25, 0);
  dashPad.rotation.z = 0.46;
  frontForkGroup.add(dashPad);

  const tachFace = new THREE.Mesh(G.tachDial, M.secondaryGlossMat);
  tachFace.position.set(-0.02, 0.27, 0);
  tachFace.rotation.z = Math.PI / 2 - 0.44;
  const tempGauge = new THREE.Mesh(G.tempDial, M.accentMat);
  tempGauge.position.set(-0.02, 0.265, 0.072);
  tempGauge.rotation.z = Math.PI / 2 - 0.44;
  frontForkGroup.add(tachFace, tempGauge);

  // Sculpted Front Fender hugging front slick tire
  const frontFenderMesh = new THREE.Mesh(G.frontFender, M.primaryGlossMat);
  frontFenderMesh.position.set(0.14, -0.09, 0);
  frontFenderMesh.scale.set(1.22, 0.85, 0.68);
  frontForkGroup.add(frontFenderMesh);

  // =========================================================================
  // 3. SCULPTED 1990 500cc AERODYNAMIC BODYWORK, TANK, TAIL & WINDSCREEN
  // =========================================================================
  const noseMesh = new THREE.Mesh(G.noseCone, M.fairingMat);
  noseMesh.position.set(0.55, 0.69, 0);
  noseMesh.rotation.z = -Math.PI / 2 + 0.08;
  bikeBodyGroup.add(noseMesh);

  const screenMesh = new THREE.Mesh(G.bubbleScreen, M.windscreenMat);
  screenMesh.position.set(0.47, 0.78, 0);
  screenMesh.rotation.z = -0.38;
  screenMesh.scale.set(1.36, 0.78, 0.88);
  bikeBodyGroup.add(screenMesh);

  // Sculpted Fuel Tank (ExtrudeGeometry with knee indents & clearcoat paint)
  const tankMesh = new THREE.Mesh(G.fuelTankMain, M.fairingMat);
  bikeBodyGroup.add(tankMesh);

  const fuelCapMesh = new THREE.Mesh(G.fuelCap, M.chromeMat);
  fuelCapMesh.position.set(0.20, 0.915, 0);
  fuelCapMesh.rotation.z = -0.10;
  bikeBodyGroup.add(fuelCapMesh);

  // Left & Right Sculpted Side Fairing Shells (ExtrudeGeometry with bevels)
  for (const side of [-1, 1]) {
    const sideFairing = new THREE.Mesh(G.sideFairingShell, M.fairingMat);
    sideFairing.position.set(0, 0, side * 0.148);
    if (side < 0) {
      sideFairing.scale.z = -1;
    }
    bikeBodyGroup.add(sideFairing);

    for (let v = 0; v < 3; v++) {
      const vent = new THREE.Mesh(G.ventSlat, M.accentMat);
      vent.position.set(0.18 - v * 0.042, 0.52 - v * 0.036, side * 0.198);
      vent.rotation.z = 0.42;
      bikeBodyGroup.add(vent);
    }
  }

  // Lower Aerodynamic Belly Pan Keel (centered symmetrically)
  const bellyKeel = new THREE.Mesh(G.bellyPanKeel, M.secondaryGlossMat);
  bellyKeel.position.set(0.12, 0.265, 0);
  bellyKeel.rotation.z = Math.PI / 2 - 0.04;
  bellyKeel.scale.set(0.60, 1.0, 0.85);
  bikeBodyGroup.add(bellyKeel);

  // Sculpted 1990s GP Tail Cowl / Seat Unit mapped with livery.tail (numbers & stripes!)
  const tailCowl = new THREE.Mesh(G.tailCowlMain, M.tailMat);
  bikeBodyGroup.add(tailCowl);

  // Dark Recessed Under-Tail Exhaust Housing (visible directly under tail cowl from behind, like Ref 1)
  const underTailBox = new THREE.Mesh(G.underTailRecess, M.blackRubberMat);
  underTailBox.position.set(-0.79, 0.665, 0);
  underTailBox.rotation.z = 0.16;
  bikeBodyGroup.add(underTailBox);

  // Sculpted Foam Seat Pad at y = 0.78m & Bum-Stop Pad
  const seatPadMesh = new THREE.Mesh(G.seatPad, M.blackRubberMat);
  seatPadMesh.position.set(-0.12, 0.755, 0);
  seatPadMesh.scale.set(1.25, 0.28, 0.92);
  const seatStopMesh = new THREE.Mesh(G.seatBumStop, M.blackRubberMat);
  seatStopMesh.position.set(-0.25, 0.79, 0);
  seatStopMesh.rotation.x = Math.PI / 2;
  seatStopMesh.rotation.z = -0.22;
  bikeBodyGroup.add(seatPadMesh, seatStopMesh);

  // =========================================================================
  // 4. 4-PIPE 2-STROKE EXPANSION CHAMBERS & CARBON/CHROME STINGERS
  // =========================================================================
  const lowerPipeL = new THREE.Mesh(G.lowerExhaustLeft, M.exhaustExpansionMat);
  const lowerPipeR = new THREE.Mesh(G.lowerExhaustRight, M.exhaustExpansionMat);
  const upperPipeL = new THREE.Mesh(G.underTailExhaustLeft, M.exhaustExpansionMat);
  const upperPipeR = new THREE.Mesh(G.underTailExhaustRight, M.exhaustExpansionMat);
  bikeBodyGroup.add(lowerPipeL, lowerPipeR, upperPipeL, upperPipeR);

  for (const side of [-1, 1]) {
    // Lower side-exit Carbon-Kevlar silencer canister & hollow chrome stinger tip (sleek & tucked)
    const lowerSilencer = new THREE.Mesh(G.silencerCan, M.carbonMat);
    lowerSilencer.scale.set(0.82, 0.90, 0.82);
    lowerSilencer.position.set(-0.68, 0.47, side * 0.126);
    lowerSilencer.rotation.z = Math.PI / 2 + 0.50;

    const lowerTip = new THREE.Mesh(G.stingerNozzle, M.chromeMat);
    lowerTip.scale.set(0.85, 0.85, 0.85);
    lowerTip.position.set(-0.79, 0.538, side * 0.124);
    lowerTip.rotation.z = Math.PI / 2 + 0.50;

    const lowerBore = new THREE.Mesh(G.exhaustBore, M.exhaustBoreMat);
    lowerBore.position.set(-0.812, 0.552, side * 0.124);
    lowerBore.rotation.z = Math.PI / 2 + 0.50;

    // Upper under-tail stinger silencer canister & hollow chrome stinger tip
    const upperSilencer = new THREE.Mesh(G.silencerCan, M.carbonMat);
    upperSilencer.scale.set(0.76, 0.78, 0.76);
    upperSilencer.position.set(-0.73, 0.665, side * 0.046);
    upperSilencer.rotation.z = Math.PI / 2 + 0.10;

    const upperTip = new THREE.Mesh(G.stingerNozzle, M.chromeMat);
    upperTip.scale.set(0.82, 0.82, 0.82);
    upperTip.position.set(-0.845, 0.674, side * 0.046);
    upperTip.rotation.z = Math.PI / 2 + 0.10;

    const upperBore = new THREE.Mesh(G.exhaustBore, M.exhaustBoreMat);
    upperBore.position.set(-0.868, 0.678, side * 0.046);
    upperBore.rotation.z = Math.PI / 2 + 0.10;

    bikeBodyGroup.add(
      lowerSilencer,
      lowerTip,
      lowerBore,
      upperSilencer,
      upperTip,
      upperBore
    );
  }

  // =========================================================================
  // 5. SCULPTED ANATOMICAL RIDER (~1.75m IN CROUCHED GP RACING TUCK)
  // =========================================================================
  const riderBody = new THREE.Group();
  riderBody.position.set(-0.11, 0.74, 0);
  leanGroup.add(riderBody);

  // Sculpted Leather Pelvis / Hips sitting deep on seat pad
  const pelvisMesh = new THREE.Mesh(G.riderPelvis, M.leathersBackMat);
  pelvisMesh.position.set(-0.02, 0.01, 0);
  riderBody.add(pelvisMesh);

  // Articulated Torso Group (pivots from hips for tuck-in and corner hang-off)
  const torsoGroup = new THREE.Group();
  torsoGroup.position.set(0.01, 0.02, 0);
  torsoGroup.rotation.z = -0.80;
  riderBody.add(torsoGroup);

  // Continuous Sculpted Back + Broad Shoulders + Aero Hump mapped with livery.leathers
  const torsoMesh = new THREE.Mesh(G.riderTorso, M.leathersBackMat);
  torsoGroup.add(torsoMesh);

  // Smoothly Blended Capsule Arms connecting shoulder sockets -> tucked elbows -> clip-on grips
  const buildArm = (side) => {
    const armGroup = new THREE.Group();
    armGroup.position.set(0.01, 0.30, side * 0.162);

    const pShoulder = { x: 0, y: 0, z: 0 };
    const pElbow = { x: 0.135, y: -0.145, z: side * 0.018 };
    const pWrist = { x: 0.365, y: 0.032, z: side * 0.058 };

    const upperArm = new THREE.Mesh(G.upperArm, M.leathersLimbMat);
    alignLimbBetween(upperArm, pShoulder, pElbow);
    armGroup.add(upperArm);

    const forearm = new THREE.Mesh(G.forearm, M.leathersLimbMat);
    alignLimbBetween(forearm, pElbow, pWrist);
    armGroup.add(forearm);

    const glove = new THREE.Mesh(G.gloveSphere, M.leatherDarkMat);
    glove.scale.set(1.25, 0.82, 0.92);
    glove.position.set(pWrist.x, pWrist.y, pWrist.z);
    armGroup.add(glove);

    return armGroup;
  };

  const leftArmGroup = buildArm(-1);
  const rightArmGroup = buildArm(1);
  torsoGroup.add(leftArmGroup, rightArmGroup);

  // Sculpted Full-Face 1990 GP Helmet rising cleanly above the shoulder yoke
  const headGroup = new THREE.Group();
  headGroup.position.set(-0.045, 0.445, 0);
  headGroup.rotation.z = 0.70;
  torsoGroup.add(headGroup);

  const neckMesh = new THREE.Mesh(G.neckCyl, M.leatherDarkMat);
  neckMesh.position.set(-0.01, -0.075, 0);
  neckMesh.rotation.z = 0.16;
  headGroup.add(neckMesh);

  const helmetShellMesh = new THREE.Mesh(G.helmetShell, M.helmetShellMat);
  headGroup.add(helmetShellMesh);

  const visorMesh = new THREE.Mesh(G.helmetVisor, M.visorChromeMat);
  visorMesh.position.set(0.016, 0.008, 0);
  headGroup.add(visorMesh);

  // Articulated Left & Right Capsule Legs -> Flush Knee Pucks -> Tall GP Racing Boots on Pegs
  const buildLeg = (side) => {
    const legPivot = new THREE.Group();
    legPivot.position.set(0.0, -0.01, side * 0.132);

    const pHip = { x: 0, y: 0, z: 0 };
    const pKnee = { x: 0.23, y: -0.125, z: side * 0.068 };
    const pAnkle = { x: -0.02, y: -0.34, z: side * 0.045 };

    // Muscular leather thigh capsule straddling tank and flaring to knee
    const thigh = new THREE.Mesh(G.thighCapsule, M.leathersLimbMat);
    alignLimbBetween(thigh, pHip, pKnee);
    legPivot.add(thigh);

    // Flush replaceable Knee Slider Puck embedded on outer knee
    const puck = new THREE.Mesh(G.kneePuck, M.puckMat);
    puck.position.set(pKnee.x + 0.005, pKnee.y - 0.010, pKnee.z + side * 0.040);
    puck.rotation.x = Math.PI / 2 + side * 0.20;
    legPivot.add(puck);

    // Tall black armored GP racing boot shaft from knee down to rearset footpeg
    const shin = new THREE.Mesh(G.shinCapsule, M.leatherDarkMat);
    alignLimbBetween(shin, pKnee, pAnkle);
    legPivot.add(shin);

    // Sculpted GP racing boot foot resting on rearset peg
    const boot = new THREE.Mesh(G.racingBoot, M.leatherDarkMat);
    boot.position.set(pAnkle.x, pAnkle.y - 0.02, pAnkle.z);
    boot.rotation.z = 0.12;
    legPivot.add(boot);

    // Knee-down spark burst emitter right at the knee puck
    const sparkMesh = buildSparkCluster(G, M);
    sparkMesh.position.set(pKnee.x - 0.01, pKnee.y - 0.025, pKnee.z + side * 0.068);
    sparkMesh.traverse((o) => {
      if (o.isMesh) o.userData.noShadow = true;
    });
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

  // Enable shadow casting & receiving across all bike & rider meshes
  enableShadowsRecursive(leanGroup);

  const rig = {
    rootGroup,
    pitchGroup,
    leanGroup,
    bikeBodyGroup,
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

  // Optional async GLB model swap (skipped in Node; only loads if enabled / present)
  if (bikeSpec.id) {
    tryLoadOptionalBikeGLB(bikeSpec.id, rig, false);
  }

  return rig;
}

/**
 * Animates the hierarchical 1990 500cc GP bike rig & rider each frame:
 * - World position & heading, braking fork dive, wheelie lift, lean roll
 * - High-speed wheel rotation (r = 0.30m for 17" 0.60m OD tires)
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
    rig.frontForkGroup.position.y = 0.54 - brake * 0.022;
    rig.frontForkGroup.rotation.y = -clamp(lean * 0.08, -0.08, 0.08);
  }

  // Spin front and rear 17" wheels (outer radius 0.30m) proportional to linear speed
  rig.wheelAngle = (rig.wheelAngle || 0) - (speed / 0.30) * safeDt;
  if (rig.frontWheelGroup) {
    rig.frontWheelGroup.rotation.z = rig.wheelAngle;
  }
  if (rig.rearWheelGroup) {
    rig.rearWheelGroup.rotation.z = rig.wheelAngle;
  }
  if (rig.glbFrontWheel) rig.glbFrontWheel.rotation.z = rig.wheelAngle;
  if (rig.glbRearWheel) rig.glbRearWheel.rotation.z = rig.wheelAngle;

  // Animate Rider Hang-Off, Knee-Down & Aero Tuck
  const leanNorm = clamp(lean / 0.96, -1, 1);
  const absLean = Math.abs(leanNorm);
  const isTuck = Boolean(rider.tuck);

  if (rig.riderBody) {
    // Shift hips laterally off the seat into the inside of the turn
    rig.riderBody.position.z = leanNorm * 0.21;
    const seatOffset = rig.riderSeatOffset || NO_SEAT_OFFSET;
    rig.riderBody.position.y = (isTuck ? 0.705 : 0.740) - absLean * 0.038 + seatOffset.y;
    rig.riderBody.position.x = (isTuck ? -0.14 : -0.11) + seatOffset.x;
  }

  if (rig.torsoGroup) {
    // Tuck torso behind bubble windscreen or lean chest down across tank in corners
    rig.torsoGroup.rotation.z = (isTuck ? -1.04 : -0.80) - absLean * 0.12;
    rig.torsoGroup.rotation.x = leanNorm * 0.25;
    rig.torsoGroup.rotation.y = -leanNorm * 0.15;
  }

  if (rig.headGroup) {
    // Counter-roll helmet to keep eyes level with horizon and looking into corner apex
    rig.headGroup.rotation.x = -lean * 0.62;
    rig.headGroup.rotation.z = isTuck ? 0.90 : 0.68 + absLean * 0.10;
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
    rig.leftArmGroup.rotation.z = isTuck ? 0.20 : 0.0;
    rig.rightArmGroup.rotation.z = isTuck ? 0.20 : 0.0;
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

  // Grounding contact shadow stays flat on asphalt at y = 0.022 and tracks lateral lean offset
  if (rig.contactShadow) {
    rig.contactShadow.position.set(0, 0.022, Math.sin(lean) * 0.16);
    rig.contactShadow.rotation.z = w.pitch || 0;
    const shadowStretchZ = 1.0 + Math.abs(Math.sin(lean)) * 0.34;
    const shadowStretchX = 1.0 - Math.min(0.22, wheelie * 0.35);
    rig.contactShadow.scale.set(shadowStretchX, 1.0, shadowStretchZ);
  }
}
