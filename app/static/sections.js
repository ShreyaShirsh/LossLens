'use strict';
// Content sections driven by the baked data in DATA (results.json, model.json, demos.json).

const LOSSES = [0, 0.001, 0.005, 0.01, 0.02, 0.05];
const LOSS_LABEL = ['0%', '0.1%', '0.5%', '1%', '2%', '5%'];
const NICE = { 'LossLens (oracle)': 'Perfect detective (ceiling)' };
const niceName = a => NICE[a] || a;
const speedOf = (algo, rtt, loss) => DATA.results.speed.find(r => r.algo === algo && r.rtt === rtt && Math.abs(r.loss - loss) < 1e-9);

function segment(host, labels, values, current, onPick) {
  host.innerHTML = '';
  labels.forEach((lab, i) => {
    const b = h('button', { class: values[i] === current ? 'on' : '' }, lab);
    b.addEventListener('click', () => {
      $$('button', host).forEach(x => x.classList.remove('on')); b.classList.add('on'); onPick(values[i]);
    });
    host.append(b);
  });
}

/* ---------------- 1. problem ---------------- */
function initProblem() {
  let loss = 0.01, rtt = 50;
  const algos = ['NewReno', 'CUBIC', 'Veno', 'LossLens', 'LossLens (oracle)'];
  function render() {
    $('#prob-title').textContent = `${LOSS_LABEL[LOSSES.indexOf(loss)]} wireless loss · ${rtt} ms round trip`;
    const rows = algos.map(a => [a, speedOf(a, rtt, loss).mean]);
    $('#prob-bars').innerHTML = rows.map(([a, v]) => `
      <div class="bar-row ${a === 'CUBIC' || a === 'LossLens' ? 'hl' : ''}"><span class="nm">${niceName(a)}</span>
      <div class="track"><div class="fill" style="background:${COLORS[a]};${a === 'LossLens (oracle)' ? 'opacity:.55' : ''}" data-w="${Math.min(v, 100)}"></div></div>
      <span class="val">${fmt(v, 1)}</span></div>`).join('');
    requestAnimationFrame(() => requestAnimationFrame(() => $$('.fill', $('#prob-bars')).forEach(f => f.style.width = f.dataset.w + '%')));
    const cub = rows.find(r => r[0] === 'CUBIC')[1], ll = rows.find(r => r[0] === 'LossLens')[1];
    $('#prob-callout').innerHTML = loss === 0
      ? `With <b>no wireless loss</b> there is nothing to fix: LossLens behaves exactly like CUBIC (${fmt(ll, 1)} vs ${fmt(cub, 1)} Mbps).`
      : `At <b>${LOSS_LABEL[LOSSES.indexOf(loss)]} random loss</b>, standard CUBIC delivers <b>${fmt(cub, 1)} Mbps</b>, only ${fmt(cub, 0)}% of the link. LossLens delivers <b style="color:#67e8f9">${fmt(ll, 1)} Mbps</b>, <b style="color:#67e8f9">${fmt(ll / cub, 1)}× more</b>.`;
  }
  segment($('#seg-loss'), LOSS_LABEL, LOSSES, loss, v => { loss = v; render(); });
  segment($('#seg-rtt'), ['50 ms', '150 ms'], [50, 150], rtt, v => { rtt = v; render(); });
  render();
}

/* ---------------- 2. idea: clues ---------------- */
const CLUES = {
  srtt_ratio: ['Delay ratio', 'How much slower replies are now than the fastest ever seen. Queues make this climb.'],
  rtt_gradient: ['Delay trend', 'Were delays rising just before the loss? A filling queue says yes.'],
  rtt_var: ['Delay wobble', 'How much the last few delays jump around.'],
  ack_jitter: ['Reply rhythm', 'How irregularly the "got it" replies have been arriving.'],
  cwnd_bdp_ratio: ['Sending vs capacity', 'How much we send compared with what the link seems to carry. Overshooting means a queue.'],
  time_since_loss: ['Calm period', 'How long since the previous loss, in round trips.'],
  loss_rate: ['Recent loss rate', 'How often losses have happened lately.'],
};
function initClues() {
  const M = DATA.model, grid = $('#clue-grid'), f2 = v => fmt(v, Math.abs(v) < .01 ? 4 : Math.abs(v) < 1 ? 3 : 2);
  Object.entries(CLUES).forEach(([key, [name, desc]]) => {
    const c = M.clues[key], card = h('div', { class: 'card clue' });
    card.innerHTML = `<div class="tag">${key}</div><h3>${name}</h3><div class="muted small" style="min-height:62px">${desc}</div>
      <div class="vals"><span><span class="dotc" style="background:${RAND}"></span>random ${f2(c.median_random)}</span>
      <span><span class="dotc" style="background:${CONG}"></span>congestion ${f2(c.median_congestion)}</span></div><div class="hist"></div>`;
    miniHist($('.hist', card), c.hist.random, c.hist.congestion, RAND, CONG);
    grid.append(card);
  });
  grid.append(h('div', { class: 'card glow', html: `<h3>Why these seven?</h3><div class="muted small">Every clue is something the <b>sender can measure alone</b>: no help from routers, no special hardware. The same code computes them while collecting training data and while running inside TCP, so the model sees identical numbers in both.<br><br>Bars: how often each value occurs, per kind of loss (medians shown above).</div>` }));
  const sx = M.clues.srtt_ratio, sy = M.clues.cwnd_bdp_ratio;
  scatter($('#scatter'), M.scatter, [sx.lo, sx.hi], [sy.lo, sy.hi], 'Delay ratio (replies slower than the fastest)', 'Sending vs link capacity');
}

/* ---------------- 4. results ---------------- */
function initResults() {
  let tab = 'speed', rtt = 50; const hidden = new Set(), order = ['LossLens', 'LossLens (oracle)', 'CUBIC', 'NewReno', 'Veno'];
  const fairLoss = { v: 0 }, fairComp = { v: 1 };
  function speedChart() {
    $('#res-legend').innerHTML = '';
    order.forEach(a => {
      const chip = h('span', { class: 'chip toggle' + (hidden.has(a) ? ' off' : '') }, h('span', { class: 'sw', style: `background:${COLORS[a]}` }), niceName(a));
      chip.addEventListener('click', () => { hidden.has(a) ? hidden.delete(a) : hidden.add(a); speedChart(); });
      $('#res-legend').append(chip);
    });
    const series = order.filter(a => !hidden.has(a)).map(a => ({
      name: niceName(a), color: COLORS[a], dash: a === 'LossLens (oracle)', width: a === 'LossLens' ? 4.4 : 2.2,
      vals: LOSSES.map(l => speedOf(a, rtt, l).mean), err: LOSSES.map(l => speedOf(a, rtt, l).std),
    }));
    categoryLines($('#res-chart'), { cats: LOSS_LABEL, series, yMax: 50, yTitle: 'Goodput (Mbps)', xTitle: 'Random loss on the wireless link', unit: 'Mbps' });
  }
  function fairChart() {
    const F = DATA.results.fairness, algos = ['CUBIC', 'LossLens'], bufs = [0.5, 1, 2];
    $('#fair-legend').innerHTML = '';
    algos.forEach(a => $('#fair-legend').append(h('span', { class: 'chip' }, h('span', { class: 'sw', style: `background:${COLORS[a]}` }), a)));
    const get = (a, b) => F.find(r => r.algo === a && r.loss === fairLoss.v && r.competitors === fairComp.v && r.buffer === b)?.share;
    groupedBars($('#fair-chart'), {
      groups: bufs.map(b => `router buffer ${b}× BDP`), series: algos.map(a => ({ name: a, color: COLORS[a], vals: bufs.map(b => get(a, b)) })),
      yMax: 2, ref: 1, xTitle: `Our flow's share vs ${fairComp.v} competing CUBIC flow${fairComp.v > 1 ? 's' : ''} (equal start, 60 s)`,
    });
    const ll = get('LossLens', 1), cu = get('CUBIC', 1);
    $('#fair-note').innerHTML = fairLoss.v === 0
      ? `<b style="color:#67e8f9">LossLens takes exactly CUBIC's share</b> (${fmt(ll, 2)} vs ${fmt(cu, 2)} at 1× BDP): it is not aggressive towards other users.`
      : `With 1% wireless loss and competing flows that keep the queue full, nobody gets much and LossLens ≈ CUBIC (${fmt(ll, 2)} vs ${fmt(cu, 2)}). This is our <b>known limitation</b>.`;
  }
  function tableView() {
    const algos = ['NewReno', 'CUBIC', 'Veno', 'LossLens (oracle)', 'LossLens'];
    let html = `<table class="nums"><tr><th>${rtt} ms RTT</th>${LOSS_LABEL.map(l => `<th>${l} loss</th>`).join('')}</tr>`;
    algos.forEach(a => {
      html += `<tr class="${a.startsWith('LossLens') ? 'us' : ''}"><td><span class="dotc" style="background:${COLORS[a]}"></span>${niceName(a)}</td>` +
        LOSSES.map(l => { const v = speedOf(a, rtt, l).mean; return `<td style="background:rgba(34,211,238,${(Math.min(v, 50) / 50 * .45).toFixed(2)})">${fmt(v, 1)}</td>`; }).join('') + '</tr>';
    });
    $('#res-table').innerHTML = html + '</table>';
  }
  function show() {
    ['speed', 'fair', 'table'].forEach(t => $('#tab-' + t).style.display = t === tab ? '' : 'none');
    $('#res-rtt').style.display = tab === 'fair' ? 'none' : '';
    if (tab === 'speed') speedChart(); else if (tab === 'fair') fairChart(); else tableView();
  }
  segment($('#res-tabs'), ['Speed vs wireless loss', 'Fairness', 'All the numbers'], ['speed', 'fair', 'table'], tab, v => { tab = v; show(); });
  segment($('#res-rtt'), ['50 ms RTT', '150 ms RTT'], [50, 150], rtt, v => { rtt = v; show(); });
  const ctl = $('#fair-loss').parentElement;
  segment($('#fair-loss'), ['no wireless loss', '1% wireless loss'], [0, 0.01], 0, v => { fairLoss.v = v; fairChart(); });
  segment($('#fair-comp'), ['vs 1 CUBIC flow', 'vs 3 CUBIC flows'], [1, 3], 1, v => { fairComp.v = v; fairChart(); });
  show();
}

/* ---------------- 5. the detective ---------------- */
const SHORT = { srtt_ratio: 'delay ratio', rtt_gradient: 'delay trend', rtt_var: 'delay wobble', ack_jitter: 'reply rhythm',
  cwnd_bdp_ratio: 'send/capacity', time_since_loss: 'calm period', loss_rate: 'loss rate' };

function initBrain() {
  const M = DATA.model, d = M.dataset, c = M.confusion;
  $('#brain-lead').textContent = `Trained on ${fmt(d.usable, 0)} labelled losses from ${d.runs} simulation runs, then tested on ${M.split.test} runs it never saw. A "random" verdict on a real congestion loss is the costly mistake, so the tree is tuned to catch congestion first.`;
  $('#split-note').textContent = `${M.split.test} unseen runs · ${fmt(M.split.test_events, 0)} loss events`;
  const pc = (a, b) => fmt(a / (a + b) * 100, 1) + '%';
  $('#confusion').innerHTML = `
    <div></div><div class="hd">verdict:<br>congestion</div><div class="hd">verdict:<br>random</div>
    <div class="hd">truly<br>congestion</div>
    <div class="cell" style="background:rgba(52,211,153,.16)"><b>${pc(c.tp, c.fn)}</b><span class="small muted">caught · ${fmt(c.tp, 0)}</span></div>
    <div class="cell" style="background:rgba(244,63,94,.18)"><b>${pc(c.fn, c.tp)}</b><span class="small muted">missed · ${fmt(c.fn, 0)}</span></div>
    <div class="hd">truly<br>random</div>
    <div class="cell" style="background:rgba(251,146,60,.14)"><b>${pc(c.fp, c.tn)}</b><span class="small muted">false alarm · ${fmt(c.fp, 0)}</span></div>
    <div class="cell" style="background:rgba(52,211,153,.16)"><b>${pc(c.tn, c.fp)}</b><span class="small muted">ignored · ${fmt(c.tn, 0)}</span></div>`;
  $('#confusion').insertAdjacentHTML('afterend', `<div class="muted small" style="margin-top:12px">A false alarm just means normal TCP behaviour, which is safe. A miss is rarer by design.</div>`);
  $('#model-table').innerHTML = `<tr><th>Model</th><th>catches</th><th>ignores</th><th>accuracy</th></tr>` + M.comparison.map(m =>
    `<tr class="${m.model === 'Decision tree' ? 'us' : ''}"><td>${m.model}</td><td>${fmt(m.caught * 100, 1)}%</td><td>${fmt(m.ignored * 100, 1)}%</td><td>${fmt(m.accuracy * 100, 1)}%</td></tr>`).join('');
  const mx = Math.max(...M.importance.map(i => i.value));
  $('#imp').innerHTML = M.importance.map(i => `<div class="imp"><span>${CLUES[i.feature][0]}</span><div class="tr"><i data-w="${i.value / mx * 100}"></i></div><span>${fmt(i.value * 100, 0)}%</span></div>`).join('');
  onVisible($('#imp'), () => $$('#imp i').forEach(b => b.style.width = b.dataset.w + '%'));
  initTree();
}

let treeApi = null;
function initTree() {
  const M = DATA.model, root = M.tree, thr = M.threshold; let uid = 0;
  (function walk(n, depth) { n.id = uid++; n.depth = depth; n.open = !n.leaf && depth < 3; if (!n.leaf) { walk(n.l, depth + 1); walk(n.r, depth + 1); } })(root, 0);
  const BW = 176, BH = 36, CW = 218, RH = 46; let active = new Set();
  const svg = $('#tree-svg');
  function draw() {
    let row = 0, nodes = [], edges = [], maxD = 0;
    (function place(n) {
      maxD = Math.max(maxD, n.depth);
      if (n.leaf || !n.open) { n.y = row++ * RH + 28; nodes.push(n); return; }
      place(n.l); place(n.r); n.y = (n.l.y + n.r.y) / 2; nodes.push(n);
      edges.push([n, n.l, '≤']); edges.push([n, n.r, '>']);
    })(root);
    const W = (maxD + 1) * CW + 30, H = row * RH + 30;
    let g = '';
    edges.forEach(([a, b, lab]) => {
      const x1 = a.depth * CW + 12 + BW, y1 = a.y, x2 = b.depth * CW + 12, y2 = b.y, mx = (x1 + x2) / 2, on = active.has(a.id) && active.has(b.id);
      g += `<path d="M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}" fill="none" stroke="${on ? '#22d3ee' : 'rgba(255,255,255,.18)'}" stroke-width="${on ? 3 : 1.4}"/>` +
           `<text x="${x2 - 8}" y="${y2 - 5}" text-anchor="end" fill="#8e99b8" font-size="10">${lab === '≤' ? 'yes' : 'no'}</text>`;
    });
    nodes.forEach(n => {
      const x = n.depth * CW + 12, on = active.has(n.id);
      let fill = 'rgba(255,255,255,.06)', stroke = 'rgba(255,255,255,.22)', t1, t2 = '';
      if (n.leaf) {
        const cong = n.verdict === 'congestion';
        fill = cong ? 'rgba(244,63,94,.28)' : 'rgba(251,146,60,.24)'; stroke = cong ? '#f43f5e' : '#fb923c';
        t1 = cong ? 'SLOW DOWN' : 'KEEP SPEED'; t2 = `${fmt(n.p * 100, 0)}% congestion · n=${fmt(n.n, 0)}`;
      } else {
        t1 = `${SHORT[n.f]} ≤ ${fmt(n.t, Math.abs(n.t) < .1 ? 3 : 2)}`; t2 = n.open ? `n=${fmt(n.n, 0)}` : `▸ ${fmt(n.n, 0)} losses (click)`;
      }
      g += `<g class="tn" data-id="${n.id}"><rect x="${x}" y="${n.y - BH / 2}" width="${BW}" height="${BH}" rx="9" fill="${fill}" stroke="${on ? '#22d3ee' : stroke}" stroke-width="${on ? 3 : 1.3}"/>` +
           `<text x="${x + 10}" y="${n.y - 3}" fill="#e8ecf8" font-size="11.5" font-weight="700">${t1}</text>` +
           `<text x="${x + 10}" y="${n.y + 11}" fill="#8e99b8" font-size="10">${t2}</text></g>`;
    });
    svg.setAttribute('width', W); svg.setAttribute('height', H); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.innerHTML = g;
    $$('.tn', svg).forEach(el => el.addEventListener('click', () => {
      const n = find(root, +el.dataset.id); if (!n.leaf) { n.open = !n.open; draw(); }
    }));
  }
  const find = (n, id) => n.id === id ? n : n.leaf ? null : (find(n.l, id) || find(n.r, id));
  const all = (n, open) => { if (!n.leaf) { n.open = open; all(n.l, open); all(n.r, open); } };
  $('#tree-expand').addEventListener('click', () => { all(root, true); draw(); });
  $('#tree-collapse').addEventListener('click', () => { all(root, false); root.open = true; root.l.open = root.r.open = true; draw(); });
  draw();
  treeApi = {
    classify(vals) {                       // walk the tree for a clue vector; returns {leaf, path}
      let n = root, path = [];
      while (!n.leaf) { path.push(n.id); n = vals[n.f] <= n.t ? n.l : n.r; }
      path.push(n.id); return { leaf: n, path };
    },
    highlight(path) { active = new Set(path); draw(); },
    openPath(path) { path.forEach(id => { const n = find(root, id); if (!n.leaf) n.open = true; }); },
  };
  initTry();
}

function initTry() {
  const M = DATA.model, host = $('#try-sliders'), vals = {}, rows = {};
  Object.keys(CLUES).forEach(k => {
    const c = M.clues[k], step = (c.hi - c.lo) / 300;
    const inp = h('input', { type: 'range', min: c.lo, max: c.hi, step, value: c.median_random });
    const out = h('span', {}, '');
    rows[k] = { inp, out };
    inp.addEventListener('input', () => update());
    host.append(h('div', { class: 'sl-row' }, h('span', {}, CLUES[k][0]), inp, out));
  });
  const idx = { random: 0, congestion: 0 };
  function load(kind) {
    const ex = M.examples[kind][idx[kind]++ % M.examples[kind].length];
    Object.keys(CLUES).forEach(k => { rows[k].inp.value = ex[k]; });
    update(true);
  }
  function update(openPath) {
    Object.keys(CLUES).forEach(k => {
      vals[k] = +rows[k].inp.value; rows[k].out.textContent = fmt(vals[k], Math.abs(vals[k]) < .01 ? 4 : Math.abs(vals[k]) < 1 ? 3 : 2);
    });
    const { leaf, path } = treeApi.classify(vals);
    if (openPath === true) treeApi.openPath(path);
    treeApi.highlight(path);
    const cong = leaf.verdict === 'congestion', box = $('#verdict-box');
    box.textContent = cong ? 'CONGESTION: slow down' : 'RANDOM LOSS: keep speed';
    box.style.background = cong ? 'rgba(244,63,94,.22)' : 'rgba(251,146,60,.2)';
    box.style.color = cong ? '#fda4af' : '#fdba74';
    $('#verdict-detail').textContent = `This leaf: ${fmt(leaf.p * 100, 0)}% of ${fmt(leaf.n, 0)} similar training losses were congestion (threshold ${fmt(M.threshold * 100, 0)}%).`;
  }
  $('#ex-rand').addEventListener('click', () => load('random'));
  $('#ex-cong').addEventListener('click', () => load('congestion'));
  load('random');
}

/* ---------------- 6. build ---------------- */
function initBuild() {
  const M = DATA.model, R = DATA.results;
  $('#ph1-out').innerHTML = `<b>Output:</b> ${fmt(M.dataset.usable, 0)} labelled loss events from ${M.dataset.runs} runs`;
  $('#ph2-out').innerHTML = `<b>Output:</b> catches ${fmt(M.confusion.caught * 100, 1)}% of congestion losses, ignores ${fmt(M.confusion.ignored * 100, 1)}% of random ones (unseen runs)`;
  $('#ph3-out').innerHTML = `<b>Output:</b> ${R.runs} runs, 7–24× faster than CUBIC at 1% loss`;
  $('#loc').innerHTML = Object.entries(R.loc).map(([k, v]) => `<div><b>${fmt(v, 0)}</b>lines of ${k}</div>`).join('');
  const steps = ['Simulate', 'Label drops', 'Learn', 'Embed in TCP', 'Evaluate', 'Demo'], gap = 1000 / steps.length;
  let g = `<line x1="40" x2="960" y1="60" y2="60" stroke="rgba(255,255,255,.14)" stroke-width="3"/>
    <line x1="40" x2="960" y1="60" y2="60" stroke="url(#lg)" stroke-width="3" stroke-dasharray="10 14"><animate attributeName="stroke-dashoffset" from="48" to="0" dur="1.6s" repeatCount="indefinite"/></line>`;
  steps.forEach((s, i) => {
    const x = 60 + i * (880 / (steps.length - 1));
    g += `<circle cx="${x}" cy="60" r="19" fill="#0b1226" stroke="url(#lg)" stroke-width="3"/><text x="${x}" y="65" text-anchor="middle" fill="#e8ecf8" font-weight="800" font-size="14">${i + 1}</text>` +
         `<text x="${x}" y="108" text-anchor="middle" fill="#8e99b8" font-size="13.5">${s}</text>`;
  });
  $('#pipe').innerHTML = g;
}

/* ---------------- 7. wrap-up ---------------- */
const QA = [
  ['How does the detective decide?', 'At each loss it reads seven clues the sender can measure and walks a depth-6 decision tree. The delay ratio matters most: a filling router queue makes delays grow before a congestion loss, while a random loss shows up with delays flat.'],
  ['Why a decision tree and not a neural network?', 'Accuracy is close (see "Tree vs forest vs neural network"), but the tree is tiny, explainable, decides instantly, and exports to plain C++ if/else, so TCP needs no machine-learning library.'],
  ['Why are the results the same every time for the same settings?', 'ns-3 is deterministic: the same network and the same loss-pattern number always give the same result, so anyone can reproduce our numbers, and both senders face exactly the same losses. Change the pattern number or roll the dice and the numbers change. Our evaluation averaged 3 patterns per scenario.'],
  ['Is the live demo real or pre-recorded?', 'Real. "Run live simulation" starts three ns-3 simulations (normal TCP, LossLens, and the perfect detective) and plots what they measure. The pre-run networks are the same simulator, stored as a backup.'],
  ['What if the tree is wrong?', 'A timeout always counts as congestion, a safety fallback overrules the tree when a queue is clearly building, and the tree is tuned to catch at least 90% of congestion losses. A false alarm just means normal TCP behaviour, so the worst case is today\'s TCP.'],
  ['How were the training labels obtained?', 'The simulator knows why every packet vanished. A drop at the router queue is labelled congestion, a drop on the wireless link is labelled random. A real network can never tell you that, which is why we simulate.'],
  ['What is the "perfect detective" (oracle)?', 'The same TCP that is told the true cause of each loss by the simulator. It is the ceiling any classifier could reach. Our tree reaches roughly 70% of it.'],
  ['Why does LossLens gain nothing on a shared, full link?', 'When other TCP flows keep the queue full, delays always look high, so every loss looks like congestion and LossLens behaves like CUBIC. Smarter clues for shared bottlenecks are future work.'],
  ['Does this work on a real network?', 'We evaluated in simulation. The design needs only sender-side measurements and a tiny tree, so a Linux kernel port (for example with eBPF) is feasible, but it would need testing on real radios.'],
];
function initWrap() {
  const qa = $('#qa');
  QA.forEach(([q, a]) => {
    const box = h('div', { class: 'qa' }, h('button', {}, q), h('div', { class: 'ans' }, a));
    $('button', box).addEventListener('click', () => box.classList.toggle('open'));
    qa.append(box);
  });
  const team = [
    ['Shreya Shirsh', 'SS', 'Developer', 'Built everything technical: the ns-3 simulation, drop labelling, dataset, classifier, LossLens TCP, 396 experiments, this app.'],
    ['Avani Abhay Chaudhary', 'AC', 'Developer', 'Literature review, introduction, related work, simulation set-up and classifier chapters, references.'],
    ['Arpita Sinha', 'AS', 'Developer', 'Design and results chapters, diagrams, slides, abstract and conclusion.'],
  ];
  $('#team').innerHTML = team.map(([n, i, r, d]) => `<div class="card member"><div class="avatar">${i}</div><h3>${n}</h3><div class="chip" style="margin:6px 0 10px">${r}</div><p class="muted small">${d}</p></div>`).join('');
}
