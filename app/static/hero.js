'use strict';
// Hero illustration: two lanes (normal TCP vs LossLens) hit by the SAME radio interference at the
// same moments. Queue overflows (congestion) happen per lane, whenever that lane fills the link.

function initHero() {
  const cv = $('#hero-canvas'), ctx = cv.getContext('2d');
  let W = 0, H = 270, visible = true;
  const MAXR = 14;                                   // packets per second at full speed (visual)
  const lanes = [
    { name: 'Normal TCP', color: '#60a5fa', aware: false, rate: MAXR, pk: [], acc: 0, y: 92, cuts: 0, full: 0, fullLimit: 2.5 },
    { name: 'LossLens', color: '#22d3ee', aware: true, rate: MAXR, pk: [], acc: 0, y: 196, cuts: 0, full: 0, fullLimit: 2.5 },
  ];
  const fx = [];                                     // visual effects (rings + labels)
  let t = 0, nextRandom = 1.4;

  function resize() {
    const r = cv.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    W = r.width; cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize(); addEventListener('resize', resize);
  new IntersectionObserver(es => { visible = es[0].isIntersecting; }).observe(cv);

  const x0 = () => 205, x1 = () => W - 40;
  const pos = f => x0() + (x1() - x0()) * f;        // fraction along the path -> pixels
  const NODES = [[0, 'Sender'], [.38, 'Router queue'], [.66, 'Wi-Fi access point'], [1, 'Receiver']];

  // one loss on one lane: 'random' = radio interference, 'cong' = router queue overflowed
  function lose(l, kind) {
    const f = kind === 'random' ? .83 : .38;
    let best = -1, bd = 1;                          // remove the packet closest to the loss point
    l.pk.forEach((p, i) => { const d = Math.abs(p.f - f); if (d < bd && !p.dead) { bd = d; best = i; } });
    if (best >= 0 && bd < .12) { l.pk[best].dead = 1; l.pk[best].f = f; }
    const cut = kind === 'cong' || !l.aware;       // normal TCP cuts at every loss, LossLens only at congestion
    if (cut) { l.rate = Math.max(l.rate * .5, 2.5); l.cuts++; }
    fx.push({ x: pos(f), y: l.y, t: 0, kind, good: !(kind === 'random' && cut),
      text: kind === 'cong' ? 'queue full: slow down ✓' : cut ? 'interference: slows down ✗' : 'interference: ignored ✓' });
  }

  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, .05); last = now;
    if (!visible || !W) return;
    t += dt;
    if (t > nextRandom) { lanes.forEach(l => lose(l, 'random')); nextRandom = t + 1.1 + Math.random() * 1.6; }
    lanes.forEach(l => {
      // grow fast when far below capacity, gently near it (like CUBIC)
      l.rate = Math.min(MAXR, l.rate + (0.5 + 0.4 * (MAXR - l.rate)) * dt);
      // a lane that keeps the link full fills the router queue until it overflows
      if (l.rate > MAXR * .97) l.full += dt; else l.full = Math.max(0, l.full - dt);
      if (l.full > l.fullLimit) { lose(l, 'cong'); l.full = 0; l.fullLimit = 2 + Math.random() * 1.5; }
      l.acc += l.rate * dt;
      while (l.acc >= 1) { l.acc -= 1; l.pk.push({ f: 0, dead: 0 }); }
      l.pk.forEach(p => { if (p.dead) p.dead += dt; else p.f += dt * .3; });
      l.pk = l.pk.filter(p => p.f < 1.02 && p.dead < .6);
    });
    fx.forEach(e => e.t += dt);
    while (fx.length && fx[0].t > 1.2) fx.shift();
    draw();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.font = '600 12px Segoe UI, sans-serif'; ctx.textAlign = 'center';
    lanes.forEach(l => {
      // track
      ctx.strokeStyle = 'rgba(255,255,255,.1)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x0(), l.y); ctx.lineTo(x1(), l.y); ctx.stroke();
      // wireless stretch
      ctx.strokeStyle = 'rgba(251,146,60,.35)'; ctx.setLineDash([2, 7]);
      ctx.beginPath(); ctx.moveTo(pos(.66), l.y); ctx.lineTo(x1(), l.y); ctx.stroke(); ctx.setLineDash([]);
      // nodes
      NODES.forEach(([f, lab], i) => {
        const x = pos(f);
        ctx.fillStyle = '#0b1226'; ctx.strokeStyle = i === 2 ? '#fb923c' : i === 1 ? '#f43f5e' : 'rgba(255,255,255,.4)';
        ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, l.y, 11, 0, 7); ctx.fill(); ctx.stroke();
        if (l === lanes[0]) { ctx.fillStyle = '#8e99b8'; ctx.fillText(lab, x, 30); }
      });
      // packets
      l.pk.forEach(p => {
        const x = pos(Math.min(p.f, 1));
        if (p.dead) {
          ctx.globalAlpha = Math.max(0, 1 - p.dead / .6); ctx.fillStyle = '#fb7185';
          ctx.fillRect(x - 5, l.y - 5 + p.dead * 40, 10, 10); ctx.globalAlpha = 1;
        } else {
          ctx.shadowColor = l.color; ctx.shadowBlur = 10; ctx.fillStyle = l.color;
          ctx.beginPath(); ctx.roundRect(x - 5, l.y - 5, 10, 10, 3); ctx.fill(); ctx.shadowBlur = 0;
        }
      });
      // label + speed
      const mbps = l.rate / MAXR * 100;
      ctx.textAlign = 'left'; ctx.fillStyle = l.color; ctx.font = '800 15px Segoe UI, sans-serif';
      ctx.fillText(l.name, 18, l.y - 16);
      ctx.fillStyle = '#e8ecf8'; ctx.font = '800 26px Segoe UI, sans-serif';
      const num = Math.round(mbps) + '', nw = ctx.measureText(num).width;
      ctx.fillText(num, 18, l.y + 16);
      ctx.fillStyle = '#8e99b8'; ctx.font = '600 11.5px Segoe UI, sans-serif';
      ctx.fillText('Mbps · slow-downs: ' + l.cuts, 18 + nw + 8, l.y + 15);
      ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fillRect(18, l.y + 26, 120, 5);
      ctx.fillStyle = l.color; ctx.fillRect(18, l.y + 26, 120 * l.rate / MAXR, 5);
      ctx.textAlign = 'center'; ctx.font = '600 12px Segoe UI, sans-serif';
    });
    // loss effects
    fx.forEach(e => {
      const col = e.kind === 'random' ? '251,146,60' : '244,63,94', a = Math.max(0, 1 - e.t / 1.2);
      ctx.strokeStyle = `rgba(${col},${a})`; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(e.x, e.y, 8 + e.t * 34, 0, 7); ctx.stroke();
    });
    // what each lane did about each loss, written just above the lane
    ctx.font = '700 12.5px Segoe UI, sans-serif';
    fx.forEach(e => {
      ctx.globalAlpha = Math.max(0, 1 - e.t / 1.2);
      ctx.fillStyle = e.good ? '#34d399' : '#fb7185';
      ctx.fillText(e.text, e.x, e.y - 22 - e.t * 6);
    });
    ctx.globalAlpha = 1;
  }
  requestAnimationFrame(frame);
}
