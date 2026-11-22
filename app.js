'use strict';
(function () {
  const $ = (s) => document.querySelector(s);
  const NS = 'http://www.w3.org/2000/svg';

  const PRESETS = {
    inspeccion: { sens: 60, sigma: 16, eps: 25, minLen: 25, join: 12, snap: 4, labels: true, colors: true },
    plano:      { sens: 55, sigma: 20, eps: 35, minLen: 40, join: 14, snap: 6, labels: true, colors: false },
    silueta:    { sens: 45, sigma: 30, eps: 45, minLen: 80, join: 18, snap: 3, labels: false, colors: false },
    detalle:    { sens: 80, sigma: 10, eps: 15, minLen: 10, join: 6, snap: 0, labels: false, colors: true }
  };
  const FORMAT = {
    sens: (v) => v, sigma: (v) => (v / 10).toFixed(1), eps: (v) => (v / 10).toFixed(1),
    minLen: (v) => v, join: (v) => v, snap: (v) => v + '°', res: (v) => v + ' px',
    bg: (v) => v + '%', lw: (v) => (v / 10).toFixed(1)
  };
  const COLORS = { line: '#1f4e8c', polyline: '#1f4e8c', polygon: '#1f4e8c', rect: '#0f766e', circle: '#c2410c', arc: '#a16207' };
  const TIPO = { line: 'Línea', polyline: 'Polilínea', polygon: 'Polígono', rect: 'Rectángulo', circle: 'Círculo', arc: 'Arco' };

  const S = {
    img: null, W: 0, H: 0, gray: null, bgUrl: '', edge: null, shapes: [], hidden: new Set(),
    unit: 'px', scale: 1, calibrated: false, calib: false, calibPts: [], sel: -1, view: 'sketch', timer: 0, name: 'croquis'
  };

  /* ---------- Controles ---------- */

  const sliders = Object.keys(FORMAT);
  function syncOutputs() { sliders.forEach((k) => { $('#o-' + k).textContent = FORMAT[k]($('#' + k).value); }); }
  function setPreset(name) {
    const p = PRESETS[name];
    for (const k of Object.keys(p)) {
      const el = $('#' + k);
      if (el.type === 'checkbox') el.checked = p[k]; else el.value = p[k];
    }
    document.querySelectorAll('#presets .chip').forEach((c) => c.classList.toggle('on', c.dataset.p === name));
    syncOutputs();
  }
  function opts() {
    return {
      sens: +$('#sens').value, sigma: +$('#sigma').value / 10, eps: +$('#eps').value / 10,
      minLen: +$('#minLen').value, join: +$('#join').value, snap: +$('#snap').value,
      circles: $('#circles').checked, rects: $('#rects').checked
    };
  }

  /* ---------- Carga y análisis ---------- */

  function status(t) { $('#status').textContent = t; }

  function loadSrc(src, name) {
    const im = new Image();
    im.onload = () => { S.img = im; S.name = (name || 'croquis').replace(/\.[^.]+$/, ''); S.hidden.clear(); prepare(); analyze(); };
    im.onerror = () => status('No se pudo leer la imagen. Prueba con JPG o PNG.');
    im.src = src;
  }

  function prepare() {
    const max = +$('#res').value;
    const k = Math.min(1, max / Math.max(S.img.naturalWidth, S.img.naturalHeight));
    const W = Math.max(8, Math.round(S.img.naturalWidth * k)), H = Math.max(8, Math.round(S.img.naturalHeight * k));
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.drawImage(S.img, 0, 0, W, H);
    const d = x.getImageData(0, 0, W, H).data, g = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    S.W = W; S.H = H; S.gray = g; S.bgUrl = c.toDataURL('image/jpeg', 0.8);
  }

  function analyze() {
    if (!S.gray) return;
    status('Analizando…');
    setTimeout(() => {
      const t = performance.now();
      const r = Croquis.analyze(S.gray, S.W, S.H, opts());
      S.edge = r.edge; S.shapes = r.shapes; S.sel = -1;
      status(S.W + '×' + S.H + ' px · ' + Math.round(performance.now() - t) + ' ms');
      render();
    }, 20);
  }
  function schedule(reprep) {
    clearTimeout(S.timer);
    S.timer = setTimeout(() => { if (reprep) prepare(); analyze(); }, 180);
  }

  /* ---------- Medidas ---------- */

  const vis = () => S.shapes.filter((s) => !S.hidden.has(s.id));
  function fmt(px) {
    const v = px * (S.calibrated ? S.scale : 1);
    return (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)) + ' ' + (S.calibrated ? S.unit : 'px');
  }
  function angleOf(a, b) {
    let d = Math.atan2(-(b[1] - a[1]), b[0] - a[0]) * 180 / Math.PI;
    if (d < 0) d += 180; if (d >= 180) d -= 180;
    return d;
  }
  function describe(s) {
    const k = S.calibrated ? S.scale : 1;
    switch (s.type) {
      case 'line': return { m: fmt(s.length), d: angleOf(s.pts[0], s.pts[1]).toFixed(1) + '°' };
      case 'polyline': return { m: fmt(s.length), d: s.pts.length + ' vértices' };
      case 'polygon': return { m: 'perím. ' + fmt(s.length), d: s.pts.length + ' vértices' };
      case 'rect': {
        const [a, b, c] = s.pts;
        return { m: fmt(Math.hypot(b[0] - a[0], b[1] - a[1])) + ' × ' + fmt(Math.hypot(c[0] - b[0], c[1] - b[1])), d: 'ángulo ' + angleOf(a, b).toFixed(1) + '°' };
      }
      case 'circle': return { m: 'Ø ' + fmt(2 * s.r), d: 'centro ' + (s.cx * k).toFixed(1) + ', ' + ((S.H - s.cy) * k).toFixed(1) };
      default: return { m: 'R ' + fmt(s.r), d: 'arco ' + Math.abs(s.span * 180 / Math.PI).toFixed(0) + '°' };
    }
  }

  /* ---------- SVG ---------- */

  const esc = (n) => (Math.round(n * 100) / 100);
  function pathOf(s) {
    if (s.type === 'arc') {
      const x0 = s.cx + s.r * Math.cos(s.a0), y0 = s.cy + s.r * Math.sin(s.a0);
      const a1 = s.a0 + s.span, x1 = s.cx + s.r * Math.cos(a1), y1 = s.cy + s.r * Math.sin(a1);
      return `M${esc(x0)} ${esc(y0)}A${esc(s.r)} ${esc(s.r)} 0 ${Math.abs(s.span) > Math.PI ? 1 : 0} ${s.span > 0 ? 1 : 0} ${esc(x1)} ${esc(y1)}`;
    }
    return 'M' + s.pts.map((p) => esc(p[0]) + ' ' + esc(p[1])).join('L') + (s.closed ? 'Z' : '');
  }
  function labelsOf(s, fs) {
    const out = [], t = (x, y, txt, an) => out.push(`<text x="${esc(x)}" y="${esc(y)}" font-size="${esc(fs)}" text-anchor="${an || 'middle'}">${txt}</text>`);
    if (s.type === 'circle') {
      if (s.r > fs * 4) t(s.cx, s.cy - s.r + fs * 1.7, 'Ø ' + fmt(2 * s.r));
      else t(s.cx + s.r + fs * 0.5, s.cy + fs / 3, 'Ø ' + fmt(2 * s.r), 'start');
    }
    else if (s.type === 'arc') {
      const m = s.a0 + s.span / 2; t(s.cx + (s.r + fs) * Math.cos(m), s.cy + (s.r + fs) * Math.sin(m), 'R ' + fmt(s.r));
    } else if (s.type === 'rect') {
      const [a, b, c, d] = s.pts;
      t((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - fs * 0.5, fmt(dist(a, b)));
      t((b[0] + c[0]) / 2 + fs * 2.2, (b[1] + c[1]) / 2, fmt(dist(b, c)));
    } else {
      const n = s.pts.length, segs = s.closed ? n : n - 1;
      for (let i = 0; i < segs; i++) {
        const a = s.pts[i], b = s.pts[(i + 1) % n], L = dist(a, b);
        if (L < S.W * 0.07) continue;
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        t(mx, my - fs * 0.5, fmt(L));
      }
    }
    return out.join('');
  }
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  function buildSVG(o) {
    o = o || {};
    const W = S.W, H = S.H, lw = +$('#lw').value / 10 * Math.max(1, W / 700), fs = Math.max(9, W / 60);
    const useColor = $('#colors').checked, labels = $('#labels').checked && !o.noLabels, bg = +$('#bg').value / 100;
    let g = '';
    for (const s of vis()) {
      const col = o.mono || !useColor ? '#14233a' : COLORS[s.type];
      const sel = !o.clean && s.id === S.sel;
      const w = sel ? lw * 2.2 : lw;
      const c = sel ? '#f97316' : col;
      const attr = `data-i="${s.id}" fill="none" stroke="${c}" stroke-width="${esc(w)}" stroke-linecap="round" stroke-linejoin="round"`;
      g += s.type === 'circle' ? `<circle ${attr} cx="${esc(s.cx)}" cy="${esc(s.cy)}" r="${esc(s.r)}"/>` : `<path ${attr} d="${pathOf(s)}"/>`;
      if (s.type === 'circle' || s.type === 'arc') g += `<circle cx="${esc(s.cx)}" cy="${esc(s.cy)}" r="${esc(lw * 0.9)}" fill="${c}"/>`;
    }
    let lab = '';
    if (labels) for (const s of vis()) lab += labelsOf(s, fs);
    const bgImg = o.bg !== false && bg > 0 ? `<image href="${S.bgUrl}" width="${W}" height="${H}" opacity="${bg}"/>` : '';
    const whiteBg = o.white ? `<rect width="${W}" height="${H}" fill="#fff"/>` : '';
    const cal = S.calibPts.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="${esc(fs * 0.4)}" fill="#f97316"/>`).join('') +
      (S.calibPts.length === 2 ? `<line x1="${S.calibPts[0][0]}" y1="${S.calibPts[0][1]}" x2="${S.calibPts[1][0]}" y2="${S.calibPts[1][1]}" stroke="#f97316" stroke-dasharray="6 4" stroke-width="${esc(lw)}"/>` : '');
    return `<svg xmlns="${NS}" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="IBM Plex Mono, monospace">` +
      whiteBg + bgImg + `<g>${g}</g><g fill="#14233a" stroke="#fff" stroke-width="${esc(fs / 4)}" paint-order="stroke" stroke-linejoin="round">${lab}</g>` +
      (o.clean ? '' : cal) + '</svg>';
  }

  /* ---------- Render ---------- */

  function render() {
    $('#sketch').innerHTML = buildSVG();
    drawEdges();
    const v = vis(), cnt = (t) => v.filter((s) => t.includes(s.type)).length;
    $('#summary').innerHTML = [
      ['Líneas', cnt(['line', 'polyline'])], ['Círculos', cnt(['circle'])], ['Arcos', cnt(['arc'])],
      ['Rectángulos', cnt(['rect'])], ['Polígonos', cnt(['polygon'])]
    ].map(([n, c]) => `<span class="pill">${n} <b>${c}</b></span>`).join('');
    $('#tbl tbody').innerHTML = v.map((s) => {
      const d = describe(s);
      return `<tr data-i="${s.id}" class="${s.id === S.sel ? 'sel' : ''}"><td class="num">${s.id + 1}</td><td>${TIPO[s.type]}</td><td class="mono">${d.m}</td><td class="mono">${d.d}</td><td><button class="del" data-del="${s.id}" aria-label="Quitar elemento ${s.id + 1}">×</button></td></tr>`;
    }).join('') || '<tr><td colspan="5">No se detectó geometría. Sube la sensibilidad o baja el largo mínimo.</td></tr>';
  }

  function drawEdges() {
    const c = $('#edgeCanvas'); c.width = S.W; c.height = S.H;
    const x = c.getContext('2d'), im = x.createImageData(S.W, S.H);
    for (let i = 0; i < S.edge.length; i++) {
      const v = S.edge[i] ? 20 : 255;
      im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = 255;
    }
    x.putImageData(im, 0, 0);
  }

  function select(i) { S.sel = S.sel === i ? -1 : i; render(); }

  /* ---------- Calibración ---------- */

  function svgPoint(ev) {
    const svg = $('#sketch svg'), pt = svg.createSVGPoint();
    pt.x = ev.clientX; pt.y = ev.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    return [Math.round(p.x), Math.round(p.y)];
  }
  function setUnitLabel() { $('#calibUnit').textContent = S.unit === 'px' ? 'mm' : S.unit; }
  function updateScaleInfo() {
    $('#scaleInfo').textContent = S.calibrated ? `1 px = ${S.scale.toPrecision(4)} ${S.unit}` : 'Sin calibrar: las medidas están en píxeles.';
  }

  /* ---------- Exportar ---------- */

  function toDXF() {
    const k = S.calibrated ? S.scale : 1, X = (x) => (x * k).toFixed(4), Y = (y) => ((S.H - y) * k).toFixed(4);
    let o = '0\nSECTION\n2\nENTITIES\n';
    const line = (a, b) => { o += `0\nLINE\n8\nCROQUIS\n10\n${X(a[0])}\n20\n${Y(a[1])}\n30\n0\n11\n${X(b[0])}\n21\n${Y(b[1])}\n31\n0\n`; };
    const norm = (d) => { d %= 360; return (d < 0 ? d + 360 : d).toFixed(4); };
    for (const s of vis()) {
      if (s.type === 'circle') o += `0\nCIRCLE\n8\nCROQUIS\n10\n${X(s.cx)}\n20\n${Y(s.cy)}\n30\n0\n40\n${(s.r * k).toFixed(4)}\n`;
      else if (s.type === 'arc') {
        const t0 = s.a0 * 180 / Math.PI, t1 = (s.a0 + s.span) * 180 / Math.PI;
        const st = s.span > 0 ? -t1 : -t0, en = s.span > 0 ? -t0 : -t1;
        o += `0\nARC\n8\nCROQUIS\n10\n${X(s.cx)}\n20\n${Y(s.cy)}\n30\n0\n40\n${(s.r * k).toFixed(4)}\n50\n${norm(st)}\n51\n${norm(en)}\n`;
      } else {
        const n = s.pts.length, segs = s.closed ? n : n - 1;
        for (let i = 0; i < segs; i++) line(s.pts[i], s.pts[(i + 1) % n]);
      }
    }
    return o + '0\nENDSEC\n0\nEOF\n';
  }
  function toJSON() {
    return JSON.stringify({
      origen: S.name, ancho_px: S.W, alto_px: S.H, unidad: S.calibrated ? S.unit : 'px', escala_por_px: S.calibrated ? S.scale : 1,
      elementos: vis().map((s) => {
        const d = describe(s), r = { id: s.id + 1, tipo: s.type, medida: d.m, detalle: d.d };
        if (s.pts) r.puntos_px = s.pts.map((p) => p.map((v) => Math.round(v * 10) / 10));
        else Object.assign(r, { cx_px: +s.cx.toFixed(1), cy_px: +s.cy.toFixed(1), radio_px: +s.r.toFixed(1) });
        return r;
      })
    }, null, 2);
  }
  function save(name, data, type) {
    const url = URL.createObjectURL(new Blob([data], { type }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  function exportAs(kind) {
    if (!S.gray) return;
    const base = S.name + '-croquis';
    if (kind === 'svg') save(base + '.svg', buildSVG({ clean: true, white: true, bg: $('#bg').value > 0 }), 'image/svg+xml');
    else if (kind === 'dxf') save(base + '.dxf', toDXF(), 'application/dxf');
    else if (kind === 'json') save(base + '.json', toJSON(), 'application/json');
    else {
      const svg = buildSVG({ clean: true, white: true }), im = new Image();
      im.onload = () => {
        const c = document.createElement('canvas'); c.width = S.W * 2; c.height = S.H * 2;
        const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height);
        c.toBlob((b) => b && save(base + '.png', b, 'image/png'));
      };
      im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    }
  }

  /* ---------- Imagen de ejemplo ---------- */

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

  /* ---------- Eventos ---------- */

  function bind() {
    sliders.forEach((k) => $('#' + k).addEventListener('input', () => { syncOutputs(); if (k === 'bg' || k === 'lw') render(); else schedule(k === 'res'); }));
    ['circles', 'rects'].forEach((k) => $('#' + k).addEventListener('change', () => schedule(false)));
    ['labels', 'colors'].forEach((k) => $('#' + k).addEventListener('change', render));
    document.querySelectorAll('#presets .chip').forEach((b) => b.addEventListener('click', () => { setPreset(b.dataset.p); S.hidden.clear(); render_if(); schedule(false); }));
    const render_if = () => { if (S.gray) render(); };

    $('#file').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) loadSrc(URL.createObjectURL(f), f.name); });
    $('#btnSample').addEventListener('click', () => loadSrc(sample(), 'ejemplo'));

    const wrap = $('#wrap');
    ['dragenter', 'dragover'].forEach((t) => wrap.addEventListener(t, (e) => { e.preventDefault(); wrap.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach((t) => wrap.addEventListener(t, (e) => { e.preventDefault(); wrap.classList.remove('drag'); }));
    wrap.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f && f.type.startsWith('image/')) loadSrc(URL.createObjectURL(f), f.name); });
    document.addEventListener('paste', (e) => {
      const it = [...(e.clipboardData ? e.clipboardData.items : [])].find((i) => i.type.startsWith('image/'));
      if (it) loadSrc(URL.createObjectURL(it.getAsFile()), 'pegada');
    });

    document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
      S.view = t.dataset.view;
      document.querySelectorAll('.tab').forEach((o) => { o.classList.toggle('on', o === t); o.setAttribute('aria-selected', o === t); });
      $('#sketch').hidden = S.view !== 'sketch'; $('#edgeCanvas').hidden = S.view !== 'edges';
    }));

    $('#sketch').addEventListener('click', (e) => {
      if (S.calib) {
        S.calibPts.push(svgPoint(e));
        if (S.calibPts.length === 2) { S.calib = false; $('#wrap').classList.remove('calibrating'); $('#calibForm').hidden = false; $('#calibVal').focus(); status('Escribe la distancia real.'); }
        render(); return;
      }
      const el = e.target.closest('[data-i]'); if (el) select(+el.dataset.i);
    });
    $('#tbl tbody').addEventListener('click', (e) => {
      const d = e.target.closest('[data-del]');
      if (d) { S.hidden.add(+d.dataset.del); render(); return; }
      const r = e.target.closest('tr[data-i]'); if (r) select(+r.dataset.i);
    });

    $('#unit').addEventListener('change', (e) => {
      const F = { mm: 1, cm: 10, m: 1000 }, old = S.unit; S.unit = e.target.value;
      if (S.unit === 'px') { S.calibrated = false; S.scale = 1; }
      else if (S.calibrated && F[old]) S.scale = S.scale * F[old] / F[S.unit];
      setUnitLabel(); updateScaleInfo(); if (S.gray) render();
    });
    $('#btnCalib').addEventListener('click', () => {
      if (!S.gray) return;
      S.calib = true; S.calibPts = []; $('#calibForm').hidden = true;
      $('#wrap').classList.add('calibrating');
      if (S.view !== 'sketch') document.querySelector('.tab[data-view="sketch"]').click();
      if (S.unit === 'px') { $('#unit').value = 'mm'; S.unit = 'mm'; }
      setUnitLabel(); status('Haz clic en 2 puntos de distancia conocida.'); render();
    });
    $('#btnApplyCalib').addEventListener('click', () => {
      const real = parseFloat($('#calibVal').value);
      if (S.calibPts.length !== 2 || !(real > 0)) { status('Indica una distancia mayor que 0.'); return; }
      const px = dist(S.calibPts[0], S.calibPts[1]);
      if (px < 2) { status('Los puntos están muy cerca. Repite la calibración.'); return; }
      S.scale = real / px; S.calibrated = true; S.calibPts = []; $('#calibForm').hidden = true;
      updateScaleInfo(); status('Escala aplicada.'); render();
    });
    document.querySelectorAll('[data-exp]').forEach((b) => b.addEventListener('click', () => exportAs(b.dataset.exp)));
  }

  setPreset('inspeccion');
  $('#res').value = 900; syncOutputs();
  $('#bg').value = 25; $('#lw').value = 20; syncOutputs();
  bind();
  loadSrc(sample(), 'ejemplo');
})();
