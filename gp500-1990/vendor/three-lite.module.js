// High-Visual-Fidelity WebGL PBR + IBL Reflection + Shadow + Texture 3D Engine Module for GP500-1990
// Provides scene graph, procedural UV/normal primitives, textures, PBR/Clearcoat materials,
// instanced rendering, and split-screen viewports with full headless Node compatibility.

export const PCFShadowMap = 1;
export const PCFSoftShadowMap = 2;
export const BasicShadowMap = 0;

export const RepeatWrapping = 1000;
export const ClampToEdgeWrapping = 1001;
export const MirroredRepeatWrapping = 1002;

export const NearestFilter = 1003;
export const NearestMipmapNearestFilter = 1004;
export const NearestMipmapLinearFilter = 1005;
export const LinearFilter = 1006;
export const LinearMipmapNearestFilter = 1007;
export const LinearMipmapLinearFilter = 1008;

export const FrontSide = 0;
export const BackSide = 1;
export const DoubleSide = 2;

export const NoBlending = 0;
export const NormalBlending = 1;
export const AdditiveBlending = 2;
export const SubtractiveBlending = 3;
export const MultiplyBlending = 4;

export const RGBAFormat = 1023;
export const RGBFormat = 1022;
export const UnsignedByteType = 1009;

export const NoToneMapping = 0;
export const LinearToneMapping = 1;
export const ReinhardToneMapping = 2;
export const CineonToneMapping = 3;
export const ACESFilmicToneMapping = 4;

export const SRGBColorSpace = 'srgb';
export const LinearSRGBColorSpace = 'srgb-linear';

export const MathUtils = {
  clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  },
  lerp(a, b, t) {
    return a + (b - a) * t;
  },
  degToRad(deg) {
    return (deg * Math.PI) / 180;
  },
  radToDeg(rad) {
    return (rad * 180) / Math.PI;
  },
  randFloat(lo, hi) {
    return lo + Math.random() * (hi - lo);
  },
  randFloatSpread(range) {
    return range * (0.5 - Math.random());
  }
};

export class Vector2 {
  constructor(x = 0, y = 0) {
    this.isVector2 = true;
    this.x = x;
    this.y = y;
  }
  set(x, y) {
    this.x = x;
    this.y = y ?? x;
    return this;
  }
  setScalar(s) {
    this.x = s;
    this.y = s;
    return this;
  }
  copy(v) {
    this.x = v.x;
    this.y = v.y;
    return this;
  }
  clone() {
    return new Vector2(this.x, this.y);
  }
  add(v) {
    this.x += v.x;
    this.y += v.y;
    return this;
  }
  sub(v) {
    this.x -= v.x;
    this.y -= v.y;
    return this;
  }
  multiplyScalar(s) {
    this.x *= s;
    this.y *= s;
    return this;
  }
  length() {
    return Math.hypot(this.x, this.y);
  }
  normalize() {
    const len = Math.hypot(this.x, this.y) || 1;
    this.x /= len;
    this.y /= len;
    return this;
  }
  distanceTo(v) {
    return Math.hypot(this.x - v.x, this.y - v.y);
  }
}

export class Vector3 {
  constructor(x = 0, y = 0, z = 0) {
    this.isVector3 = true;
    this.x = x;
    this.y = y;
    this.z = z;
  }
  set(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }
  setScalar(s) {
    this.x = s;
    this.y = s;
    this.z = s;
    return this;
  }
  copy(v) {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }
  clone() {
    return new Vector3(this.x, this.y, this.z);
  }
  add(v) {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }
  addVectors(a, b) {
    this.x = a.x + b.x;
    this.y = a.y + b.y;
    this.z = a.z + b.z;
    return this;
  }
  addScaledVector(v, s) {
    this.x += v.x * s;
    this.y += v.y * s;
    this.z += v.z * s;
    return this;
  }
  sub(v) {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    return this;
  }
  subVectors(a, b) {
    this.x = a.x - b.x;
    this.y = a.y - b.y;
    this.z = a.z - b.z;
    return this;
  }
  multiplyScalar(s) {
    this.x *= s;
    this.y *= s;
    this.z *= s;
    return this;
  }
  divideScalar(s) {
    const inv = s !== 0 ? 1 / s : 1;
    this.x *= inv;
    this.y *= inv;
    this.z *= inv;
    return this;
  }
  dot(v) {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }
  cross(v) {
    const ax = this.x, ay = this.y, az = this.z;
    this.x = ay * v.z - az * v.y;
    this.y = az * v.x - ax * v.z;
    this.z = ax * v.y - ay * v.x;
    return this;
  }
  crossVectors(a, b) {
    this.x = a.y * b.z - a.z * b.y;
    this.y = a.z * b.x - a.x * b.z;
    this.z = a.x * b.y - a.y * b.x;
    return this;
  }
  length() {
    return Math.hypot(this.x, this.y, this.z);
  }
  lengthSq() {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }
  normalize() {
    const len = Math.hypot(this.x, this.y, this.z) || 1;
    this.x /= len;
    this.y /= len;
    this.z /= len;
    return this;
  }
  distanceTo(v) {
    return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z);
  }
  lerp(v, t) {
    this.x += (v.x - this.x) * t;
    this.y += (v.y - this.y) * t;
    this.z += (v.z - this.z) * t;
    return this;
  }
  applyMatrix4(m) {
    const x = this.x, y = this.y, z = this.z;
    const e = m.elements;
    const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15] || 1);
    this.x = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w;
    this.y = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w;
    this.z = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w;
    return this;
  }
}

export class Euler {
  constructor(x = 0, y = 0, z = 0, order = 'XYZ') {
    this.isEuler = true;
    this.x = x;
    this.y = y;
    this.z = z;
    this.order = order;
  }
  set(x, y, z, order = this.order) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.order = order;
    return this;
  }
  copy(e) {
    this.x = e.x;
    this.y = e.y;
    this.z = e.z;
    this.order = e.order || 'XYZ';
    return this;
  }
  clone() {
    return new Euler(this.x, this.y, this.z, this.order);
  }
}

export class Quaternion {
  constructor(x = 0, y = 0, z = 0, w = 1) {
    this.isQuaternion = true;
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
  }
  set(x, y, z, w) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
    return this;
  }
  identity() {
    return this.set(0, 0, 0, 1);
  }
  copy(q) {
    this.x = q.x;
    this.y = q.y;
    this.z = q.z;
    this.w = q.w;
    return this;
  }
  clone() {
    return new Quaternion(this.x, this.y, this.z, this.w);
  }
  setFromAxisAngle(axis, angle) {
    const half = angle / 2;
    const s = Math.sin(half);
    this.x = axis.x * s;
    this.y = axis.y * s;
    this.z = axis.z * s;
    this.w = Math.cos(half);
    return this;
  }
  setFromEuler(euler) {
    const c1 = Math.cos(euler.x / 2);
    const c2 = Math.cos(euler.y / 2);
    const c3 = Math.cos(euler.z / 2);
    const s1 = Math.sin(euler.x / 2);
    const s2 = Math.sin(euler.y / 2);
    const s3 = Math.sin(euler.z / 2);
    this.x = s1 * c2 * c3 + c1 * s2 * s3;
    this.y = c1 * s2 * c3 - s1 * c2 * s3;
    this.z = c1 * c2 * s3 + s1 * s2 * c3;
    this.w = c1 * c2 * c3 - s1 * s2 * s3;
    return this;
  }
}

export class Color {
  constructor(r = 0xffffff, g, b) {
    this.isColor = true;
    this.r = 1;
    this.g = 1;
    this.b = 1;
    if (g !== undefined && b !== undefined) {
      this.setRGB(r, g, b);
    } else {
      this.set(r);
    }
  }
  set(val, g, b) {
    if (g !== undefined && b !== undefined) {
      return this.setRGB(val, g, b);
    }
    if (typeof val === 'number') {
      return this.setHex(val);
    }
    if (typeof val === 'string') {
      return this.setStyle(val);
    }
    if (val && typeof val === 'object') {
      this.r = val.r ?? 1;
      this.g = val.g ?? 1;
      this.b = val.b ?? 1;
    }
    return this;
  }
  setRGB(r, g, b) {
    this.r = r;
    this.g = g;
    this.b = b;
    return this;
  }
  setScalar(s) {
    this.r = s;
    this.g = s;
    this.b = s;
    return this;
  }
  setHex(hex) {
    const n = Math.floor(Number(hex) || 0) & 0xffffff;
    this.r = ((n >> 16) & 255) / 255;
    this.g = ((n >> 8) & 255) / 255;
    this.b = (n & 255) / 255;
    return this;
  }
  setStyle(style) {
    if (typeof style !== 'string') return this;
    const s = style.trim();
    if (s.startsWith('#')) {
      const hexStr = s.slice(1);
      if (hexStr.length === 3) {
        const r = parseInt(hexStr[0] + hexStr[0], 16);
        const g = parseInt(hexStr[1] + hexStr[1], 16);
        const b = parseInt(hexStr[2] + hexStr[2], 16);
        return this.setRGB(r / 255, g / 255, b / 255);
      }
      if (hexStr.length >= 6) {
        return this.setHex(parseInt(hexStr.slice(0, 6), 16));
      }
    }
    const m = s.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
    if (m) {
      return this.setRGB(Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255);
    }
    return this;
  }
  getHex() {
    const r = Math.round(MathUtils.clamp(this.r, 0, 1) * 255);
    const g = Math.round(MathUtils.clamp(this.g, 0, 1) * 255);
    const b = Math.round(MathUtils.clamp(this.b, 0, 1) * 255);
    return (r << 16) | (g << 8) | b;
  }
  getHexString() {
    return this.getHex().toString(16).padStart(6, '0');
  }
  getStyle() {
    return `#${this.getHexString()}`;
  }
  copy(c) {
    if (c) {
      this.r = c.r;
      this.g = c.g;
      this.b = c.b;
    }
    return this;
  }
  clone() {
    return new Color(this.r, this.g, this.b);
  }
  lerp(c, t) {
    this.r += (c.r - this.r) * t;
    this.g += (c.g - this.g) * t;
    this.b += (c.b - this.b) * t;
    return this;
  }
  multiplyScalar(s) {
    this.r *= s;
    this.g *= s;
    this.b *= s;
    return this;
  }
}

function matMul4(out, a, b) {
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

  for (let col = 0; col < 4; col++) {
    const idx = col * 4;
    const b0 = b[idx], b1 = b[idx + 1], b2 = b[idx + 2], b3 = b[idx + 3];
    out[idx] = a00 * b0 + a10 * b1 + a20 * b2 + a30 * b3;
    out[idx + 1] = a01 * b0 + a11 * b1 + a21 * b2 + a31 * b3;
    out[idx + 2] = a02 * b0 + a12 * b1 + a22 * b2 + a32 * b3;
    out[idx + 3] = a03 * b0 + a13 * b1 + a23 * b2 + a33 * b3;
  }
}

export class Matrix4 {
  constructor() {
    this.isMatrix4 = true;
    this.elements = new Float32Array(16);
    this.identity();
  }
  identity() {
    const e = this.elements;
    e.fill(0);
    e[0] = 1;
    e[5] = 1;
    e[10] = 1;
    e[15] = 1;
    return this;
  }
  copy(m) {
    this.elements.set(m.elements);
    return this;
  }
  clone() {
    return new Matrix4().copy(this);
  }
  multiply(m) {
    return this.multiplyMatrices(this, m);
  }
  premultiply(m) {
    return this.multiplyMatrices(m, this);
  }
  multiplyMatrices(a, b) {
    matMul4(this.elements, a.elements, b.elements);
    return this;
  }
  makeRotationX(rad) {
    this.identity();
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    this.elements[5] = c;
    this.elements[6] = s;
    this.elements[9] = -s;
    this.elements[10] = c;
    return this;
  }
  makeRotationY(rad) {
    this.identity();
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    this.elements[0] = c;
    this.elements[2] = -s;
    this.elements[8] = s;
    this.elements[10] = c;
    return this;
  }
  makeRotationZ(rad) {
    this.identity();
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    this.elements[0] = c;
    this.elements[1] = s;
    this.elements[4] = -s;
    this.elements[5] = c;
    return this;
  }
  makeRotationFromEuler(euler) {
    return this.composeTransform({ x: 0, y: 0, z: 0 }, euler, { x: 1, y: 1, z: 1 });
  }
  makeScale(x, y, z) {
    this.identity();
    this.elements[0] = x;
    this.elements[5] = y;
    this.elements[10] = z;
    return this;
  }
  makeTranslation(x, y, z) {
    this.identity();
    if (typeof x === 'object') {
      this.elements[12] = x.x;
      this.elements[13] = x.y;
      this.elements[14] = x.z;
    } else {
      this.elements[12] = x;
      this.elements[13] = y;
      this.elements[14] = z;
    }
    return this;
  }
  scale(v) {
    const e = this.elements;
    const sx = v.x ?? 1, sy = v.y ?? 1, sz = v.z ?? 1;
    e[0] *= sx; e[1] *= sx; e[2] *= sx; e[3] *= sx;
    e[4] *= sy; e[5] *= sy; e[6] *= sy; e[7] *= sy;
    e[8] *= sz; e[9] *= sz; e[10] *= sz; e[11] *= sz;
    return this;
  }
  setPosition(x, y, z) {
    if (typeof x === 'object') {
      this.elements[12] = x.x;
      this.elements[13] = x.y;
      this.elements[14] = x.z;
    } else {
      this.elements[12] = x;
      this.elements[13] = y;
      this.elements[14] = z;
    }
    return this;
  }
  compose(pos, quatOrEuler, scl) {
    if (quatOrEuler && quatOrEuler.isQuaternion && !quatOrEuler.isEuler) {
      const x = quatOrEuler.x, y = quatOrEuler.y, z = quatOrEuler.z, w = quatOrEuler.w;
      const x2 = x + x, y2 = y + y, z2 = z + z;
      const xx = x * x2, xy = x * y2, xz = x * z2;
      const yy = y * y2, yz = y * z2, zz = z * z2;
      const wx = w * x2, wy = w * y2, wz = w * z2;
      const sx = scl ? scl.x : 1, sy = scl ? scl.y : 1, sz = scl ? scl.z : 1;
      const e = this.elements;
      e[0] = (1 - (yy + zz)) * sx;
      e[1] = (xy + wz) * sx;
      e[2] = (xz - wy) * sx;
      e[3] = 0;
      e[4] = (xy - wz) * sy;
      e[5] = (1 - (xx + zz)) * sy;
      e[6] = (yz + wx) * sy;
      e[7] = 0;
      e[8] = (xz + wy) * sz;
      e[9] = (yz - wx) * sz;
      e[10] = (1 - (xx + yy)) * sz;
      e[11] = 0;
      e[12] = pos ? pos.x : 0;
      e[13] = pos ? pos.y : 0;
      e[14] = pos ? pos.z : 0;
      e[15] = 1;
      return this;
    }
    return this.composeTransform(
      pos || { x: 0, y: 0, z: 0 },
      quatOrEuler || { x: 0, y: 0, z: 0 },
      scl || { x: 1, y: 1, z: 1 }
    );
  }
  composeTransform(pos, rot, scl) {
    const cx = Math.cos(rot.x || 0), sx = Math.sin(rot.x || 0);
    const cy = Math.cos(rot.y || 0), sy = Math.sin(rot.y || 0);
    const cz = Math.cos(rot.z || 0), sz = Math.sin(rot.z || 0);

    // Intrinsic XYZ rotation: R = Rx * Ry * Rz
    const r00 = cy * cz;
    const r01 = sx * sy * cz + cx * sz;
    const r02 = -cx * sy * cz + sx * sz;

    const r10 = -cy * sz;
    const r11 = -sx * sy * sz + cx * cz;
    const r12 = cx * sy * sz + sx * cz;

    const r20 = sy;
    const r21 = -sx * cy;
    const r22 = cx * cy;

    const scx = scl.x ?? 1;
    const scy = scl.y ?? 1;
    const scz = scl.z ?? 1;

    const e = this.elements;
    e[0] = r00 * scx;
    e[1] = r01 * scx;
    e[2] = r02 * scx;
    e[3] = 0;

    e[4] = r10 * scy;
    e[5] = r11 * scy;
    e[6] = r12 * scy;
    e[7] = 0;

    e[8] = r20 * scz;
    e[9] = r21 * scz;
    e[10] = r22 * scz;
    e[11] = 0;

    e[12] = pos.x || 0;
    e[13] = pos.y || 0;
    e[14] = pos.z || 0;
    e[15] = 1;
    return this;
  }
}

export class Object3D {
  constructor() {
    this.isObject3D = true;
    this.name = '';
    this.position = new Vector3(0, 0, 0);
    this.rotation = new Euler(0, 0, 0);
    this.quaternion = new Quaternion();
    this.scale = new Vector3(1, 1, 1);
    this.up = new Vector3(0, 1, 0);
    this.children = [];
    this.parent = null;
    this.visible = true;
    this.castShadow = false;
    this.receiveShadow = false;
    this.renderOrder = 0;
    this.frustumCulled = true;
    this.userData = {};
    this.matrix = new Matrix4();
    this.matrixWorld = new Matrix4();
    this.matrixAutoUpdate = true;
  }
  add(...objs) {
    for (const o of objs) {
      if (!o || o === this) continue;
      if (o.parent) o.parent.remove(o);
      o.parent = this;
      this.children.push(o);
    }
    return this;
  }
  remove(...objs) {
    for (const o of objs) {
      const idx = this.children.indexOf(o);
      if (idx !== -1) {
        o.parent = null;
        this.children.splice(idx, 1);
      }
    }
    return this;
  }
  clear() {
    for (let i = 0; i < this.children.length; i++) {
      this.children[i].parent = null;
    }
    this.children.length = 0;
    return this;
  }
  traverse(cb) {
    cb(this);
    for (let i = 0; i < this.children.length; i++) {
      this.children[i].traverse(cb);
    }
  }
  lookAt(tx, ty, tz) {
    if (typeof tx === 'object') {
      ty = tx.y;
      tz = tx.z;
      tx = tx.x;
    }
    const dx = tx - this.position.x;
    const dy = ty - this.position.y;
    const dz = tz - this.position.z;
    this.rotation.y = Math.atan2(dx, dz);
    this.rotation.x = -Math.atan2(dy, Math.hypot(dx, dz) || 1);
    return this;
  }
  updateMatrix() {
    this.matrix.composeTransform(this.position, this.rotation, this.scale);
  }
  updateMatrixWorld() {
    if (this.matrixAutoUpdate) {
      this.updateMatrix();
    }
    if (this.parent) {
      this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
    } else {
      this.matrixWorld.copy(this.matrix);
    }
    for (let i = 0; i < this.children.length; i++) {
      this.children[i].updateMatrixWorld();
    }
  }
  clone(recursive = true) {
    const c = new this.constructor();
    c.name = this.name;
    c.position.copy(this.position);
    c.rotation.copy(this.rotation);
    c.scale.copy(this.scale);
    c.visible = this.visible;
    c.castShadow = this.castShadow;
    c.receiveShadow = this.receiveShadow;
    c.renderOrder = this.renderOrder;
    c.frustumCulled = this.frustumCulled;
    c.userData = { ...this.userData };
    if (recursive) {
      for (const ch of this.children) {
        if (typeof ch.clone === 'function') c.add(ch.clone(true));
      }
    }
    return c;
  }
}

export class Group extends Object3D {
  constructor() {
    super();
    this.isGroup = true;
  }
}

export class Scene extends Object3D {
  constructor() {
    super();
    this.isScene = true;
    this.background = new Color(0x6ea8e5);
    this.fog = null;
    this.environment = null;
  }
}

export class Fog {
  constructor(color = 0x8ec2f2, near = 120, far = 650) {
    this.isFog = true;
    this.color = new Color(color);
    this.near = near;
    this.far = far;
  }
}

export class FogExp2 {
  constructor(color = 0x8ec2f2, density = 0.002) {
    this.isFogExp2 = true;
    this.color = new Color(color);
    this.density = density;
    this.near = 140;
    this.far = Math.max(280, Math.min(900, 1.8 / Math.max(0.0005, density)));
  }
}

export class AmbientLight extends Object3D {
  constructor(color = 0xffffff, intensity = 0.7) {
    super();
    this.isLight = true;
    this.isAmbientLight = true;
    this.color = new Color(color);
    this.intensity = intensity;
  }
}

export class HemisphereLight extends Object3D {
  constructor(skyColor = 0xffffff, groundColor = 0x444444, intensity = 1.0) {
    super();
    this.isLight = true;
    this.isHemisphereLight = true;
    this.color = new Color(skyColor);
    this.groundColor = new Color(groundColor);
    this.intensity = intensity;
  }
}

export class DirectionalLight extends Object3D {
  constructor(color = 0xffffff, intensity = 0.9) {
    super();
    this.isLight = true;
    this.isDirectionalLight = true;
    this.color = new Color(color);
    this.intensity = intensity;
    this.target = new Object3D();
    this.shadow = {
      mapSize: new Vector2(1024, 1024),
      bias: -0.0005,
      normalBias: 0.02,
      radius: 1,
      camera: {
        near: 0.5,
        far: 500,
        left: -120,
        right: 120,
        top: 120,
        bottom: -120,
        updateProjectionMatrix() {}
      }
    };
  }
}

export class PointLight extends Object3D {
  constructor(color = 0xffffff, intensity = 1.0, distance = 0, decay = 2) {
    super();
    this.isLight = true;
    this.isPointLight = true;
    this.color = new Color(color);
    this.intensity = intensity;
    this.distance = distance;
    this.decay = decay;
    this.shadow = { mapSize: new Vector2(512, 512), bias: 0, camera: { near: 0.5, far: 500 } };
  }
}

export class SpotLight extends Object3D {
  constructor(color = 0xffffff, intensity = 1.0, distance = 0, angle = Math.PI / 3, penumbra = 0, decay = 2) {
    super();
    this.isLight = true;
    this.isSpotLight = true;
    this.color = new Color(color);
    this.intensity = intensity;
    this.distance = distance;
    this.angle = angle;
    this.penumbra = penumbra;
    this.decay = decay;
    this.target = new Object3D();
    this.shadow = { mapSize: new Vector2(512, 512), bias: 0, camera: { near: 0.5, far: 500 } };
  }
}

export class PerspectiveCamera extends Object3D {
  constructor(fov = 60, aspect = 1.77, near = 0.5, far = 900) {
    super();
    this.isCamera = true;
    this.isPerspectiveCamera = true;
    this.fov = fov;
    this.aspect = aspect;
    this.near = near;
    this.far = far;
    this.up = new Vector3(0, 1, 0);
    this.projectionMatrix = new Matrix4();
    this.viewMatrix = new Matrix4();
    this.matrixWorldInverse = this.viewMatrix;
    this.updateProjectionMatrix();
  }
  updateProjectionMatrix() {
    const f = 1.0 / Math.tan((this.fov * Math.PI) / 360);
    const nf = 1.0 / (this.near - this.far);
    const e = this.projectionMatrix.elements;
    e.fill(0);
    e[0] = f / Math.max(0.01, this.aspect);
    e[5] = f;
    e[10] = (this.far + this.near) * nf;
    e[11] = -1;
    e[14] = 2 * this.far * this.near * nf;
    return this;
  }
  lookAt(tx, ty, tz) {
    if (typeof tx === 'object') {
      ty = tx.y;
      tz = tx.z;
      tx = tx.x;
    }
    const ex = this.position.x;
    const ey = this.position.y;
    const ez = this.position.z;

    let zx = ex - tx;
    let zy = ey - ty;
    let zz = ez - tz;
    const zLen = Math.hypot(zx, zy, zz) || 1;
    zx /= zLen;
    zy /= zLen;
    zz /= zLen;

    let xx = this.up.y * zz - this.up.z * zy;
    let xy = this.up.z * zx - this.up.x * zz;
    let xz = this.up.x * zy - this.up.y * zx;
    const xLen = Math.hypot(xx, xy, xz) || 1;
    xx /= xLen;
    xy /= xLen;
    xz /= xLen;

    const yx = zy * xz - zz * xy;
    const yy = zz * xx - zx * xz;
    const yz = zx * xy - zy * xx;

    const e = this.viewMatrix.elements;
    e[0] = xx;
    e[4] = xy;
    e[8] = xz;
    e[12] = -(xx * ex + xy * ey + xz * ez);

    e[1] = yx;
    e[5] = yy;
    e[9] = yz;
    e[13] = -(yx * ex + yy * ey + yz * ez);

    e[2] = zx;
    e[6] = zy;
    e[10] = zz;
    e[14] = -(zx * ex + zy * ey + zz * ez);

    e[3] = 0;
    e[7] = 0;
    e[11] = 0;
    e[15] = 1;
    return this;
  }
}

// ---------------------------------------------------------------------------
// TEXTURES
// ---------------------------------------------------------------------------
export class Texture {
  constructor(image = null) {
    this.isTexture = true;
    this.image = image;
    this.wrapS = RepeatWrapping;
    this.wrapT = RepeatWrapping;
    this.repeat = new Vector2(1, 1);
    this.offset = new Vector2(0, 0);
    this.center = new Vector2(0, 0);
    this.rotation = 0;
    this.magFilter = LinearFilter;
    this.minFilter = LinearMipmapLinearFilter;
    this.anisotropy = 4;
    this.colorSpace = SRGBColorSpace;
    this.flipY = true;
    this.needsUpdate = true;
    this._glTexture = null;
    this._glContext = null;
  }
  clone() {
    const t = new Texture(this.image);
    t.wrapS = this.wrapS;
    t.wrapT = this.wrapT;
    t.repeat.copy(this.repeat);
    t.offset.copy(this.offset);
    t.center.copy(this.center);
    t.rotation = this.rotation;
    t.magFilter = this.magFilter;
    t.minFilter = this.minFilter;
    t.anisotropy = this.anisotropy;
    t.colorSpace = this.colorSpace;
    t.flipY = this.flipY;
    t.needsUpdate = true;
    return t;
  }
  dispose() {
    if (this._glTexture && this._glContext) {
      try {
        this._glContext.deleteTexture(this._glTexture);
      } catch (_e) {
        // ignore
      }
    }
    this._glTexture = null;
  }
}

export class CanvasTexture extends Texture {
  constructor(canvas = null) {
    super(canvas);
    this.isCanvasTexture = true;
    this.needsUpdate = true;
  }
}

export class DataTexture extends Texture {
  constructor(data = null, width = 1, height = 1, format = RGBAFormat, type = UnsignedByteType) {
    super({ data, width, height });
    this.isDataTexture = true;
    this.format = format;
    this.type = type;
    this.flipY = false;
    this.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// BUFFER ATTRIBUTES & GEOMETRIES
// ---------------------------------------------------------------------------
export class Float32BufferAttribute {
  constructor(array, itemSize = 3) {
    this.isBufferAttribute = true;
    this.array = array instanceof Float32Array ? array : new Float32Array(array || []);
    this.itemSize = itemSize;
    this.count = Math.floor(this.array.length / itemSize);
    this.needsUpdate = false;
  }
  getX(i) {
    return this.array[i * this.itemSize];
  }
  getY(i) {
    return this.array[i * this.itemSize + 1];
  }
  getZ(i) {
    return this.array[i * this.itemSize + 2];
  }
  setXY(i, x, y) {
    const idx = i * this.itemSize;
    this.array[idx] = x;
    this.array[idx + 1] = y;
    return this;
  }
  setXYZ(i, x, y, z) {
    const idx = i * this.itemSize;
    this.array[idx] = x;
    this.array[idx + 1] = y;
    this.array[idx + 2] = z;
    return this;
  }
  clone() {
    return new Float32BufferAttribute(new Float32Array(this.array), this.itemSize);
  }
}

export class Uint16BufferAttribute {
  constructor(array, itemSize = 1) {
    this.isBufferAttribute = true;
    this.array = array instanceof Uint16Array ? array : new Uint16Array(array || []);
    this.itemSize = itemSize;
    this.count = Math.floor(this.array.length / itemSize);
    this.needsUpdate = false;
  }
}

export class Uint32BufferAttribute {
  constructor(array, itemSize = 1) {
    this.isBufferAttribute = true;
    this.array = array instanceof Uint32Array ? array : new Uint32Array(array || []);
    this.itemSize = itemSize;
    this.count = Math.floor(this.array.length / itemSize);
    this.needsUpdate = false;
  }
}

export class BufferGeometry {
  constructor() {
    this.isBufferGeometry = true;
    this.attributes = {};
    this.index = null;
    this.boundingBox = null;
    this.boundingSphere = null;
    this._gpuBuffers = null;
  }
  setAttribute(name, attr) {
    this.attributes[name] = attr;
    this._gpuBuffers = null;
    return this;
  }
  getAttribute(name) {
    return this.attributes[name];
  }
  deleteAttribute(name) {
    delete this.attributes[name];
    this._gpuBuffers = null;
    return this;
  }
  setIndex(index) {
    if (Array.isArray(index)) {
      this.index = new Uint32BufferAttribute(index, 1);
    } else {
      this.index = index;
    }
    this._gpuBuffers = null;
    return this;
  }
  computeVertexNormals() {
    const posAttr = this.attributes.position;
    if (!posAttr) return this;
    const pos = posAttr.array;
    const nrm = new Float32Array(pos.length);

    if (this.index && this.index.array) {
      const idx = this.index.array;
      for (let i = 0; i + 2 < idx.length; i += 3) {
        const i0 = idx[i] * 3;
        const i1 = idx[i + 1] * 3;
        const i2 = idx[i + 2] * 3;
        const ux = pos[i1] - pos[i0], uy = pos[i1 + 1] - pos[i0 + 1], uz = pos[i1 + 2] - pos[i0 + 2];
        const vx = pos[i2] - pos[i0], vy = pos[i2 + 1] - pos[i0 + 1], vz = pos[i2 + 2] - pos[i0 + 2];
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        nrm[i0] += nx; nrm[i0 + 1] += ny; nrm[i0 + 2] += nz;
        nrm[i1] += nx; nrm[i1 + 1] += ny; nrm[i1 + 2] += nz;
        nrm[i2] += nx; nrm[i2 + 1] += ny; nrm[i2 + 2] += nz;
      }
      for (let i = 0; i < nrm.length; i += 3) {
        const len = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1;
        nrm[i] /= len;
        nrm[i + 1] /= len;
        nrm[i + 2] /= len;
      }
    } else {
      for (let i = 0; i + 8 < pos.length; i += 9) {
        const ux = pos[i + 3] - pos[i], uy = pos[i + 4] - pos[i + 1], uz = pos[i + 5] - pos[i + 2];
        const vx = pos[i + 6] - pos[i], vy = pos[i + 7] - pos[i + 1], vz = pos[i + 8] - pos[i + 2];
        let nx = uy * vz - uz * vy;
        let ny = uz * vx - ux * vz;
        let nz = ux * vy - uy * vx;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len; ny /= len; nz /= len;
        nrm[i] = nx; nrm[i + 1] = ny; nrm[i + 2] = nz;
        nrm[i + 3] = nx; nrm[i + 4] = ny; nrm[i + 5] = nz;
        nrm[i + 6] = nx; nrm[i + 7] = ny; nrm[i + 8] = nz;
      }
    }

    this.setAttribute('normal', new Float32BufferAttribute(nrm, 3));
    return this;
  }
  translate(x = 0, y = 0, z = 0) {
    const posAttr = this.attributes.position;
    if (posAttr) {
      const a = posAttr.array;
      for (let i = 0; i < a.length; i += 3) {
        a[i] += x;
        a[i + 1] += y;
        a[i + 2] += z;
      }
      posAttr.needsUpdate = true;
    }
    this._gpuBuffers = null;
    return this;
  }
  scale(x = 1, y = 1, z = 1) {
    const posAttr = this.attributes.position;
    if (posAttr) {
      const a = posAttr.array;
      for (let i = 0; i < a.length; i += 3) {
        a[i] *= x;
        a[i + 1] *= y;
        a[i + 2] *= z;
      }
      posAttr.needsUpdate = true;
    }
    const nrmAttr = this.attributes.normal;
    if (nrmAttr) {
      const n = nrmAttr.array;
      const ix = x !== 0 ? 1 / x : 1;
      const iy = y !== 0 ? 1 / y : 1;
      const iz = z !== 0 ? 1 / z : 1;
      for (let i = 0; i < n.length; i += 3) {
        const nx = n[i] * ix;
        const ny = n[i + 1] * iy;
        const nz = n[i + 2] * iz;
        const len = Math.hypot(nx, ny, nz) || 1;
        n[i] = nx / len;
        n[i + 1] = ny / len;
        n[i + 2] = nz / len;
      }
      nrmAttr.needsUpdate = true;
    }
    this._gpuBuffers = null;
    return this;
  }
  rotateX(rad) {
    const c = Math.cos(rad), s = Math.sin(rad);
    for (const key of ['position', 'normal']) {
      const attr = this.attributes[key];
      if (!attr) continue;
      const a = attr.array;
      for (let i = 0; i < a.length; i += 3) {
        const y = a[i + 1], z = a[i + 2];
        a[i + 1] = c * y - s * z;
        a[i + 2] = s * y + c * z;
      }
      attr.needsUpdate = true;
    }
    this._gpuBuffers = null;
    return this;
  }
  rotateY(rad) {
    const c = Math.cos(rad), s = Math.sin(rad);
    for (const key of ['position', 'normal']) {
      const attr = this.attributes[key];
      if (!attr) continue;
      const a = attr.array;
      for (let i = 0; i < a.length; i += 3) {
        const x = a[i], z = a[i + 2];
        a[i] = c * x + s * z;
        a[i + 2] = -s * x + c * z;
      }
      attr.needsUpdate = true;
    }
    this._gpuBuffers = null;
    return this;
  }
  rotateZ(rad) {
    const c = Math.cos(rad), s = Math.sin(rad);
    for (const key of ['position', 'normal']) {
      const attr = this.attributes[key];
      if (!attr) continue;
      const a = attr.array;
      for (let i = 0; i < a.length; i += 3) {
        const x = a[i], y = a[i + 1];
        a[i] = c * x - s * y;
        a[i + 1] = s * x + c * y;
      }
      attr.needsUpdate = true;
    }
    this._gpuBuffers = null;
    return this;
  }
  center() {
    this.computeBoundingBox();
    if (this.boundingBox) {
      const cx = (this.boundingBox.min.x + this.boundingBox.max.x) * 0.5;
      const cy = (this.boundingBox.min.y + this.boundingBox.max.y) * 0.5;
      const cz = (this.boundingBox.min.z + this.boundingBox.max.z) * 0.5;
      this.translate(-cx, -cy, -cz);
    }
    return this;
  }
  computeBoundingBox() {
    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    const pos = this.attributes.position?.array;
    if (pos && pos.length >= 3) {
      for (let i = 0; i < pos.length; i += 3) {
        if (pos[i] < min.x) min.x = pos[i];
        if (pos[i + 1] < min.y) min.y = pos[i + 1];
        if (pos[i + 2] < min.z) min.z = pos[i + 2];
        if (pos[i] > max.x) max.x = pos[i];
        if (pos[i + 1] > max.y) max.y = pos[i + 1];
        if (pos[i + 2] > max.z) max.z = pos[i + 2];
      }
    } else {
      min.set(0, 0, 0);
      max.set(0, 0, 0);
    }
    this.boundingBox = { min, max };
    return this;
  }
  computeBoundingSphere() {
    this.computeBoundingBox();
    const { min, max } = this.boundingBox;
    const center = new Vector3(
      (min.x + max.x) * 0.5,
      (min.y + max.y) * 0.5,
      (min.z + max.z) * 0.5
    );
    const radius = center.distanceTo(max);
    this.boundingSphere = { center, radius };
    return this;
  }
  clone() {
    const g = new BufferGeometry();
    for (const [k, v] of Object.entries(this.attributes)) {
      g.setAttribute(k, v.clone ? v.clone() : new Float32BufferAttribute(new Float32Array(v.array), v.itemSize));
    }
    if (this.index) {
      g.setIndex(new Uint32BufferAttribute(new Uint32Array(this.index.array), 1));
    }
    return g;
  }
  dispose() {
    this._gpuBuffers = null;
  }
}

function pushVertex(pos, nrm, uv, p, n, t) {
  pos.push(p[0], p[1], p[2]);
  nrm.push(n[0], n[1], n[2]);
  uv.push(t[0], t[1]);
}

export class BoxGeometry extends BufferGeometry {
  constructor(w = 1, h = 1, d = 1, widthSegments = 1, heightSegments = 1, depthSegments = 1) {
    super();
    const pos = [];
    const nrm = [];
    const uv = [];

    const buildPlane = (uIdx, vIdx, wIdx, uDir, vDir, width, height, depth, gridX, gridY) => {
      const segW = width / gridX;
      const segH = height / gridY;
      const hw = width / 2;
      const hh = height / 2;
      const hd = depth / 2;
      const normal = [0, 0, 0];
      normal[wIdx] = depth > 0 ? 1 : -1;

      const makePt = (ix, iy) => {
        const p = [0, 0, 0];
        p[uIdx] = (ix * segW - hw) * uDir;
        p[vIdx] = (iy * segH - hh) * vDir;
        p[wIdx] = hd;
        return p;
      };

      for (let iy = 0; iy < gridY; iy++) {
        for (let ix = 0; ix < gridX; ix++) {
          const p00 = makePt(ix, iy);
          const p10 = makePt(ix + 1, iy);
          const p01 = makePt(ix, iy + 1);
          const p11 = makePt(ix + 1, iy + 1);

          const u0 = ix / gridX, u1 = (ix + 1) / gridX;
          const v0 = 1 - iy / gridY, v1 = 1 - (iy + 1) / gridY;

          pushVertex(pos, nrm, uv, p00, normal, [u0, v0]);
          pushVertex(pos, nrm, uv, p01, normal, [u0, v1]);
          pushVertex(pos, nrm, uv, p10, normal, [u1, v0]);

          pushVertex(pos, nrm, uv, p01, normal, [u0, v1]);
          pushVertex(pos, nrm, uv, p11, normal, [u1, v1]);
          pushVertex(pos, nrm, uv, p10, normal, [u1, v0]);
        }
      }
    };

    const ws = Math.max(1, Math.floor(widthSegments));
    const hs = Math.max(1, Math.floor(heightSegments));
    const ds = Math.max(1, Math.floor(depthSegments));

    buildPlane(2, 1, 0, -1, -1, d, h, w, ds, hs);  // +X
    buildPlane(2, 1, 0, 1, -1, d, h, -w, ds, hs);  // -X
    buildPlane(0, 2, 1, 1, 1, w, d, h, ws, ds);    // +Y
    buildPlane(0, 2, 1, 1, -1, w, d, -h, ws, ds);  // -Y
    buildPlane(0, 1, 2, 1, -1, w, h, d, ws, hs);   // +Z
    buildPlane(0, 1, 2, -1, -1, w, h, -d, ws, hs); // -Z

    this.setAttribute('position', new Float32BufferAttribute(pos, 3));
    this.setAttribute('normal', new Float32BufferAttribute(nrm, 3));
    this.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  }
}

export class PlaneGeometry extends BufferGeometry {
  constructor(w = 1, h = 1, widthSegments = 1, heightSegments = 1) {
    super();
    const hw = w / 2;
    const hh = h / 2;
    const gridX = Math.max(1, Math.floor(widthSegments));
    const gridY = Math.max(1, Math.floor(heightSegments));
    const segW = w / gridX;
    const segH = h / gridY;

    const pos = [];
    const nrm = [];
    const uv = [];
    const normal = [0, 0, 1];

    for (let iy = 0; iy < gridY; iy++) {
      const y0 = hh - iy * segH;
      const y1 = hh - (iy + 1) * segH;
      const v0 = 1 - iy / gridY;
      const v1 = 1 - (iy + 1) / gridY;

      for (let ix = 0; ix < gridX; ix++) {
        const x0 = -hw + ix * segW;
        const x1 = -hw + (ix + 1) * segW;
        const u0 = ix / gridX;
        const u1 = (ix + 1) / gridX;

        pushVertex(pos, nrm, uv, [x0, y0, 0], normal, [u0, v0]);
        pushVertex(pos, nrm, uv, [x0, y1, 0], normal, [u0, v1]);
        pushVertex(pos, nrm, uv, [x1, y0, 0], normal, [u1, v0]);

        pushVertex(pos, nrm, uv, [x0, y1, 0], normal, [u0, v1]);
        pushVertex(pos, nrm, uv, [x1, y1, 0], normal, [u1, v1]);
        pushVertex(pos, nrm, uv, [x1, y0, 0], normal, [u1, v0]);
      }
    }

    this.setAttribute('position', new Float32BufferAttribute(pos, 3));
    this.setAttribute('normal', new Float32BufferAttribute(nrm, 3));
    this.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  }
}

export class CylinderGeometry extends BufferGeometry {
  constructor(
    radiusTop = 0.5,
    radiusBottom = 0.5,
    height = 1,
    radialSegments = 16,
    heightSegments = 1,
    openEnded = false,
    thetaStart = 0,
    thetaLength = Math.PI * 2
  ) {
    super();
    const rSeg = Math.max(3, Math.floor(radialSegments));
    const hSeg = Math.max(1, Math.floor(heightSegments));
    const hy = height / 2;
    const slope = (radiusBottom - radiusTop) / Math.max(1e-6, height);

    const pos = [];
    const nrm = [];
    const uv = [];

    const sideVertex = (u, v) => {
      const theta = thetaStart + u * thetaLength;
      const sinT = Math.sin(theta);
      const cosT = Math.cos(theta);
      const r = v * (radiusBottom - radiusTop) + radiusTop;
      const y = hy - v * height;
      const p = [r * sinT, y, r * cosT];
      const nLen = Math.hypot(sinT, slope, cosT) || 1;
      const n = [sinT / nLen, slope / nLen, cosT / nLen];
      return { p, n, t: [u, 1 - v] };
    };

    for (let y = 0; y < hSeg; y++) {
      const v0 = y / hSeg;
      const v1 = (y + 1) / hSeg;
      for (let x = 0; x < rSeg; x++) {
        const u0 = x / rSeg;
        const u1 = (x + 1) / rSeg;

        const a = sideVertex(u0, v0);
        const b = sideVertex(u0, v1);
        const c = sideVertex(u1, v1);
        const d = sideVertex(u1, v0);

        pushVertex(pos, nrm, uv, a.p, a.n, a.t);
        pushVertex(pos, nrm, uv, b.p, b.n, b.t);
        pushVertex(pos, nrm, uv, d.p, d.n, d.t);

        pushVertex(pos, nrm, uv, b.p, b.n, b.t);
        pushVertex(pos, nrm, uv, c.p, c.n, c.t);
        pushVertex(pos, nrm, uv, d.p, d.n, d.t);
      }
    }

    if (!openEnded) {
      if (radiusTop > 0) {
        const topN = [0, 1, 0];
        for (let x = 0; x < rSeg; x++) {
          const u0 = x / rSeg;
          const u1 = (x + 1) / rSeg;
          const t0 = thetaStart + u0 * thetaLength;
          const t1 = thetaStart + u1 * thetaLength;
          const s0 = Math.sin(t0), c0 = Math.cos(t0);
          const s1 = Math.sin(t1), c1 = Math.cos(t1);

          pushVertex(pos, nrm, uv, [0, hy, 0], topN, [0.5, 0.5]);
          pushVertex(pos, nrm, uv, [radiusTop * s0, hy, radiusTop * c0], topN, [0.5 + 0.5 * s0, 0.5 + 0.5 * c0]);
          pushVertex(pos, nrm, uv, [radiusTop * s1, hy, radiusTop * c1], topN, [0.5 + 0.5 * s1, 0.5 + 0.5 * c1]);
        }
      }
      if (radiusBottom > 0) {
        const botN = [0, -1, 0];
        for (let x = 0; x < rSeg; x++) {
          const u0 = x / rSeg;
          const u1 = (x + 1) / rSeg;
          const t0 = thetaStart + u0 * thetaLength;
          const t1 = thetaStart + u1 * thetaLength;
          const s0 = Math.sin(t0), c0 = Math.cos(t0);
          const s1 = Math.sin(t1), c1 = Math.cos(t1);

          pushVertex(pos, nrm, uv, [0, -hy, 0], botN, [0.5, 0.5]);
          pushVertex(pos, nrm, uv, [radiusBottom * s1, -hy, radiusBottom * c1], botN, [0.5 + 0.5 * s1, 0.5 - 0.5 * c1]);
          pushVertex(pos, nrm, uv, [radiusBottom * s0, -hy, radiusBottom * c0], botN, [0.5 + 0.5 * s0, 0.5 - 0.5 * c0]);
        }
      }
    }

    this.setAttribute('position', new Float32BufferAttribute(pos, 3));
    this.setAttribute('normal', new Float32BufferAttribute(nrm, 3));
    this.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  }
}

export class ConeGeometry extends CylinderGeometry {
  constructor(
    radius = 0.5,
    height = 1,
    radialSegments = 16,
    heightSegments = 1,
    openEnded = false,
    thetaStart = 0,
    thetaLength = Math.PI * 2
  ) {
    super(0, radius, height, radialSegments, heightSegments, openEnded, thetaStart, thetaLength);
  }
}

export class SphereGeometry extends BufferGeometry {
  constructor(
    radius = 0.5,
    widthSegments = 16,
    heightSegments = 12,
    phiStart = 0,
    phiLength = Math.PI * 2,
    thetaStart = 0,
    thetaLength = Math.PI
  ) {
    super();
    const wSeg = Math.max(3, Math.floor(widthSegments));
    const hSeg = Math.max(2, Math.floor(heightSegments));
    const pos = [];
    const nrm = [];
    const uv = [];

    const sphereVertex = (u, v) => {
      const phi = phiStart + u * phiLength;
      const theta = thetaStart + v * thetaLength;
      const nx = -Math.cos(phi) * Math.sin(theta);
      const ny = Math.cos(theta);
      const nz = Math.sin(phi) * Math.sin(theta);
      const len = Math.hypot(nx, ny, nz) || 1;
      const n = [nx / len, ny / len, nz / len];
      const p = [radius * nx, radius * ny, radius * nz];
      return { p, n, t: [u, 1 - v] };
    };

    for (let iy = 0; iy < hSeg; iy++) {
      const v0 = iy / hSeg;
      const v1 = (iy + 1) / hSeg;
      for (let ix = 0; ix < wSeg; ix++) {
        const u0 = ix / wSeg;
        const u1 = (ix + 1) / wSeg;

        const v00 = sphereVertex(u0, v0);
        const v10 = sphereVertex(u1, v0);
        const v01 = sphereVertex(u0, v1);
        const v11 = sphereVertex(u1, v1);

        pushVertex(pos, nrm, uv, v00.p, v00.n, v00.t);
        pushVertex(pos, nrm, uv, v01.p, v01.n, v01.t);
        pushVertex(pos, nrm, uv, v11.p, v11.n, v11.t);

        pushVertex(pos, nrm, uv, v00.p, v00.n, v00.t);
        pushVertex(pos, nrm, uv, v11.p, v11.n, v11.t);
        pushVertex(pos, nrm, uv, v10.p, v10.n, v10.t);
      }
    }

    this.setAttribute('position', new Float32BufferAttribute(pos, 3));
    this.setAttribute('normal', new Float32BufferAttribute(nrm, 3));
    this.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  }
}

export class TorusGeometry extends BufferGeometry {
  constructor(radius = 1, tube = 0.2, radialSegments = 12, tubularSegments = 24, arc = Math.PI * 2) {
    super();
    const rSeg = Math.max(3, Math.floor(radialSegments));
    const tSeg = Math.max(3, Math.floor(tubularSegments));
    const pos = [];
    const nrm = [];
    const uv = [];

    const torusVertex = (uFrac, vFrac) => {
      const u = uFrac * arc;
      const v = vFrac * Math.PI * 2;
      const cosU = Math.cos(u), sinU = Math.sin(u);
      const cosV = Math.cos(v), sinV = Math.sin(v);

      const x = (radius + tube * cosV) * cosU;
      const y = (radius + tube * cosV) * sinU;
      const z = tube * sinV;

      const nx = cosV * cosU;
      const ny = cosV * sinU;
      const nz = sinV;
      const len = Math.hypot(nx, ny, nz) || 1;
      return {
        p: [x, y, z],
        n: [nx / len, ny / len, nz / len],
        t: [uFrac, vFrac]
      };
    };

    for (let j = 0; j < rSeg; j++) {
      const v0 = j / rSeg;
      const v1 = (j + 1) / rSeg;
      for (let i = 0; i < tSeg; i++) {
        const u0 = i / tSeg;
        const u1 = (i + 1) / tSeg;

        const a = torusVertex(u0, v0);
        const b = torusVertex(u1, v0);
        const c = torusVertex(u0, v1);
        const d = torusVertex(u1, v1);

        pushVertex(pos, nrm, uv, a.p, a.n, a.t);
        pushVertex(pos, nrm, uv, b.p, b.n, b.t);
        pushVertex(pos, nrm, uv, c.p, c.n, c.t);

        pushVertex(pos, nrm, uv, b.p, b.n, b.t);
        pushVertex(pos, nrm, uv, d.p, d.n, d.t);
        pushVertex(pos, nrm, uv, c.p, c.n, c.t);
      }
    }

    this.setAttribute('position', new Float32BufferAttribute(pos, 3));
    this.setAttribute('normal', new Float32BufferAttribute(nrm, 3));
    this.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  }
}

export class LatheGeometry extends BufferGeometry {
  constructor(points = null, segments = 16, phiStart = 0, phiLength = Math.PI * 2) {
    super();
    const rawPts =
      Array.isArray(points) && points.length >= 2
        ? points
        : [
            new Vector2(0.01, -0.5),
            new Vector2(0.45, 0.0),
            new Vector2(0.01, 0.5)
          ];

    const pts = rawPts.map((pt) => {
      if (Array.isArray(pt)) return { x: Math.abs(pt[0] || 0), y: pt[1] || 0 };
      return { x: Math.abs(pt.x || 0), y: pt.y || 0 };
    });

    const segs = Math.max(3, Math.floor(segments));
    const nPts = pts.length;

    // Precompute smooth 2D profile normals (nr, ny)
    const profNormals = new Array(nPts);
    for (let j = 0; j < nPts; j++) {
      const pPrev = pts[Math.max(0, j - 1)];
      const pNext = pts[Math.min(nPts - 1, j + 1)];
      const dr = pNext.x - pPrev.x;
      const dy = pNext.y - pPrev.y;
      let nr = dy;
      let ny = -dr;
      if (nr < 0 && dy < 0) {
        nr = -dy;
        ny = dr;
      }
      const len = Math.hypot(nr, ny) || 1;
      profNormals[j] = { nr: nr / len, ny: ny / len };
    }

    const latheVertex = (uFrac, j) => {
      const phi = phiStart + uFrac * phiLength;
      const sinP = Math.sin(phi);
      const cosP = Math.cos(phi);
      const pt = pts[j];
      const pn = profNormals[j];
      const x = pt.x * sinP;
      const y = pt.y;
      const z = pt.x * cosP;

      const nx = pn.nr * sinP;
      const ny = pn.ny;
      const nz = pn.nr * cosP;
      const len = Math.hypot(nx, ny, nz) || 1;
      const vFrac = j / Math.max(1, nPts - 1);
      return {
        p: [x, y, z],
        n: [nx / len, ny / len, nz / len],
        t: [uFrac, vFrac]
      };
    };

    const pos = [];
    const nrm = [];
    const uv = [];

    for (let i = 0; i < segs; i++) {
      const u0 = i / segs;
      const u1 = (i + 1) / segs;
      for (let j = 0; j < nPts - 1; j++) {
        const a = latheVertex(u0, j);
        const b = latheVertex(u1, j);
        const c = latheVertex(u0, j + 1);
        const d = latheVertex(u1, j + 1);

        pushVertex(pos, nrm, uv, a.p, a.n, a.t);
        pushVertex(pos, nrm, uv, b.p, b.n, b.t);
        pushVertex(pos, nrm, uv, c.p, c.n, c.t);

        pushVertex(pos, nrm, uv, b.p, b.n, b.t);
        pushVertex(pos, nrm, uv, d.p, d.n, d.t);
        pushVertex(pos, nrm, uv, c.p, c.n, c.t);
      }
    }

    this.setAttribute('position', new Float32BufferAttribute(pos, 3));
    this.setAttribute('normal', new Float32BufferAttribute(nrm, 3));
    this.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  }
}

export class RingGeometry extends BufferGeometry {
  constructor(
    innerRadius = 0.25,
    outerRadius = 0.5,
    thetaSegments = 16,
    phiSegments = 1,
    thetaStart = 0,
    thetaLength = Math.PI * 2
  ) {
    super();
    const tSeg = Math.max(3, Math.floor(thetaSegments));
    const pSeg = Math.max(1, Math.floor(phiSegments));
    const pos = [];
    const nrm = [];
    const uv = [];
    const normal = [0, 0, 1];
    const rMax = Math.max(outerRadius, 1e-4);

    const ringVertex = (r, theta) => {
      const x = r * Math.cos(theta);
      const y = r * Math.sin(theta);
      return {
        p: [x, y, 0],
        t: [(x / rMax + 1) * 0.5, (y / rMax + 1) * 0.5]
      };
    };

    for (let j = 0; j < pSeg; j++) {
      const r0 = innerRadius + (j / pSeg) * (outerRadius - innerRadius);
      const r1 = innerRadius + ((j + 1) / pSeg) * (outerRadius - innerRadius);
      for (let i = 0; i < tSeg; i++) {
        const t0 = thetaStart + (i / tSeg) * thetaLength;
        const t1 = thetaStart + ((i + 1) / tSeg) * thetaLength;

        const a = ringVertex(r0, t0);
        const b = ringVertex(r1, t0);
        const c = ringVertex(r0, t1);
        const d = ringVertex(r1, t1);

        pushVertex(pos, nrm, uv, a.p, normal, a.t);
        pushVertex(pos, nrm, uv, b.p, normal, b.t);
        pushVertex(pos, nrm, uv, c.p, normal, c.t);

        pushVertex(pos, nrm, uv, b.p, normal, b.t);
        pushVertex(pos, nrm, uv, d.p, normal, d.t);
        pushVertex(pos, nrm, uv, c.p, normal, c.t);
      }
    }

    this.setAttribute('position', new Float32BufferAttribute(pos, 3));
    this.setAttribute('normal', new Float32BufferAttribute(nrm, 3));
    this.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  }
}

export class CircleGeometry extends RingGeometry {
  constructor(radius = 0.5, segments = 16, thetaStart = 0, thetaLength = Math.PI * 2) {
    super(0, radius, segments, 1, thetaStart, thetaLength);
  }
}

export class CapsuleGeometry extends BufferGeometry {
  constructor(radius = 0.25, length = 0.5, capSegments = 6, radialSegments = 12) {
    super();
    const cSeg = Math.max(2, Math.floor(capSegments));
    const rSeg = Math.max(4, Math.floor(radialSegments));
    const halfL = length * 0.5;
    const pts = [];
    for (let i = 0; i <= cSeg; i++) {
      const a = -Math.PI / 2 + (i / cSeg) * (Math.PI / 2);
      pts.push(new Vector2(radius * Math.cos(a), -halfL + radius * Math.sin(a)));
    }
    for (let i = 0; i <= cSeg; i++) {
      const a = (i / cSeg) * (Math.PI / 2);
      pts.push(new Vector2(radius * Math.cos(a), halfL + radius * Math.sin(a)));
    }
    const lathe = new LatheGeometry(pts, rSeg);
    this.setAttribute('position', lathe.getAttribute('position'));
    this.setAttribute('normal', lathe.getAttribute('normal'));
    this.setAttribute('uv', lathe.getAttribute('uv'));
  }
}

export class IcosahedronGeometry extends SphereGeometry {
  constructor(radius = 0.5, detail = 0) {
    const segs = Math.max(6, (detail + 1) * 6);
    super(radius, segs, Math.max(4, Math.floor(segs * 0.75)));
  }
}

export class OctahedronGeometry extends SphereGeometry {
  constructor(radius = 0.5, detail = 0) {
    const segs = Math.max(4, (detail + 1) * 4);
    super(radius, segs, Math.max(3, segs));
  }
}

export class DodecahedronGeometry extends SphereGeometry {
  constructor(radius = 0.5, detail = 0) {
    const segs = Math.max(8, (detail + 1) * 8);
    super(radius, segs, Math.max(6, Math.floor(segs * 0.75)));
  }
}

// ---------------------------------------------------------------------------
// MATERIALS
// ---------------------------------------------------------------------------
export class MeshBasicMaterial {
  constructor(opts = {}) {
    this.isMaterial = true;
    this.isMeshBasicMaterial = true;
    this.color = new Color(opts.color ?? 0xffffff);
    this.map = opts.map ?? null;
    this.vertexColors = Boolean(opts.vertexColors);
    this.roughness = opts.roughness ?? 0.45;
    this.metalness = opts.metalness ?? 0.0;
    this.clearcoat = opts.clearcoat ?? 0.0;
    this.clearcoatRoughness = opts.clearcoatRoughness ?? 0.1;
    this.reflectivity = opts.reflectivity ?? 0.5;
    this.emissive = new Color(opts.emissive ?? 0x000000);
    this.emissiveIntensity = opts.emissiveIntensity ?? 1.0;
    this.transparent = Boolean(opts.transparent);
    this.opacity = opts.opacity ?? 1.0;
    this.side = opts.side ?? FrontSide;
    this.depthWrite = opts.depthWrite !== undefined ? Boolean(opts.depthWrite) : true;
    this.depthTest = opts.depthTest !== undefined ? Boolean(opts.depthTest) : true;
    this.polygonOffset = Boolean(opts.polygonOffset);
    this.polygonOffsetFactor = opts.polygonOffsetFactor ?? -1;
    this.polygonOffsetUnits = opts.polygonOffsetUnits ?? -1;
    this.blending = opts.blending ?? NormalBlending;
    this.flatShading = Boolean(opts.flatShading);
    this.wireframe = Boolean(opts.wireframe);
    this.fog = opts.fog !== undefined ? Boolean(opts.fog) : true;
    this.unlit = true;
    this.needsUpdate = false;
  }
  setValues(values = {}) {
    for (const [k, v] of Object.entries(values)) {
      if (v === undefined) continue;
      if ((k === 'color' || k === 'emissive') && this[k] && this[k].isColor) {
        this[k].set(v);
      } else {
        this[k] = v;
      }
    }
    return this;
  }
  clone() {
    const m = new this.constructor();
    m.color.copy(this.color);
    m.map = this.map;
    m.vertexColors = this.vertexColors;
    m.roughness = this.roughness;
    m.metalness = this.metalness;
    m.clearcoat = this.clearcoat;
    m.clearcoatRoughness = this.clearcoatRoughness;
    m.reflectivity = this.reflectivity;
    m.emissive.copy(this.emissive);
    m.emissiveIntensity = this.emissiveIntensity;
    m.transparent = this.transparent;
    m.opacity = this.opacity;
    m.side = this.side;
    m.depthWrite = this.depthWrite;
    m.depthTest = this.depthTest;
    m.polygonOffset = this.polygonOffset;
    m.polygonOffsetFactor = this.polygonOffsetFactor;
    m.polygonOffsetUnits = this.polygonOffsetUnits;
    m.blending = this.blending;
    m.flatShading = this.flatShading;
    m.wireframe = this.wireframe;
    m.fog = this.fog;
    m.unlit = this.unlit;
    return m;
  }
  dispose() {}
}

export class MeshLambertMaterial extends MeshBasicMaterial {
  constructor(opts = {}) {
    super(opts);
    this.isMeshLambertMaterial = true;
    this.unlit = false;
    this.roughness = opts.roughness ?? 0.68;
  }
}

export class MeshPhongMaterial extends MeshLambertMaterial {
  constructor(opts = {}) {
    super(opts);
    this.isMeshPhongMaterial = true;
    this.shininess = opts.shininess ?? 30;
    this.specular = new Color(opts.specular ?? 0x222222);
    this.roughness =
      opts.roughness ?? MathUtils.clamp(1.0 - Math.sqrt(this.shininess / 140), 0.14, 0.78);
  }
}

export class MeshStandardMaterial extends MeshLambertMaterial {
  constructor(opts = {}) {
    super(opts);
    this.isMeshStandardMaterial = true;
    this.roughness = opts.roughness ?? 0.45;
    this.metalness = opts.metalness ?? 0.0;
  }
}

export class MeshPhysicalMaterial extends MeshStandardMaterial {
  constructor(opts = {}) {
    super(opts);
    this.isMeshPhysicalMaterial = true;
    this.clearcoat = opts.clearcoat ?? 0.0;
    this.clearcoatRoughness = opts.clearcoatRoughness ?? 0.1;
    this.reflectivity = opts.reflectivity ?? 0.5;
    this.ior = opts.ior ?? 1.5;
  }
}

export class SpriteMaterial extends MeshBasicMaterial {}
export class PointsMaterial extends MeshBasicMaterial {}
export class LineBasicMaterial extends MeshBasicMaterial {}

// ---------------------------------------------------------------------------
// MESH & INSTANCED MESH
// ---------------------------------------------------------------------------
export class Mesh extends Object3D {
  constructor(geometry = new BufferGeometry(), material = new MeshBasicMaterial()) {
    super();
    this.isMesh = true;
    this.geometry = geometry;
    this.material = material;
  }
}

export class InstancedMesh extends Mesh {
  constructor(geometry, material, count = 1) {
    super(geometry, material);
    this.isInstancedMesh = true;
    this.count = count;
    this.instanceMatrix = new Float32Array(count * 16);
    this.instanceMatrix.array = this.instanceMatrix;
    this.instanceMatrix.needsUpdate = false;
    this.instanceColor = { needsUpdate: false };
    this.instanceColors = new Array(count);
    const ident = new Matrix4();
    for (let i = 0; i < count; i++) {
      this.instanceMatrix.set(ident.elements, i * 16);
      this.instanceColors[i] = null;
    }
  }
  setMatrixAt(index, mat) {
    if (index >= 0 && index < this.count && mat && mat.elements) {
      this.instanceMatrix.set(mat.elements, index * 16);
    }
  }
  getMatrixAt(index, mat) {
    if (index >= 0 && index < this.count && mat && mat.elements) {
      mat.elements.set(this.instanceMatrix.subarray(index * 16, index * 16 + 16));
    }
  }
  setColorAt(index, color) {
    if (index >= 0 && index < this.count && color) {
      this.instanceColors[index] = color.clone ? color.clone() : new Color(color);
    }
  }
}

// ---------------------------------------------------------------------------
// SHADERS: PBR (Cook-Torrance GGX) + Clearcoat + IBL Sky/Ground Reflection + ACES
// ---------------------------------------------------------------------------
const VS_SRC = `
attribute vec3 aPos;
attribute vec3 aNrm;
attribute vec3 aCol;
attribute vec2 aUv;
uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProj;
varying vec3 vWorldPos;
varying vec3 vNrm;
varying vec3 vCol;
varying vec2 vUv;
varying float vDepth;
void main() {
  vec4 worldPos = uModel * vec4(aPos, 1.0);
  vec4 viewPos = uView * worldPos;
  gl_Position = uProj * viewPos;
  vWorldPos = worldPos.xyz;

  vec3 c0 = uModel[0].xyz / max(dot(uModel[0].xyz, uModel[0].xyz), 1e-6);
  vec3 c1 = uModel[1].xyz / max(dot(uModel[1].xyz, uModel[1].xyz), 1e-6);
  vec3 c2 = uModel[2].xyz / max(dot(uModel[2].xyz, uModel[2].xyz), 1e-6);
  vec3 nWorld = mat3(c0, c1, c2) * aNrm;
  vNrm = length(nWorld) > 1e-5 ? normalize(nWorld) : vec3(0.0, 1.0, 0.0);

  vCol = aCol;
  vUv = aUv;
  vDepth = length(viewPos.xyz);
}
`;

const FS_SRC = `
precision highp float;
varying vec3 vWorldPos;
varying vec3 vNrm;
varying vec3 vCol;
varying vec2 vUv;
varying float vDepth;

uniform vec3 uBaseCol;
uniform float uUseVertCol;
uniform float uUnlit;
uniform float uOpacity;
uniform float uRoughness;
uniform float uMetalness;
uniform float uClearcoat;
uniform float uClearcoatRoughness;
uniform float uReflectivity;
uniform vec3 uEmissive;
uniform float uEmissiveIntensity;

uniform float uHasMap;
uniform sampler2D uMap;
uniform vec2 uUvRepeat;
uniform vec2 uUvOffset;

uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uHemiSkyCol;
uniform vec3 uHemiGroundCol;
uniform vec3 uAmbientCol;

uniform vec3 uFogCol;
uniform float uFogNear;
uniform float uFogFar;
uniform float uUseFog;

void main() {
  vec3 baseColor = mix(uBaseCol, uBaseCol * vCol, uUseVertCol);
  float alpha = uOpacity;

  if (uHasMap > 0.5) {
    vec2 uv = vUv * uUvRepeat + uUvOffset;
    vec4 tex = texture2D(uMap, uv);
    baseColor *= tex.rgb;
    alpha *= tex.a;
  }

  if (alpha < 0.01) discard;

  if (uUnlit > 0.5) {
    vec3 col = baseColor + uEmissive * uEmissiveIntensity;
    if (uUseFog > 0.5 && vDepth < 480.0) {
      float f = clamp((vDepth - uFogNear) / max(1.0, uFogFar - uFogNear), 0.0, 1.0);
      f = f * f * (3.0 - 2.0 * f);
      float hAtten = clamp(1.0 - max(0.0, vWorldPos.y - 25.0) / 150.0, 0.0, 1.0);
      col = mix(col, uFogCol, f * hAtten);
    }
    gl_FragColor = vec4(col, alpha);
    return;
  }

  vec3 albedo = pow(max(baseColor, vec3(0.0)), vec3(1.38));

  vec3 N = normalize(vNrm);
  if (!gl_FrontFacing) {
    N = -N;
  }
  vec3 V = normalize(uCamPos - vWorldPos);
  vec3 L = normalize(uSunDir);
  vec3 H = normalize(V + L);

  float NdotL = max(dot(N, L), 0.0);
  float NdotV = max(dot(N, V), 0.001);
  float NdotH = max(dot(N, H), 0.0);
  float VdotH = max(dot(V, H), 0.0);

  float rough = clamp(uRoughness, 0.04, 1.0);
  float metal = clamp(uMetalness, 0.0, 1.0);
  float dielecF0 = 0.08 * clamp(uReflectivity, 0.1, 1.0);
  vec3 F0 = mix(vec3(dielecF0), albedo, metal);

  // Cook-Torrance GGX Microfacet Specular
  float a = rough * rough;
  float a2 = a * a;
  float denom = NdotH * NdotH * (a2 - 1.0) + 1.0;
  float D = a2 / max(3.14159265 * denom * denom, 0.0001);

  float k = (rough + 1.0) * (rough + 1.0) * 0.125;
  float G1V = NdotV / (NdotV * (1.0 - k) + k);
  float G1L = NdotL / (NdotL * (1.0 - k) + k);
  float G = G1V * G1L;

  vec3 F = F0 + (1.0 - F0) * pow(1.0 - VdotH, 5.0);
  vec3 specBRDF = (D * G * F) / max(4.0 * NdotV * NdotL, 0.001);

  vec3 kD = (vec3(1.0) - F) * (1.0 - metal);
  float wrapDiff = max((dot(N, L) + 0.14) / 1.14, 0.0);
  vec3 directLight = (kD * albedo * (wrapDiff * 0.78) + specBRDF * NdotL) * uSunCol;

  // Automotive Clearcoat Layer (1990 glossy GP fairing paint, helmets & visors)
  if (uClearcoat > 0.01) {
    float ccRough = clamp(uClearcoatRoughness, 0.03, 1.0);
    float ccA = ccRough * ccRough;
    float ccA2 = ccA * ccA;
    float ccDenom = NdotH * NdotH * (ccA2 - 1.0) + 1.0;
    float ccD = ccA2 / max(3.14159265 * ccDenom * ccDenom, 0.0001);
    float ccF = 0.04 + 0.96 * pow(1.0 - VdotH, 5.0);
    float ccSpec = (ccD * ccF * 0.25) * NdotL * uClearcoat;
    directLight += uSunCol * ccSpec;
  }

  // Hemisphere Sky/Ground Diffuse Fill
  float hemiFactor = N.y * 0.5 + 0.5;
  vec3 hemiIrr = mix(uHemiGroundCol, uHemiSkyCol, hemiFactor) + uAmbientCol * 0.38;
  vec3 ambientDiffuse = kD * albedo * hemiIrr * 0.65;

  // Procedural Hemisphere IBL Environment Reflection (R = reflect(-V, N))
  vec3 R = reflect(-V, N);
  vec3 skyZenith = vec3(0.11, 0.30, 0.66);
  vec3 skyHorizon = vec3(0.80, 0.89, 0.99);
  vec3 groundBounce = vec3(0.15, 0.16, 0.18);
  vec3 envCol;
  if (R.y >= 0.0) {
    envCol = mix(skyHorizon, skyZenith, pow(clamp(R.y, 0.0, 1.0), 0.55));
    float sunDisk = pow(max(dot(R, L), 0.0), mix(140.0, 10.0, rough));
    envCol += uSunCol * sunDisk * (1.0 - rough * 0.72) * 0.65;
  } else {
    envCol = mix(skyHorizon * 0.62, groundBounce, clamp(-R.y * 3.2, 0.0, 1.0));
  }
  vec3 fresnelIBL = F0 + (max(vec3(1.0 - rough), F0) - F0) * pow(1.0 - NdotV, 5.0);
  float iblWeight = clamp(metal * 0.95 + uClearcoat * 0.65 + (1.0 - rough) * 0.35, 0.0, 1.0);
  vec3 iblSpec = envCol * fresnelIBL * iblWeight;

  // Ground Contact Ambient Occlusion & Micro-Shadowing
  float groundAO = clamp(0.80 + 0.20 * clamp(vWorldPos.y * 1.6, 0.0, 1.0) + 0.08 * max(N.y, 0.0), 0.74, 1.04);

  vec3 color = (directLight + ambientDiffuse + iblSpec) * groundAO + uEmissive * uEmissiveIntensity;

  // ACES Filmic Tone Mapping + sRGB Gamma Correction
  vec3 x = color * 1.08;
  color = clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  color = pow(color, vec3(1.0 / 1.38));

  // Atmospheric Distance Fog
  if (uUseFog > 0.5) {
    float fogFactor = clamp((vDepth - uFogNear) / max(1.0, uFogFar - uFogNear), 0.0, 1.0);
    fogFactor = fogFactor * fogFactor * (3.0 - 2.0 * fogFactor);
    float heightAtten = clamp(1.0 - max(0.0, vWorldPos.y - 25.0) / 150.0, 0.0, 1.0);
    color = mix(color, uFogCol, fogFactor * heightAtten);
  }

  gl_FragColor = vec4(color, alpha);
}
`;

function isPowerOfTwo(v) {
  return v > 0 && (v & (v - 1)) === 0;
}

export class WebGLRenderer {
  constructor(opts = {}) {
    this.domElement =
      opts.canvas ||
      (typeof document !== 'undefined'
        ? document.createElement('canvas')
        : { width: 1280, height: 720, style: {} });
    this.pixelRatio = 1;
    this.clearColor = new Color(0x6ea8e5);
    this.scissorTest = false;
    this.shadowMap = {
      enabled: false,
      type: PCFSoftShadowMap
    };
    this.toneMapping = ACESFilmicToneMapping;
    this.toneMappingExposure = 1.0;
    this.outputColorSpace = SRGBColorSpace;
    this.gl = null;
    this.prog = null;
    this.locs = null;
    this._anisoExt = null;

    if (typeof this.domElement.getContext === 'function') {
      try {
        this.gl =
          this.domElement.getContext('webgl', {
            antialias: opts.antialias !== false,
            powerPreference: opts.powerPreference || 'high-performance'
          }) || this.domElement.getContext('experimental-webgl');
      } catch (_e) {
        this.gl = null;
      }
    }
    if (this.gl) {
      this._initProgram();
    }
  }

  _initProgram() {
    const gl = this.gl;
    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const vs = compile(gl.VERTEX_SHADER, VS_SRC);
    const fs = compile(gl.FRAGMENT_SHADER, FS_SRC);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.useProgram(prog);
    this.prog = prog;

    try {
      this._anisoExt =
        gl.getExtension('EXT_texture_filter_anisotropic') ||
        gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic') ||
        gl.getExtension('MOZ_EXT_texture_filter_anisotropic');
    } catch (_e) {
      this._anisoExt = null;
    }

    this.locs = {
      aPos: gl.getAttribLocation(prog, 'aPos'),
      aNrm: gl.getAttribLocation(prog, 'aNrm'),
      aCol: gl.getAttribLocation(prog, 'aCol'),
      aUv: gl.getAttribLocation(prog, 'aUv'),
      uModel: gl.getUniformLocation(prog, 'uModel'),
      uView: gl.getUniformLocation(prog, 'uView'),
      uProj: gl.getUniformLocation(prog, 'uProj'),
      uBaseCol: gl.getUniformLocation(prog, 'uBaseCol'),
      uUseVertCol: gl.getUniformLocation(prog, 'uUseVertCol'),
      uUnlit: gl.getUniformLocation(prog, 'uUnlit'),
      uOpacity: gl.getUniformLocation(prog, 'uOpacity'),
      uRoughness: gl.getUniformLocation(prog, 'uRoughness'),
      uMetalness: gl.getUniformLocation(prog, 'uMetalness'),
      uClearcoat: gl.getUniformLocation(prog, 'uClearcoat'),
      uClearcoatRoughness: gl.getUniformLocation(prog, 'uClearcoatRoughness'),
      uReflectivity: gl.getUniformLocation(prog, 'uReflectivity'),
      uEmissive: gl.getUniformLocation(prog, 'uEmissive'),
      uEmissiveIntensity: gl.getUniformLocation(prog, 'uEmissiveIntensity'),
      uHasMap: gl.getUniformLocation(prog, 'uHasMap'),
      uMap: gl.getUniformLocation(prog, 'uMap'),
      uUvRepeat: gl.getUniformLocation(prog, 'uUvRepeat'),
      uUvOffset: gl.getUniformLocation(prog, 'uUvOffset'),
      uCamPos: gl.getUniformLocation(prog, 'uCamPos'),
      uSunDir: gl.getUniformLocation(prog, 'uSunDir'),
      uSunCol: gl.getUniformLocation(prog, 'uSunCol'),
      uHemiSkyCol: gl.getUniformLocation(prog, 'uHemiSkyCol'),
      uHemiGroundCol: gl.getUniformLocation(prog, 'uHemiGroundCol'),
      uAmbientCol: gl.getUniformLocation(prog, 'uAmbientCol'),
      uFogCol: gl.getUniformLocation(prog, 'uFogCol'),
      uFogNear: gl.getUniformLocation(prog, 'uFogNear'),
      uFogFar: gl.getUniformLocation(prog, 'uFogFar'),
      uUseFog: gl.getUniformLocation(prog, 'uUseFog')
    };

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  setPixelRatio(r = 1) {
    this.pixelRatio = r || 1;
  }

  setSize(w, h) {
    this.domElement.width = Math.max(1, Math.floor(w * this.pixelRatio));
    this.domElement.height = Math.max(1, Math.floor(h * this.pixelRatio));
    if (this.gl) {
      this.gl.viewport(0, 0, this.domElement.width, this.domElement.height);
    }
  }

  setViewport(x, y, w, h) {
    if (this.gl) {
      this.gl.viewport(Math.floor(x), Math.floor(y), Math.floor(w), Math.floor(h));
    }
  }

  setScissor(x, y, w, h) {
    if (this.gl) {
      this.gl.scissor(Math.floor(x), Math.floor(y), Math.floor(w), Math.floor(h));
    }
  }

  setScissorTest(enable) {
    this.scissorTest = Boolean(enable);
    if (this.gl) {
      if (this.scissorTest) {
        this.gl.enable(this.gl.SCISSOR_TEST);
      } else {
        this.gl.disable(this.gl.SCISSOR_TEST);
      }
    }
  }

  setClearColor(color) {
    this.clearColor.set(color);
  }

  clear() {
    if (!this.gl) return;
    const gl = this.gl;
    gl.depthMask(true);
    gl.clearColor(this.clearColor.r, this.clearColor.g, this.clearColor.b, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }

  _ensureTexture(tex) {
    if (!tex || !this.gl) return null;
    const gl = this.gl;
    if (tex._glTexture && tex._glContext === gl && !tex.needsUpdate) {
      return tex._glTexture;
    }

    const img = tex.image;
    if (!img || img.isMockCanvas) {
      return null;
    }

    if (!tex._glTexture || tex._glContext !== gl) {
      tex._glTexture = gl.createTexture();
      tex._glContext = gl;
    }

    gl.bindTexture(gl.TEXTURE_2D, tex._glTexture);
    try {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, tex.flipY !== false ? 1 : 0);
    } catch (_e) {
      // ignore
    }

    let uploaded = false;
    const w = img.width || 0;
    const h = img.height || 0;

    try {
      if (img.data && w > 0 && h > 0 && typeof img.getContext !== 'function') {
        const bytes =
          img.data instanceof Uint8Array
            ? img.data
            : new Uint8Array(img.data.buffer || img.data);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
        uploaded = true;
      } else {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        uploaded = true;
      }
    } catch (_e) {
      uploaded = false;
    }

    if (!uploaded) {
      return null;
    }

    const pot = isPowerOfTwo(w) && isPowerOfTwo(h);
    const mapWrap = (mode) => {
      if (!pot) return gl.CLAMP_TO_EDGE;
      if (mode === RepeatWrapping) return gl.REPEAT;
      if (mode === MirroredRepeatWrapping) return gl.MIRRORED_REPEAT;
      return gl.CLAMP_TO_EDGE;
    };

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, mapWrap(tex.wrapS));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, mapWrap(tex.wrapT));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    if (pot) {
      try {
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      } catch (_e) {
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      }
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }

    if (this._anisoExt && tex.anisotropy > 1) {
      try {
        const maxAniso = gl.getParameter(this._anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 4;
        gl.texParameterf(
          gl.TEXTURE_2D,
          this._anisoExt.TEXTURE_MAX_ANISOTROPY_EXT,
          Math.min(tex.anisotropy, maxAniso)
        );
      } catch (_e) {
        // ignore
      }
    }

    tex.needsUpdate = false;
    return tex._glTexture;
  }

  _ensureGeometryBuffers(geo) {
    const posAttr = geo.attributes.position;
    if (!posAttr) return null;
    const gl = this.gl;

    const createBuf = (arr) => {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
      return b;
    };

    if (geo._gpuBuffers && geo._gpuBuffers.gl === gl) {
      const gb = geo._gpuBuffers;
      if (posAttr.needsUpdate) {
        gl.bindBuffer(gl.ARRAY_BUFFER, gb.posBuf);
        gl.bufferData(gl.ARRAY_BUFFER, posAttr.array, gl.STATIC_DRAW);
        posAttr.needsUpdate = false;
      }
      if (geo.attributes.normal?.needsUpdate && gb.nrmBuf) {
        gl.bindBuffer(gl.ARRAY_BUFFER, gb.nrmBuf);
        gl.bufferData(gl.ARRAY_BUFFER, geo.attributes.normal.array, gl.STATIC_DRAW);
        geo.attributes.normal.needsUpdate = false;
      }
      if (geo.attributes.color?.needsUpdate && gb.colBuf) {
        gl.bindBuffer(gl.ARRAY_BUFFER, gb.colBuf);
        gl.bufferData(gl.ARRAY_BUFFER, geo.attributes.color.array, gl.STATIC_DRAW);
        geo.attributes.color.needsUpdate = false;
      }
      if (geo.attributes.uv?.needsUpdate && gb.uvBuf) {
        gl.bindBuffer(gl.ARRAY_BUFFER, gb.uvBuf);
        gl.bufferData(gl.ARRAY_BUFFER, geo.attributes.uv.array, gl.STATIC_DRAW);
        geo.attributes.uv.needsUpdate = false;
      }
      return gb;
    }

    const posBuf = createBuf(posAttr.array);
    const nrmAttr = geo.attributes.normal;
    const nrmBuf = nrmAttr ? createBuf(nrmAttr.array) : null;
    const colAttr = geo.attributes.color;
    const colBuf = colAttr ? createBuf(colAttr.array) : null;
    const uvAttr = geo.attributes.uv;
    const uvBuf = uvAttr ? createBuf(uvAttr.array) : null;

    let idxBuf = null;
    let idxCount = 0;
    let idxType = gl.UNSIGNED_SHORT;
    if (geo.index && geo.index.array && geo.index.array.length > 0) {
      idxBuf = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
      const u16 =
        geo.index.array instanceof Uint16Array
          ? geo.index.array
          : new Uint16Array(geo.index.array);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, u16, gl.STATIC_DRAW);
      idxCount = u16.length;
    }

    geo._gpuBuffers = {
      gl,
      posBuf,
      nrmBuf,
      colBuf,
      uvBuf,
      idxBuf,
      idxCount,
      idxType,
      count: posAttr.count
    };
    return geo._gpuBuffers;
  }

  render(scene, camera) {
    if (!scene || !camera) return;
    scene.updateMatrixWorld();
    camera.updateProjectionMatrix();

    if (!this.gl || !this.prog) return;
    const gl = this.gl;
    const L = this.locs;

    // Extract lighting from scene graph
    let sunDirX = 0.45, sunDirY = 0.82, sunDirZ = 0.35;
    let sunColR = 1.05, sunColG = 0.99, sunColB = 0.88;
    let hemiSkyR = 0.62, hemiSkyG = 0.80, hemiSkyB = 0.98;
    let hemiGndR = 0.25, hemiGndG = 0.28, hemiGndB = 0.26;
    let ambR = 0.55, ambG = 0.62, ambB = 0.72;

    const opaqueNodes = [];
    const transparentNodes = [];

    const collectScene = (node) => {
      if (!node || !node.visible) return;
      if (node.isDirectionalLight) {
        const px = node.position.x, py = node.position.y, pz = node.position.z;
        const len = Math.hypot(px, py, pz) || 1;
        sunDirX = px / len;
        sunDirY = py / len;
        sunDirZ = pz / len;
        const inten = node.intensity ?? 1.0;
        sunColR = node.color.r * inten;
        sunColG = node.color.g * inten;
        sunColB = node.color.b * inten;
      } else if (node.isHemisphereLight) {
        const inten = node.intensity ?? 1.0;
        hemiSkyR = node.color.r * inten;
        hemiSkyG = node.color.g * inten;
        hemiSkyB = node.color.b * inten;
        hemiGndR = node.groundColor.r * inten;
        hemiGndG = node.groundColor.g * inten;
        hemiGndB = node.groundColor.b * inten;
      } else if (node.isAmbientLight) {
        const inten = node.intensity ?? 0.7;
        ambR = node.color.r * inten;
        ambG = node.color.g * inten;
        ambB = node.color.b * inten;
      } else if (node.isMesh && node.geometry && node.material) {
        if (node.material.transparent || (node.material.opacity ?? 1) < 0.999) {
          transparentNodes.push(node);
        } else {
          opaqueNodes.push(node);
        }
      }
      for (let i = 0; i < node.children.length; i++) {
        collectScene(node.children[i]);
      }
    };

    collectScene(scene);

    if (opaqueNodes.length > 1) {
      opaqueNodes.sort((a, b) => (a.renderOrder || 0) - (b.renderOrder || 0));
    }
    if (transparentNodes.length > 1) {
      transparentNodes.sort((a, b) => (a.renderOrder || 0) - (b.renderOrder || 0));
    }

    const bg = scene.background || this.clearColor;
    gl.depthMask(true);
    gl.clearColor(bg.r, bg.g, bg.b, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(L.uView, false, camera.viewMatrix.elements);
    gl.uniformMatrix4fv(L.uProj, false, camera.projectionMatrix.elements);
    gl.uniform3f(L.uCamPos, camera.position.x, camera.position.y, camera.position.z);
    gl.uniform3f(L.uSunDir, sunDirX, sunDirY, sunDirZ);
    gl.uniform3f(L.uSunCol, sunColR, sunColG, sunColB);
    gl.uniform3f(L.uHemiSkyCol, hemiSkyR, hemiSkyG, hemiSkyB);
    gl.uniform3f(L.uHemiGroundCol, hemiGndR, hemiGndG, hemiGndB);
    gl.uniform3f(L.uAmbientCol, ambR, ambG, ambB);

    const fog = scene.fog;
    if (fog) {
      gl.uniform3f(L.uFogCol, fog.color.r, fog.color.g, fog.color.b);
      gl.uniform1f(L.uFogNear, fog.near ?? 160);
      gl.uniform1f(L.uFogFar, fog.far ?? 680);
    } else {
      gl.uniform3f(L.uFogCol, bg.r, bg.g, bg.b);
      gl.uniform1f(L.uFogNear, 500);
      gl.uniform1f(L.uFogFar, 1200);
    }

    const tempMat = new Float32Array(16);

    const drawNode = (node) => {
      const bufs = this._ensureGeometryBuffers(node.geometry);
      if (!bufs) return;
      const mat = node.material;

      // Depth write & Polygon Offset
      const wantDepthWrite = mat.depthWrite !== undefined ? mat.depthWrite : !mat.transparent;
      gl.depthMask(Boolean(wantDepthWrite));

      if (mat.polygonOffset) {
        gl.enable(gl.POLYGON_OFFSET_FILL);
        gl.polygonOffset(mat.polygonOffsetFactor ?? -1, mat.polygonOffsetUnits ?? -1);
      } else {
        gl.disable(gl.POLYGON_OFFSET_FILL);
      }

      if (mat.blending === AdditiveBlending) {
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      } else {
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      }

      // Attributes
      gl.bindBuffer(gl.ARRAY_BUFFER, bufs.posBuf);
      gl.enableVertexAttribArray(L.aPos);
      gl.vertexAttribPointer(L.aPos, 3, gl.FLOAT, false, 0, 0);

      if (bufs.nrmBuf && L.aNrm >= 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, bufs.nrmBuf);
        gl.enableVertexAttribArray(L.aNrm);
        gl.vertexAttribPointer(L.aNrm, 3, gl.FLOAT, false, 0, 0);
      } else if (L.aNrm >= 0) {
        gl.disableVertexAttribArray(L.aNrm);
        gl.vertexAttrib3f(L.aNrm, 0, 1, 0);
      }

      if (bufs.colBuf && mat.vertexColors && L.aCol >= 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, bufs.colBuf);
        gl.enableVertexAttribArray(L.aCol);
        gl.vertexAttribPointer(L.aCol, 3, gl.FLOAT, false, 0, 0);
        gl.uniform1f(L.uUseVertCol, 1.0);
      } else {
        if (L.aCol >= 0) {
          gl.disableVertexAttribArray(L.aCol);
          gl.vertexAttrib3f(L.aCol, 1, 1, 1);
        }
        gl.uniform1f(L.uUseVertCol, 0.0);
      }

      if (bufs.uvBuf && L.aUv >= 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, bufs.uvBuf);
        gl.enableVertexAttribArray(L.aUv);
        gl.vertexAttribPointer(L.aUv, 2, gl.FLOAT, false, 0, 0);
      } else if (L.aUv >= 0) {
        gl.disableVertexAttribArray(L.aUv);
        gl.vertexAttrib2f(L.aUv, 0, 0);
      }

      // Texture map binding
      const glTex = mat.map ? this._ensureTexture(mat.map) : null;
      if (glTex) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, glTex);
        gl.uniform1i(L.uMap, 0);
        gl.uniform1f(L.uHasMap, 1.0);
        const rep = mat.map.repeat || { x: 1, y: 1 };
        const off = mat.map.offset || { x: 0, y: 0 };
        gl.uniform2f(L.uUvRepeat, rep.x ?? 1, rep.y ?? 1);
        gl.uniform2f(L.uUvOffset, off.x ?? 0, off.y ?? 0);
      } else {
        gl.uniform1f(L.uHasMap, 0.0);
      }

      // Material PBR Uniforms
      gl.uniform1f(L.uUnlit, mat.unlit ? 1.0 : 0.0);
      gl.uniform1f(L.uOpacity, mat.opacity ?? 1.0);
      gl.uniform1f(L.uRoughness, mat.roughness ?? 0.45);
      gl.uniform1f(L.uMetalness, mat.metalness ?? 0.0);
      gl.uniform1f(L.uClearcoat, mat.clearcoat ?? 0.0);
      gl.uniform1f(L.uClearcoatRoughness, mat.clearcoatRoughness ?? 0.1);
      gl.uniform1f(L.uReflectivity, mat.reflectivity ?? 0.5);
      const em = mat.emissive || { r: 0, g: 0, b: 0 };
      gl.uniform3f(L.uEmissive, em.r || 0, em.g || 0, em.b || 0);
      gl.uniform1f(L.uEmissiveIntensity, mat.emissiveIntensity ?? 1.0);
      gl.uniform1f(L.uUseFog, mat.fog === false ? 0.0 : 1.0);

      if (node.isInstancedMesh) {
        const parentWorld = node.matrixWorld.elements;
        for (let i = 0; i < node.count; i++) {
          const instSlice = node.instanceMatrix.subarray(i * 16, i * 16 + 16);
          matMul4(tempMat, parentWorld, instSlice);
          gl.uniformMatrix4fv(L.uModel, false, tempMat);
          const c = node.instanceColors[i] || mat.color;
          gl.uniform3f(L.uBaseCol, c.r, c.g, c.b);
          if (bufs.idxBuf) {
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufs.idxBuf);
            gl.drawElements(gl.TRIANGLES, bufs.idxCount, bufs.idxType, 0);
          } else {
            gl.drawArrays(gl.TRIANGLES, 0, bufs.count);
          }
        }
      } else {
        gl.uniformMatrix4fv(L.uModel, false, node.matrixWorld.elements);
        const c = mat.color;
        gl.uniform3f(L.uBaseCol, c.r, c.g, c.b);
        if (bufs.idxBuf) {
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufs.idxBuf);
          gl.drawElements(gl.TRIANGLES, bufs.idxCount, bufs.idxType, 0);
        } else {
          gl.drawArrays(gl.TRIANGLES, 0, bufs.count);
        }
      }
    };

    for (let i = 0; i < opaqueNodes.length; i++) {
      drawNode(opaqueNodes[i]);
    }
    for (let i = 0; i < transparentNodes.length; i++) {
      drawNode(transparentNodes[i]);
    }

    gl.depthMask(true);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }
}
