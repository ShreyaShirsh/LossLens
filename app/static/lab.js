'use strict';
// Live lab: configure a network, run (or replay) CUBIC vs LossLens vs the perfect detective.

const SIM = { ok: false, checked: false };
const LAB = { seed: 1, demo: null, frac: 0, playing: false, speed: 1, chart: null, runs: null, busy: false, raf: 0 };
const RACERS = [
  { key: 'cubic', name: 'Normal TCP (CUBIC)', color: COLORS['CUBIC'] },
  { key: 'tree', name: 'LossLens', color: COLORS['LossLens'] },
  { key: 'oracle', name: 'Perfect detective', color: COLORS['LossLens (oracle)'] },
];
const FACTS = [
  'Every dropped packet is labelled with its true cause: queue overflow or wireless error.',
  'Normal TCP halves its speed at every loss, even when interference caused it.',
  'LossLens reads seven clues at each loss and walks a depth-6 decision tree.',
  'All three senders face exactly the same network and the same random losses.',
  'A timeout always counts as congestion, so LossLens is never reckless.',
  'The "perfect detective" is told the true cause of each loss: the best any classifier could do.',
];

function valueAt(pts, t) {            // pts: [[t, value, ...]] sorted by t
  if (!pts.length) return 0;
  let lo = 0, hi = pts.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; pts[mid][0] < t ? lo = mid + 1 : hi = mid; }
  return pts[lo][1];
}

const FORMAT = {
  bw: v => `${v} Mbps`, rtt: v => `${v} ms`, loss: v => `${(v / 10).toFixed(1)}%`, cross: v => `${v}%`,
  buffer: v => `${v}× BDP`, seed: () => `#${LAB.seed}`,
};

function labParams() {
  return {
    bw: +$('#c-bw').value, rtt: +$('#c-rtt').value, loss: +$('#c-loss').value / 1000,
    cross: +$('#c-cross').value / 100, buffer: +$('#c-buffer').value, seed: LAB.seed, duration: 20,
    oracle: $('#c-oracle').checked,
  };
}
function setSliders(p) {
  $('#c-bw').value = p.bw; $('#c-rtt').value = p.rtt; $('#c-loss').value = Math.round(p.loss * 1000);
  $('#c-cross').value = Math.round(p.cross * 100); $('#c-buffer').value = p.buffer; LAB.seed = p.seed;
  $('#c-seed').value = Math.min(1000, p.seed); refreshLabels();
}
function refreshLabels() {
  ['bw', 'rtt', 'loss', 'cross', 'buffer', 'seed'].forEach(k => { $('#v-' + k).textContent = FORMAT[k](+$('#c-' + k).value); });
}

function initLab() {
  ['bw', 'rtt', 'loss', 'cross', 'buffer'].forEach(k => $('#c-' + k).addEventListener('input', refreshLabels));
  $('#c-seed').addEventListener('input', e => { LAB.seed = +e.target.value; refreshLabels(); });
  refreshLabels();

  $('#btn-rand').addEventListener('click', () => {
    const pick = a => a[Math.floor(Math.random() * a.length)];
    setSliders({ bw: pick([50, 100, 200]), rtt: pick([20, 50, 100, 150]), loss: pick([5, 10, 20, 30]) / 1000,
      cross: pick([0, 10, 20, 30]) / 100, buffer: pick([0.5, 1, 2]), seed: 1 + Math.floor(Math.random() * 1e9) });
    runLive();
  });
  $('#btn-run').addEventListener('click', runLive);

  const list = $('#preruns');
  DATA.demos.forEach((d, i) => {
    const sp = d.result.tree.goodput / Math.max(d.result.cubic.goodput, .01);
    const b = h('button', { class: 'prerun' }, d.title, h('small', {},
      `${d.params.bw} Mbps · ${d.params.rtt} ms · ${(d.params.loss * 100).toFixed(1)}% loss · ${Math.round(d.params.cross * 100)}% traffic` +
      (sp > 1.2 ? ` · ${sp >= 10 ? Math.round(sp) : sp.toFixed(1)}× faster` : ' · same as CUBIC')));
    b.addEventListener('click', () => { $$('.prerun').forEach(x => x.classList.remove('on')); b.classList.add('on'); loadDemo(d); });
    list.append(b);
  });

  segment($('#pb-speed'), ['1×', '2×', '4×'], [1, 2, 4], 1, v => { LAB.speed = v; });
  $('#pb-play').addEventListener('click', () => {
    if (LAB.frac >= 1) LAB.frac = 0;
    LAB.playing = !LAB.playing; $('#pb-play').textContent = LAB.playing ? '⏸' : '▶';
  });
  $('#pb-scrub').addEventListener('input', e => { LAB.frac = +e.target.value / 1000; LAB.playing = false; $('#pb-play').textContent = '▶'; paint(); });

  setLabBusy(false);
  // start with the first pre-run network, played when the section scrolls into view
  list.children[0].classList.add('on');
  $('#c-oracle').checked = false;
  loadDemo(DATA.demos[0], false);
  onVisible($('#lab-out'), () => { LAB.frac = 0; LAB.playing = true; $('#pb-play').textContent = '⏸'; }, .35);
  requestAnimationFrame(loop);
}

function setLabBusy(busy) {
  LAB.busy = busy;
  $('#btn-run').disabled = busy || !SIM.ok; $('#btn-rand').disabled = busy || !SIM.ok;
  $('#run-note').textContent = SIM.ok ? 'Runs the real ns-3 simulator: about 20 simulated seconds, usually under a minute.'
    : (SIM.checked ? 'Simulator not found (WSL / ns-3). Pre-run networks below still work.' : 'Checking for the simulator…');
}

async function runLive() {
  if (LAB.busy || !SIM.ok) return;
  const params = labParams();
  setLabBusy(true); LAB.playing = false;
  $('#lab-out').style.display = 'none'; $('#lab-wait').style.display = '';
  ['cubic', 'tree', 'oracle'].forEach(k => $('#s-' + k).classList.remove('done'));
  $('#s-oracle').style.display = params.oracle ? '' : 'none';
  const t0 = Date.now(); let fi = 0;
  $('#wait-fact').textContent = FACTS[0];
  const ticker = setInterval(() => {
    $('#wait-time').textContent = Math.round((Date.now() - t0) / 1000);
    if ((Date.now() - t0) % 4000 < 600) $('#wait-fact').textContent = FACTS[++fi % FACTS.length];
  }, 500);
  const finish = () => { clearInterval(ticker); $('#lab-wait').style.display = 'none'; $('#lab-out').style.display = ''; setLabBusy(false); };
  try {
    const r = await fetch('/api/run', { method: 'POST', body: JSON.stringify(params) });
    const { id, error } = await r.json();
    if (error) throw new Error(error);
    while (true) {
      await new Promise(res => setTimeout(res, 700));
      const job = await (await fetch('/api/job?id=' + id)).json();
      (job.done || []).forEach(k => $('#s-' + k).classList.add('done'));
      if (job.status === 'error') throw new Error(job.error);
      if (job.status === 'done') { finish(); $$('.prerun').forEach(x => x.classList.remove('on')); loadDemo({ title: 'Live run', params, result: job.result }, true); return; }
    }
  } catch (err) {
    finish(); alert('Simulation failed: ' + err.message);
  }
}

function loadDemo(d, autoplay = true) {
  LAB.demo = d; const p = d.params, R = d.result;
  setSliders({ ...p, seed: p.seed });
  $('#lab-chips').innerHTML = [
    ['Link', `${p.bw} Mbps`], ['Distance', `${p.rtt} ms`], ['Wireless loss', `${(p.loss * 100).toFixed(1)}%`],
    ['Background traffic', `${Math.round(p.cross * 100)}%`], ['Buffer', `${p.buffer}× BDP`], ['Loss pattern', `#${p.seed}`],
  ].map(([k, v]) => `<span class="chip">${k} <b>${v}</b></span>`).join('') + (d.title !== 'Live run' ? `<span class="chip" style="border-color:rgba(34,211,238,.4)">${d.title}</span>` : `<span class="chip" style="border-color:rgba(52,211,153,.5);color:#6ee7b7">● live simulation</span>`);

  const RC = RACERS.filter(r => R[r.key]);
  $('#racers').style.gridTemplateColumns = `repeat(${RC.length}, 1fr)`;
  $('#racers').innerHTML = RC.map(r => `<div class="card racer" style="--c:${r.color}"><div class="nm"><span>${r.name}</span><span class="small">sending now</span></div>
    <div class="big" id="rn-${r.key}">0<small>Mbps</small></div><div class="meter"><i id="rm-${r.key}"></i></div><div class="fin" id="rf-${r.key}"></div></div>`).join('');

  const yMax = niceMax(Math.max(p.bw * 1.15, ...RC.map(r => Math.max(...R[r.key].series.map(s => s[1])))));
  const sty = { cubic: { color: COLORS['CUBIC'], width: 2.2 }, tree: { color: COLORS['LossLens'], width: 3.4 }, oracle: { color: COLORS['LossLens (oracle)'], width: 2, dash: true } };
  LAB.tMax = p.duration + 0.5;
  LAB.chart = timeChart($('#lab-chart'), {
    tMax: LAB.tMax, yMax, cap: p.bw, events: R.tree.events,
    series: RC.map(r => ({ key: r.key, pts: R[r.key].series.map(s => [s[0], s[1]]), ...sty[r.key] })),
  });
  $('#lab-legend').innerHTML = RC.map(r => `<span class="chip"><span class="sw" style="background:${r.color}"></span>${r.name}</span>`).join('');
  LAB.chart.onHover((t, e) => {
    tip.show(`<div class="h">t = ${fmt(t, 1)} s</div>` + RC.map(r =>
      `<div><span style="color:${r.color}">${r.name}</span><b>${fmt(valueAt(R[r.key].series, t), 1)} Mbps</b></div>`).join(''), e.clientX, e.clientY);
  });
  $('#verdict').style.display = 'none';
  LAB.frac = 0; LAB.playing = autoplay; $('#pb-play').textContent = autoplay ? '⏸' : '▶';
  paint();
}

let lastTs = 0;
function loop(ts) {
  requestAnimationFrame(loop);
  const dt = Math.min((ts - lastTs) / 1000, .1); lastTs = ts;
  if (!LAB.demo || !LAB.playing) return;
  LAB.frac = Math.min(1, LAB.frac + dt * LAB.speed / 13);
  if (LAB.frac >= 1) { LAB.playing = false; $('#pb-play').textContent = '↻'; }
  paint();
}

function paint() {
  const d = LAB.demo; if (!d) return;
  const R = d.result, p = d.params, t = LAB.frac * LAB.tMax;
  LAB.chart.set(LAB.frac);
  $('#pb-scrub').value = Math.round(LAB.frac * 1000);
  RACERS.filter(r => R[r.key]).forEach(r => {
    const v = valueAt(R[r.key].series, t);
    $('#rn-' + r.key).innerHTML = `${fmt(v, v < 10 ? 1 : 0)}<small>Mbps</small>`;
    $('#rm-' + r.key).style.width = Math.min(100, v / p.bw * 100) + '%';
    $('#rf-' + r.key).innerHTML = LAB.frac >= 1 ? `average delivered: <b>${fmt(R[r.key].goodput, 1)} Mbps</b> (${fmt(R[r.key].goodput / p.bw * 100, 0)}% of the link)` : '';
  });
  if (LAB.frac >= 1) showVerdict();
}

function showVerdict() {
  const d = LAB.demo, R = d.result, v = $('#verdict');
  const cub = R.cubic.goodput, ll = R.tree.goodput, orc = R.oracle ? R.oracle.goodput : null, ratio = ll / Math.max(cub, .01);
  const ev = R.tree.events, n = ev.length;
  const rand = ev.filter(e => e[1] === 0), cong = ev.filter(e => e[1] === 1);
  const ignored = rand.filter(e => e[2] === 0).length, reacted = cong.filter(e => e[2] === 1).length;
  const right = ignored + reacted, pct = n ? right / n * 100 : 100;
  v.style.display = '';
  if (ratio < 1.2) {
    v.className = 'verdict same';
    v.innerHTML = `<div class="x">≈ 1×</div><p><b>No random loss to fix here, and that is the point.</b> LossLens delivered ${fmt(ll, 1)} Mbps and normal TCP ${fmt(cub, 1)} Mbps: when losses really are congestion, LossLens behaves exactly like TCP. It reacted to ${reacted} of ${cong.length} congestion losses.</p>`;
  } else {
    v.className = 'verdict';
    v.innerHTML = `<div class="x grad">${ratio >= 10 ? Math.round(ratio) : fmt(ratio, 1)}× faster</div><p>On this exact network LossLens delivered <b>${fmt(ll, 1)} Mbps</b> against <b>${fmt(cub, 1)} Mbps</b> for normal TCP${orc === null ? '' : `; the perfect detective reached ${fmt(orc, 1)}`}. Of ${fmt(n, 0)} losses, the tree made the right call on <b>${fmt(pct, 0)}%</b>: it ignored ${ignored} of ${rand.length} random losses and slowed down for ${reacted} of ${cong.length} congestion losses.</p>`;
  }
}
