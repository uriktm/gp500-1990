// High-Resolution Procedural PBR / Albedo Canvas Texture Generator for 500cc Grand Prix '90
// Runs natively in both browser (HTML5 2D Canvas) and headless Node.js (mock canvas fallback).

import * as THREE from 'three';

const REPEAT_WRAPPING = THREE.RepeatWrapping ?? 1000;

let cachedTextureSet = null;
const cachedLiveryTextures = new Map();

// Deterministic PRNG (Mulberry32) so procedural textures are 100% consistent across runs
function createRng(seed = 19900500) {
  let state = seed >>> 0;
  return function nextRandom() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clampByte(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

function toHexColor(colorVal, fallback = '#d91424') {
  if (typeof colorVal === 'string' && colorVal.length > 0) {
    return colorVal;
  }
  if (typeof colorVal === 'number' && Number.isFinite(colorVal)) {
    const hex = (Math.floor(colorVal) & 0xffffff).toString(16).padStart(6, '0');
    return `#${hex}`;
  }
  return fallback;
}

function hexToRgb(hexStr) {
  const clean = toHexColor(hexStr, '#ffffff').replace('#', '');
  const num = parseInt(clean, 16);
  if (Number.isNaN(num)) return { r: 255, g: 255, b: 255 };
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255
  };
}

function createCanvasSurface(width, height) {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
    if (ctx) {
      return { canvas, ctx, width, height, isMock: false };
    }
  }
  const mockCanvas = { width, height, isMockCanvas: true };
  return { canvas: mockCanvas, ctx: null, width, height, isMock: true };
}

function wrapInCanvasTexture(canvas, width, height, anisotropy = 8) {
  const TexCtor = THREE.CanvasTexture || THREE.Texture;
  const texture = TexCtor ? new TexCtor(canvas) : { image: canvas };
  texture.image = canvas;
  texture.width = width;
  texture.height = height;
  texture.colorSpace = THREE.SRGBColorSpace ?? 'srgb';
  texture.wrapS = REPEAT_WRAPPING;
  texture.wrapT = REPEAT_WRAPPING;
  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;
  return texture;
}

// ============================================================================
// 1. ASPHALT (512x512)
// Fine multi-scale aggregate noise (dark grey, basalt, subtle mica highlights)
// + darker rubberized Racing Line groove down center with longitudinal wear streaks & micro-cracks
// ============================================================================
function buildAsphaltTexture() {
  const width = 512;
  const height = 512;
  const { canvas, ctx } = createCanvasSurface(width, height);

  if (ctx) {
    const rng = createRng(1990101);
    const imgData = ctx.createImageData(width, height);
    const data = imgData.data;

    // Precompute tileable coarse noise grid (32x32) for tarmac patch modulation
    const gridN = 32;
    const coarseGrid = new Float32Array(gridN * gridN);
    for (let i = 0; i < coarseGrid.length; i++) {
      coarseGrid[i] = (rng() - 0.5) * 24;
    }

    const sampleCoarse = (x, y) => {
      const gx = (x / width) * gridN;
      const gy = (y / height) * gridN;
      const x0 = Math.floor(gx) & (gridN - 1);
      const y0 = Math.floor(gy) & (gridN - 1);
      const x1 = (x0 + 1) & (gridN - 1);
      const y1 = (y0 + 1) & (gridN - 1);
      const fx = gx - Math.floor(gx);
      const fy = gy - Math.floor(gy);
      const v00 = coarseGrid[y0 * gridN + x0];
      const v10 = coarseGrid[y0 * gridN + x1];
      const v01 = coarseGrid[y1 * gridN + x0];
      const v11 = coarseGrid[y1 * gridN + x1];
      const top = v00 + (v10 - v00) * fx;
      const bot = v01 + (v11 - v01) * fx;
      return top + (bot - top) * fy;
    };

    for (let y = 0; y < height; y++) {
      // Subtle longitudinal periodic modulation so forward motion reads clearly at high speed
      const motionBand = Math.sin((y / height) * Math.PI * 8) * 4.5 + Math.cos((y / height) * Math.PI * 24) * 3.0;

      for (let x = 0; x < width; x++) {
        const dxNorm = (x - width * 0.5) / (width * 0.5);
        // Primary darker rubberized racing line groove down the center
        const grooveX = Math.exp(-(dxNorm * dxNorm) / 0.14) * 22;
        // Dual tire track grooves inside the racing line
        const leftTrack = Math.exp(-Math.pow(dxNorm + 0.16, 2) / 0.025) * 9;
        const rightTrack = Math.exp(-Math.pow(dxNorm - 0.16, 2) / 0.025) * 9;

        const patch = sampleCoarse(x, y);
        const fine = (rng() - 0.5) * 30;

        // Multi-scale aggregate speckles: dark basalt pits & bright quartz/mica glints
        const specRoll = rng();
        let aggregateDelta = 0;
        if (specRoll < 0.085) {
          aggregateDelta = -26 - rng() * 16; // dark basalt chip
        } else if (specRoll > 0.945) {
          aggregateDelta = 28 + rng() * 32; // mica / quartz crystalline highlight
        } else if (specRoll > 0.84) {
          aggregateDelta = 14 + rng() * 12; // light granite grain
        }

        const base = 78 + patch + fine + aggregateDelta + motionBand - grooveX - leftTrack - rightTrack;
        const r = clampByte(base - 1);
        const g = clampByte(base);
        const b = clampByte(base + 3);

        const idx = (y * width + x) * 4;
        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);

    // Continuous longitudinal tire-wear rubber streaks down the center racing line
    for (let i = 0; i < 110; i++) {
      const spread = (rng() - 0.5) + (rng() - 0.5); // triangular distribution around center
      const x = width * 0.5 + spread * width * 0.30;
      const w = 1.2 + rng() * 3.2;
      const alpha = 0.04 + rng() * 0.07;
      ctx.fillStyle = `rgba(18, 20, 24, ${alpha.toFixed(3)})`;
      ctx.fillRect(x, 0, w, height);
    }

    // Tileable finite-length longitudinal rubber & aggregate motion dashes across the road
    // (gives strong visual forward speed flow as UV.v scrolls past the camera)
    for (let i = 0; i < 320; i++) {
      const x = rng() * width;
      const y = rng() * height;
      const w = 1.5 + rng() * 4.0;
      const len = 28 + rng() * 110;
      const isDarkRubber = rng() < 0.68;
      const alpha = isDarkRubber ? (0.07 + rng() * 0.14) : (0.05 + rng() * 0.09);
      ctx.fillStyle = isDarkRubber
        ? `rgba(16, 18, 22, ${alpha.toFixed(3)})`
        : `rgba(145, 150, 158, ${alpha.toFixed(3)})`;
      ctx.fillRect(x, y, w, len);
      if (y + len > height) {
        ctx.fillRect(x, 0, w, (y + len) - height);
      }
    }

    // Subtle sealed bitumen micro-cracks in the tarmac
    ctx.strokeStyle = 'rgba(20, 22, 26, 0.42)';
    ctx.lineWidth = 1.1;
    for (let c = 0; c < 18; c++) {
      let cx = rng() * width;
      let cy = rng() * height;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      const segs = 5 + Math.floor(rng() * 6);
      for (let s = 0; s < segs; s++) {
        cx += (rng() - 0.48) * 18;
        cy += 8 + rng() * 18;
        ctx.lineTo(cx, cy);
      }
      ctx.stroke();
    }
  }

  return wrapInCanvasTexture(canvas, width, height, 16);
}

// ============================================================================
// 2 & 3. RUMBLE KERBS (256x256) — Red/White & Blue/White
// Weathered FIA 1990 concrete rumble kerb with concrete grain, beveled rib shadow
// lines, and dark rubber tire marks across the ribs.
// ============================================================================
function buildKerbTexture(primaryHex, secondaryHex, seed) {
  const width = 256;
  const height = 256;
  const { canvas, ctx } = createCanvasSurface(width, height);

  if (ctx) {
    const rng = createRng(seed);
    const c1 = hexToRgb(primaryHex);
    const c2 = hexToRgb(secondaryHex);

    const imgData = ctx.createImageData(width, height);
    const data = imgData.data;

    // 2 main concrete blocks along Y (128px each) + angled serrated bevel feel
    const blockSize = 128;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Slight chevron slant for authentic FIA sawtooth kerb look & UV resilience
        const slantCoord = (y + Math.floor(x * 0.125)) & (height - 1);
        const blockIdx = Math.floor(slantCoord / blockSize);
        const localY = slantCoord % blockSize;
        const baseCol = blockIdx % 2 === 0 ? c1 : c2;

        // Beveled rib shadow & highlight lines at each concrete slab joint
        let bevelDelta = 0;
        if (localY < 6) {
          bevelDelta = -48 + localY * 6; // deep rib shadow groove
        } else if (localY < 13) {
          bevelDelta = 26 - (localY - 6) * 3; // sunlit concrete step bevel highlight
        } else if (localY > blockSize - 5) {
          bevelDelta = -25;
        }

        // Secondary corrugated mini-ribs every 32px
        const subRib = localY % 32;
        if (subRib === 0 || subRib === 1) {
          bevelDelta -= 16;
        } else if (subRib === 2) {
          bevelDelta += 10;
        }

        // Edge weathering grime near left/right borders of kerb
        const edgeDist = Math.min(x, width - 1 - x) / (width * 0.5);
        const grime = edgeDist < 0.22 ? -(1 - edgeDist / 0.22) * 28 : 0;

        // Concrete porous grain + aggregate noise
        const grain = (rng() - 0.5) * 24 + (rng() < 0.06 ? -18 : 0);

        const idx = (y * width + x) * 4;
        data[idx] = clampByte(baseCol.r + bevelDelta + grime + grain);
        data[idx + 1] = clampByte(baseCol.g + bevelDelta + grime + grain);
        data[idx + 2] = clampByte(baseCol.b + bevelDelta + grime + grain);
        data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);

    // Dark rubber tire scuff marks across the concrete ribs from apex clipping
    for (let i = 0; i < 34; i++) {
      const startX = 28 + rng() * (width - 56);
      const startY = rng() * height;
      const len = 35 + rng() * 90;
      const drift = (rng() - 0.5) * 26;
      ctx.strokeStyle = `rgba(22, 24, 28, ${(0.12 + rng() * 0.22).toFixed(3)})`;
      ctx.lineWidth = 2.5 + rng() * 5.5;
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.quadraticCurveTo(startX + drift * 0.5, startY + len * 0.5, startX + drift, startY + len);
      ctx.stroke();
    }
  }

  return wrapInCanvasTexture(canvas, width, height);
}

// ============================================================================
// 4. GRAVEL (512x512)
// Realistic beige/tan/grey pebble gravel-trap texture with raked parallel
// grooves and stone highlights/shadows.
// ============================================================================
function buildGravelTexture() {
  const width = 512;
  const height = 512;
  const { canvas, ctx } = createCanvasSurface(width, height);

  if (ctx) {
    const rng = createRng(1990404);
    const imgData = ctx.createImageData(width, height);
    const data = imgData.data;

    // Base sand/pebble bed with parallel raked furrows (16 grooves across 512px)
    const rakeFreq = (Math.PI * 2 * 16) / width;
    const crossFreq = (Math.PI * 2 * 4) / height;

    for (let y = 0; y < height; y++) {
      const waveOffset = Math.sin(y * crossFreq) * 6.0;
      for (let x = 0; x < width; x++) {
        // Raked parallel groove wave + subtle diagonal rake tooth modulation
        const rakeWave = Math.sin((x + waveOffset) * rakeFreq);
        const rakeShade = rakeWave * 16;
        const fineNoise = (rng() - 0.5) * 28;

        const baseR = 194 + rakeShade + fineNoise;
        const baseG = 171 + rakeShade * 0.92 + fineNoise * 0.92;
        const baseB = 134 + rakeShade * 0.82 + fineNoise * 0.85;

        const idx = (y * width + x) * 4;
        data[idx] = clampByte(baseR);
        data[idx + 1] = clampByte(baseG);
        data[idx + 2] = clampByte(baseB);
        data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);

    // Packed multi-toned river pebbles with top-left highlight & bottom-right shadow
    const pebblePalette = [
      '#d8c39e',
      '#c4ab82',
      '#a8906c',
      '#8f7d62',
      '#7a7267',
      '#e2d2b5',
      '#b7996e'
    ];

    const numPebbles = 4200;
    for (let i = 0; i < numPebbles; i++) {
      const px = rng() * width;
      const py = rng() * height;
      const rx = 1.4 + rng() * 3.4;
      const ry = 1.1 + rng() * 2.8;
      const col = pebblePalette[Math.floor(rng() * pebblePalette.length)];

      // Stone drop shadow
      ctx.fillStyle = 'rgba(48, 38, 26, 0.36)';
      ctx.beginPath();
      ctx.ellipse(px + 0.9, py + 0.9, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();

      // Stone body
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.ellipse(px, py, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();

      // Sunlit top-left specular highlight on stone
      if (rng() > 0.35) {
        ctx.fillStyle = 'rgba(255, 248, 232, 0.35)';
        ctx.beginPath();
        ctx.ellipse(px - rx * 0.28, py - ry * 0.28, rx * 0.45, ry * 0.42, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  return wrapInCanvasTexture(canvas, width, height);
}

// ============================================================================
// 5. GRASS (512x512)
// Lush motorsport infield turf with mowed stadium stripes, soil micro-variation,
// and grass blade grain.
// ============================================================================
function buildGrassTexture() {
  const width = 512;
  const height = 512;
  const { canvas, ctx } = createCanvasSurface(width, height);

  if (ctx) {
    const rng = createRng(1990505);
    const imgData = ctx.createImageData(width, height);
    const data = imgData.data;

    // 4 mowed stadium stripes across X + subtle cross-mow diamond check across Y
    const stripePeriod = 128;

    for (let y = 0; y < height; y++) {
      const mowY = Math.sin((y / stripePeriod) * Math.PI * 2) * 5;
      for (let x = 0; x < width; x++) {
        const mowX = Math.sin((x / stripePeriod) * Math.PI * 2) * 11;
        const soilPatch = Math.sin((x * 0.035) + Math.cos(y * 0.04) * 2.0) * 6;
        const bladeNoise = (rng() - 0.5) * 22;

        // Lush chlorophyll greens with warm soil undertones
        const r = 46 + mowX * 0.75 + mowY * 0.5 + soilPatch + bladeNoise * 0.7;
        const g = 114 + mowX * 1.15 + mowY * 0.8 + soilPatch * 0.7 + bladeNoise;
        const b = 36 + mowX * 0.45 + mowY * 0.3 + bladeNoise * 0.55;

        const idx = (y * width + x) * 4;
        data[idx] = clampByte(r);
        data[idx + 1] = clampByte(g);
        data[idx + 2] = clampByte(b);
        data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);

    // Thousands of fine individual grass blade strokes & clover/soil micro-specks
    for (let i = 0; i < 5500; i++) {
      const gx = rng() * width;
      const gy = rng() * height;
      const lean = (rng() - 0.5) * 3.2;
      const h = 3.0 + rng() * 5.5;
      const isHighlight = rng() > 0.45;
      ctx.strokeStyle = isHighlight
        ? `rgba(116, 178, 68, ${(0.18 + rng() * 0.22).toFixed(3)})`
        : `rgba(26, 68, 18, ${(0.18 + rng() * 0.22).toFixed(3)})`;
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.lineTo(gx + lean, gy - h);
      ctx.stroke();
    }
  }

  return wrapInCanvasTexture(canvas, width, height);
}

// ============================================================================
// 6. START / FINISH LINE (512x256)
// Crisp black-and-white checkered start/finish line with painted white border
// lines and rubber launch marks.
// ============================================================================
function buildStartFinishTexture() {
  const width = 512;
  const height = 256;
  const { canvas, ctx } = createCanvasSurface(width, height);

  if (ctx) {
    const rng = createRng(1990606);

    // Asphalt dark base
    ctx.fillStyle = '#25282e';
    ctx.fillRect(0, 0, width, height);

    // Painted white border lines at top and bottom
    const borderH = 18;
    ctx.fillStyle = '#f2f1ec';
    ctx.fillRect(0, 4, width, borderH);
    ctx.fillRect(0, height - borderH - 4, width, borderH);

    // Crisp black-and-white checkered matrix in the central band
    const checkTop = borderH + 10;
    const checkAreaH = height - (borderH + 10) * 2; // 200px
    const rows = 4;
    const cols = 16;
    const cellW = width / cols; // 32px
    const cellH = checkAreaH / rows; // 50px

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const isWhite = (r + c) % 2 === 0;
        ctx.fillStyle = isWhite ? '#f3f2ed' : '#181a1f';
        ctx.fillRect(c * cellW, checkTop + r * cellH, cellW, cellH);
      }
    }

    // Subtle tarmac grain bleeding through the road paint
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
      const grain = (rng() - 0.5) * 18;
      data[i] = clampByte(data[i] + grain);
      data[i + 1] = clampByte(data[i + 1] + grain);
      data[i + 2] = clampByte(data[i + 2] + grain);
    }
    ctx.putImageData(imgData, 0, 0);

    // Black rubber clutch-drop launch marks streaking across the start/finish line
    for (let i = 0; i < 42; i++) {
      const lx = rng() * width;
      const lw = 2 + rng() * 5;
      const alpha = 0.08 + rng() * 0.18;
      ctx.fillStyle = `rgba(16, 18, 22, ${alpha.toFixed(3)})`;
      ctx.fillRect(lx, 0, lw, height);
    }
  }

  return wrapInCanvasTexture(canvas, width, height);
}

// ============================================================================
// 7. TIRE TREAD & SIDEWALL (256x256)
// Racing slick tire compound texture with subtle center heat-cycle sheen and
// sidewall lettering ring ("GP500 RADIAL").
// ============================================================================
function buildTireTreadTexture() {
  const width = 256;
  const height = 256;
  const { canvas, ctx } = createCanvasSurface(width, height);

  if (ctx) {
    const rng = createRng(1990707);

    // Base vulcanized carbon-black slick rubber
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0.0, '#141619');
    grad.addColorStop(0.22, '#1f2329');
    grad.addColorStop(0.5, '#2b3038'); // subtle center heat-cycle bluish-charcoal sheen
    grad.addColorStop(0.78, '#1f2329');
    grad.addColorStop(1.0, '#141619');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // Fine circumferential rubber abrasion texture & grain
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;
    for (let y = 0; y < height; y++) {
      const streak = Math.sin(y * 0.65) * 3;
      for (let x = 0; x < width; x++) {
        const noise = (rng() - 0.5) * 10 + streak;
        const idx = (y * width + x) * 4;
        data[idx] = clampByte(data[idx] + noise);
        data[idx + 1] = clampByte(data[idx + 1] + noise);
        data[idx + 2] = clampByte(data[idx + 2] + noise + 1);
      }
    }
    ctx.putImageData(imgData, 0, 0);

    // Subtle wear-indicator dimples along the slick contact patch
    ctx.fillStyle = '#101215';
    for (let x = 16; x < width; x += 64) {
      ctx.beginPath();
      ctx.arc(x, height * 0.42, 2.2, 0, Math.PI * 2);
      ctx.arc(x + 32, height * 0.58, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Sidewall lettering bands (top and bottom for Torus UV wrapping)
    ctx.save();
    ctx.font = 'bold 14px Impact, Arial Black, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f2c938';
    ctx.fillText('GP500 RADIAL   •   500cc FACTORY SLICK', width * 0.5, 22);
    ctx.fillStyle = '#ececec';
    ctx.fillText('GP500 RADIAL   •   500cc FACTORY SLICK', width * 0.5, height - 22);

    // Also draw a subtle circular sidewall lettering ring around center for flat/cylindrical UVs
    ctx.strokeStyle = 'rgba(242, 201, 56, 0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(width * 0.5, height * 0.5, 96, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  return wrapInCanvasTexture(canvas, width, height);
}

// ============================================================================
// 8. CARBON-KEVLAR WEAVE (128x128)
// Diagonal 2x2 twill carbon-Kevlar weave texture for 1990 two-stroke exhaust
// silencers and cockpit dash.
// ============================================================================
function buildCarbonTexture() {
  const width = 128;
  const height = 128;
  const { canvas, ctx } = createCanvasSurface(width, height);

  if (ctx) {
    const cell = 8; // 16x16 twill cells across 128x128
    ctx.fillStyle = '#121417';
    ctx.fillRect(0, 0, width, height);

    for (let gy = 0; gy < height / cell; gy++) {
      for (let gx = 0; gx < width / cell; gx++) {
        const px = gx * cell;
        const py = gy * cell;
        // 2x2 diagonal twill phase
        const phase = (gx + gy) % 4;
        const isWarp = phase < 2;
        const isKevlarThread = (gx + gy * 2) % 4 === 0;

        const grad = isWarp
          ? ctx.createLinearGradient(px, py, px + cell, py)
          : ctx.createLinearGradient(px, py, px, py + cell);

        if (isKevlarThread) {
          // Subtle 1990 carbon-Kevlar olive-gold hybrid tow
          grad.addColorStop(0.0, '#2a2414');
          grad.addColorStop(0.5, '#685928');
          grad.addColorStop(1.0, '#231e10');
        } else {
          // Anisotropic graphite carbon fiber tow
          grad.addColorStop(0.0, '#16191e');
          grad.addColorStop(0.5, '#3b424d');
          grad.addColorStop(1.0, '#14171c');
        }

        ctx.fillStyle = grad;
        ctx.fillRect(px + 0.5, py + 0.5, cell - 1, cell - 1);
      }
    }
  }

  return wrapInCanvasTexture(canvas, width, height);
}

// ============================================================================
// 9. BRAKE DISC (256x256)
// Brushed radial steel rotor texture with ventilated drill holes and dark
// swept pad track.
// ============================================================================
function buildBrakeDiscTexture() {
  const width = 256;
  const height = 256;
  const { canvas, ctx } = createCanvasSurface(width, height);

  if (ctx) {
    const cx = width * 0.5;
    const cy = height * 0.5;

    ctx.fillStyle = '#181b20';
    ctx.fillRect(0, 0, width, height);

    // Outer steel rotor disc (r = 52..122)
    const rotorGrad = ctx.createRadialGradient(cx, cy, 48, cx, cy, 122);
    rotorGrad.addColorStop(0.0, '#78808a');
    rotorGrad.addColorStop(0.18, '#b4bcc6');
    rotorGrad.addColorStop(0.55, '#6a727c'); // dark swept brake-pad friction track
    rotorGrad.addColorStop(0.88, '#9aa2ad');
    rotorGrad.addColorStop(1.0, '#50565e');

    ctx.fillStyle = rotorGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, 122, 0, Math.PI * 2);
    ctx.fill();

    // Fine concentric brushed machining grooves on the steel rotor
    for (let r = 56; r <= 118; r += 2) {
      ctx.strokeStyle = r % 4 === 0 ? 'rgba(235, 242, 250, 0.16)' : 'rgba(25, 30, 36, 0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Radial brushed metallic sheen lines
    for (let a = 0; a < 72; a++) {
      const ang = (a / 72) * Math.PI * 2;
      ctx.strokeStyle = a % 2 === 0 ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.06)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * 54, cy + Math.sin(ang) * 54);
      ctx.lineTo(cx + Math.cos(ang) * 120, cy + Math.sin(ang) * 120);
      ctx.stroke();
    }

    // Cross-drilled ventilation holes arranged in spiral arcs across the pad track
    const numArms = 12;
    const holesPerArm = 3;
    for (let arm = 0; arm < numArms; arm++) {
      const baseAngle = (arm / numArms) * Math.PI * 2;
      for (let h = 0; h < holesPerArm; h++) {
        const radius = 70 + h * 17;
        const angle = baseAngle + h * 0.11;
        const hx = cx + Math.cos(angle) * radius;
        const hy = cy + Math.sin(angle) * radius;

        // Chamfered steel rim
        ctx.fillStyle = '#cfd6e0';
        ctx.beginPath();
        ctx.arc(hx, hy, 4.4, 0, Math.PI * 2);
        ctx.fill();

        // Dark drilled core
        ctx.fillStyle = '#14161a';
        ctx.beginPath();
        ctx.arc(hx, hy, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Inner anodized gold carrier bell / spider (1990 Brembo GP style)
    const carrierGrad = ctx.createRadialGradient(cx, cy, 20, cx, cy, 54);
    carrierGrad.addColorStop(0.0, '#785a18');
    carrierGrad.addColorStop(0.6, '#d4a638');
    carrierGrad.addColorStop(1.0, '#967220');
    ctx.fillStyle = carrierGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, 54, 0, Math.PI * 2);
    ctx.fill();

    // 10 floating rotor bobbins along the carrier-to-rotor joint (r = 54)
    for (let b = 0; b < 10; b++) {
      const ang = (b / 10) * Math.PI * 2;
      const bx = cx + Math.cos(ang) * 54;
      const by = cy + Math.sin(ang) * 54;
      ctx.fillStyle = '#d8dee8';
      ctx.beginPath();
      ctx.arc(bx, by, 5.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#22262e';
      ctx.beginPath();
      ctx.arc(bx, by, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Center hub bore
    ctx.fillStyle = '#15181d';
    ctx.beginPath();
    ctx.arc(cx, cy, 24, 0, Math.PI * 2);
    ctx.fill();
  }

  return wrapInCanvasTexture(canvas, width, height);
}

// ============================================================================
// 10. GRANDSTAND CROWD MOSAIC (512x256)
// Vibrant 1990 Grand Prix grandstand crowd mosaic (hundreds of tiny colorful
// spectators, flags, and grandstand seating rows).
// ============================================================================
function buildCrowdTexture() {
  const width = 512;
  const height = 256;
  const { canvas, ctx } = createCanvasSurface(width, height);

  if (ctx) {
    const rng = createRng(1990808);

    // Concrete tiered grandstand seating structure
    ctx.fillStyle = '#383d46';
    ctx.fillRect(0, 0, width, height);

    const numRows = 10;
    const crowdHeight = 224;
    const rowH = crowdHeight / numRows;

    // Real crowds are mostly dark, denim and neutral clothing with the odd team color.
    const shirtPalette = [
      '#23262c', '#2c3442', '#3b4a63', '#4a5568', '#5b6472', // black, navy, denim, greys
      '#7a7266', '#9a8f7c', '#c9c4b8', '#e6e3dc', // khaki, beige, off-white
      '#23262c', '#2c3442', '#3b4a63', '#e6e3dc',
      '#8e2a2a', '#2f4f86', '#b8923a' // muted team red, blue, gold
    ];
    const skinTones = ['#f2c6a0', '#e0ac82', '#c68b59', '#f7d7b8', '#8d5832'];

    for (let r = 0; r < numRows; r++) {
      const rowTop = r * rowH;

      // Concrete step & safety aisle shadow
      ctx.fillStyle = r % 2 === 0 ? '#49505c' : '#3f4550';
      ctx.fillRect(0, rowTop, width, rowH);
      ctx.fillStyle = '#252930';
      ctx.fillRect(0, rowTop + rowH - 3, width, 3);

      // Draw spectators packed along the row
      for (let x = 4; x < width - 4; x += 6 + Math.floor(rng() * 3)) {
        // Leave narrow vertical stairway aisles at x = 128, 256, 384
        if (Math.abs(x - 128) < 7 || Math.abs(x - 256) < 7 || Math.abs(x - 384) < 7) {
          ctx.fillStyle = '#6c7380';
          ctx.fillRect(x - 2, rowTop, 4, rowH);
          continue;
        }

        const jitterY = (rng() - 0.5) * 3;
        const torsoColor = shirtPalette[Math.floor(rng() * shirtPalette.length)];
        const skinColor = skinTones[Math.floor(rng() * skinTones.length)];

        // Torso / jacket
        ctx.fillStyle = torsoColor;
        ctx.fillRect(x - 2.5, rowTop + 7 + jitterY, 5.5, rowH - 8);

        // Head
        ctx.fillStyle = skinColor;
        ctx.beginPath();
        ctx.arc(x, rowTop + 5.5 + jitterY, 2.4, 0, Math.PI * 2);
        ctx.fill();

        // Occasional baseball cap / racing hat
        if (rng() > 0.45) {
          ctx.fillStyle = shirtPalette[Math.floor(rng() * shirtPalette.length)];
          ctx.fillRect(x - 2.4, rowTop + 3.0 + jitterY, 4.8, 2.0);
        }
      }
    }

    // Waving racing flags & team banners scattered across the grandstand
    const flagSpecs = [
      { bg: '#d91424', fg: '#ffffff', text: '#1' },
      { bg: '#1648b8', fg: '#f5c542', text: 'V4' },
      { bg: '#00a8e8', fg: '#e62222', text: '34' },
      { bg: '#b80f1a', fg: '#f0d040', text: '27' },
      { bg: '#ffffff', fg: '#151515', text: 'GP' }
    ];

    for (let f = 0; f < 6; f++) {
      const fx = 18 + rng() * (width - 52);
      const fy = 14 + rng() * (crowdHeight - 44);
      const fw = 22 + rng() * 14;
      const fh = 13 + rng() * 6;
      const spec = flagSpecs[f % flagSpecs.length];

      // Flagpole
      ctx.strokeStyle = '#e4e8f0';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(fx, fy + fh + 6);
      ctx.lineTo(fx, fy - 2);
      ctx.stroke();

      // Flag cloth
      ctx.fillStyle = spec.bg;
      ctx.fillRect(fx, fy, fw, fh);
      ctx.fillStyle = spec.fg;
      ctx.fillRect(fx, fy + fh * 0.65, fw, fh * 0.35);

      ctx.font = 'bold 8px Arial, sans-serif';
      ctx.fillStyle = spec.fg;
      ctx.fillText(spec.text, fx + 3, fy + 8);
    }

    // Front grandstand guardrail & sponsor parapet strip at bottom (y = 224..256)
    ctx.fillStyle = '#dfe3ea';
    ctx.fillRect(0, crowdHeight, width, 32);
    ctx.fillStyle = '#d91424';
    ctx.fillRect(0, crowdHeight + 4, width, 6);
    ctx.fillStyle = '#1648b8';
    ctx.fillRect(0, crowdHeight + 22, width, 6);
  }

  return wrapInCanvasTexture(canvas, width, height);
}

// ============================================================================
// 11. PIT BUILDING FACADE (512x256)
// Concrete & glass pit-lane garage / hospitality facade with Pit Box doors
// and balcony windows.
// ============================================================================
function buildPitBuildingTexture() {
  const width = 512;
  const height = 256;
  const { canvas, ctx } = createCanvasSurface(width, height);

  if (ctx) {
    // Architectural precast concrete base
    ctx.fillStyle = '#cfd4dc';
    ctx.fillRect(0, 0, width, height);

    // Top roofline fascia & race control parapet (y = 0..26)
    ctx.fillStyle = '#262b34';
    ctx.fillRect(0, 0, width, 20);
    ctx.fillStyle = '#d91424';
    ctx.fillRect(0, 20, width, 6);

    // Upper floor: VIP Hospitality Suite panoramic tinted glass windows & balcony (y = 28..122)
    ctx.fillStyle = '#aeb6c2';
    ctx.fillRect(0, 26, width, 98);

    const numWindows = 8;
    const winW = width / numWindows;
    for (let w = 0; w < numWindows; w++) {
      const wx = w * winW + 6;
      const wy = 34;
      const ww = winW - 12;
      const wh = 76;

      // Reflective blue-tinted architectural glass gradient
      const glassGrad = ctx.createLinearGradient(wx, wy, wx + ww, wy + wh);
      glassGrad.addColorStop(0.0, '#162c46');
      glassGrad.addColorStop(0.45, '#2b527a');
      glassGrad.addColorStop(0.55, '#4c7fb0');
      glassGrad.addColorStop(1.0, '#182b42');
      ctx.fillStyle = glassGrad;
      ctx.fillRect(wx, wy, ww, wh);

      // Warm interior hospitality ceiling light glow strip
      ctx.fillStyle = 'rgba(255, 236, 175, 0.42)';
      ctx.fillRect(wx + 6, wy + 8, ww - 12, 5);

      // Aluminum window frame mullions
      ctx.strokeStyle = '#dde3ec';
      ctx.lineWidth = 2;
      ctx.strokeRect(wx, wy, ww, wh);
    }

    // Balcony handrail along y = 96..118
    ctx.strokeStyle = '#eef2f7';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(0, 96);
    ctx.lineTo(width, 96);
    ctx.stroke();

    // Mid-level Championship Sponsor Frieze & Pit Box Number Band (y = 124..152)
    ctx.fillStyle = '#181c24';
    ctx.fillRect(0, 124, width, 28);
    ctx.fillStyle = '#f5c542';
    ctx.fillRect(0, 124, width, 3);
    ctx.fillRect(0, 149, width, 3);

    // Ground Floor: 4 Factory Pit Box Garages (y = 152..256)
    const numBays = 4;
    const bayW = width / numBays;
    const teamColors = ['#d91424', '#1648b8', '#00a8e8', '#b80f1a'];
    const teamLabels = ['PIT BOX 01 • AKAGI', 'PIT BOX 02 • SHIDEN', 'PIT BOX 03 • KAZE', 'PIT BOX 04 • CORSA'];

    for (let b = 0; b < numBays; b++) {
      const bx = b * bayW;

      // Team sign above each Pit Box
      ctx.fillStyle = teamColors[b];
      ctx.fillRect(bx + 8, 129, bayW - 16, 18);
      ctx.font = 'bold 10px Arial, sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(teamLabels[b], bx + bayW * 0.5, 138);

      // Concrete structural pier with safety chevrons
      ctx.fillStyle = '#b8c0cc';
      ctx.fillRect(bx, 152, 12, 104);
      ctx.fillRect(bx + bayW - 12, 152, 12, 104);

      // Garage door opening (y = 158..256)
      const doorX = bx + 12;
      const doorW = bayW - 24;
      const doorY = 158;
      const doorH = 98;

      // Dark garage interior recess
      ctx.fillStyle = '#14171d';
      ctx.fillRect(doorX, doorY, doorW, doorH);

      // Interior overhead fluorescent light & red tool cabinets inside the open pit box
      ctx.fillStyle = '#fff9e6';
      ctx.fillRect(doorX + 14, doorY + 26, doorW - 28, 4);
      ctx.fillStyle = teamColors[b];
      ctx.fillRect(doorX + 10, doorY + 62, 28, 32);
      ctx.fillStyle = '#383f4c';
      ctx.fillRect(doorX + doorW - 38, doorY + 66, 26, 28);

      // Partially lowered corrugated steel roller shutter at top of garage bay
      const shutterH = 22;
      ctx.fillStyle = '#8b94a3';
      ctx.fillRect(doorX, doorY, doorW, shutterH);
      for (let sy = doorY + 3; sy < doorY + shutterH; sy += 4) {
        ctx.fillStyle = '#5c6472';
        ctx.fillRect(doorX, sy, doorW, 1.5);
      }
    }
  }

  return wrapInCanvasTexture(canvas, width, height);
}

// ============================================================================
// 12. TRACKSIDE BILLBOARD BANNERS (4 x 512x128)
// "AKAGI MOTO GP", "SHIDEN V4 POWER", "KAZE RACING OIL", "CORSA ITALIA 500"
// ============================================================================
function buildBannerTexture(spec) {
  const width = 512;
  const height = 128;
  const { canvas, ctx } = createCanvasSurface(width, height);

  if (ctx) {
    // Background fill
    ctx.fillStyle = spec.bg;
    ctx.fillRect(0, 0, width, height);

    // Sweeping 1990 diagonal racing color blocks
    ctx.fillStyle = spec.stripe1;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(135, 0);
    ctx.lineTo(85, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = spec.stripe2;
    ctx.beginPath();
    ctx.moveTo(width - 125, 0);
    ctx.lineTo(width, 0);
    ctx.lineTo(width, height);
    ctx.lineTo(width - 175, height);
    ctx.closePath();
    ctx.fill();

    // Accent top and bottom trim bars
    ctx.fillStyle = spec.accent;
    ctx.fillRect(0, 0, width, 10);
    ctx.fillRect(0, height - 10, width, 10);

    // Checkered racing tab on left side
    const sq = 12;
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 3; c++) {
        ctx.fillStyle = (r + c) % 2 === 0 ? '#ffffff' : '#14161a';
        ctx.fillRect(16 + c * sq, 22 + r * sq, sq, sq);
      }
    }

    // Main billboard headline with subtle drop shadow
    ctx.save();
    ctx.font = 'italic bold 44px Impact, Arial Black, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillText(spec.title, width * 0.5 + 3, height * 0.46 + 3);

    ctx.fillStyle = spec.textColor;
    ctx.fillText(spec.title, width * 0.5, height * 0.46);

    // Sub-caption
    ctx.font = 'bold 14px Arial, sans-serif';
    ctx.fillStyle = spec.subColor;
    ctx.fillText(spec.subtitle, width * 0.5, height * 0.80);
    ctx.restore();

    // Outer hoarding frame border
    ctx.strokeStyle = 'rgba(20, 22, 26, 0.65)';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, width - 4, height - 4);
  }

  return wrapInCanvasTexture(canvas, width, height);
}

// ============================================================================
// PUBLIC EXPORT 1: createTextureSet()
// ============================================================================
export function createTextureSet() {
  if (cachedTextureSet) {
    return cachedTextureSet;
  }

  const bannerConfigs = [
    {
      title: 'AKAGI MOTO GP',
      subtitle: '500cc V4 FACTORY RACING TECHNOLOGY',
      bg: '#f6f6f2',
      stripe1: '#d91424',
      stripe2: '#18181c',
      accent: '#d91424',
      textColor: '#d91424',
      subColor: '#18181c'
    },
    {
      title: 'SHIDEN V4 POWER',
      subtitle: 'WORLD CHAMPIONSHIP GRAND PRIX ENGINEERING',
      bg: '#1648b8',
      stripe1: '#f5c542',
      stripe2: '#0f2f7a',
      accent: '#f5c542',
      textColor: '#ffffff',
      subColor: '#f5c542'
    },
    {
      title: 'KAZE RACING OIL',
      subtitle: '100% SYNTHETIC TWO-STROKE COMPETITION LUBRICANT',
      bg: '#00a8e8',
      stripe1: '#e62222',
      stripe2: '#ffffff',
      accent: '#e62222',
      textColor: '#ffffff',
      subColor: '#102030'
    },
    {
      title: 'CORSA ITALIA 500',
      subtitle: 'SCUDERIA CORSA REPARTO CORSE • MILANO',
      bg: '#b80f1a',
      stripe1: '#181818',
      stripe2: '#228b3b',
      accent: '#f0d040',
      textColor: '#f0d040',
      subColor: '#ffffff'
    }
  ];

  cachedTextureSet = {
    asphalt: buildAsphaltTexture(),
    kerbRedWhite: buildKerbTexture('#d41c24', '#f0eee9', 1990202),
    kerbBlueWhite: buildKerbTexture('#1652b8', '#f0eee9', 1990303),
    gravel: buildGravelTexture(),
    grass: buildGrassTexture(),
    startFinish: buildStartFinishTexture(),
    tireTread: buildTireTreadTexture(),
    carbon: buildCarbonTexture(),
    brakeDisc: buildBrakeDiscTexture(),
    crowd: buildCrowdTexture(),
    pitBuilding: buildPitBuildingTexture(),
    banners: bannerConfigs.map((cfg) => buildBannerTexture(cfg))
  };

  return cachedTextureSet;
}

// ============================================================================
// PUBLIC EXPORT 2: createBikeLiveryTexture(bikeSpec)
// Generates and caches (by bikeSpec.id) a 512x512 custom racing fairing livery
// CanvasTexture with 1990 factory diagonal stripes, number plate box (#1, #4,
// #34, #27), lower belly-pan sponsor lettering, panel-seam lines & rivets.
// ============================================================================
export function createBikeLiveryTexture(bikeSpec = {}) {
  const id = bikeSpec?.id || 'default_gp500';
  if (cachedLiveryTextures.has(id)) {
    return cachedLiveryTextures.get(id);
  }

  const width = 512;
  const height = 512;
  const { canvas, ctx } = createCanvasSurface(width, height);

  const primary = toHexColor(bikeSpec?.colorPrimary ?? bikeSpec?.colorPrimaryHex, '#d91424');
  const secondary = toHexColor(bikeSpec?.colorSecondary ?? bikeSpec?.colorSecondaryHex, '#ffffff');
  const accent = toHexColor(bikeSpec?.colorAccent ?? bikeSpec?.colorAccentHex, '#151515');
  const raceNumber = String(bikeSpec?.number ?? 1);
  const rawName = String(bikeSpec?.name || 'GP500 V4');
  const brandWord = rawName.split(' ')[0].toUpperCase();

  if (ctx) {
    // 1. Base coat in primary factory color
    ctx.fillStyle = primary;
    ctx.fillRect(0, 0, width, height);

    // 2. Classic 1990 sweeping diagonal factory color blocks (secondary color)
    ctx.fillStyle = secondary;
    ctx.beginPath();
    ctx.moveTo(0, height * 0.26);
    ctx.lineTo(width, height * 0.10);
    ctx.lineTo(width, height * 0.56);
    ctx.lineTo(0, height * 0.72);
    ctx.closePath();
    ctx.fill();

    // 3. Bold accent speed-stripe borders along the diagonal fairing cut
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(0, height * 0.23);
    ctx.lineTo(width, height * 0.07);
    ctx.lineTo(width, height * 0.12);
    ctx.lineTo(0, height * 0.28);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(0, height * 0.70);
    ctx.lineTo(width, height * 0.54);
    ctx.lineTo(width, height * 0.60);
    ctx.lineTo(0, height * 0.76);
    ctx.closePath();
    ctx.fill();

    // 4. Lower belly-pan wedge & sponsor strip (y = 0.80..1.0)
    ctx.fillStyle = accent;
    ctx.fillRect(0, height * 0.82, width, height * 0.18);
    ctx.fillStyle = secondary;
    ctx.fillRect(0, height * 0.80, width, height * 0.025);

    // 5. Fairing heat-extractor cooling louvers
    ctx.fillStyle = '#121418';
    for (let i = 0; i < 4; i++) {
      const ly = height * 0.62 + i * 9;
      ctx.fillRect(38 + i * 6, ly, 46, 4);
      ctx.fillRect(width - 84 - i * 6, ly, 46, 4);
    }

    // 6. Helper to draw a crisp 1990 FIM Number Plate + bold racing number
    const useYellowPlate = id === 'shiden' || id === 'corsa';
    const plateFill = useYellowPlate ? '#f6d338' : '#f8f8f5';

    const drawNumberPlate = (cx, cy, pw, ph, fontPx) => {
      const x0 = cx - pw * 0.5;
      const y0 = cy - ph * 0.5;
      ctx.fillStyle = '#14161a';
      ctx.fillRect(x0 - 4, y0 - 4, pw + 8, ph + 8);
      ctx.fillStyle = plateFill;
      ctx.fillRect(x0, y0, pw, ph);

      ctx.font = `italic bold ${fontPx}px Impact, Arial Black, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#111317';
      ctx.fillText(raceNumber, cx, cy + 2);
    };

    // Center nose / tail number plate + left/right side fairing number plates
    drawNumberPlate(width * 0.5, height * 0.40, 142, 108, 76);
    drawNumberPlate(width * 0.18, height * 0.36, 96, 78, 52);
    drawNumberPlate(width * 0.82, height * 0.36, 96, 78, 52);

    // 7. Factory brand decal & lower belly-pan sponsor lettering
    ctx.save();
    ctx.font = 'italic bold 32px Impact, Arial Black, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = secondary === '#ffffff' ? '#ffffff' : '#f8f8f4';
    ctx.fillText(`${brandWord} FACTORY 500`, width * 0.5, height * 0.14);

    ctx.font = 'bold 24px Impact, Arial Black, sans-serif';
    ctx.fillStyle = primary === '#151515' ? '#ffffff' : '#f5f5f0';
    ctx.fillText(`${brandWord}   •   V4 TWO-STROKE   •   GP500`, width * 0.5, height * 0.91);
    ctx.restore();

    // 8. Subtle aerodynamic panel-seam lines & silver Dzus fairing rivets
    ctx.strokeStyle = 'rgba(15, 18, 22, 0.38)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, height * 0.50);
    ctx.lineTo(width, height * 0.50);
    ctx.moveTo(width * 0.32, 0);
    ctx.lineTo(width * 0.32, height);
    ctx.moveTo(width * 0.68, 0);
    ctx.lineTo(width * 0.68, height);
    ctx.stroke();

    ctx.fillStyle = '#d4dbe4';
    const rivetCoords = [
      [48, 248], [128, 248], [384, 248], [464, 248],
      [48, 398], [160, 398], [352, 398], [464, 398]
    ];
    for (const [rx, ry] of rivetCoords) {
      ctx.beginPath();
      ctx.arc(rx, ry, 3.0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#252930';
      ctx.beginPath();
      ctx.arc(rx, ry, 1.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#d4dbe4';
    }
  }

  const liveryTex = wrapInCanvasTexture(canvas, width, height);
  cachedLiveryTextures.set(id, liveryTex);
  return liveryTex;
}
