/* Auto croquis - núcleo de análisis (sin dependencias).
   Imagen en gris -> bordes (Canny) -> trazado -> simplificación -> geometría. */
(function (root) {
  'use strict';

  const PI = Math.PI;

  /* ---------- Filtros y bordes ---------- */

  function gaussBlur(src, W, H, sigma) {
    if (sigma < 0.3) return Float32Array.from(src);
    const r = Math.max(1, Math.ceil(sigma * 3));
    const k = new Float32Array(2 * r + 1);
    let sum = 0;
    for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma)); sum += k[i + r]; }
    for (let i = 0; i < k.length; i++) k[i] /= sum;
    const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let s = 0;
        for (let i = -r; i <= r; i++) {
          let xx = x + i; if (xx < 0) xx = 0; else if (xx >= W) xx = W - 1;
          s += src[y * W + xx] * k[i + r];
        }
        tmp[y * W + x] = s;
      }
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let s = 0;
        for (let i = -r; i <= r; i++) {
          let yy = y + i; if (yy < 0) yy = 0; else if (yy >= H) yy = H - 1;
          s += tmp[yy * W + x] * k[i + r];
        }
        out[y * W + x] = s;
      }
    }
    return out;
  }

  function canny(gray, W, H, sigma, sens) {
    const g = gaussBlur(gray, W, H, sigma);
    const mag = new Float32Array(W * H), dir = new Uint8Array(W * H);
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        const gx = -g[i - W - 1] + g[i - W + 1] - 2 * g[i - 1] + 2 * g[i + 1] - g[i + W - 1] + g[i + W + 1];
        const gy = -g[i - W - 1] - 2 * g[i - W] - g[i - W + 1] + g[i + W - 1] + 2 * g[i + W] + g[i + W + 1];
        mag[i] = Math.hypot(gx, gy);
        let a = Math.atan2(gy, gx) * 180 / PI; if (a < 0) a += 180;
        dir[i] = (a < 22.5 || a >= 157.5) ? 0 : a < 67.5 ? 1 : a < 112.5 ? 2 : 3;
      }
    }
    const nms = new Float32Array(W * H);
    const vals = [];
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x, m = mag[i];
        if (m < 1) continue;
        let a, b;
        switch (dir[i]) {
          case 0: a = mag[i - 1]; b = mag[i + 1]; break;
          case 1: a = mag[i - W - 1]; b = mag[i + W + 1]; break;
          case 2: a = mag[i - W]; b = mag[i + W]; break;
          default: a = mag[i - W + 1]; b = mag[i + W - 1];
        }
        if (m > a && m >= b) { nms[i] = m; vals.push(m); }
      }
    }
    const edge = new Uint8Array(W * H);
    if (!vals.length) return edge;
    vals.sort((p, q) => p - q);
    const ref = vals[Math.floor(vals.length * 0.9)] || vals[vals.length - 1];
    const hi = Math.max(ref * (0.75 - 0.0065 * sens), 2);
    const lo = Math.max(hi * 0.4, 1);
    const stack = [];
    for (let i = 0; i < nms.length; i++) if (nms[i] >= hi) { edge[i] = 1; stack.push(i); }
    while (stack.length) {
      const i = stack.pop();
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const j = i + dy * W + dx;
        if (j < 0 || j >= nms.length) continue;
        if (!edge[j] && nms[j] >= lo) { edge[j] = 1; stack.push(j); }
      }
    }
    return edge;
  }

  /* ---------- Trazado de bordes a polilíneas ---------- */

  const N8 = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]];

  function trace(edge, W, H) {
    const vis = new Uint8Array(W * H);
    const out = [];
    const free = (i) => {
      const x = i % W, y = (i / W) | 0, r = [];
      for (const [dx, dy] of N8) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (edge[j] && !vis[j]) r.push(j);
      }
      return r;
    };
    const degree = (i) => {
      const x = i % W, y = (i / W) | 0; let n = 0;
      for (const [dx, dy] of N8) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        if (edge[ny * W + nx]) n++;
      }
      return n;
    };
    const follow = (start) => {
      const pts = []; let cur = start, prev = -1;
      for (;;) {
        const c = free(cur);
        if (!c.length) break;
        let best = c[0];
        if (prev >= 0) {
          const dx = cur % W - prev % W, dy = ((cur / W) | 0) - ((prev / W) | 0);
          let bs = -9;
          for (const j of c) {
            const ex = j % W - cur % W, ey = ((j / W) | 0) - ((cur / W) | 0);
            const s = (dx * ex + dy * ey) / Math.hypot(ex, ey);
            if (s > bs) { bs = s; best = j; }
          }
        }
        vis[best] = 1; pts.push(best); prev = cur; cur = best;
      }
      return pts;
    };
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < edge.length; i++) {
        if (!edge[i] || vis[i]) continue;
        if (pass === 0 && degree(i) > 1) continue;
        vis[i] = 1;
        const f = follow(i), b = follow(i);
        const poly = b.reverse().concat([i], f);
        out.push(poly.map((j) => [j % W, (j / W) | 0]));
      }
    }
    return out;
  }

  /* ---------- Utilidades geométricas ---------- */

  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  function pathLen(p, closed) {
    let s = 0;
    for (let i = 1; i < p.length; i++) s += dist(p[i - 1], p[i]);
    if (closed && p.length > 1) s += dist(p[p.length - 1], p[0]);
    return s;
  }

  function joinPolys(polys, gap) {
    if (gap <= 0) return polys;
    let list = polys.filter((p) => p.length >= 5).sort((a, b) => b.length - a.length).slice(0, 600);
    const isClosed = (p) => dist(p[0], p[p.length - 1]) <= 2;
    let guard = 0;
    for (let again = true; again && guard < 2000; guard++) {
      again = false;
      outer:
      for (let i = 0; i < list.length; i++) {
        if (isClosed(list[i])) continue;
        for (let j = i + 1; j < list.length; j++) {
          if (isClosed(list[j])) continue;
          const a = list[i], b = list[j];
          const as = a[0], ae = a[a.length - 1], bs = b[0], be = b[b.length - 1];
          let m = null;
          if (dist(ae, bs) <= gap) m = a.concat(b);
          else if (dist(ae, be) <= gap) m = a.concat(b.slice().reverse());
          else if (dist(as, bs) <= gap) m = a.slice().reverse().concat(b);
          else if (dist(as, be) <= gap) m = b.concat(a);
          if (m) { list.splice(j, 1); list[i] = m; again = true; break outer; }
        }
      }
    }
    return list;
  }

  function dpKeep(pts, eps) {
    const n = pts.length;
    if (n < 3) return pts.map((_, i) => i);
    const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
    const st = [[0, n - 1]];
    while (st.length) {
      const [s, e] = st.pop();
      const a = pts[s], b = pts[e];
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
      let md = -1, mi = -1;
      for (let i = s + 1; i < e; i++) {
        const d = L < 1e-9 ? dist(pts[i], a) : Math.abs(dy * (pts[i][0] - a[0]) - dx * (pts[i][1] - a[1])) / L;
        if (d > md) { md = d; mi = i; }
      }
      if (md > eps) { keep[mi] = 1; st.push([s, mi], [mi, e]); }
    }
    const idx = []; for (let i = 0; i < n; i++) if (keep[i]) idx.push(i);
    return idx;
  }

  function simplify(raw, eps, closed) {
    if (!closed) return dpKeep(raw, eps).map((i) => raw[i].slice());
    let k = 0, md = -1;
    for (let i = 1; i < raw.length; i++) { const d = dist(raw[i], raw[0]); if (d > md) { md = d; k = i; } }
    const a = raw.slice(0, k + 1), b = raw.slice(k).concat([raw[0]]);
    const sa = dpKeep(a, eps).map((i) => a[i]), sb = dpKeep(b, eps).map((i) => b[i]);
    return sa.concat(sb.slice(1, -1)).map((p) => p.slice());
  }

  function fitCircle(pts) {
    const n = pts.length;
    let mx = 0, my = 0;
    for (const p of pts) { mx += p[0]; my += p[1]; }
    mx /= n; my /= n;
    let suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
    for (const p of pts) {
      const u = p[0] - mx, v = p[1] - my;
      suu += u * u; svv += v * v; suv += u * v;
      suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u;
    }
    const det = suu * svv - suv * suv;
    if (Math.abs(det) < 1e-9) return null;
    const c1 = 0.5 * (suuu + suvv), c2 = 0.5 * (svvv + svuu);
    const uc = (c1 * svv - c2 * suv) / det, vc = (suu * c2 - suv * c1) / det;
    const cx = uc + mx, cy = vc + my;
    const r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / n);
    let err = 0;
    for (const p of pts) { const d = Math.hypot(p[0] - cx, p[1] - cy) - r; err += d * d; }
    return { cx, cy, r, rms: Math.sqrt(err / n) };
  }

  function angularSpan(pts, c) {
    let prev = Math.atan2(pts[0][1] - c.cy, pts[0][0] - c.cx);
    const a0 = prev; let total = 0, pos = 0, neg = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = Math.atan2(pts[i][1] - c.cy, pts[i][0] - c.cx);
      let d = a - prev;
      while (d > PI) d -= 2 * PI;
      while (d < -PI) d += 2 * PI;
      total += d; if (d > 0) pos++; else if (d < 0) neg++;
      prev = a;
    }
    const mono = Math.max(pos, neg) / Math.max(1, pos + neg);
    return { a0, span: total, mono };
  }

  function snapPoly(p, closed, tolDeg) {
    const tol = tolDeg * PI / 180, n = p.length, segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const a = p[i], b = p[(i + 1) % n];
      const ang = Math.abs(Math.atan2(b[1] - a[1], b[0] - a[0]));
      if (ang < tol || ang > PI - tol) { const m = (a[1] + b[1]) / 2; a[1] = b[1] = m; }
      else if (Math.abs(ang - PI / 2) < tol) { const m = (a[0] + b[0]) / 2; a[0] = b[0] = m; }
    }
  }

  function isRect(p, tolDeg) {
    if (p.length !== 4) return false;
    for (let i = 0; i < 4; i++) {
      const a = p[i], b = p[(i + 1) % 4], c = p[(i + 2) % 4];
      const v1 = [b[0] - a[0], b[1] - a[1]], v2 = [c[0] - b[0], c[1] - b[1]];
      const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(...v1) * Math.hypot(...v2) || 1);
      if (Math.abs(cos) > Math.sin(tolDeg * PI / 180)) return false;
    }
    return true;
  }


  function lineIntersect(p1, p2, p3, p4) {
    const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
    if (Math.abs(d) < 1e-9) return null;
    const t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
    return [p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])];
  }

  /* Colapsa aristas muy cortas (restos de esquinas) prolongando las rectas vecinas. */
  function cleanPoly(pts, closed, minEdge) {
    let p = pts.map((q) => q.slice()), changed = true, guard = 0;
    while (changed && guard++ < 200) {
      changed = false;
      const n = p.length, minN = closed ? 4 : 3;
      if (n < minN) break;
      const segs = closed ? n : n - 1;
      for (let i = 0; i < segs; i++) {
        const j = (i + 1) % n;
        if (dist(p[i], p[j]) >= minEdge) continue;
        const pi = closed ? (i - 1 + n) % n : i - 1, qj = closed ? (j + 1) % n : j + 1;
        const mid = [(p[i][0] + p[j][0]) / 2, (p[i][1] + p[j][1]) / 2];
        let np = mid;
        if (pi >= 0 && qj < n && pi !== qj) {
          const x = lineIntersect(p[pi], p[i], p[j], p[qj]);
          if (x && dist(x, mid) <= minEdge * 2) np = x;
        }
        if (!closed && (i === 0 || j === n - 1)) { p.splice(i === 0 ? 0 : n - 1, 1); changed = true; break; }
        if (j === 0) { p[0] = np; p.splice(n - 1, 1); } else { p[i] = np; p.splice(j, 1); }
        changed = true; break;
      }
    }
    // quita vértices casi colineales
    let moved = true;
    while (moved && p.length > (closed ? 3 : 2)) {
      moved = false;
      const n = p.length;
      for (let i = closed ? 0 : 1; i < (closed ? n : n - 1); i++) {
        const a = p[(i - 1 + n) % n], b = p[i], c = p[(i + 1) % n];
        const v1 = [b[0] - a[0], b[1] - a[1]], v2 = [c[0] - b[0], c[1] - b[1]];
        const cr = Math.abs(v1[0] * v2[1] - v1[1] * v2[0]) / ((Math.hypot(...v1) * Math.hypot(...v2)) || 1);
        const dt = v1[0] * v2[0] + v1[1] * v2[1];
        if (cr < 0.1 && dt > 0) { p.splice(i, 1); moved = true; break; }
      }
    }
    return p;
  }

  /* ---------- Clasificación ---------- */

  function classify(raw, o, W, H) {
    const joinTol = Math.max(3, o.join);
    let closed = raw.length >= 12 && dist(raw[0], raw[raw.length - 1]) <= joinTol;
    const length = pathLen(raw, closed);
    if (length < o.minLen) return null;

    if (o.circles && raw.length >= 14) {
      const c = fitCircle(raw);
      if (c && c.r >= 4 && c.r <= 3 * Math.max(W, H) && c.rms <= Math.max(0.03 * c.r, 1.3)) {
        const sp = angularSpan(raw, c);
        if (sp.mono >= 0.9) {
          if (Math.abs(sp.span) >= 2 * PI * 0.9) {
            return { type: 'circle', cx: c.cx, cy: c.cy, r: c.r, length: 2 * PI * c.r };
          }
          const sag = c.r * (1 - Math.cos(Math.abs(sp.span) / 2));
          if (Math.abs(sp.span) >= 0.5 && sag > 3) {
            return { type: 'arc', cx: c.cx, cy: c.cy, r: c.r, a0: sp.a0, span: sp.span, length: Math.abs(sp.span) * c.r };
          }
        }
      }
    }

    let pts = simplify(raw, o.eps, closed);
    if (closed && pts.length >= 2 && dist(pts[0], pts[pts.length - 1]) < 1.5) pts.pop();
    if (pts.length < 2) return null;
    pts = cleanPoly(pts, closed, Math.max(10, o.join * 1.2));
    if (closed && pts.length < 3) closed = false;
    if (pts.length < 2) return null;
    if (o.snap > 0) snapPoly(pts, closed, o.snap);

    if (closed) {
      if (o.rects && isRect(pts, 14)) return { type: 'rect', pts, closed: true, length };
      return { type: 'polygon', pts, closed: true, length };
    }
    if (pts.length === 2) return { type: 'line', pts, closed: false, length };
    return { type: 'polyline', pts, closed: false, length };
  }

  function analyze(gray, W, H, o) {
    const edge = canny(gray, W, H, o.sigma, o.sens);
    let polys = trace(edge, W, H);
    polys = joinPolys(polys, o.join);
    const shapes = [];
    for (const p of polys) {
      if (p.length < 4) continue;
      const s = classify(p, o, W, H);
      if (s) shapes.push(s);
    }
    shapes.sort((a, b) => b.length - a.length);
    shapes.forEach((s, i) => { s.id = i; });
    return { edge, shapes };
  }


  /* ---------- Modo orificios y patrón ---------- */

  function boxesForGauss(sigma, n) {
    const wi = Math.sqrt(12 * sigma * sigma / n + 1);
    let wl = Math.floor(wi); if (wl % 2 === 0) wl--;
    const wu = wl + 2;
    const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
    const out = []; for (let i = 0; i < n; i++) out.push(i < m ? wl : wu);
    return out;
  }
  function boxH(src, dst, W, H, r) {
    const k = 1 / (r + r + 1);
    for (let y = 0; y < H; y++) {
      let ti = y * W, li = ti, ri = ti + r;
      const fv = src[ti], lv = src[ti + W - 1];
      let val = (r + 1) * fv;
      for (let j = 0; j < r; j++) val += src[ti + j];
      for (let j = 0; j <= r; j++) { val += src[ri++] - fv; dst[ti++] = val * k; }
      for (let j = r + 1; j < W - r; j++) { val += src[ri++] - src[li++]; dst[ti++] = val * k; }
      for (let j = W - r; j < W; j++) { val += lv - src[li++]; dst[ti++] = val * k; }
    }
  }
  function boxV(src, dst, W, H, r) {
    const k = 1 / (r + r + 1);
    for (let x = 0; x < W; x++) {
      let ti = x, li = x, ri = x + r * W;
      const fv = src[ti], lv = src[ti + (H - 1) * W];
      let val = (r + 1) * fv;
      for (let j = 0; j < r; j++) val += src[ti + j * W];
      for (let j = 0; j <= r; j++) { val += src[ri] - fv; dst[ti] = val * k; ri += W; ti += W; }
      for (let j = r + 1; j < H - r; j++) { val += src[ri] - src[li]; dst[ti] = val * k; li += W; ri += W; ti += W; }
      for (let j = H - r; j < H; j++) { val += lv - src[li]; dst[ti] = val * k; li += W; ti += W; }
    }
  }
  function gaussFast(src, W, H, sigma) {
    if (sigma < 0.5) return Float32Array.from(src);
    const a = Float32Array.from(src), b = new Float32Array(W * H);
    const lim = (Math.min(W, H) >> 1) - 1;
    for (const w of boxesForGauss(sigma, 3)) {
      const r = Math.max(1, Math.min(((w - 1) / 2) | 0, lim));
      boxH(a, b, W, H, r); boxV(b, a, W, H, r);
    }
    return a;
  }

  function median(a) { const b = a.slice().sort((x, y) => x - y); return b.length ? b[b.length >> 1] : 0; }

  function holes(gray, W, H, o) {
    const rmin = Math.max(1.5, o.dmin / 2), rmax = Math.max(rmin + 1, o.dmax / 2);
    const bg = gaussFast(gray, W, H, Math.max(rmax * 3, 8));
    const base = new Float32Array(W * H);
    for (let i = 0; i < base.length; i++) base[i] = gray[i] - bg[i];

    const ratio = 1.25, rs = [];
    for (let r = rmin; r <= rmax; r *= ratio) rs.push(r);
    const sig = rs.map((r) => r / Math.SQRT2); sig.push(sig[sig.length - 1] * ratio);
    const B = sig.map((sg) => gaussFast(base, W, H, sg));
    const sgn = o.dark ? 1 : -1, n = rs.length, D = [];
    for (let s = 0; s < n; s++) {
      const d = new Float32Array(W * H);
      for (let i = 0; i < d.length; i++) d[i] = sgn * (B[s + 1][i] - B[s][i]);
      D.push(d);
    }

    const floor = 2.5, cands = [], rf = Math.sqrt(ratio);
    for (let s = 0; s < n; s++) {
      const d = D[s], dp = s > 0 ? D[s - 1] : null, dn = s < n - 1 ? D[s + 1] : null;
      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          const i = y * W + x, v = d[i];
          if (v < floor) continue;
          if (v < d[i - 1] || v <= d[i + 1] || v < d[i - W] || v <= d[i + W] ||
              v < d[i - W - 1] || v <= d[i - W + 1] || v < d[i + W - 1] || v <= d[i + W + 1]) continue;
          let ok = true;
          for (const q of [dp, dn]) {
            if (!q || !ok) continue;
            for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1; dx++) if (q[i + dy * W + dx] >= v) { ok = false; break; }
          }
          if (ok) cands.push({ x, y, r: rs[s] * rf, v });
        }
      }
    }
    if (!cands.length) return { shapes: [], stats: {} };

    const vs = cands.map((c) => c.v).sort((a, b) => a - b);
    const thr = vs[Math.floor(vs.length * 0.85)] * (0.9 - 0.008 * o.sens);
    let pick = cands.filter((c) => c.v >= thr).sort((a, b) => b.v - a.v);

    // supresión de solapes
    const cs = rmax * 2.4, grid = new Map(), kept = [];
    for (const c of pick) {
      const gx = (c.x / cs) | 0, gy = (c.y / cs) | 0;
      let clash = false;
      for (let dy = -1; dy <= 1 && !clash; dy++) for (let dx = -1; dx <= 1 && !clash; dx++) {
        const l = grid.get((gx + dx) + ',' + (gy + dy));
        if (l) for (const k of l) if (Math.hypot(k.x - c.x, k.y - c.y) < 0.9 * Math.max(k.r, c.r)) { clash = true; break; }
      }
      if (clash) continue;
      const key = gx + ',' + gy; if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(c); kept.push(c);
    }

    // radio real por gradiente radial
    const gs = gaussFast(gray, W, H, 1);
    for (const h of kept) {
      const ring = (r) => {
        let sum = 0, cnt = 0;
        for (let k = 0; k < 16; k++) {
          const a = k * PI / 8, x = Math.round(h.x + r * Math.cos(a)), y = Math.round(h.y + r * Math.sin(a));
          if (x >= 0 && y >= 0 && x < W && y < H) { sum += gs[y * W + x]; cnt++; }
        }
        return cnt >= 10 ? sum / cnt : null;
      };
      let best = 2, br = h.r;
      for (let r = h.r * 0.6; r <= h.r * 1.5; r += 0.5) {
        const a = ring(r - 1), b = ring(r + 1);
        if (a == null || b == null) continue;
        const g = o.dark ? b - a : a - b;
        if (g > best) { best = g; br = r; }
      }
      h.r = br;
    }

    // tamaño dominante
    const bins = new Map();
    for (const h of kept) { const b = Math.round(h.r * 2); bins.set(b, (bins.get(b) || 0) + h.v); }
    let mb = 0, mv = -1;
    for (const [b] of bins) {
      const v = (bins.get(b - 1) || 0) + bins.get(b) + (bins.get(b + 1) || 0);
      if (v > mv) { mv = v; mb = b; }
    }
    const modeR = mb / 2;
    let hs = kept.filter((h) => Math.abs(h.r - modeR) <= o.tol * modeR);
    if (hs.length < 4) return finish(hs, null, 0, 0);

    // paso del patrón
    const cell = modeR * 8, g2 = new Map();
    hs.forEach((h, i) => { const k = ((h.x / cell) | 0) + ',' + ((h.y / cell) | 0); if (!g2.has(k)) g2.set(k, []); g2.get(k).push(i); });
    const near = (i, lo, hi) => {
      const h = hs[i], gx = (h.x / cell) | 0, gy = (h.y / cell) | 0, out = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const l = g2.get((gx + dx) + ',' + (gy + dy));
        if (l) for (const j of l) if (j !== i) { const d = Math.hypot(hs[j].x - h.x, hs[j].y - h.y); if (d >= lo && d <= hi) out.push([j, d]); }
      }
      return out;
    };
    const nnd = [];
    for (let i = 0; i < hs.length; i++) {
      const l = near(i, 0, cell); if (l.length) nnd.push(Math.min(...l.map((p) => p[1])));
    }
    if (nnd.length < 4) return finish(hs, null, 0, 0);
    const hb = new Map();
    nnd.forEach((d) => { const b = Math.round(d * 2); hb.set(b, (hb.get(b) || 0) + 1); });
    let pb = 0, pv = -1;
    for (const [b] of hb) { const v = (hb.get(b - 1) || 0) + hb.get(b) + (hb.get(b + 1) || 0); if (v > pv) { pv = v; pb = b; } }
    const near0 = nnd.filter((d) => Math.abs(d - pb / 2) <= 0.15 * pb / 2);
    const pitch = near0.reduce((a, b) => a + b, 0) / near0.length;

    let alive = hs.map((_, i) => i), nbr = null;
    for (let it = 0; it < 3; it++) {
      const idx = new Map(); alive.forEach((a, k) => idx.set(a, k));
      nbr = alive.map((a) => near(a, 0.8 * pitch, 1.25 * pitch).filter((p) => idx.has(p[0])).map((p) => p[0]));
      if (!o.lattice) break;
      const next = alive.filter((_, k) => nbr[k].length >= 2);
      if (next.length === alive.length) break;
      alive = next;
    }
    const idx2 = new Map(); alive.forEach((a, k) => idx2.set(a, k));
    nbr = alive.map((a) => near(a, 0.8 * pitch, 1.25 * pitch).filter((p) => idx2.has(p[0])).map((p) => p[0]));
    const counts = nbr.map((l) => l.length).sort((a, b) => a - b);
    const hex = (counts[Math.floor(counts.length * 0.75)] || 0) >= 5, m = hex ? 6 : 4;
    let S = 0, C = 0;
    alive.forEach((a, k) => nbr[k].forEach((j) => {
      const th = Math.atan2(hs[j].y - hs[a].y, hs[j].x - hs[a].x); S += Math.sin(m * th); C += Math.cos(m * th);
    }));
    let th0 = Math.atan2(S, C) / m;
    const half = PI / m; while (th0 > half) th0 -= 2 * half; while (th0 <= -half) th0 += 2 * half;
    return finish(alive.map((a) => hs[a]), { hex, th0, pitch }, pitch, th0);

    function finish(list, pat, pitchV, th) {
      const shapes = list.map((h) => ({ type: 'circle', cx: h.x, cy: h.y, r: h.r, length: 2 * PI * h.r, row: 0, col: 0 }));
      let rows = 0;
      if (pat && shapes.length) {
        const rowSp = pat.hex ? pitchV * Math.sin(PI / 3) : pitchV, c = Math.cos(th), sn = Math.sin(th);
        shapes.forEach((s) => { s.v = -s.cx * sn + s.cy * c; s.u = s.cx * c + s.cy * sn; });
        shapes.sort((a, b) => a.v - b.v);
        let row = 1, prev = shapes[0].v, cur = [];
        const flush = () => { cur.sort((a, b) => a.u - b.u).forEach((s, k) => { s.row = row; s.col = k + 1; }); cur = []; };
        for (const s of shapes) { if (s.v - prev > rowSp * 0.5) { flush(); row++; } cur.push(s); prev = s.v; }
        flush(); rows = row;
        shapes.sort((a, b) => a.row - b.row || a.col - b.col);
      }
      shapes.forEach((s, i) => { s.id = i; delete s.u; delete s.v; });
      const stats = { count: shapes.length, diam: 2 * median(shapes.map((s) => s.r)), pitch: pitchV, rows, hex: pat ? pat.hex : null, angle: pat ? th * 180 / PI : 0 };
      return { shapes, stats };
    }
  }

  const api = { holes, analyze, canny, trace, classify, fitCircle, simplify, pathLen };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Croquis = api;
})(typeof self !== 'undefined' ? self : this);
