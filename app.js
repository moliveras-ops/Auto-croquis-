'use strict';
(function () {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);
  const NS = 'http://www.w3.org/2000/svg';
  const PI = Math.PI;

  const PRESETS = {
    inspeccion: { sens: 60, sigma: 16, eps: 25, minLen: 25, join: 12, snap: 4 },
    plano:      { sens: 55, sigma: 20, eps: 35, minLen: 40, join: 14, snap: 6 },
    silueta:    { sens: 45, sigma: 30, eps: 45, minLen: 80, join: 18, snap: 3 },
    detalle:    { sens: 80, sigma: 10, eps: 15, minLen: 10, join: 6, snap: 0 }
  };
  const FORMAT = {
    sens: (v) => v, sigma: (v) => (v / 10).toFixed(1), eps: (v) => (v / 10).toFixed(1),
    minLen: (v) => v, join: (v) => v, snap: (v) => v + '°', res: (v) => v + ' px',
    bg: (v) => v + '%', lw: (v) => (v / 10).toFixed(1),
    dmin: (v) => v, dmax: (v) => v, hsens: (v) => v, tol: (v) => v + '%'
  };
  const COLORS = { line: '#1f4e8c', polyline: '#1f4e8c', polygon: '#1f4e8c', rect: '#0f766e', circle: '#c2410c', arc: '#a16207' };
  const TIPO = { line: 'Línea', polyline: 'Polilínea', polygon: 'Polígono', rect: 'Rectángulo', circle: 'Círculo', arc: 'Arco' };
  const C_HOLE = '#1f4e8c', C_MANUAL = '#0f766e', C_MISS = '#dc2626', C_SEL = '#f97316';
  const SAVE_KEYS = ['dmin', 'dmax', 'hsens', 'tol', 'light', 'lattice', 'showMissing', 'roiEllipse', 'res', 'bg', 'lw', 'labels', 'colors', 'unit', 'ref'];

  const S = {
    img: null, W: 0, H: 0, gray: null, bgUrl: '', edge: null,
    shapes: [], missing: [], dismissed: [], stats: null, mode: 'holes',
    unit: 'mm', scale: 1, calibrated: false, picking: null, calibPts: [], roi: null, roiDraft: null,
    sel: -1, view: 'sketch', tool: 'move', vb: null, undo: [], timer: 0, name: 'croquis'
  };

  /* ---------- Utilidades ---------- */

  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const esc = (n) => Math.round(n * 100) / 100;
  const median = (a) => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[b.length >> 1] : 0; };
  const k = () => (S.calibrated ? S.scale : 1);
  const U = () => (S.calibrated ? S.unit : 'px');
  function fmt(px) {
    const v = px * k();
    return (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)) + ' ' + U();
  }
  function status(t) { $('#status').textContent = t; }
  const medR = () => median(S.shapes.filter((s) => s.type === 'circle').map((s) => s.r)) || 6;

  /* ---------- Controles ---------- */

  const sliders = Object.keys(FORMAT);
  function syncOutputs() { sliders.forEach((key) => { $('#o-' + key).textContent = FORMAT[key]($('#' + key).value); }); }
  function setPreset(name) {
    const p = PRESETS[name];
    for (const key of Object.keys(p)) $('#' + key).value = p[key];
    $$('#presets .chip').forEach((c) => c.classList.toggle('on', c.dataset.p === name));
    syncOutputs();
  }
  function saveSettings() {
    try {
      const o = {}; SAVE_KEYS.forEach((id) => { const el = $('#' + id); o[id] = el.type === 'checkbox' ? el.checked : el.value; });
      localStorage.setItem('autocroquis', JSON.stringify(o));
    } catch (e) { /* sin almacenamiento */ }
  }
  function loadSettings() {
    try {
      const o = JSON.parse(localStorage.getItem('autocroquis') || '{}');
      SAVE_KEYS.forEach((id) => { if (!(id in o)) return; const el = $('#' + id); if (el.type === 'checkbox') el.checked = o[id]; else el.value = o[id]; });
    } catch (e) { /* sin almacenamiento */ }
  }
  function holeOpts(extra) {
    return Object.assign({
      dmin: +$('#dmin').value, dmax: Math.max(+$('#dmax').value, +$('#dmin').value + 2), sens: +$('#hsens').value,
      tol: +$('#tol').value / 100, dark: !$('#light').checked, lattice: $('#lattice').checked, roi: S.roi
    }, extra || {});
  }
  function geomOpts() {
    return {
      sens: +$('#sens').value, sigma: +$('#sigma').value / 10, eps: +$('#eps').value / 10,
      minLen: +$('#minLen').value, join: +$('#join').value, snap: +$('#snap').value,
      circles: $('#circles').checked, rects: $('#rects').checked
    };
  }

  /* ---------- Carga y análisis ---------- */

  function loadSrc(src, name) {
    const im = new Image();
    im.onload = () => {
      S.img = im; S.name = (name || 'croquis').replace(/\.[^.]+$/, '');
      S.roi = null; S.dismissed = []; S.vb = null; S.calibPts = []; S.picking = null;
      $('#btnRoiClear').disabled = true;
      prepare();
      if (S.mode === 'holes') autoDiam(); else analyze();
    };
    im.onerror = () => status('No se pudo leer la imagen. Prueba con JPG o PNG.');
    im.src = src;
  }

  function prepare() {
    const max = +$('#res').value, old = S.W;
    const f = Math.min(1, max / Math.max(S.img.naturalWidth, S.img.naturalHeight));
    const W = Math.max(8, Math.round(S.img.naturalWidth * f)), H = Math.max(8, Math.round(S.img.naturalHeight * f));
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.drawImage(S.img, 0, 0, W, H);
    const d = x.getImageData(0, 0, W, H).data, g = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    if (old && old !== W) {
      const r = W / old;
      if (S.roi) S.roi = { x0: S.roi.x0 * r, y0: S.roi.y0 * r, x1: S.roi.x1 * r, y1: S.roi.y1 * r, ellipse: S.roi.ellipse };
      if (S.calibrated) S.scale /= r;
      S.vb = null;
    }
    S.W = W; S.H = H; S.gray = g; S.bgUrl = c.toDataURL('image/jpeg', 0.82);
  }

  function run(fn, msg) {
    status(msg || 'Analizando…');
    setTimeout(fn, 30);
  }

  function analyze() {
    if (!S.gray) return;
    run(() => {
      const t = performance.now();
      let r;
      if (S.mode === 'holes') { r = Croquis.holes(S.gray, S.W, S.H, holeOpts()); r.edge = null; }
      else r = Croquis.analyze(S.gray, S.W, S.H, geomOpts());
      S.stats = r.stats || null; S.edge = r.edge; S.shapes = r.shapes; S.sel = -1; S.undo = [];
      refreshMissing();
      status(S.W + '×' + S.H + ' px · ' + Math.round(performance.now() - t) + ' ms');
      render();
    });
  }

  function autoDiam() {
    if (!S.gray) return;
    run(() => {
      const r = Croquis.holes(S.gray, S.W, S.H, holeOpts({ dmin: 4, dmax: Math.min(200, Math.round(Math.min(S.W, S.H) / 6)), tol: 0.35, lattice: true }));
      const d = r.stats && r.stats.diam;
      if (d && r.shapes.length >= 4) {
        $('#dmin').value = Math.max(3, Math.round(d * 0.6));
        $('#dmax').value = Math.max(+$('#dmin').value + 4, Math.round(d * 1.6));
        syncOutputs(); saveSettings();
        status('Ø estimado ' + d.toFixed(1) + ' px');
      } else status('No encontré un patrón claro. Ajusta el rango de Ø a mano.');
      analyze();
    }, 'Estimando Ø de los orificios…');
  }

  function schedule(reprep) {
    clearTimeout(S.timer);
    S.timer = setTimeout(() => { if (reprep) prepare(); analyze(); }, 200);
  }

  /* Recalcula numeración, Ø mediano y posiciones faltantes tras un cambio manual. */
  function refreshMissing() {
    S.missing = [];
    if (S.mode !== 'holes') { S.shapes.forEach((s, i) => { s.id = i; }); return; }
    const st = S.stats;
    if (st) { st.count = S.shapes.length; st.diam = 2 * medR(); }
    if ($('#showMissing').checked && st && st.pitch) {
      const p = st.pitch, r = medR();
      S.missing = Croquis.missing(S.shapes, st, S.roi)
        .filter((m) => !S.dismissed.some((d) => Math.hypot(d[0] - m.cx, d[1] - m.cy) < 0.45 * p))
        .map((m) => ({ type: 'circle', cx: m.cx, cy: m.cy, r, missing: true }));
    }
    const all = S.shapes.concat(S.missing);
    const rows = Croquis.numberGrid(all, st);
    if (st) st.rows = rows;
    S.shapes = all.filter((s) => !s.missing); S.missing = all.filter((s) => s.missing);
    S.shapes.forEach((s, i) => { s.id = i; });
    S.missing.forEach((s, i) => { s.mid = i; });
  }

  function pushUndo() {
    S.undo.push(JSON.stringify({ shapes: S.shapes, dismissed: S.dismissed }));
    if (S.undo.length > 40) S.undo.shift();
  }
  function undo() {
    const u = S.undo.pop(); if (!u) return;
    const o = JSON.parse(u); S.shapes = o.shapes; S.dismissed = o.dismissed; S.sel = -1;
    refreshMissing(); render();
  }

  /* ---------- Descripción ---------- */

  function angleOf(a, b) {
    let d = Math.atan2(-(b[1] - a[1]), b[0] - a[0]) * 180 / PI;
    if (d < 0) d += 180; if (d >= 180) d -= 180;
    return d;
  }
  const pos = (s) => (s.cx * k()).toFixed(1) + ', ' + ((S.H - s.cy) * k()).toFixed(1);
  const rc = (s) => (s.row ? 'F' + s.row + ' C' + s.col : '');
  function describe(s) {
    if (S.mode === 'holes') return { t: s.manual ? 'Orificio (manual)' : 'Orificio', m: 'Ø ' + fmt(2 * s.r), d: [rc(s), 'centro ' + pos(s)].filter(Boolean).join(' · ') };
    switch (s.type) {
      case 'line': return { t: TIPO.line, m: fmt(s.length), d: angleOf(s.pts[0], s.pts[1]).toFixed(1) + '°' };
      case 'polyline': return { t: TIPO.polyline, m: fmt(s.length), d: s.pts.length + ' vértices' };
      case 'polygon': return { t: TIPO.polygon, m: 'perím. ' + fmt(s.length), d: s.pts.length + ' vértices' };
      case 'rect': {
        const [a, b, c] = s.pts;
        return { t: TIPO.rect, m: fmt(dist(a, b)) + ' × ' + fmt(dist(b, c)), d: 'ángulo ' + angleOf(a, b).toFixed(1) + '°' };
      }
      case 'circle': return { t: TIPO.circle, m: 'Ø ' + fmt(2 * s.r), d: 'centro ' + pos(s) };
      default: return { t: TIPO.arc, m: 'R ' + fmt(s.r), d: 'arco ' + Math.abs(s.span * 180 / PI).toFixed(0) + '°' };
    }
  }

  /* ---------- SVG ---------- */

  function pathOf(s) {
    if (s.type === 'arc') {
      const x0 = s.cx + s.r * Math.cos(s.a0), y0 = s.cy + s.r * Math.sin(s.a0);
      const a1 = s.a0 + s.span, x1 = s.cx + s.r * Math.cos(a1), y1 = s.cy + s.r * Math.sin(a1);
      return `M${esc(x0)} ${esc(y0)}A${esc(s.r)} ${esc(s.r)} 0 ${Math.abs(s.span) > PI ? 1 : 0} ${s.span > 0 ? 1 : 0} ${esc(x1)} ${esc(y1)}`;
    }
    return 'M' + s.pts.map((p) => esc(p[0]) + ' ' + esc(p[1])).join('L') + (s.closed ? 'Z' : '');
  }
  function labelsOf(s, fs) {
    const out = [], t = (x, y, txt, an, sz) => out.push(`<text x="${esc(x)}" y="${esc(y)}" font-size="${esc(sz || fs)}" text-anchor="${an || 'middle'}">${txt}</text>`);
    if (S.mode === 'holes') { t(s.cx, s.cy + s.r * 0.3, s.id + 1, 'middle', Math.max(4, s.r * 0.8)); return out.join(''); }
    if (s.type === 'circle') {
      if (s.r > fs * 4) t(s.cx, s.cy - s.r + fs * 1.7, 'Ø ' + fmt(2 * s.r));
      else t(s.cx + s.r + fs * 0.5, s.cy + fs / 3, 'Ø ' + fmt(2 * s.r), 'start');
    } else if (s.type === 'arc') {
      const m = s.a0 + s.span / 2; t(s.cx + (s.r + fs) * Math.cos(m), s.cy + (s.r + fs) * Math.sin(m), 'R ' + fmt(s.r));
    } else if (s.type === 'rect') {
      const [a, b, c] = s.pts;
      t((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - fs * 0.5, fmt(dist(a, b)));
      t((b[0] + c[0]) / 2 + fs * 2.2, (b[1] + c[1]) / 2, fmt(dist(b, c)));
    } else {
      const n = s.pts.length, segs = s.closed ? n : n - 1;
      for (let i = 0; i < segs; i++) {
        const a = s.pts[i], b = s.pts[(i + 1) % n], L = dist(a, b);
        if (L < S.W * 0.07) continue;
        t((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - fs * 0.5, fmt(L));
      }
    }
    return out.join('');
  }

  function buildSVG(o) {
    o = o || {};
    const W = S.W, H = S.H, holes = S.mode === 'holes';
    const lw = +$('#lw').value / 10 * Math.max(1, W / 700) * (holes ? 0.6 : 1), fs = Math.max(9, W / 60);
    const useColor = $('#colors').checked, labels = $('#labels').checked, bg = +$('#bg').value / 100;
    let g = '';
    for (const s of S.shapes) {
      let c = holes ? (useColor && s.manual ? C_MANUAL : C_HOLE) : (useColor ? COLORS[s.type] : '#14233a');
      let w = lw;
      if (!o.clean && s.id === S.sel) { c = C_SEL; w = lw * 2.2; }
      const attr = `data-i="${s.id}" fill="none" stroke="${c}" stroke-width="${esc(w)}" stroke-linecap="round" stroke-linejoin="round"`;
      g += s.type === 'circle' ? `<circle ${attr} cx="${esc(s.cx)}" cy="${esc(s.cy)}" r="${esc(s.r)}"/>` : `<path ${attr} d="${pathOf(s)}"/>`;
      if (!holes && (s.type === 'circle' || s.type === 'arc')) g += `<circle cx="${esc(s.cx)}" cy="${esc(s.cy)}" r="${esc(lw * 0.9)}" fill="${c}"/>`;
    }
    for (const m of S.missing) {
      const sel = !o.clean && ('m' + m.mid) === S.sel, a = m.r * 0.55;
      g += `<g data-m="${m.mid}" stroke="${sel ? C_SEL : C_MISS}" stroke-width="${esc(lw * (sel ? 2 : 1.2))}" fill="none">` +
        `<circle cx="${esc(m.cx)}" cy="${esc(m.cy)}" r="${esc(m.r)}" stroke-dasharray="${esc(m.r * 0.5)} ${esc(m.r * 0.3)}"/>` +
        `<path d="M${esc(m.cx - a)} ${esc(m.cy - a)}L${esc(m.cx + a)} ${esc(m.cy + a)}M${esc(m.cx + a)} ${esc(m.cy - a)}L${esc(m.cx - a)} ${esc(m.cy + a)}"/></g>`;
    }
    let lab = '';
    if (labels) for (const s of S.shapes) lab += labelsOf(s, fs);
    const bgImg = o.bg !== false && bg > 0 ? `<image href="${S.bgUrl}" width="${W}" height="${H}" opacity="${bg}"/>` : '';
    const whiteBg = o.white ? `<rect width="${W}" height="${H}" fill="#fff"/>` : '';
    const vb = o.clean || !S.vb ? `0 0 ${W} ${H}` : S.vb.map(esc).join(' ');
    return `<svg xmlns="${NS}" viewBox="${vb}" width="${W}" height="${H}" font-family="IBM Plex Mono, monospace">` +
      whiteBg + bgImg + `<g>${g}</g><g fill="#14233a" stroke="#fff" stroke-width="${esc(fs / 5)}" paint-order="stroke" stroke-linejoin="round">${lab}</g>` +
      (o.clean ? '' : '<g id="ov"></g>') + '</svg>';
  }

  function drawOverlay() {
    const ov = $('#ov'); if (!ov) return;
    const lw = Math.max(1.5, S.W / 450), r = S.roiDraft || S.roi;
    let h = '';
    if (r) {
      const st = `fill="none" stroke="${C_SEL}" stroke-width="${esc(lw)}" stroke-dasharray="${esc(lw * 5)} ${esc(lw * 3)}"`;
      h += r.ellipse ? `<ellipse ${st} cx="${esc((r.x0 + r.x1) / 2)}" cy="${esc((r.y0 + r.y1) / 2)}" rx="${esc((r.x1 - r.x0) / 2)}" ry="${esc((r.y1 - r.y0) / 2)}"/>`
        : `<rect ${st} x="${esc(r.x0)}" y="${esc(r.y0)}" width="${esc(r.x1 - r.x0)}" height="${esc(r.y1 - r.y0)}"/>`;
    }
    h += S.calibPts.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="${esc(lw * 3)}" fill="${C_SEL}"/>`).join('');
    if (S.calibPts.length === 2) h += `<line x1="${S.calibPts[0][0]}" y1="${S.calibPts[0][1]}" x2="${S.calibPts[1][0]}" y2="${S.calibPts[1][1]}" stroke="${C_SEL}" stroke-width="${esc(lw)}"/>`;
    ov.innerHTML = h;
  }

  /* ---------- Render ---------- */

  function render() {
    $('#sketch').innerHTML = buildSVG();
    drawOverlay();
    drawImageView();
    $('#btnUndo').disabled = !S.undo.length;
    const v = S.shapes, cnt = (t) => v.filter((s) => t.includes(s.type)).length;
    let pills;
    if (S.mode === 'holes') {
      const st = S.stats || {};
      pills = [['Orificios', v.length]];
      if (S.missing.length) pills.push(['Faltantes', S.missing.length, 'warn']);
      if (v.length) pills.push(['Ø mediano', fmt(2 * medR())]);
      if (st.pitch) pills.push(['Paso', fmt(st.pitch)], ['Patrón', st.hex ? 'triangular' : 'cuadrado'], ['Filas', st.rows], ['Giro', st.angle.toFixed(1) + '°']);
    } else pills = [['Líneas', cnt(['line', 'polyline'])], ['Círculos', cnt(['circle'])], ['Arcos', cnt(['arc'])], ['Rectángulos', cnt(['rect'])], ['Polígonos', cnt(['polygon'])]];
    $('#summary').innerHTML = pills.map(([n, c, cl]) => `<span class="pill ${cl || ''}">${n} <b>${c}</b></span>`).join('');

    const MAX = 400;
    const missRows = S.missing.map((m) => `<tr data-m="${m.mid}" class="miss ${('m' + m.mid) === S.sel ? 'sel' : ''}"><td class="num">—</td><td>Posible faltante</td><td class="mono">—</td><td class="mono">${[rc(m), 'centro ' + pos(m)].filter(Boolean).join(' · ')}</td><td><button class="del" data-delm="${m.mid}" aria-label="Descartar faltante">×</button></td></tr>`).join('');
    const rows = v.slice(0, MAX).map((s) => {
      const d = describe(s);
      return `<tr data-i="${s.id}" class="${s.id === S.sel ? 'sel' : ''}"><td class="num">${s.id + 1}</td><td>${d.t}</td><td class="mono">${d.m}</td><td class="mono">${d.d}</td><td><button class="del" data-del="${s.id}" aria-label="Quitar ${s.id + 1}">×</button></td></tr>`;
    }).join('');
    const more = v.length > MAX ? `<tr><td colspan="5">Se muestran ${MAX} de ${v.length}. Todos van en el CSV y el JSON.</td></tr>` : '';
    $('#tbl tbody').innerHTML = (missRows + rows + more) || '<tr><td colspan="5">No se detectó nada. Prueba "Detectar Ø automáticamente", dibuja la zona o sube la sensibilidad.</td></tr>';
  }

  function drawImageView() {
    const c = $('#edgeCanvas'); c.width = S.W; c.height = S.H;
    const x = c.getContext('2d'), im = x.createImageData(S.W, S.H);
    for (let i = 0; i < S.gray.length; i++) {
      const v = S.edge ? (S.edge[i] ? 20 : 255) : S.gray[i];
      im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = 255;
    }
    x.putImageData(im, 0, 0);
  }

  function select(id) {
    S.sel = S.sel === id ? -1 : id;
    render();
    const row = document.querySelector(typeof id === 'string' ? `tr[data-m="${id.slice(1)}"]` : `tr[data-i="${id}"]`);
    if (row && S.sel !== -1) row.scrollIntoView({ block: 'nearest' });
  }

  /* ---------- Zoom y desplazamiento ---------- */

  const svgEl = () => $('#sketch svg');
  function toImg(cx, cy) {
    const svg = svgEl(); if (!svg) return [0, 0];
    const pt = svg.createSVGPoint(); pt.x = cx; pt.y = cy;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    return [p.x, p.y];
  }
  function applyVB() {
    const svg = svgEl(); if (!svg) return;
    svg.setAttribute('viewBox', S.vb ? S.vb.map(esc).join(' ') : `0 0 ${S.W} ${S.H}`);
  }
  function zoomAt(f, ix, iy) {
    let [x, y, w, h] = S.vb || [0, 0, S.W, S.H];
    const nw = Math.min(S.W, Math.max(S.W / 40, w / f)), nh = nw * S.H / S.W;
    if (ix == null) { ix = x + w / 2; iy = y + h / 2; }
    x = ix - (ix - x) * nw / w; y = iy - (iy - y) * nh / h;
    S.vb = nw >= S.W ? null : clampVB([x, y, nw, nh]);
    applyVB();
  }
  function clampVB(v) {
    const [x, y, w, h] = v;
    return [Math.min(Math.max(x, -w * 0.25), S.W - w * 0.75), Math.min(Math.max(y, -h * 0.25), S.H - h * 0.75), w, h];
  }
  function panBy(dxClient, dyClient) {
    if (!S.vb) return;
    const box = svgEl().getBoundingClientRect(), f = S.vb[2] / box.width;
    S.vb = clampVB([S.vb[0] - dxClient * f, S.vb[1] - dyClient * f, S.vb[2], S.vb[3]]);
    applyVB();
  }

  /* ---------- Interacción sobre el croquis ---------- */

  function nearestHole(p, maxF) {
    let best = -1, bd = Infinity;
    for (const s of S.shapes) { const d = Math.hypot(s.cx - p[0], s.cy - p[1]); if (d < bd) { bd = d; best = s.id; } }
    return best >= 0 && bd <= S.shapes[best].r * (maxF || 1.4) ? best : -1;
  }
  function nearestMissing(p, maxD) {
    let best = -1, bd = Infinity;
    for (const m of S.missing) { const d = Math.hypot(m.cx - p[0], m.cy - p[1]); if (d < bd) { bd = d; best = m.mid; } }
    return bd <= maxD ? best : -1;
  }

  function tap(cx, cy) {
    const p = toImg(cx, cy);
    if (S.picking === 'calib') {
      S.calibPts.push([Math.round(p[0]), Math.round(p[1])]);
      drawOverlay();
      if (S.calibPts.length === 2) { S.picking = null; $('#wrap').classList.remove('picking'); applyCalib(); }
      else status('Toca el segundo punto.');
      return;
    }
    const holes = S.mode === 'holes';
    if (S.tool === 'add' && holes) {
      const r = medR(), mi = nearestMissing(p, r * 1.6);
      let c = p;
      if (mi >= 0) c = [S.missing[mi].cx, S.missing[mi].cy];
      pushUndo();
      S.shapes.push({ type: 'circle', cx: c[0], cy: c[1], r, length: 2 * PI * r, manual: true });
      refreshMissing(); render(); return;
    }
    if (S.tool === 'del') {
      if (holes) {
        const mi = nearestMissing(p, medR() * 1.4);
        if (mi >= 0) { pushUndo(); S.dismissed.push([S.missing[mi].cx, S.missing[mi].cy]); refreshMissing(); render(); return; }
        const hi = nearestHole(p); if (hi < 0) return;
        pushUndo(); S.shapes.splice(hi, 1);
      } else {
        const el = document.elementFromPoint(cx, cy), t = el && el.closest('[data-i]'); if (!t) return;
        pushUndo(); S.shapes.splice(+t.dataset.i, 1);
      }
      S.sel = -1; refreshMissing(); render(); return;
    }
    // Mover: seleccionar
    if (holes) {
      const hi = nearestHole(p); if (hi >= 0) return select(hi);
      const mi = nearestMissing(p, medR() * 1.4); if (mi >= 0) return select('m' + mi);
      if (S.sel !== -1) select(S.sel);
    } else {
      const el = document.elementFromPoint(cx, cy), t = el && el.closest('[data-i]');
      if (t) select(+t.dataset.i);
    }
  }

  function bindPointer() {
    const el = $('#sketch'), ptrs = new Map();
    let start = null, moved = false, pinch = null;
    el.addEventListener('pointerdown', (e) => {
      if (!svgEl()) return;
      el.setPointerCapture(e.pointerId);
      ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      if (ptrs.size === 1) {
        start = [e.clientX, e.clientY]; moved = false;
        if (S.picking === 'roi') { const p = toImg(e.clientX, e.clientY); S.roiDraft = { x0: p[0], y0: p[1], x1: p[0], y1: p[1], ellipse: $('#roiEllipse').checked }; }
      } else if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), m: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
        moved = true; S.roiDraft = null;
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (!ptrs.has(e.pointerId)) return;
      const prev = ptrs.get(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      if (ptrs.size === 2 && pinch) {
        const [a, b] = [...ptrs.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]), m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const ip = toImg(m[0], m[1]);
        zoomAt(d / pinch.d, ip[0], ip[1]);
        panBy(m[0] - pinch.m[0], m[1] - pinch.m[1]);
        pinch = { d, m }; return;
      }
      if (ptrs.size !== 1 || !start) return;
      if (!moved && Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 6) moved = true;
      if (!moved) return;
      if (S.picking === 'roi' && S.roiDraft) {
        const p = toImg(e.clientX, e.clientY), s0 = toImg(start[0], start[1]);
        S.roiDraft = { x0: Math.min(s0[0], p[0]), y0: Math.min(s0[1], p[1]), x1: Math.max(s0[0], p[0]), y1: Math.max(s0[1], p[1]), ellipse: $('#roiEllipse').checked };
        drawOverlay();
      } else panBy(e.clientX - prev[0], e.clientY - prev[1]);
    });
    const end = (e) => {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.delete(e.pointerId);
      if (ptrs.size === 1) { pinch = null; return; }
      if (ptrs.size > 0) return;
      pinch = null;
      if (S.picking === 'roi' && S.roiDraft) {
        const r = S.roiDraft; S.roiDraft = null;
        if (moved && r.x1 - r.x0 > 15 && r.y1 - r.y0 > 15) {
          S.roi = { x0: Math.max(0, r.x0), y0: Math.max(0, r.y0), x1: Math.min(S.W, r.x1), y1: Math.min(S.H, r.y1), ellipse: r.ellipse };
          S.picking = null; $('#wrap').classList.remove('picking'); $('#btnRoiClear').disabled = false; S.dismissed = [];
          analyze();
        } else drawOverlay();
        return;
      }
      if (!moved && e.type === 'pointerup') tap(e.clientX, e.clientY);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', (e) => {
      if (!svgEl()) return;
      e.preventDefault();
      const p = toImg(e.clientX, e.clientY);
      zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, p[0], p[1]);
    }, { passive: false });
    el.addEventListener('dblclick', (e) => { const p = toImg(e.clientX, e.clientY); zoomAt(2, p[0], p[1]); });
  }

  /* ---------- Calibración ---------- */

  function updateScaleInfo() {
    $('#refUnit').textContent = S.unit === 'px' ? 'mm' : S.unit;
    $('#scaleInfo').textContent = S.calibrated ? `Calibrado: 1 px = ${S.scale.toPrecision(4)} ${S.unit}` : 'Sin calibrar: las medidas están en píxeles.';
  }
  function applyCalib() {
    const real = parseFloat($('#refVal').value), ref = $('#ref').value;
    if (!(real > 0)) { status('Escribe el valor real (mayor que 0).'); $('#refVal').focus(); return; }
    if (S.unit === 'px') { S.unit = 'mm'; $('#unit').value = 'mm'; }
    let px = 0;
    if (ref === 'diam') px = 2 * medR();
    else if (ref === 'pitch') px = S.stats && S.stats.pitch;
    else {
      if (S.calibPts.length < 2) {
        S.calibPts = []; S.picking = 'calib'; $('#wrap').classList.add('picking');
        if (S.view !== 'sketch') $('.tab[data-view="sketch"]').click();
        drawOverlay(); status('Toca 2 puntos separados por ' + real + ' ' + S.unit + '.'); return;
      }
      px = dist(S.calibPts[0], S.calibPts[1]);
    }
    if (!(px > 1)) { status(ref === 'pitch' ? 'No hay paso detectado. Usa otra referencia.' : 'No hay referencia válida en la imagen.'); return; }
    S.scale = real / px; S.calibrated = true; S.calibPts = [];
    updateScaleInfo(); status('Escala aplicada.'); render();
  }

  /* ---------- Exportar ---------- */

  function toDXF() {
    const f = k(), X = (x) => (x * f).toFixed(4), Y = (y) => ((S.H - y) * f).toFixed(4);
    const layer = S.mode === 'holes' ? 'ORIFICIOS' : 'CROQUIS';
    let o = '0\nSECTION\n2\nENTITIES\n';
    const circ = (s, L) => { o += `0\nCIRCLE\n8\n${L}\n10\n${X(s.cx)}\n20\n${Y(s.cy)}\n30\n0\n40\n${(s.r * f).toFixed(4)}\n`; };
    const norm = (d) => { d %= 360; return (d < 0 ? d + 360 : d).toFixed(4); };
    for (const s of S.shapes) {
      if (s.type === 'circle') circ(s, layer);
      else if (s.type === 'arc') {
        const t0 = s.a0 * 180 / PI, t1 = (s.a0 + s.span) * 180 / PI;
        const st = s.span > 0 ? -t1 : -t0, en = s.span > 0 ? -t0 : -t1;
        o += `0\nARC\n8\n${layer}\n10\n${X(s.cx)}\n20\n${Y(s.cy)}\n30\n0\n40\n${(s.r * f).toFixed(4)}\n50\n${norm(st)}\n51\n${norm(en)}\n`;
      } else {
        const n = s.pts.length, segs = s.closed ? n : n - 1;
        for (let i = 0; i < segs; i++) {
          const a = s.pts[i], b = s.pts[(i + 1) % n];
          o += `0\nLINE\n8\n${layer}\n10\n${X(a[0])}\n20\n${Y(a[1])}\n30\n0\n11\n${X(b[0])}\n21\n${Y(b[1])}\n31\n0\n`;
        }
      }
    }
    S.missing.forEach((m) => circ(m, 'FALTANTES'));
    return o + '0\nENDSEC\n0\nEOF\n';
  }
  function toJSON() {
    const st = S.stats || {};
    return JSON.stringify({
      origen: S.name, ancho_px: S.W, alto_px: S.H, unidad: U(), escala_por_px: k(),
      patron: S.mode === 'holes' && st.pitch ? { paso: +(st.pitch * k()).toFixed(3), tipo: st.hex ? 'triangular' : 'cuadrado', giro_grados: +st.angle.toFixed(2), filas: st.rows } : null,
      elementos: S.shapes.map((s) => {
        const d = describe(s), r = { id: s.id + 1, tipo: S.mode === 'holes' ? (s.manual ? 'orificio_manual' : 'orificio') : s.type, medida: d.m };
        if (s.row) { r.fila = s.row; r.columna = s.col; }
        if (s.pts) r.puntos_px = s.pts.map((p) => p.map((v) => Math.round(v * 10) / 10));
        else Object.assign(r, { cx_px: +s.cx.toFixed(1), cy_px: +s.cy.toFixed(1), radio_px: +s.r.toFixed(1) });
        return r;
      }),
      faltantes: S.missing.map((m) => ({ fila: m.row, columna: m.col, cx_px: +m.cx.toFixed(1), cy_px: +m.cy.toFixed(1) }))
    }, null, 2);
  }
  function toCSV() {
    const f = k(), u = U(), num = (v) => v.toFixed(2).replace('.', ',');
    const rows = [`n;fila;columna;x_${u};y_${u};diametro_${u};estado`];
    const all = S.shapes.filter((s) => s.type === 'circle').concat(S.missing)
      .sort((a, b) => (a.row || 0) - (b.row || 0) || (a.col || 0) - (b.col || 0));
    all.forEach((s, i) => rows.push([i + 1, s.row || '', s.col || '', num(s.cx * f), num((S.H - s.cy) * f), s.missing ? '' : num(2 * s.r * f),
      s.missing ? 'posible faltante' : s.manual ? 'manual' : 'detectado'].join(';')));
    return '﻿' + rows.join('\r\n');
  }
  function save(name, data, type) {
    const url = URL.createObjectURL(new Blob([data], { type }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }
  function exportAs(kind) {
    if (!S.gray) return;
    const base = S.name + '-croquis';
    if (kind === 'svg') save(base + '.svg', buildSVG({ clean: true, white: true }), 'image/svg+xml');
    else if (kind === 'dxf') save(base + '.dxf', toDXF(), 'application/dxf');
    else if (kind === 'csv') save(base + '.csv', toCSV(), 'text/csv;charset=utf-8');
    else if (kind === 'json') save(base + '.json', toJSON(), 'application/json');
    else {
      const im = new Image();
      im.onload = () => {
        const c = document.createElement('canvas'), f = Math.min(2, 4000 / Math.max(S.W, S.H));
        c.width = Math.round(S.W * f); c.height = Math.round(S.H * f);
        const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height);
        c.toBlob((b) => b && save(base + '.png', b, 'image/png'));
      };
      im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(buildSVG({ clean: true, white: true }));
    }
  }

  /* ---------- Imágenes de ejemplo ---------- */

  function sampleHoles() {
    const c = document.createElement('canvas'); c.width = 900; c.height = 620;
    const x = c.getContext('2d');
    const gr = x.createLinearGradient(0, 0, 900, 620); gr.addColorStop(0, '#9a7a5c'); gr.addColorStop(1, '#6f6a62');
    x.fillStyle = gr; x.fillRect(0, 0, 900, 620);
    x.fillStyle = '#2b2b2b'; x.font = '600 34px sans-serif'; x.fillText('ESPEJO TUBOS · EJEMPLO', 40, 46);
    const p = 26, ang = 7 * PI / 180, plug = new Set(['5,9', '9,14', '10,14', '13,6', '15,18']);
    for (let r = 0; r < 20; r++) for (let q = 0; q < 28; q++) {
      const u = q * p + (r % 2 ? p / 2 : 0), v = r * p * 0.866;
      const X = 150 + u * Math.cos(ang) - v * Math.sin(ang), Y = 80 + u * Math.sin(ang) + v * Math.cos(ang);
      if (Math.hypot(X - 450, Y - 330) > 260 || plug.has(r + ',' + q)) continue;
      x.fillStyle = '#3a2f28'; x.beginPath(); x.arc(X, Y, 8, 0, 7); x.fill();
    }
    return c.toDataURL('image/png');
  }
  function sample() {
    const c = document.createElement('canvas'); c.width = 900; c.height = 620;
    const x = c.getContext('2d');
    x.fillStyle = '#efede8'; x.fillRect(0, 0, 900, 620);
    x.fillStyle = '#3b4a5e'; x.fillRect(110, 90, 680, 440);
    x.fillStyle = '#efede8';
    [[190, 170], [710, 170], [190, 450], [710, 450]].forEach(([cx, cy]) => { x.beginPath(); x.arc(cx, cy, 26, 0, 7); x.fill(); });
    x.beginPath(); x.arc(450, 310, 105, 0, 7); x.fill();
    x.fillRect(330, 440, 240, 40);
    x.fillStyle = '#3b4a5e'; x.beginPath(); x.arc(450, 310, 42, 0, 7); x.fill();
    return c.toDataURL('image/png');
  }

  /* ---------- Modo y herramientas ---------- */

  function setMode(m, silent) {
    S.mode = m; S.sel = -1; S.dismissed = [];
    $$('#modes .chip').forEach((c) => c.classList.toggle('on', c.dataset.mode === m));
    $('#secHoles').hidden = m !== 'holes'; $('#secGeom').hidden = m !== 'geom';
    $('.tool[data-tool="add"]').hidden = m !== 'holes';
    if (m !== 'holes' && S.tool === 'add') setTool('move');
    if (!silent) {
      if (m === 'holes') { $('#bg').value = 55; $('#lw').value = 15; $('#labels').checked = false; }
      else { $('#bg').value = 25; $('#lw').value = 20; $('#labels').checked = true; }
      syncOutputs();
    }
    if (S.gray) analyze();
  }
  function setTool(t) {
    S.tool = t;
    $$('.tool').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
    const w = $('#wrap'); w.classList.remove('tool-move', 'tool-add', 'tool-del'); w.classList.add('tool-' + t);
    status(t === 'add' ? 'Toca donde falta un orificio. Si tocas una marca roja, se ajusta a ella.' : t === 'del' ? 'Toca un orificio o una marca roja para quitarlo.' : '');
  }

  /* ---------- Eventos ---------- */

  function bind() {
    ['dmin', 'dmax', 'hsens', 'tol'].forEach((id) => $('#' + id).addEventListener('input', () => { syncOutputs(); saveSettings(); schedule(false); }));
    ['light', 'lattice'].forEach((id) => $('#' + id).addEventListener('change', () => { saveSettings(); schedule(false); }));
    $('#showMissing').addEventListener('change', () => { saveSettings(); refreshMissing(); render(); });
    $('#roiEllipse').addEventListener('change', () => { saveSettings(); if (S.roi) { S.roi.ellipse = $('#roiEllipse').checked; analyze(); } });
    ['sens', 'sigma', 'eps', 'minLen', 'join', 'snap'].forEach((id) => $('#' + id).addEventListener('input', () => { syncOutputs(); schedule(false); }));
    $('#res').addEventListener('input', () => { syncOutputs(); saveSettings(); if (S.img) schedule(true); });
    ['bg', 'lw'].forEach((id) => $('#' + id).addEventListener('input', () => { syncOutputs(); saveSettings(); if (S.gray) render(); }));
    ['circles', 'rects'].forEach((id) => $('#' + id).addEventListener('change', () => schedule(false)));
    ['labels', 'colors'].forEach((id) => $('#' + id).addEventListener('change', () => { saveSettings(); if (S.gray) render(); }));
    $$('#modes .chip').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
    $$('#presets .chip').forEach((b) => b.addEventListener('click', () => { setPreset(b.dataset.p); schedule(false); }));
    $$('.tool').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
    $('#btnAuto').addEventListener('click', autoDiam);
    $('#btnUndo').addEventListener('click', undo);
    $('#zIn').addEventListener('click', () => zoomAt(1.6));
    $('#zOut').addEventListener('click', () => zoomAt(1 / 1.6));
    $('#zFit').addEventListener('click', () => { S.vb = null; applyVB(); });

    $('#btnRoi').addEventListener('click', () => {
      if (!S.gray) return;
      S.picking = 'roi'; $('#wrap').classList.add('picking');
      if (S.view !== 'sketch') $('.tab[data-view="sketch"]').click();
      status('Arrastra sobre la imagen para encerrar la zona.');
      $('#wrap').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
    $('#btnRoiClear').addEventListener('click', () => { S.roi = null; S.dismissed = []; $('#btnRoiClear').disabled = true; analyze(); });

    $('#file').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) loadSrc(URL.createObjectURL(f), f.name); e.target.value = ''; });
    $('#btnSample').addEventListener('click', () => loadSrc(S.mode === 'holes' ? sampleHoles() : sample(), 'ejemplo'));

    const wrap = $('#wrap');
    ['dragenter', 'dragover'].forEach((t) => wrap.addEventListener(t, (e) => { e.preventDefault(); wrap.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach((t) => wrap.addEventListener(t, (e) => { e.preventDefault(); wrap.classList.remove('drag'); }));
    wrap.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f && f.type.startsWith('image/')) loadSrc(URL.createObjectURL(f), f.name); });
    document.addEventListener('paste', (e) => {
      const it = [...(e.clipboardData ? e.clipboardData.items : [])].find((i) => i.type.startsWith('image/'));
      if (it) loadSrc(URL.createObjectURL(it.getAsFile()), 'pegada');
    });

    $$('.tab').forEach((t) => t.addEventListener('click', () => {
      S.view = t.dataset.view;
      $$('.tab').forEach((o) => o.classList.toggle('on', o === t));
      $('#sketch').hidden = S.view !== 'sketch'; $('#edgeCanvas').hidden = S.view !== 'edges';
    }));

    $('#tbl tbody').addEventListener('click', (e) => {
      const d = e.target.closest('[data-del]');
      if (d) { pushUndo(); S.shapes.splice(+d.dataset.del, 1); S.sel = -1; refreshMissing(); render(); return; }
      const dm = e.target.closest('[data-delm]');
      if (dm) { const m = S.missing[+dm.dataset.delm]; pushUndo(); S.dismissed.push([m.cx, m.cy]); S.sel = -1; refreshMissing(); render(); return; }
      const r = e.target.closest('tr[data-i]'); if (r) return select(+r.dataset.i);
      const rm = e.target.closest('tr[data-m]'); if (rm) select('m' + rm.dataset.m);
    });

    $('#unit').addEventListener('change', (e) => {
      const F = { mm: 1, cm: 10, m: 1000 }, old = S.unit; S.unit = e.target.value;
      if (S.unit === 'px') { S.calibrated = false; S.scale = 1; }
      else if (S.calibrated && F[old]) S.scale = S.scale * F[old] / F[S.unit];
      saveSettings(); updateScaleInfo(); if (S.gray) render();
    });
    $('#ref').addEventListener('change', () => { saveSettings(); S.calibPts = []; drawOverlay(); });
    $('#btnApplyCalib').addEventListener('click', () => { S.calibPts = []; applyCalib(); });
    $('#refVal').addEventListener('keydown', (e) => { if (e.key === 'Enter') { S.calibPts = []; applyCalib(); } });
    $$('[data-exp]').forEach((b) => b.addEventListener('click', () => exportAs(b.dataset.exp)));
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); }
      if (e.key === 'Escape' && S.picking) { S.picking = null; S.roiDraft = null; S.calibPts = []; $('#wrap').classList.remove('picking'); drawOverlay(); status(''); }
    });
    bindPointer();
  }

  setPreset('inspeccion');
  $('#res').value = 1400; $('#dmin').value = 6; $('#dmax').value = 40; $('#hsens').value = 60; $('#tol').value = 35;
  $('#bg').value = 55; $('#lw').value = 15;
  loadSettings();
  S.unit = $('#unit').value; S.calibrated = false;
  syncOutputs(); updateScaleInfo();
  bind();
  setTool('move');
  setMode('holes', true);
  loadSrc(sampleHoles(), 'ejemplo-orificios');
})();
