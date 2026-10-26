'use strict';
// Small helpers + hand-written SVG charts (no external libraries, so it works offline).

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const fmt = (n, d = 1) => Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const COLORS = {
  'NewReno': '#94a3b8', 'CUBIC': '#60a5fa', 'Westwood+': '#4ade80', 'Veno': '#c084fc',
  'BBR': '#facc15', 'LossLens': '#22d3ee', 'LossLens (oracle)': '#a5f3fc',
};
const CONG = '#f43f5e', RAND = '#fb923c';

function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
  }
  kids.flat().forEach(c => e.append(c.nodeType ? c : document.createTextNode(c)));
  return e;
}

function countUp(node, to, { dur = 1400, dec = 0, prefix = '', suffix = '' } = {}) {
  const t0 = performance.now();
  const tick = now => {
    const p = clamp((now - t0) / dur, 0, 1), e = 1 - Math.pow(1 - p, 3);
    node.textContent = prefix + fmt(to * e, dec) + suffix;
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function onVisible(node, fn, threshold = 0.25) {
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) { io.disconnect(); fn(); }
  }), { threshold });
  io.observe(node);
}

function niceMax(v) {
  const p = Math.pow(10, Math.floor(Math.log10(v || 1))), m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}

const tip = {
  el: null,
  show(html, x, y) {
    this.el = this.el || $('#tip');
    this.el.innerHTML = html; this.el.style.opacity = 1;
    const w = this.el.offsetWidth, hgt = this.el.offsetHeight;
    this.el.style.left = clamp(x + 16, 8, innerWidth - w - 8) + 'px';
    this.el.style.top = clamp(y - hgt - 12, 8, innerHeight - hgt - 8) + 'px';
  },
  hide() { (this.el = this.el || $('#tip')).style.opacity = 0; },
};

/* ---------- category line chart (results) ---------- */
// spec: {cats:[labels], series:[{name,color,dash,width,vals:[..],err:[..]}], yMax, yTitle, xTitle, unit}
function categoryLines(host, spec) {
  const W = 900, H = 440, m = { l: 62, r: 24, t: 20, b: 58 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b, n = spec.cats.length;
  const yMax = spec.yMax || niceMax(Math.max(...spec.series.flatMap(s => s.vals.map((v, i) => v + (s.err?.[i] || 0)))));
  const X = i => m.l + (n === 1 ? pw / 2 : i * pw / (n - 1)), Y = v => m.t + ph - v / yMax * ph;
  let g = '';
  for (let k = 0; k <= 5; k++) {
    const v = yMax * k / 5, y = Y(v);
    g += `<line x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}" stroke="rgba(255,255,255,.07)"/>` +
         `<text x="${m.l - 10}" y="${y + 4}" text-anchor="end" fill="#8e99b8" font-size="12">${fmt(v, v < 10 && v % 1 ? 1 : 0)}</text>`;
  }
  spec.cats.forEach((c, i) => {
    g += `<text x="${X(i)}" y="${H - m.b + 24}" text-anchor="middle" fill="#8e99b8" font-size="13">${c}</text>`;
  });
  g += `<text x="${m.l + pw / 2}" y="${H - 8}" text-anchor="middle" fill="#8e99b8" font-size="13">${spec.xTitle}</text>` +
       `<text transform="translate(16 ${m.t + ph / 2}) rotate(-90)" text-anchor="middle" fill="#8e99b8" font-size="13">${spec.yTitle}</text>`;
  const order = [...spec.series].sort((a, b) => (a.width || 2) - (b.width || 2));
  order.forEach(s => {
    const pts = s.vals.map((v, i) => [X(i), Y(v)]);
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('');
    if (s.err) s.vals.forEach((v, i) => {
      const lo = Y(Math.max(0, v - s.err[i])), hi = Y(v + s.err[i]);
      g += `<line x1="${X(i)}" x2="${X(i)}" y1="${lo}" y2="${hi}" stroke="${s.color}" stroke-opacity=".5" stroke-width="2"/>`;
    });
    g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2.2}" ${s.dash ? 'stroke-dasharray="7 6"' : ''} stroke-linejoin="round" stroke-linecap="round" class="ln"/>`;
    if (!s.dash) pts.forEach(p => g += `<circle cx="${p[0]}" cy="${p[1]}" r="${(s.width || 2.2) > 3 ? 5.5 : 3.6}" fill="${s.color}" stroke="#060913" stroke-width="1.5"/>`);
  });
  g += `<line id="xh" y1="${m.t}" y2="${m.t + ph}" stroke="rgba(255,255,255,.35)" stroke-dasharray="3 4" opacity="0"/>` +
       `<rect id="hit" x="${m.l - 20}" y="${m.t}" width="${pw + 40}" height="${ph}" fill="transparent"/>`;
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="width:100%">${g}</svg>`;
  const svg = $('svg', host), xh = $('#xh', host);
  $('#hit', host).addEventListener('mousemove', e => {
    const r = svg.getBoundingClientRect(), px = (e.clientX - r.left) / r.width * W;
    const i = clamp(Math.round((px - m.l) / pw * (n - 1)), 0, n - 1);
    xh.setAttribute('x1', X(i)); xh.setAttribute('x2', X(i)); xh.setAttribute('opacity', 1);
    const rows = [...spec.series].sort((a, b) => b.vals[i] - a.vals[i]).map(s =>
      `<div><span style="color:${s.color}">${s.name}</span><b>${fmt(s.vals[i], 1)} ${spec.unit || ''}</b></div>`).join('');
    tip.show(`<div class="h">${spec.xTitle}: ${spec.cats[i]}</div>${rows}`, e.clientX, e.clientY);
  });
  $('#hit', host).addEventListener('mouseleave', () => { xh.setAttribute('opacity', 0); tip.hide(); });
}

/* ---------- grouped bars (fairness) ---------- */
// spec: {groups:[label], series:[{name,color,vals:[..]}], yMax, ref}
function groupedBars(host, spec) {
  const W = 900, H = 400, m = { l: 56, r: 20, t: 40, b: 52 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b, gn = spec.groups.length, sn = spec.series.length;
  const yMax = spec.yMax, Y = v => m.t + ph - Math.min(v, yMax) / yMax * ph;
  let g = '';
  for (let k = 0; k <= 4; k++) {
    const v = yMax * k / 4;
    g += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="rgba(255,255,255,.07)"/>` +
         `<text x="${m.l - 10}" y="${Y(v) + 4}" text-anchor="end" fill="#8e99b8" font-size="12">${fmt(v, 1)}</text>`;
  }
  const gw = pw / gn, bw = Math.min(46, gw * .78 / sn);
  spec.groups.forEach((lab, gi) => {
    const x0 = m.l + gi * gw + (gw - bw * sn) / 2;
    g += `<text x="${m.l + gi * gw + gw / 2}" y="${H - m.b + 26}" text-anchor="middle" fill="#8e99b8" font-size="13">${lab}</text>`;
    spec.series.forEach((s, si) => {
      const v = s.vals[gi], y = Y(v ?? 0);
      if (v == null) return;
      g += `<rect x="${x0 + si * bw}" y="${y}" width="${bw - 5}" height="${m.t + ph - y}" rx="5" fill="${s.color}" class="gb" data-t="${s.name}|${v}|${lab}"/>` +
           `<text x="${x0 + si * bw + (bw - 5) / 2}" y="${y - 6}" text-anchor="middle" fill="#e8ecf8" font-size="11.5" font-weight="700">${fmt(v, 2)}</text>`;
    });
  });
  g += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(spec.ref)}" y2="${Y(spec.ref)}" stroke="#fff" stroke-dasharray="6 5" stroke-opacity=".7"/>` +
       `<line x1="${W - m.r - 190}" x2="${W - m.r - 164}" y1="16" y2="16" stroke="#fff" stroke-dasharray="6 5" stroke-opacity=".8"/><text x="${W - m.r}" y="20" text-anchor="end" fill="#fff" font-size="12" opacity=".85">exactly a fair share = 1.0</text>` +
       `<text x="${m.l + pw / 2}" y="${H - 6}" text-anchor="middle" fill="#8e99b8" font-size="13">${spec.xTitle}</text>`;
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="width:100%">${g}</svg>`;
}

/* ---------- mini overlay histogram (clues) ---------- */
function miniHist(host, a, b, colA, colB) {
  const W = 300, H = 70, n = a.length, bw = W / n, mx = Math.max(...a, ...b) || 1;
  const bars = (arr, col, op) => arr.map((v, i) =>
    `<rect x="${i * bw + .5}" y="${H - v / mx * (H - 4)}" width="${bw - 1}" height="${v / mx * (H - 4)}" fill="${col}" fill-opacity="${op}"/>`).join('');
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${bars(a, colA, .55)}${bars(b, colB, .55)}</svg>`;
}

/* ---------- time-series chart with playback clip (lab) ---------- */
function timeChart(host, spec) {
  const W = 960, H = 400, m = { l: 62, r: 22, t: 16, b: 74 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b, tMax = spec.tMax, yMax = spec.yMax;
  const X = t => m.l + t / tMax * pw, Y = v => m.t + ph - clamp(v, 0, yMax) / yMax * ph;
  let g = '';
  for (let k = 0; k <= 5; k++) {
    const v = yMax * k / 5;
    g += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="rgba(255,255,255,.07)"/>` +
         `<text x="${m.l - 10}" y="${Y(v) + 4}" text-anchor="end" fill="#8e99b8" font-size="12">${fmt(v, 0)}</text>`;
  }
  for (let t = 0; t <= tMax; t += tMax > 20 ? 5 : 4) {
    g += `<text x="${X(t)}" y="${H - m.b + 22}" text-anchor="middle" fill="#8e99b8" font-size="12">${t} s</text>`;
  }
  g += `<text transform="translate(16 ${m.t + ph / 2}) rotate(-90)" text-anchor="middle" fill="#8e99b8" font-size="13">Sending rate = window ÷ delay (Mbps)</text>` +
       `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(spec.cap)}" y2="${Y(spec.cap)}" stroke="#fff" stroke-opacity=".55" stroke-dasharray="6 5"/>` +
       `<text x="${W - m.r - 4}" y="${Y(spec.cap) - 7}" text-anchor="end" fill="#fff" fill-opacity=".7" font-size="12">link capacity ${fmt(spec.cap, 0)} Mbps</text>`;
  const clip = `<clipPath id="reveal"><rect id="rv" x="${m.l}" y="0" width="0" height="${H}"/></clipPath>`;
  let lines = '';
  spec.series.forEach(s => {
    const d = s.pts.map((p, i) => (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1)).join('');
    lines += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2.4}" ${s.dash ? 'stroke-dasharray="6 5"' : ''} stroke-linejoin="round" id="ln-${s.key}"/>`;
  });
  // loss-event ticks (LossLens run): orange = random loss, rose = congestion; filled = handled correctly
  let ev = `<text x="${m.l - 10}" y="${H - m.b + 50}" text-anchor="end" fill="#8e99b8" font-size="11.5">LossLens decisions</text>`;
  (spec.events || []).forEach(([t, label, pred]) => {
    const ok = (label === 1) === (pred === 1), col = label ? CONG : RAND, x = X(t);
    ev += `<line x1="${x}" x2="${x}" y1="${H - m.b + 38}" y2="${H - m.b + 58}" stroke="${col}" stroke-width="${ok ? 2 : 2.4}" stroke-opacity="${ok ? .85 : 1}"/>` +
          (ok ? '' : `<circle cx="${x}" cy="${H - m.b + 34}" r="2.8" fill="${col}"/>`);
  });
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="width:100%"><defs>${clip}</defs>${g}` +
    `<g clip-path="url(#reveal)">${lines}${ev}</g>` +
    `<line id="head" y1="${m.t}" y2="${m.t + ph}" x1="${m.l}" x2="${m.l}" stroke="#fff" stroke-opacity=".5"/>` +
    `<rect id="hit" x="${m.l}" y="${m.t}" width="${pw}" height="${ph}" fill="transparent"/></svg>`;
  const rv = $('#rv', host), head = $('#head', host), svg = $('svg', host), hit = $('#hit', host);
  const api = {
    set(frac) { const x = m.l + frac * pw; rv.setAttribute('width', frac * pw); head.setAttribute('x1', x); head.setAttribute('x2', x); },
    onHover(fn) {
      hit.addEventListener('mousemove', e => {
        const r = svg.getBoundingClientRect();
        fn(clamp(((e.clientX - r.left) / r.width * W - m.l) / pw * tMax, 0, tMax), e);
      });
      hit.addEventListener('mouseleave', () => tip.hide());
    },
  };
  return api;
}

/* ---------- scatter (clues) ---------- */
function scatter(host, pts, xr, yr, xLab, yLab) {
  const W = 700, H = 380, m = { l: 58, r: 16, t: 14, b: 50 }, pw = W - m.l - m.r, ph = H - m.t - m.b;
  const X = v => m.l + (v - xr[0]) / (xr[1] - xr[0]) * pw, Y = v => m.t + ph - (v - yr[0]) / (yr[1] - yr[0]) * ph;
  let g = '';
  for (let k = 0; k <= 4; k++) {
    const vx = xr[0] + (xr[1] - xr[0]) * k / 4, vy = yr[0] + (yr[1] - yr[0]) * k / 4;
    g += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(vy)}" y2="${Y(vy)}" stroke="rgba(255,255,255,.06)"/>` +
         `<text x="${m.l - 8}" y="${Y(vy) + 4}" text-anchor="end" fill="#8e99b8" font-size="11.5">${fmt(vy, 1)}</text>` +
         `<text x="${X(vx)}" y="${H - m.b + 20}" text-anchor="middle" fill="#8e99b8" font-size="11.5">${fmt(vx, 2)}</text>`;
  }
  g += `<text x="${m.l + pw / 2}" y="${H - 8}" text-anchor="middle" fill="#8e99b8" font-size="12.5">${xLab}</text>` +
       `<text transform="translate(14 ${m.t + ph / 2}) rotate(-90)" text-anchor="middle" fill="#8e99b8" font-size="12.5">${yLab}</text>`;
  pts.forEach(([a, b, c]) => g += `<circle cx="${X(a).toFixed(1)}" cy="${Y(b).toFixed(1)}" r="3" fill="${c ? CONG : RAND}" fill-opacity=".5"/>`);
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="width:100%">${g}</svg>`;
}
