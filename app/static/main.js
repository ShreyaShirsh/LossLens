'use strict';
// Boot: load the baked data, build every section, wire up navigation.

let DATA = {};
const SECTIONS = ['hero', 'problem', 'idea', 'lab', 'results', 'brain', 'build', 'wrap'];

async function boot() {
  const [results, model, demos] = await Promise.all(['results', 'model', 'demos'].map(n => fetch(`/data/${n}.json`).then(r => r.json())));
  DATA = { results, model, demos };

  // hero stats
  onVisible($('#st-runs'), () => {
    countUp($('#st-runs'), results.runs, { dur: 1600 });
    countUp($('#st-events'), model.dataset.usable, { dur: 1800 });
    countUp($('#st-fair'), 1, { dur: 1400, dec: 2 });
  }, .1);

  initHero(); initProblem(); initClues(); initResults(); initBrain(); initBuild(); initWrap(); initLab();

  // scroll reveal
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .12 });
  $$('.reveal').forEach(n => io.observe(n));
  $$('section > .card, section > .split, section > .grid, section > .tabs').forEach(n => { n.classList.add('reveal'); io.observe(n); });

  initNav();
  pollHealth();
}

function initNav() {
  const dots = $('#dots'), links = $$('#nav .links a');
  SECTIONS.forEach(id => dots.append(h('a', { href: '#' + id, title: id })));
  const spy = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return;
    $$('#dots a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + e.target.id));
    links.forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + e.target.id));
  }), { rootMargin: '-45% 0px -50% 0px' });
  SECTIONS.forEach(id => spy.observe($('#' + id)));
  addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.altKey || e.ctrlKey) return;
    const cur = SECTIONS.findIndex(id => $('#' + id).getBoundingClientRect().bottom > innerHeight * .4);
    let next = null;
    if (['ArrowRight', 'PageDown'].includes(e.key)) next = Math.min(SECTIONS.length - 1, cur + 1);
    if (['ArrowLeft', 'PageUp'].includes(e.key)) next = Math.max(0, cur - 1);
    if (next !== null) { e.preventDefault(); $('#' + SECTIONS[next]).scrollIntoView({ behavior: 'smooth' }); }
  });
}

async function pollHealth() {
  const pill = $('#sim-pill');
  for (let i = 0; i < 40; i++) {
    try {
      const h = await (await fetch('/api/health')).json();
      if (h.checked) {
        SIM.ok = h.wsl; SIM.checked = true;
        pill.className = h.wsl ? 'ok' : 'off';
        $('span', pill).textContent = h.wsl ? 'ns-3 simulator ready' : 'simulator offline · replay mode';
        setLabBusy(LAB.busy);
        return;
      }
    } catch (e) { /* server still starting */ }
    await new Promise(r => setTimeout(r, 700));
  }
}

boot().catch(err => { document.body.insertAdjacentHTML('afterbegin', `<pre style="color:#fda4af;padding:90px 30px">Failed to start: ${err}</pre>`); console.error(err); });
