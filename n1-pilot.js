// Pilot screen: flight display, map, one guidance card with a single primary action, verified datalink.
(function () {
  'use strict';
  const $ = id => document.getElementById(id), { setText, setClass, el } = N1UI;
  const msgList = new N1UI.MessageList($('msgs'));
  let link = null, st = null, mapMode = 'auto', doneDismissed = false, lastNoticeAt = 0, lastTrail = 0, busy = false;
  const trail = [], disp = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, gs: 0, vsi: 0, ready: false };
  let rangeSm = 120, centerSm = { x: 0, z: 20 };

  async function run(cmd) {
    if (!link || busy) return;
    busy = true;
    try { const res = await link.cmd(cmd, {}); $('notice').textContent = res.ok ? '' : res.reason; lastNoticeAt = performance.now(); }
    finally { busy = false; }
  }
  $('primary').onclick = () => { if (st && st.ui.next) run(st.ui.next); };
  $('declineBtn').onclick = () => run('decline'); $('goAroundBtn').onclick = () => run('goAround'); $('endBtn').onclick = () => run('disconnect');
  document.addEventListener('keydown', e => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = e.target.tagName; if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.key === 'Enter') { if (tag === 'BUTTON' || tag === 'A') return; if (st && st.ui.next) { e.preventDefault(); run(st.ui.next); } }
    else if ((e.key === 'g' || e.key === 'G') && st && st.ui.can.goAround) run('goAround');
  });
  document.querySelectorAll('[data-range]').forEach(b => b.onclick = () => { mapMode = b.dataset.range; document.querySelectorAll('[data-range]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); });
  $('doneRestart').onclick = () => { link.sys('reset', { scenario: st.scenario.id }); doneDismissed = false; };
  $('doneClose').onclick = () => { doneDismissed = true; $('doneModal').hidden = true; };

  function primaryLabel(s) {
    const n = s.ui.next; if (!n) return '';
    if (n === 'engage') return s.clearance && s.clearance.op === 'departure' ? 'Start departure' : N1Coach.ACTIONS.engage;
    return N1Coach.ACTIONS[n];
  }

  function render(s) {
    st = s; const a = s.ac, c = N1Coach.describe(s), can = s.ui.can;
    if (!disp.ready) Object.assign(disp, { x: a.pos.x, y: a.pos.y, z: a.pos.z, yaw: a.yaw, pitch: a.pitch, roll: a.roll, gs: a.groundSpeed, vsi: a.vsi, ready: true });

    // Status bar
    setText($('phase'), a.phase); setClass($('phaseBox'), 'phase' + (!s.link.up ? ' bad' : a.stage === 'goaround' ? ' warn' : ''));
    const linkTxt = !s.link.up ? `Link lost${s.link.downFor ? ' · ' + s.link.downFor + ' s' : ''}` : a.connected ? 'Verified link' : 'Not connected';
    setText($('linkTxt'), linkTxt); setClass($('linkPill'), 'pill ' + (!s.link.up ? 'bad' : a.connected ? 'ok' : 'warn')); setClass($('linkDot'), 'dot ' + (!s.link.up ? 'bad' : a.connected ? 'ok' : 'warn'));
    setText($('verifyPill'), `✓ ${s.counters.verified} / ${s.counters.sent}` + (s.counters.rejected ? ` · ${s.counters.rejected} rejected` : '')); setClass($('verifyPill'), 'pill ' + (s.counters.rejected ? 'warn' : s.counters.verified ? 'ok' : ''));
    setText($('clock'), N1Link.fmt.clock(s.time));
    setText($('stepText'), `Step ${s.ui.step + 1} of ${s.ui.steps.length} · ${s.ui.steps[s.ui.step]}`); $('stepBar').style.width = (s.ui.step / (s.ui.steps.length - 1) * 100) + '%';
    const ov = $('pfdOverlay'), ovOn = a.stage === 'goaround' || !s.link.up; ov.hidden = !ovOn; if (ovOn) { setClass(ov, 'pfd-overlay' + (s.link.up ? ' warn' : '')); setText(ov, s.link.up ? 'GO AROUND' : 'LINK LOST'); }

    // Systems
    setText($('sBat'), a.battery.toFixed(0) + '%'); const bb = $('sBatBar'); bb.style.width = a.battery + '%'; setClass(bb, a.battery < 25 ? 'bad' : a.battery < 40 ? 'warn' : '');
    setText($('sPow'), a.power.toFixed(0) + ' kW'); $('sPowBar').style.width = Math.min(100, a.power / 260 * 100) + '%';
    setText($('sThr'), a.thrustPct.toFixed(0) + '%'); $('sThrBar').style.width = a.thrustPct + '%';
    setText($('sWind'), s.weather.now.toFixed(1) + ' m/s'); setText($('sWindSub'), `from ${N1Link.fmt.hdg(s.weather.dir)}° · gusts ${s.weather.peak.toFixed(0)}`);

    // Guidance card
    setText($('clState'), c.pill[0]); setClass($('clState'), 'pill ' + c.pill[1]);
    setText($('clTitle'), c.title); setText($('clNext'), c.next);
    const rt = $('clRoute'), key = c.route.join('>'); if (rt.dataset.key !== key) { rt.dataset.key = key; rt.replaceChildren(...c.route.map(n => el('span', '', n))); }
    $('clCodeWrap').hidden = c.code == null || !(s.clearance && s.clearance.status === 'offered'); if (c.code != null) setText($('clCode'), c.code);
    $('clBarWrap').hidden = c.fraction == null; if (c.fraction != null) $('clBar').style.width = Math.max(0, c.fraction * 100) + '%';
    setText($('clTimer'), c.remaining != null ? c.remaining + ' s left' : '');
    const label = primaryLabel(s); $('primary').hidden = !label; if (label) { setText($('primaryLabel'), label); $('primary').classList.add('next'); $('primary').disabled = busy; }
    $('declineBtn').hidden = !can.decline; $('goAroundBtn').hidden = !can.goAround; $('endBtn').hidden = !can.disconnect;
    if (performance.now() - lastNoticeAt > 6000 && $('notice').textContent) $('notice').textContent = '';

    if (s.time - lastTrail > .6) { lastTrail = s.time; trail.push({ x: a.pos.x, z: a.pos.z }); if (trail.length > 160) trail.shift(); }
    if (s.complete && !doneDismissed && $('doneModal').hidden) {
      const td = a.touchdown, rows = [['Elapsed', N1Link.fmt.clock(s.time)], ['Verified messages', `${s.counters.verified} / ${s.counters.sent}`], ['Rejected', String(s.counters.rejected)], ['Touchdown sink', td ? td.sink.toFixed(2) + ' m/s' : '—'], ['Battery', a.battery.toFixed(0) + '%'], ['Scenario', s.scenario.label]];
      $('doneStats').replaceChildren(...rows.map(([k, v]) => { const d = el('div'); d.append(el('small', '', k), el('b', '', v)); return d; })); $('doneModal').hidden = false;
    }
    if (!s.complete) { $('doneModal').hidden = true; doneDismissed = false; }
  }

  function fit(canvas) {
    const dpr = Math.min(2, window.devicePixelRatio || 1), w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); return { ctx, W: w, H: h };
  }
  function drawMap() {
    const { ctx, W, H } = fit($('mfd')); if (!W || !H) return;
    const a = st.ac, term = { x: 0, z: 20 }, d = Math.hypot(a.pos.x - term.x, a.pos.z - term.z);
    let rT, cT;
    if (mapMode === 'term') { rT = 110; cT = term; } else if (mapMode === 'area') { rT = 520; cT = { x: 0, z: -110 }; }
    else { rT = Math.max(110, Math.min(520, d * .8 + 70)); cT = d > 200 ? { x: (term.x + a.pos.x) / 2, z: (term.z + a.pos.z) / 2 } : term; }
    rangeSm += (rT - rangeSm) * .06; centerSm.x += (cT.x - centerSm.x) * .06; centerSm.z += (cT.z - centerSm.z) * .06;
    N1Map.draw(ctx, W, H, { ...st, ac: { ...st.ac, pos: { x: disp.x, y: disp.y, z: disp.z }, yaw: disp.yaw } }, { range: rangeSm, center: centerSm, style: 'pilot', trail });
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.max(0, Math.min(.1, (now - last) / 1000)); last = now;
    if (st && disp.ready && !document.hidden) {
      try {
        const a = st.ac, age = link ? Math.min(.12, link.age()) : 0, k = 1 - Math.exp(-dt * 14);
        disp.x += (a.pos.x + a.vel.x * age - disp.x) * k; disp.y += (a.pos.y + a.vel.y * age - disp.y) * k; disp.z += (a.pos.z + a.vel.z * age - disp.z) * k;
        disp.pitch += (a.pitch - disp.pitch) * k; disp.roll += (a.roll - disp.roll) * k; disp.gs += (a.groundSpeed - disp.gs) * k; disp.vsi += (a.vsi - disp.vsi) * k;
        disp.yaw += Math.atan2(Math.sin(a.yaw - disp.yaw), Math.cos(a.yaw - disp.yaw)) * k;
        const p = fit($('pfd')); if (p.W && p.H) N1PFD.draw(p.ctx, p.W, p.H, disp, st);
        drawMap();
      } catch (err) { console.error('Pilot render error', err); }
    }
    requestAnimationFrame(frame);
  }

  N1Link.connect('pilot', {
    onState: render,
    onLog: log => { msgList.update(log.messages); setText($('msgCount'), log.messages.length + ' messages'); },
    onReset: () => { msgList.clear(); trail.length = 0; disp.ready = false; doneDismissed = false; }
  }).then(l => { link = l; });
  requestAnimationFrame(frame);
})();
