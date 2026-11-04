// Desktop Bonk — shared helpers. All game scripts attach to the global `DB` namespace
// so they work as classic <script> files inside WKWebView (file://) and inside Node tests.
(function (root) {
  'use strict';
  const DB = root.DB = root.DB || {};

  const U = DB.util = {};
  U.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
  U.len = (x, y) => Math.sqrt(x * x + y * y);
  U.dist = (a, b) => Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));
  U.deg = (d) => (d * Math.PI) / 180;
  U.TAU = Math.PI * 2;

  // Deterministic RNG (mulberry32) so tests and replays are reproducible.
  U.rng = function (seed) {
    let a = (seed >>> 0) || 0x9e3779b9;
    const f = function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    f.range = (lo, hi) => lo + (hi - lo) * f();
    f.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * f());
    f.pick = (arr) => arr[Math.floor(f() * arr.length)];
    f.gauss = () => {
      let u = 0, v = 0;
      while (u === 0) u = f();
      while (v === 0) v = f();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(U.TAU * v);
    };
    f.shuffle = (arr) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(f() * (i + 1));
        const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      }
      return arr;
    };
    return f;
  };

  U.deepClone = (o) => JSON.parse(JSON.stringify(o));

  U.deepMerge = function (target, src) {
    if (!src || typeof src !== 'object') return target;
    for (const k of Object.keys(src)) {
      const v = src[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if (!target[k] || typeof target[k] !== 'object' || Array.isArray(target[k])) target[k] = {};
        U.deepMerge(target[k], v);
      } else {
        target[k] = v;
      }
    }
    return target;
  };

  // Polygon helpers ---------------------------------------------------------
  U.polyArea = function (pts) {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return a / 2;
  };

  U.isConvex = function (pts) {
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length], c = pts[(i + 2) % pts.length];
      const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (Math.abs(cr) < 1e-9) continue;
      const sg = cr > 0 ? 1 : -1;
      if (s === 0) s = sg; else if (s !== sg) return false;
    }
    return true;
  };

  // Ear-clipping triangulation followed by greedy merging into convex pieces
  // of at most `maxVerts` vertices (Box2D polygons must be convex, <= 8 verts).
  U.convexDecompose = function (input, maxVerts) {
    maxVerts = maxVerts || 8;
    let pts = input.map((p) => [p[0], p[1]]);
    if (U.polyArea(pts) < 0) pts.reverse();
    if (pts.length <= maxVerts && U.isConvex(pts)) return [pts];
    // ear clipping
    const tris = [];
    const idx = pts.map((_, i) => i);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const inTri = (p, a, b, c) => cross(a, b, p) >= -1e-9 && cross(b, c, p) >= -1e-9 && cross(c, a, p) >= -1e-9;
    let guard = 0;
    while (idx.length > 3 && guard++ < 5000) {
      let clipped = false;
      for (let i = 0; i < idx.length; i++) {
        const ia = idx[(i + idx.length - 1) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length];
        const a = pts[ia], b = pts[ib], c = pts[ic];
        if (cross(a, b, c) <= 1e-9) continue;
        let ok = true;
        for (const j of idx) {
          if (j === ia || j === ib || j === ic) continue;
          if (inTri(pts[j], a, b, c)) { ok = false; break; }
        }
        if (!ok) continue;
        tris.push([ia, ib, ic]);
        idx.splice(i, 1);
        clipped = true;
        break;
      }
      if (!clipped) break;
    }
    if (idx.length === 3) tris.push([idx[0], idx[1], idx[2]]);
    // greedy merge of adjacent convex pieces (Hertel–Mehlhorn style)
    let pieces = tris.map((t) => t.slice());
    let merged = true;
    while (merged) {
      merged = false;
      outer: for (let i = 0; i < pieces.length; i++) {
        for (let j = i + 1; j < pieces.length; j++) {
          const m = mergePieces(pieces[i], pieces[j]);
          if (m && m.length <= maxVerts && U.isConvex(m.map((k) => pts[k]))) {
            pieces[i] = m;
            pieces.splice(j, 1);
            merged = true;
            break outer;
          }
        }
      }
    }
    return pieces.map((p) => p.map((k) => pts[k])).filter((p) => Math.abs(U.polyArea(p)) > 1e-4);
  };

  function mergePieces(a, b) {
    // find shared edge (a[i],a[i+1]) == (b[j+1],b[j])
    for (let i = 0; i < a.length; i++) {
      const a0 = a[i], a1 = a[(i + 1) % a.length];
      for (let j = 0; j < b.length; j++) {
        const b0 = b[j], b1 = b[(j + 1) % b.length];
        if (a0 === b1 && a1 === b0) {
          const out = [];
          for (let k = 0; k < a.length; k++) out.push(a[(i + 1 + k) % a.length]); // starts at a1, ends at a0
          // insert b vertices between a0 and a1 (excluding shared)
          for (let k = 2; k < b.length; k++) out.push(b[(j + k) % b.length]);
          return out;
        }
      }
    }
    return null;
  }

  // Arc made of quad segments: useful for bowls, rings and funnels.
  U.arcQuads = function (cx, cy, rIn, rOut, a0, a1, n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const t0 = a0 + ((a1 - a0) * i) / n, t1 = a0 + ((a1 - a0) * (i + 1)) / n;
      out.push([
        [cx + Math.cos(t0) * rIn, cy + Math.sin(t0) * rIn],
        [cx + Math.cos(t0) * rOut, cy + Math.sin(t0) * rOut],
        [cx + Math.cos(t1) * rOut, cy + Math.sin(t1) * rOut],
        [cx + Math.cos(t1) * rIn, cy + Math.sin(t1) * rIn],
      ]);
    }
    return out;
  };

  U.now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
})(typeof window !== 'undefined' ? window : globalThis);
