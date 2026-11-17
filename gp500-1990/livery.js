// Canvas-Generated Procedural Livery Textures for 500cc Grand Prix '90
// Generates per-bike (akagi, shiden, kaze, corsa) high-detail textures for:
// - Fairing & fuel tank bodywork
// - Tail cowl / rear seat unit with number plates
// - Rider racing leathers (back with arched brand name, number, aero hump, seams, kidney belt)
// - Rider limbs & knee sliders (striped arms/legs, accordion stretch panels, scuffed pucks)
// - Painted 1990s GP helmet shell graphics
// - Racing slick tire tread & sidewall markings
// Strictly fictional brands & sponsors only. Headless-safe (mock canvas fallback when document is undefined).

import * as THREE from 'three';
import { BIKES, getBikeById } from './bikes.js';

export const FICTIONAL_SPONSORS = [
  'VORTEX OIL',
  'KRONOS TYRES',
  'APEX RACING',
  'NITROX FUEL',
  'VELOCE',
  'HYPERION',
  'TAKARA',
  'SOLARIS',
  'ZENITH',
  'AEROX'
];

export const LIVERY_THEMES = {
  akagi: {
    id: 'akagi',
    brand: 'AKAGI',
    riderName: 'TAKAHASHI',
    number: 1,
    helmetMaker: 'KAZAMA',
    primary: '#d91424',
    secondary: '#ffffff',
    accent: '#151515',
    trim: '#f5c542',
    suitBase: '#c81220',
    suitYoke: '#ffffff',
    suitSide: '#16181e',
    suitStripe: '#ffffff',
    tailStyle: 'wing',
    sponsors: ['VORTEX', 'KRONOS', 'TAKARA', 'APEX']
  },
  shiden: {
    id: 'shiden',
    brand: 'SHIDEN',
    riderName: 'KOBAYASHI',
    number: 4,
    helmetMaker: 'AEROX',
    primary: '#1648b8',
    secondary: '#f59b22',
    accent: '#ffffff',
    trim: '#ffe042',
    suitBase: '#f07818',
    suitYoke: '#f8d238',
    suitSide: '#122c74',
    suitStripe: '#ffffff',
    tailStyle: 'centerStripe',
    sponsors: ['SOLARIS', 'VELOCE', 'KRONOS', 'ZENITH']
  },
  kaze: {
    id: 'kaze',
    brand: 'KAZE',
    riderName: 'MCKENZIE',
    number: 34,
    helmetMaker: 'KAZAMA',
    primary: '#0b68d8',
    secondary: '#ffffff',
    accent: '#e62222',
    trim: '#f7b518',
    suitBase: '#0b52c4',
    suitYoke: '#ffffff',
    suitSide: '#121828',
    suitStripe: '#ffffff',
    tailStyle: 'whiteCrown',
    sponsors: ['NITROX', 'KRONOS', 'HYPERION', 'VORTEX']
  },
  corsa: {
    id: 'corsa',
    brand: 'CORSA',
    riderName: 'BELLINI',
    number: 27,
    helmetMaker: 'VELOCE',
    primary: '#b80f1a',
    secondary: '#18181c',
    accent: '#f0d040',
    trim: '#ffffff',
    suitBase: '#b80f1a',
    suitYoke: '#18181c',
    suitSide: '#14151a',
    suitStripe: '#f0d040',
    tailStyle: 'italia',
    sponsors: ['VELOCE', 'HYPERION', 'KRONOS', 'SOLARIS']
  }
};

const liveryCache = new Map();

function toHexString(val, fallback = '#d91424') {
  if (typeof val === 'string' && val.length > 0) return val;
  if (typeof val === 'number' && Number.isFinite(val)) {
    return `#${(Math.floor(val) & 0xffffff).toString(16).padStart(6, '0')}`;
  }
  return fallback;
}

function resolveTheme(bikeOrId) {
  const id = typeof bikeOrId === 'string' ? bikeOrId : bikeOrId?.id || 'akagi';
  const spec = getBikeById(id);
  const preset = LIVERY_THEMES[id] || LIVERY_THEMES.akagi;
  const customPrimary = bikeOrId && typeof bikeOrId === 'object' && bikeOrId.colorPrimary !== undefined
    ? toHexString(bikeOrId.colorPrimary, preset.primary)
    : preset.primary;
  const customSecondary = bikeOrId && typeof bikeOrId === 'object' && bikeOrId.colorSecondary !== undefined
    ? toHexString(bikeOrId.colorSecondary, preset.secondary)
    : preset.secondary;
  const customAccent = bikeOrId && typeof bikeOrId === 'object' && bikeOrId.colorAccent !== undefined
    ? toHexString(bikeOrId.colorAccent, preset.accent)
    : preset.accent;

  return {
    ...preset,
    id: spec?.id || id,
    number: bikeOrId?.number ?? spec?.number ?? preset.number,
    primary: customPrimary,
    secondary: customSecondary,
    accent: customAccent
  };
}

function createSurface(width, height) {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
      if (ctx) {
        return { canvas, ctx, width, height, isMock: false };
      }
    } catch {
      // Fall through to mock canvas
    }
  }
  const mockCanvas = { width, height, isMockCanvas: true };
  return { canvas: mockCanvas, ctx: null, width, height, isMock: true };
}

function makeTexture(canvas, width, height, repeat = false) {
  const TexCtor = THREE.CanvasTexture || THREE.Texture;
  const tex = TexCtor ? new TexCtor(canvas) : { image: canvas };
  tex.image = canvas;
  tex.width = width;
  tex.height = height;
  const wrapMode = repeat
    ? (THREE.RepeatWrapping ?? 1000)
    : (THREE.ClampToEdgeWrapping ?? 1001);
  tex.wrapS = wrapMode;
  tex.wrapT = wrapMode;
  if (THREE.SRGBColorSpace) {
    tex.colorSpace = THREE.SRGBColorSpace;
  }
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

function drawStitchedLine(ctx, x1, y1, x2, y2, color = 'rgba(255,255,255,0.45)', lineWidth = 2) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

function drawSponsorPatch(ctx, x, y, w, h, text, bgColor, textColor, borderColor = '#ffffff') {
  ctx.save();
  ctx.fillStyle = bgColor;
  ctx.fillRect(x - w / 2, y - h / 2, w, h);
  if (borderColor) {
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = Math.max(1.5, h * 0.08);
    ctx.strokeRect(x - w / 2, y - h / 2, w, h);
  }
  ctx.fillStyle = textColor;
  ctx.font = `900 ${Math.floor(h * 0.62)}px Impact, "Arial Black", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + 1);
  ctx.restore();
}

function drawArchedText(ctx, text, cx, cy, radius, spreadAngle, font, fillStyle, strokeStyle, strokeWidth = 6) {
  ctx.save();
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const chars = String(text).split('');
  const n = chars.length;
  const step = n > 1 ? spreadAngle / (n - 1) : 0;
  const start = -spreadAngle / 2;

  for (let i = 0; i < n; i++) {
    const ang = start + i * step;
    ctx.save();
    ctx.translate(cx + Math.sin(ang) * radius, cy - Math.cos(ang) * radius);
    ctx.rotate(ang);
    if (strokeStyle && strokeWidth > 0) {
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = strokeWidth;
      ctx.strokeText(chars[i], 0, 0);
    }
    ctx.fillStyle = fillStyle;
    ctx.fillText(chars[i], 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

// ============================================================================
// 1. FAIRING & TANK BODYWORK TEXTURE (1024x512)
// u: 0 (rear) -> 1 (front nose), v: 0 (bottom belly) -> 1 (top tank/upper fairing)
// ============================================================================
export function createFairingTexture(bikeOrId) {
  const theme = resolveTheme(bikeOrId);
  const width = 1024;
  const height = 512;
  const { canvas, ctx } = createSurface(width, height);

  if (ctx) {
    // Base coat
    ctx.fillStyle = theme.primary;
    ctx.fillRect(0, 0, width, height);

    // Lower belly pan & diagonal speed wedge
    ctx.fillStyle = theme.secondary;
    ctx.beginPath();
    ctx.moveTo(0, height);
    ctx.lineTo(width, height);
    ctx.lineTo(width, height * 0.56);
    ctx.lineTo(width * 0.62, height * 0.42);
    ctx.lineTo(width * 0.15, height * 0.68);
    ctx.closePath();
    ctx.fill();

    // Accent racing slash between primary and secondary zones
    ctx.fillStyle = theme.accent;
    ctx.beginPath();
    ctx.moveTo(width * 0.08, height * 0.66);
    ctx.lineTo(width * 0.64, height * 0.38);
    ctx.lineTo(width, height * 0.50);
    ctx.lineTo(width, height * 0.58);
    ctx.lineTo(width * 0.62, height * 0.45);
    ctx.lineTo(width * 0.12, height * 0.73);
    ctx.closePath();
    ctx.fill();

    // Trim pinstripe
    ctx.strokeStyle = theme.trim;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(width * 0.06, height * 0.64);
    ctx.lineTo(width * 0.64, height * 0.36);
    ctx.lineTo(width, height * 0.48);
    ctx.stroke();

    // Upper tank stripe band (near top of canvas, v -> 1)
    ctx.fillStyle = theme.secondary;
    ctx.fillRect(0, 0, width, height * 0.11);
    ctx.fillStyle = theme.trim;
    ctx.fillRect(0, height * 0.11, width, 6);

    // Angled factory manufacturer brand across mid fairing
    ctx.save();
    ctx.translate(width * 0.52, height * 0.36);
    ctx.rotate(-0.18);
    ctx.font = 'italic 900 92px Impact, "Arial Black", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 10;
    ctx.strokeStyle = '#0d1016';
    ctx.strokeText(theme.brand, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(theme.brand, 0, 0);
    ctx.restore();

    // Lower belly pan sponsor decals
    const bellyTextCol = theme.secondary === '#ffffff' ? '#121620' : '#ffffff';
    ctx.save();
    ctx.fillStyle = bellyTextCol;
    ctx.font = 'italic 900 40px Impact, "Arial Black", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(theme.sponsors[0], width * 0.34, height * 0.85);
    ctx.fillText(theme.sponsors[1], width * 0.68, height * 0.85);
    ctx.restore();

    // Front nose number plate & racing number (near right edge u ~ 0.84)
    ctx.save();
    ctx.translate(width * 0.84, height * 0.30);
    ctx.fillStyle = theme.id === 'akagi' ? '#f5d428' : '#ffffff';
    ctx.strokeStyle = '#111318';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.roundRect(-82, -62, 164, 124, 18);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#101216';
    ctx.font = 'italic 900 94px Impact, "Arial Black", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(theme.number), 0, 4);
    ctx.restore();

    // Subtle fairing panel seam & Dzus rivets
    ctx.strokeStyle = 'rgba(0,0,0,0.32)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(width * 0.25, height * 0.22);
    ctx.lineTo(width * 0.74, height * 0.65);
    ctx.stroke();

    ctx.fillStyle = '#d4dce6';
    for (let i = 0; i < 6; i++) {
      const rx = width * (0.28 + i * 0.085);
      const ry = height * (0.25 + i * 0.068);
      ctx.beginPath();
      ctx.arc(rx, ry, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  return makeTexture(canvas, width, height, false);
}

// ============================================================================
// 2. TAIL COWL / SEAT UNIT TEXTURE (512x512)
// Mapped symmetrically across tail width (u: 0 left flank -> 0.5 center top -> 1 right flank)
// and along tail length (v: 0 rear exhaust tip -> 1 front seat bum-stop)
// Note: In Canvas2D, y=0 is top (v=1) and y=height is bottom (v=0)
// ============================================================================
export function createTailTexture(bikeOrId) {
  const theme = resolveTheme(bikeOrId);
  const width = 512;
  const height = 512;
  const { canvas, ctx } = createSurface(width, height);

  if (ctx) {
    if (theme.tailStyle === 'whiteCrown') {
      // Ref 1 style (Kaze): Crisp white upper tail cowl with blue & red flank flashes
      ctx.fillStyle = '#f6f8fc';
      ctx.fillRect(0, 0, width, height);

      // Left and right lower blue flank panels
      ctx.fillStyle = theme.primary;
      ctx.fillRect(0, 0, width * 0.24, height);
      ctx.fillRect(width * 0.76, 0, width * 0.24, height);

      // Red/orange angled sweeps along the tail edges (just like Ref 1)
      ctx.fillStyle = theme.accent;
      ctx.beginPath();
      ctx.moveTo(width * 0.14, 0);
      ctx.lineTo(width * 0.33, height * 0.78);
      ctx.lineTo(width * 0.24, height * 0.92);
      ctx.lineTo(width * 0.06, height * 0.35);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(width * 0.86, 0);
      ctx.lineTo(width * 0.67, height * 0.78);
      ctx.lineTo(width * 0.76, height * 0.92);
      ctx.lineTo(width * 0.94, height * 0.35);
      ctx.closePath();
      ctx.fill();
    } else if (theme.tailStyle === 'centerStripe') {
      // Ref 2 style (Shiden): Deep navy flanks with bold central orange-gold stripe & white borders
      ctx.fillStyle = theme.primary;
      ctx.fillRect(0, 0, width, height);

      // White border stripes
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(width * 0.31, 0, width * 0.38, height);

      // Central radiant orange-gold stripe
      ctx.fillStyle = theme.secondary;
      ctx.fillRect(width * 0.35, 0, width * 0.30, height);
    } else if (theme.tailStyle === 'italia') {
      // Corsa style: Black flanks, Rosso Corsa center, gold & tricolore stripes
      ctx.fillStyle = theme.secondary;
      ctx.fillRect(0, 0, width, height);

      ctx.fillStyle = theme.accent;
      ctx.fillRect(width * 0.27, 0, width * 0.46, height);

      ctx.fillStyle = theme.primary;
      ctx.fillRect(width * 0.30, 0, width * 0.40, height);

      // Subtle Italian tricolore center ribbon near tail tip
      ctx.fillStyle = '#009246';
      ctx.fillRect(width * 0.45, height * 0.62, width * 0.033, height * 0.24);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(width * 0.483, height * 0.62, width * 0.034, height * 0.24);
      ctx.fillStyle = '#ce2b37';
      ctx.fillRect(width * 0.517, height * 0.62, width * 0.033, height * 0.24);
    } else {
      // Akagi factory wing style: White top crown with crimson center wedge & gold trim
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);

      ctx.fillStyle = theme.primary;
      ctx.fillRect(0, 0, width * 0.22, height);
      ctx.fillRect(width * 0.78, 0, width * 0.22, height);

      ctx.beginPath();
      ctx.moveTo(width * 0.36, 0);
      ctx.lineTo(width * 0.64, 0);
      ctx.lineTo(width * 0.57, height * 0.85);
      ctx.lineTo(width * 0.43, height * 0.85);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = theme.trim;
      ctx.lineWidth = 6;
      ctx.stroke();
    }

    // Angled side number plates on both left and right tail flanks
    for (const side of [-1, 1]) {
      const cx = side < 0 ? width * 0.19 : width * 0.81;
      const cy = height * 0.44;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.fillStyle = theme.id === 'akagi' ? '#f5d428' : '#ffffff';
      ctx.strokeStyle = '#101218';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.roundRect(-52, -58, 104, 116, 12);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#101218';
      ctx.font = 'italic 900 68px Impact, "Arial Black", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(theme.number), 0, 2);
      ctx.restore();
    }

    // Rear tail-tip brand decal right above the exhaust cutout (visible from directly behind)
    ctx.save();
    ctx.fillStyle = theme.tailStyle === 'whiteCrown' ? '#122868' : '#ffffff';
    ctx.font = '900 22px Impact, "Arial Black", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(theme.brand, width * 0.5, height * 0.81);
    ctx.restore();

    // Dark recessed exhaust outlet shadow band at very bottom (v -> 0, y -> height)
    const grad = ctx.createLinearGradient(0, height * 0.87, 0, height);
    grad.addColorStop(0, 'rgba(10,12,16,0.0)');
    grad.addColorStop(0.4, 'rgba(10,12,16,0.85)');
    grad.addColorStop(1, 'rgba(5,6,8,0.98)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, height * 0.87, width, height * 0.13);
  }

  return makeTexture(canvas, width, height, false);
}

// ============================================================================
// 3. RIDER RACING LEATHERS TEXTURE (1024x1024)
// Mapped so the rider's back (seen from rear chase cam) occupies u in [0.1, 0.9],
// v from 0 (hips/pelvis) to 1 (neck collar).
// Canvas y = 0 is top (v = 1, collar/shoulders), y = height is bottom (v = 0, hips).
// ============================================================================
export function createRiderLeathersTexture(bikeOrId) {
  const theme = resolveTheme(bikeOrId);
  const width = 1024;
  const height = 1024;
  const { canvas, ctx } = createSurface(width, height);

  if (ctx) {
    // 1. Base leather color
    ctx.fillStyle = theme.suitBase;
    ctx.fillRect(0, 0, width, height);

    // Subtle leather grain & perforated torso breathability dots
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (let y = 160; y < 760; y += 14) {
      for (let x = 220; x < 804; x += 14) {
        if ((x + y) % 28 === 0) {
          ctx.fillRect(x, y, 3, 3);
        }
      }
    }

    // 2. Dark anatomical side-lat panels (gives unmistakable V-taper silhouette from behind)
    ctx.fillStyle = theme.suitSide;
    // Left lat/rib panel
    ctx.beginPath();
    ctx.moveTo(0, height * 0.18);
    ctx.lineTo(width * 0.25, height * 0.24);
    ctx.lineTo(width * 0.31, height * 0.68);
    ctx.lineTo(width * 0.24, height * 0.84);
    ctx.lineTo(0, height * 0.84);
    ctx.closePath();
    ctx.fill();

    // Right lat/rib panel
    ctx.beginPath();
    ctx.moveTo(width, height * 0.18);
    ctx.lineTo(width * 0.75, height * 0.24);
    ctx.lineTo(width * 0.69, height * 0.68);
    ctx.lineTo(width * 0.76, height * 0.84);
    ctx.lineTo(width, height * 0.84);
    ctx.closePath();
    ctx.fill();

    // White/trim piping along the V-taper seams
    ctx.strokeStyle = theme.suitStripe;
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.moveTo(width * 0.23, height * 0.20);
    ctx.lineTo(width * 0.31, height * 0.68);
    ctx.lineTo(width * 0.26, height * 0.98);
    ctx.moveTo(width * 0.77, height * 0.20);
    ctx.lineTo(width * 0.69, height * 0.68);
    ctx.lineTo(width * 0.74, height * 0.98);
    ctx.stroke();

    // 3. Upper Shoulder Yoke (y: 0 -> 0.25, matches Ref 1 & Ref 2 contrast shoulder yoke)
    ctx.fillStyle = theme.suitYoke;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(width, 0);
    ctx.lineTo(width, height * 0.24);
    ctx.quadraticCurveTo(width * 0.5, height * 0.15, 0, height * 0.24);
    ctx.closePath();
    ctx.fill();

    // Top shoulder accent band (orange/red/gold across upper traps like Ref 1 & Ref 2)
    ctx.fillStyle = theme.id === 'kaze' ? '#e84a18' : theme.accent;
    ctx.beginPath();
    ctx.moveTo(width * 0.12, height * 0.04);
    ctx.quadraticCurveTo(width * 0.5, height * 0.01, width * 0.88, height * 0.04);
    ctx.lineTo(width * 0.84, height * 0.12);
    ctx.quadraticCurveTo(width * 0.5, height * 0.08, width * 0.16, height * 0.12);
    ctx.closePath();
    ctx.fill();

    // Shoulder yoke bottom border & double stitch
    ctx.strokeStyle = theme.trim;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(0, height * 0.24);
    ctx.quadraticCurveTo(width * 0.5, height * 0.15, width, height * 0.24);
    ctx.stroke();
    drawStitchedLine(ctx, width * 0.1, height * 0.22, width * 0.9, height * 0.22, 'rgba(0,0,0,0.45)', 3);

    // 4. HUGE ARCHED BRAND NAME ACROSS UPPER BACK (like Ref 1, strictly fictional!)
    drawArchedText(
      ctx,
      theme.brand,
      width * 0.5,
      height * 0.62,
      height * 0.31,
      0.78,
      '900 92px Impact, "Arial Black", sans-serif',
      '#ffffff',
      '#0b0e14',
      15
    );

    // 5. AERODYNAMIC SPEED HUMP & STACKED SPONSOR PATCHES (y: 0.34 -> 0.64)
    ctx.save();
    // Subtle sculpted shading around the aero hump pad
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(width * 0.37, height * 0.33);
    ctx.quadraticCurveTo(width * 0.5, height * 0.30, width * 0.63, height * 0.33);
    ctx.lineTo(width * 0.58, height * 0.63);
    ctx.quadraticCurveTo(width * 0.5, height * 0.66, width * 0.42, height * 0.63);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Stacked sponsor patches down the spine (Ref 1 & Ref 2 signature detail)
    drawSponsorPatch(
      ctx,
      width * 0.5,
      height * 0.39,
      210,
      54,
      theme.sponsors[0],
      '#101828',
      '#ffffff',
      theme.trim
    );
    drawSponsorPatch(
      ctx,
      width * 0.5,
      height * 0.47,
      230,
      52,
      theme.sponsors[1],
      '#ffffff',
      '#121620',
      '#d91424'
    );
    drawSponsorPatch(
      ctx,
      width * 0.5,
      height * 0.55,
      200,
      50,
      `${theme.riderName} #${theme.number}`,
      theme.primary,
      '#ffffff',
      '#ffffff'
    );

    // 6. LOWER BACK ACCORDION STRETCH RIBS & WAIST BELT (y: 0.64 -> 0.80)
    ctx.fillStyle = '#f2f5fa';
    ctx.fillRect(width * 0.29, height * 0.65, width * 0.42, height * 0.13);
    ctx.strokeStyle = '#181c24';
    ctx.lineWidth = 5;
    ctx.strokeRect(width * 0.29, height * 0.65, width * 0.42, height * 0.13);

    // Accordion pleat lines
    ctx.strokeStyle = 'rgba(16, 20, 30, 0.35)';
    ctx.lineWidth = 4;
    for (let r = 1; r <= 4; r++) {
      const ry = height * (0.65 + r * 0.025);
      ctx.beginPath();
      ctx.moveTo(width * 0.30, ry);
      ctx.lineTo(width * 0.70, ry);
      ctx.stroke();
    }

    // Wing/Star emblem on the waist belt (like the white star emblem at the bottom of the back in Ref 1)
    ctx.save();
    ctx.translate(width * 0.5, height * 0.715);
    ctx.fillStyle = theme.primary;
    ctx.strokeStyle = '#101218';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-85, 10);
    ctx.lineTo(-22, -16);
    ctx.lineTo(0, -28);
    ctx.lineTo(22, -16);
    ctx.lineTo(85, 10);
    ctx.lineTo(28, 18);
    ctx.lineTo(0, 8);
    ctx.lineTo(-28, 18);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // 7. PELVIS / HIPS & SEAT REGION (y: 0.80 -> 1.0)
    ctx.fillStyle = '#14171f';
    ctx.fillRect(width * 0.34, height * 0.80, width * 0.32, height * 0.20);

    // Curved hip stripes flowing into the thighs on left and right
    ctx.fillStyle = theme.suitYoke;
    ctx.fillRect(width * 0.08, height * 0.82, width * 0.22, height * 0.18);
    ctx.fillRect(width * 0.70, height * 0.82, width * 0.22, height * 0.18);

    // Neck collar dark neoprene trim at very top (y: 0 -> 0.035)
    ctx.fillStyle = '#12151c';
    ctx.fillRect(0, 0, width, height * 0.032);
  }

  return makeTexture(canvas, width, height, false);
}

export const createLeathersTexture = createRiderLeathersTexture;

// ============================================================================
// 4. RIDER LIMBS & KNEE SLIDERS TEXTURE (512x512)
// Used on thighs, shins, upper arms, and forearms: longitudinal leather stripes,
// accordion flex zones above knee/elbow, and double-stitched seams.
// ============================================================================
export function createRiderLimbsTexture(bikeOrId) {
  const theme = resolveTheme(bikeOrId);
  const width = 512;
  const height = 512;
  const { canvas, ctx } = createSurface(width, height);

  if (ctx) {
    // Base team leather color so proximal shoulder/hip joints blend seamlessly into the torso/pelvis
    ctx.fillStyle = theme.suitBase;
    ctx.fillRect(0, 0, width, height);

    // Inner-facing dark Kevlar stretch fabric along seams
    ctx.fillStyle = '#161922';
    ctx.fillRect(0, 0, width * 0.16, height);
    ctx.fillRect(width * 0.84, 0, width * 0.16, height);

    // Dual outer & rear racing stripes so sleeve/thigh striping reads cleanly from behind
    for (const cx of [width * 0.28, width * 0.72]) {
      ctx.fillStyle = theme.suitYoke;
      ctx.fillRect(cx - width * 0.09, height * 0.16, width * 0.18, height * 0.84);
      ctx.fillStyle = theme.primary;
      ctx.fillRect(cx - width * 0.025, height * 0.16, width * 0.05, height * 0.84);
      drawStitchedLine(ctx, cx - width * 0.09, height * 0.16, cx - width * 0.09, height, 'rgba(255,255,255,0.45)', 2);
      drawStitchedLine(ctx, cx + width * 0.09, height * 0.16, cx + width * 0.09, height, 'rgba(255,255,255,0.45)', 2);
    }

    // Subtle upper cuff band blending shoulder/hip into sleeve/thigh
    const topGrad = ctx.createLinearGradient(0, 0, 0, height * 0.22);
    topGrad.addColorStop(0, theme.suitBase);
    topGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = topGrad;
    ctx.fillRect(0, 0, width, height * 0.22);

    // Accordion leather stretch ribs near the distal knee/elbow joint (y: 0.70 -> 0.86)
    ctx.fillStyle = '#e8ecf2';
    ctx.fillRect(width * 0.22, height * 0.70, width * 0.56, height * 0.14);
    ctx.strokeStyle = '#1a1e26';
    ctx.lineWidth = 4;
    for (let i = 0; i < 5; i++) {
      const ry = height * (0.715 + i * 0.026);
      ctx.beginPath();
      ctx.moveTo(width * 0.22, ry);
      ctx.lineTo(width * 0.78, ry);
      ctx.stroke();
    }
  }

  return makeTexture(canvas, width, height, false);
}

// ============================================================================
// 5. PAINTED 1990s GP HELMET TEXTURE (512x512)
// u = 0.5 is the BACK of the helmet (facing the chase camera), u = 0/1 is front chin/visor.
// v = 0 (y = height) is bottom neck roll, v = 1 (y = 0) is top crown.
// ============================================================================
export function createHelmetTexture(bikeOrId) {
  const theme = resolveTheme(bikeOrId);
  const width = 512;
  const height = 512;
  const { canvas, ctx } = createSurface(width, height);

  if (ctx) {
    // Base gloss shell coat
    ctx.fillStyle = theme.secondary === '#18181c' ? '#ffffff' : theme.secondary;
    ctx.fillRect(0, 0, width, height);

    // Crown color dome (top 35% of helmet)
    ctx.fillStyle = theme.primary;
    ctx.fillRect(0, 0, width, height * 0.34);

    // Sweeping chevrons & wing graphics converging toward the back center (x = width * 0.5)
    ctx.fillStyle = theme.primary;
    ctx.beginPath();
    ctx.moveTo(0, height * 0.42);
    ctx.lineTo(width * 0.5, height * 0.74);
    ctx.lineTo(width, height * 0.42);
    ctx.lineTo(width, height * 0.62);
    ctx.lineTo(width * 0.5, height * 0.90);
    ctx.lineTo(0, height * 0.62);
    ctx.closePath();
    ctx.fill();

    // High-contrast accent lightning/chevron stripes (yellow/red/gold like Ref 1 & Ref 2 helmets)
    ctx.fillStyle = theme.trim;
    ctx.beginPath();
    ctx.moveTo(0, height * 0.32);
    ctx.lineTo(width * 0.5, height * 0.62);
    ctx.lineTo(width, height * 0.32);
    ctx.lineTo(width, height * 0.41);
    ctx.lineTo(width * 0.5, height * 0.71);
    ctx.lineTo(0, height * 0.41);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = theme.accent;
    ctx.beginPath();
    ctx.moveTo(width * 0.15, height * 0.18);
    ctx.lineTo(width * 0.5, height * 0.48);
    ctx.lineTo(width * 0.85, height * 0.18);
    ctx.lineTo(width * 0.76, height * 0.12);
    ctx.lineTo(width * 0.5, height * 0.36);
    ctx.lineTo(width * 0.24, height * 0.12);
    ctx.closePath();
    ctx.fill();

    // Central vertical racing stripe over crown to rear spoiler
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(width * 0.46, 0, width * 0.08, height * 0.86);
    ctx.strokeStyle = '#101218';
    ctx.lineWidth = 4;
    ctx.strokeRect(width * 0.46, 0, width * 0.08, height * 0.86);

    // Twin rear air extractor vents on back of helmet (u ~ 0.42 & 0.58)
    ctx.fillStyle = '#141820';
    ctx.fillRect(width * 0.38, height * 0.34, width * 0.06, height * 0.04);
    ctx.fillRect(width * 0.56, height * 0.34, width * 0.06, height * 0.04);

    // Rear helmet brand badge & rider number right above the neck roll (u = 0.5, y ~ 0.77)
    drawSponsorPatch(
      ctx,
      width * 0.5,
      height * 0.77,
      116,
      36,
      `${theme.helmetMaker} #${theme.number}`,
      '#10131a',
      theme.trim,
      '#ffffff'
    );

    // Front helmet brow decal (at u = 0 and u = 1 wrap edges, y ~ 0.36)
    ctx.fillStyle = '#10131a';
    ctx.fillRect(0, height * 0.32, width * 0.12, height * 0.07);
    ctx.fillRect(width * 0.88, height * 0.32, width * 0.12, height * 0.07);

    // Bottom dark rubber neck-roll trim (y: 0.88 -> 1.0)
    ctx.fillStyle = '#101216';
    ctx.fillRect(0, height * 0.88, width, height * 0.12);
    ctx.strokeStyle = theme.trim;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(0, height * 0.88);
    ctx.lineTo(width, height * 0.88);
    ctx.stroke();
  }

  return makeTexture(canvas, width, height, true);
}

// ============================================================================
// 6. RACING SLICK TIRE & SIDEWALL TEXTURE (512x512)
// LatheGeometry maps u (0..1) around wheel circumference and v (0..1) from
// left rim bead (v=0) -> left sidewall -> slick tread center (v=0.5) -> right sidewall -> right bead (v=1).
// ============================================================================
export function createTireSidewallTexture() {
  const width = 512;
  const height = 512;
  const { canvas, ctx } = createSurface(width, height);

  if (ctx) {
    // Base vulcanized dark slick rubber
    ctx.fillStyle = '#17191e';
    ctx.fillRect(0, 0, width, height);

    // Center heat-cycled contact band (v in 0.25..0.75 -> y in 128..384)
    const treadGrad = ctx.createLinearGradient(0, height * 0.20, 0, height * 0.80);
    treadGrad.addColorStop(0, '#1e2128');
    treadGrad.addColorStop(0.2, '#131519');
    treadGrad.addColorStop(0.5, '#0e1014');
    treadGrad.addColorStop(0.8, '#131519');
    treadGrad.addColorStop(1, '#1e2128');
    ctx.fillStyle = treadGrad;
    ctx.fillRect(0, height * 0.20, width, height * 0.60);

    // Fine circumferential rubber grain streaks across the tread
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 2;
    for (let y = Math.floor(height * 0.22); y < Math.floor(height * 0.78); y += 6) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Sidewall bands (top y: 0..0.18 and bottom y: 0.82..1.0)
    ctx.fillStyle = '#20242c';
    ctx.fillRect(0, 0, width, height * 0.18);
    ctx.fillRect(0, height * 0.82, width, height * 0.18);

    // Sidewall molded ring ribs
    ctx.strokeStyle = '#2c313b';
    ctx.lineWidth = 3;
    for (const sy of [height * 0.05, height * 0.15, height * 0.85, height * 0.95]) {
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(width, sy);
      ctx.stroke();
    }

    // Fictional tire manufacturer stencils on both sidewalls
    ctx.fillStyle = '#e8edf5';
    ctx.font = 'italic 900 22px Impact, "Arial Black", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('KRONOS RADIAL GP', width * 0.25, height * 0.10);
    ctx.fillText('180/55 ZR17', width * 0.75, height * 0.10);
    ctx.fillText('KRONOS RADIAL GP', width * 0.25, height * 0.90);
    ctx.fillText('180/55 ZR17', width * 0.75, height * 0.90);

    // Yellow/red tire compound balance dots on sidewall
    ctx.fillStyle = '#f5c542';
    ctx.beginPath();
    ctx.arc(width * 0.52, height * 0.10, 6, 0, Math.PI * 2);
    ctx.arc(width * 0.52, height * 0.90, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  return makeTexture(canvas, width, height, true);
}

// ============================================================================
// MAIN LIVERY BUNDLE FACTORY & CACHE
// ============================================================================
export function createLiverySet(bikeOrId = BIKES[0]) {
  const theme = resolveTheme(bikeOrId);
  const cacheKey = `${theme.id}_${theme.primary}_${theme.secondary}_${theme.accent}_${theme.number}`;
  if (liveryCache.has(cacheKey)) {
    return liveryCache.get(cacheKey);
  }

  const fairing = createFairingTexture(theme);
  const tail = createTailTexture(theme);
  const leathers = createRiderLeathersTexture(theme);
  const limbs = createRiderLimbsTexture(theme);
  const helmet = createHelmetTexture(theme);
  const tireSidewall = createTireSidewallTexture();

  const bundle = {
    id: theme.id,
    brand: theme.brand,
    riderName: theme.riderName,
    number: theme.number,
    theme,
    fairing,
    fairingTexture: fairing,
    body: fairing,
    livery: fairing,
    tail,
    tailTexture: tail,
    seatCowl: tail,
    leathers,
    leathersTexture: leathers,
    riderLeathers: leathers,
    suit: leathers,
    back: leathers,
    limbs,
    limbsTexture: limbs,
    kneeSliders: limbs,
    helmet,
    helmetTexture: helmet,
    tire: tireSidewall,
    tireSidewall
  };

  liveryCache.set(cacheKey, bundle);
  return bundle;
}

export const getBikeLivery = createLiverySet;
export const getLiveryForBike = createLiverySet;
export const createBikeLivery = createLiverySet;

export function clearLiveryCache() {
  liveryCache.clear();
}
