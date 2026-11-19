// Realistic Earth renderer — Canvas 2D, zero dependencies.
// Maps NASA public-domain equirectangular textures (Blue Marble day,
// Black Marble city lights) onto the orthographic sphere per-pixel using
// precomputed lookup tables, with a day/night terminator computed from the
// REAL current solar position (low-precision astronomical algorithm, ~0.01°).
//
// Performance design (older-ThinkPad target):
//  - texture sphere rendered at capped resolution (<= 440px), upscaled once
//  - per-pixel base vectors precomputed; lambda-only rotation uses a cheap
//    fast path (no per-pixel trig); tilt changes trigger a rebase
//  - day/night/specular colors pre-baked into typed arrays (no per-pixel pow)
//  - caller throttles updates (~30fps); particle layer stays at 60fps
//
// Projection convention matches globe.js Geo.projectVec exactly:
//   c = toVec(-lambda, -phi); east/north tangent basis; v = nx*east + ny*north + nz*c.

const DEG = Math.PI / 180;
const TWO_PI = Math.PI * 2;

/** Subsolar point [lonDeg, latDeg] for a UTC timestamp (low-precision solar algorithm). */
export function subsolarPoint(dateMs) {
  const n = dateMs / 86400000 - 10957.5; // days since J2000.0
  const L = (280.460 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * DEG;
  const lam = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * DEG;
  const eps = (23.439 - 0.0000004 * n) * DEG;
  const dec = Math.asin(Math.sin(eps) * Math.sin(lam));
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
  const gmst = (280.46061837 + 360.98564736629 * n) % 360;
  let lon = ra / DEG - gmst;
  lon = ((lon + 180) % 360 + 360) % 360 - 180;
  return [lon, dec / DEG];
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("texture load failed: " + url));
    img.src = url;
  });
}

function textureData(img, w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const cx = c.getContext("2d", { willReadFrequently: true });
  cx.drawImage(img, 0, 0, w, h);
  return cx.getImageData(0, 0, w, h).data;
}

/**
 * Create the renderer. Resolves once textures are decoded; rejects if any
 * texture fails (caller falls back to the vector globe).
 */
export async function createEarthRenderer({
  dayUrl = "/textures/earth_atmos_2048.jpg",
  nightUrl = "/textures/earth_lights_2048.png",
  specUrl = "/textures/earth_specular_2048.jpg",
  textureWidth = 1024,
} = {}) {
  const [dayImg, nightImg, specImg] = await Promise.all([loadImage(dayUrl), loadImage(nightUrl), loadImage(specUrl)]);
  const TW = textureWidth, TH = textureWidth / 2;
  const dayRaw = textureData(dayImg, TW, TH);
  const nightRaw = textureData(nightImg, TW, TH);
  const specRaw = textureData(specImg, TW, TH);

  // Pre-bake day colors: recognizable Earth (blue oceans, land, clouds),
  // gently cooled and darkened to sit inside the dark observatory UI.
  const day = new Uint8ClampedArray(TW * TH * 3);
  for (let i = 0, j = 0; i < dayRaw.length; i += 4, j += 3) {
    const r = dayRaw[i], g = dayRaw[i + 1], b = dayRaw[i + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const desat = 0.12;
    day[j]     = (r * (1 - desat) + lum * desat) * 0.95 + 2;
    day[j + 1] = (g * (1 - desat) + lum * desat) * 0.97 + 3;
    day[j + 2] = (b * (1 - desat) + lum * desat) * 1.06 + 6;
  }
  // Pre-bake amber city lights over a near-black night base.
  const night = new Uint8ClampedArray(TW * TH * 3);
  for (let i = 0, j = 0; i < nightRaw.length; i += 4, j += 3) {
    const v = Math.max(nightRaw[i], nightRaw[i + 1], nightRaw[i + 2]);
    const glow = Math.pow(v / 255, 1.35) * 235;
    night[j]     = 7 + glow * 1.0;
    night[j + 1] = 11 + glow * 0.72;
    night[j + 2] = 19 + glow * 0.42;
  }
  // Ocean mask for subtle sun glint.
  const spec = new Uint8Array(TW * TH);
  for (let i = 0, j = 0; i < specRaw.length; i += 4, j++) spec[j] = specRaw[i];

  let S = 0, canvas = null, cx2d = null, imgData = null, out = null;
  let idx = null, nx = null, ny = null, nz = null, limb = null;
  let baseLon = null, rowOf = null, rvx = null, rvy = null, rvz = null;
  let rebasedPhi = NaN, rebasedLambda = NaN, count = 0;

  function configure(scalePx, dpr) {
    const target = Math.max(192, Math.min(480, Math.round(scalePx * 2 * Math.min(dpr, 1.5) * 0.70)));
    if (target === S) return;
    S = target;
    canvas = document.createElement("canvas");
    canvas.width = S; canvas.height = S;
    cx2d = canvas.getContext("2d");
    imgData = cx2d.createImageData(S, S);
    out = imgData.data;
    const cap = S * S;
    idx = new Uint32Array(cap); nx = new Float32Array(cap); ny = new Float32Array(cap);
    nz = new Float32Array(cap); limb = new Float32Array(cap);
    baseLon = new Float32Array(cap); rowOf = new Uint32Array(cap);
    rvx = new Float32Array(cap); rvy = new Float32Array(cap); rvz = new Float32Array(cap);
    count = 0;
    const half = S / 2;
    for (let y = 0; y < S; y++) {
      const py = (y + 0.5 - half) / half;
      for (let x = 0; x < S; x++) {
        const px = (x + 0.5 - half) / half;
        const r2 = px * px + py * py;
        if (r2 > 1) continue;
        const k = count++;
        idx[k] = (y * S + x) * 4;
        nx[k] = px; ny[k] = -py; nz[k] = Math.sqrt(1 - r2);
        limb[k] = 0.42 + 0.58 * Math.pow(nz[k], 0.65); // limb darkening
      }
    }
    rebasedPhi = NaN; // force rebase
  }

  function rebase(lambdaDeg, phiDeg) {
    const lonC = -lambdaDeg * DEG, latC = -phiDeg * DEG;
    const sl = Math.sin(lonC), cl = Math.cos(lonC), sp = Math.sin(latC), cp = Math.cos(latC);
    const ex = -sl, ey = cl, ez = 0;
    const nxx = -sp * cl, nxy = -sp * sl, nzz = cp;
    const cxx = cp * cl, cxy = cp * sl, czz = sp;
    for (let k = 0; k < count; k++) {
      const a = nx[k], b = ny[k], c = nz[k];
      const vx = a * ex + b * nxx + c * cxx;
      const vy = a * ey + b * nxy + c * cxy;
      const vz = a * ez + b * nzz + c * czz;
      rvx[k] = vx; rvy[k] = vy; rvz[k] = vz;
      baseLon[k] = Math.atan2(vy, vx);
      const lat = Math.asin(Math.max(-1, Math.min(1, vz)));
      let row = Math.floor((0.5 - lat / Math.PI) * TH);
      if (row >= TH) row = TH - 1; if (row < 0) row = 0;
      rowOf[k] = row * TW;
    }
    rebasedPhi = phiDeg; rebasedLambda = lambdaDeg;
  }

  /** Render the sphere for the given rotation and time. Returns the canvas. */
  function render(lambdaDeg, phiDeg, dateMs) {
    if (!S) return null;
    if (Math.abs(phiDeg - rebasedPhi) > 0.01 || Number.isNaN(rebasedPhi)) rebase(lambdaDeg, phiDeg);
    const dLambda = (lambdaDeg - rebasedLambda) * DEG;
    const cosL = Math.cos(dLambda), sinL = Math.sin(dLambda);
    // Sun vector in world space, rotated into the rebase frame (Rz(+dLambda)).
    const [sLon, sLat] = subsolarPoint(dateMs);
    const sl = sLon * DEG, sp = sLat * DEG, cp = Math.cos(sp);
    const sx0 = cp * Math.cos(sl), sy0 = cp * Math.sin(sl), sz0 = Math.sin(sp);
    const sx = sx0 * cosL - sy0 * sinL;
    const sy = sx0 * sinL + sy0 * cosL;
    const sz = sz0;
    const invTwoPi = 1 / TWO_PI;
    for (let k = 0; k < count; k++) {
      let u = (baseLon[k] - dLambda) * invTwoPi + 0.5;
      u -= Math.floor(u);
      let col = (u * TW) | 0; if (col >= TW) col = TW - 1;
      const t3 = (rowOf[k] + col) * 3;
      const cosSun = rvx[k] * sx + rvy[k] * sy + rvz[k] * sz;
      // Smooth twilight band.
      let t = (cosSun + 0.07) / 0.16;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      t = t * t * (3 - 2 * t);
      const it = 1 - t;
      // Warm sunset band along the terminator (peaks mid-twilight).
      const tw = t * it * 4;
      let r = day[t3] * t + night[t3] * it + 16 * tw;
      let g = day[t3 + 1] * t + night[t3 + 1] * it + 7 * tw;
      let b = day[t3 + 2] * t + night[t3 + 2] * it;
      // Subtle ocean sun-glint near the subsolar point.
      if (cosSun > 0.55) {
        const c2 = cosSun * cosSun, c6 = c2 * c2 * c2;
        const glint = spec[rowOf[k] + col] * c6 * 0.10;
        r += glint; g += glint; b += glint * 1.15;
      }
      const lm = limb[k];
      const o = idx[k];
      out[o] = r * lm; out[o + 1] = g * lm; out[o + 2] = b * lm; out[o + 3] = 255;
    }
    cx2d.putImageData(imgData, 0, 0);
    return canvas;
  }

  return { configure, render, subsolarPoint, get size() { return S; } };
}
