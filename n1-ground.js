// Ground control screen: radar, aircraft strip, pad control, weather, supervision, logs.
(function () {
  'use strict';
  const $ = id => document.getElementById(id), { setText, setClass, el } = N1UI;
  const msgList = new N1UI.MessageList($('msgs')), decLog = new N1UI.DecisionLog($('decs'));
  let link = null, st = null, mapMode = 'auto', hiPad = null, doneDismissed = false, lastTrail = 0, lastNotice = 0, wxSendAt = 0, apKey = '';
  const trail = [], disp = { x: 0, y: 0, z: 0, yaw: 0, ready: false };
  let rangeSm = 300, centerSm = { x: 0, z: -80 };

  async function cmd(name, args) { if (!link) return { ok: false }; const r = await link.cmd(name, args || {}); $('notice').textContent = r.ok ? '' : r.reason; lastNotice = performance.now(); return r; }
  document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => cmd('setMode', { mode: b.dataset.mode }));
  document.querySelectorAll('[data-range]').forEach(b => b.onclick = () => { mapMode = b.dataset.range; document.querySelectorAll('[data-range]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); });
  $('ivHold').onclick = () => cmd('hold'); $('ivGo').onclick = () => cmd('goAround'); $('ivRevoke').onclick = () => cmd('revoke');
  $('fxTamper').onclick = () => cmd('tamper'); $('fxReplay').onclick = () => cmd('replay'); $('fxLink').onclick = () => cmd('linkDrop', { seconds: 10 });
  $('apGo').onclick = () => cmd('approve', { padId: $('apPad').value }); $('apDeny').onclick = () => cmd('deny');
  $('doneRestart').onclick = () => { link.sys('reset', { scenario: st.scenario.id }); doneDismissed = false; };
  $('doneClose').onclick = () => { doneDismissed = true; $('doneModal').hidden = true; };
  const showTab = which => { const d = which === 'dec'; $('decs').hidden = !d; $('msgs').hidden = d; $('tabDec').setAttribute('aria-selected', String(d)); $('tabMsg').setAttribute('aria-selected', String(!d)); };
  $('tabDec').onclick = () => showTab('dec'); $('tabMsg').onclick = () => showTab('msg');

  // Weather sliders: send while dragging (throttled); reflect the state only when not being dragged.
  const wx = { speed: $('wxSpeed'), int: $('wxInt'), dir: $('wxDir') };
  const sendWeather = () => cmd('setWeather', { speed: +wx.speed.value, intensity: +wx.int.value, dir: +wx.dir.value });
  for (const input of Object.values(wx)) {
    input.addEventListener('input', () => { updateWxLabels(+wx.speed.value, +wx.int.value, +wx.dir.value); const now = performance.now(); if (now - wxSendAt > 120) { wxSendAt = now; sendWeather(); } });
    input.addEventListener('change', sendWeather);
  }
  function updateWxLabels(s, i, d) { setText($('wxSpeedV'), s.toFixed(1) + ' m/s'); setText($('wxIntV'), i.toFixed(1)); setText($('wxDirV'), N1Link.fmt.hdg(d) + '°'); }

  // Pad rows (built once)
  const padCards = new Map(), STATUS_CLASS = { free: 'ok', reserved: 'info', occupied: 'warn', blocked: 'bad', closed: '' };
  const padState = id => st.pads.find(p => p.id === id);
  function buildPads(pads) {
    $('pads').replaceChildren(...pads.map(p => {
      const card = el('div', 'pad-card'), head = el('div', 'pad-head'), name = el('b', '', p.name), pill = el('span', 'pill', ''), occ = el('span', 'occ', ''), btns = el('div', 'pad-btns');
      const ob = el('button', 'btn mini', 'Block'), cl = el('button', 'btn mini', 'Close');
      ob.title = 'Report debris or an obstruction on this pad'; cl.title = 'Close this pad for maintenance';
      ob.onclick = () => cmd('setPad', { padId: p.id, field: 'blocked', value: !padState(p.id).blocked });
      cl.onclick = () => cmd('setPad', { padId: p.id, field: 'closed', value: !padState(p.id).closed });
      head.append(name, pill); btns.append(ob, cl); card.append(head, btns, occ);
      card.onmouseenter = () => { hiPad = p.id; }; card.onmouseleave = () => { hiPad = null; };
      padCards.set(p.id, { card, pill, occ, ob, cl }); return card;
    }));
  }

  function render(s) {
    st = s; const a = s.ac;
    if (!disp.ready) Object.assign(disp, { x: a.pos.x, y: a.pos.y, z: a.pos.z, yaw: a.yaw, ready: true });
    document.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === s.config.mode)));
    setText($('linkTxt'), !s.link.up ? `Link lost${s.link.downFor ? ' · ' + s.link.downFor + ' s' : ''}` : a.connected ? 'Aircraft linked' : 'No aircraft session');
    setClass($('linkPill'), 'pill ' + (!s.link.up ? 'bad' : a.connected ? 'ok' : 'warn')); setClass($('linkDot'), 'dot ' + (!s.link.up ? 'bad' : a.connected ? 'ok' : 'warn'));
    setText($('verifyPill'), `✓ ${s.counters.verified} / ${s.counters.sent}` + (s.counters.rejected ? ` · ${s.counters.rejected} rejected` : '')); setClass($('verifyPill'), 'pill ' + (s.counters.rejected ? 'warn' : s.counters.verified ? 'ok' : ''));
    setText($('clock'), N1Link.fmt.clock(s.time));
    const bn = $('banner');
    if (!s.link.up) { bn.hidden = false; bn.className = 'banner blink'; setText(bn, 'Radio link lost. The aircraft session and clearance are cancelled.'); }
    else if (s.pending) { bn.hidden = false; bn.className = 'banner warn blink'; setText(bn, 'Your decision is needed: approve or hold the aircraft request.'); }
    else if (a.stage === 'goaround') { bn.hidden = false; bn.className = 'banner warn'; setText(bn, 'VH-101 is going around: climbing and holding.'); }
    else bn.hidden = true;

    // Aircraft strip
    const pad = a.padId && s.pads.find(p => p.id === a.padId), c = s.clearance, tgt = pad || (c && s.pads.find(p => p.id === c.padId));
    setText($('stripPhase'), a.phase); setClass($('stripPhase'), 'pill ' + (!s.link.up ? 'bad' : a.stage === 'goaround' ? 'warn' : 'info'));
    setText($('sAlt'), a.pos.y.toFixed(0) + ' m'); setText($('sGs'), a.groundSpeed.toFixed(0) + ' m/s'); setText($('sHdg'), N1Link.fmt.hdg(a.heading) + '°'); setText($('sBat'), a.battery.toFixed(0) + '%');
    setText($('sPad'), tgt ? tgt.name : '—'); setText($('sDist'), tgt ? Math.hypot(a.pos.x - tgt.x, a.pos.z - tgt.z).toFixed(0) + ' m' : '—');
    setText($('sVs'), a.vsi.toFixed(1)); setText($('sPow'), a.power.toFixed(0) + ' kW');
    setText($('sClr'), c ? `${c.op} · ${c.padName} · ${c.status}${c.status === 'offered' ? (c.delivered ? ` (${c.remaining} s)` : ' (in transit)') : ''}` : 'none');
    setText($('sReq'), s.request ? `${s.request.op}${s.request.priority ? ' · priority' : ''}` : s.pending ? 'waiting for you' : 'none');
    $('ivHold').disabled = !a.connected; $('ivGo').disabled = !['transit', 'inbound', 'descent'].includes(a.stage); $('ivRevoke').disabled = !c;

    // Approval card
    const ap = $('approval'); ap.hidden = !s.pending;
    if (s.pending) {
      const key = s.pending.kind + s.pending.padId + s.pending.candidates.join();
      if (key !== apKey) { apKey = key; const rec = s.pads.find(p => p.id === s.pending.padId);
        setText($('apText'), `${s.pending.kind === 'landing' ? 'Landing' : 'Departure'} request from VH-101 (battery ${a.battery.toFixed(0)}%). The computer recommends ${rec.name}. Approve it, choose another free pad, or hold.`);
        $('apPad').replaceChildren(...s.pending.candidates.map(id => { const o = el('option', '', s.pads.find(p => p.id === id).name + (id === s.pending.padId ? ' (recommended)' : '')); o.value = id; return o; })); $('apPad').value = s.pending.padId; }
    } else apKey = '';

    // Pads
    if (!padCards.size) buildPads(s.pads);
    for (const p of s.pads) {
      const pc = padCards.get(p.id); setClass(pc.card, 'pad-card ' + p.status + (p.id === a.padId ? ' mine' : ''));
      setText(pc.pill, N1Map.STATUS_TXT[p.status]); setClass(pc.pill, 'pill ' + STATUS_CLASS[p.status]);
      setText(pc.occ, p.occupants.length ? p.occupants.map(o => o.id).join(', ') : p.reservedBy ? 'Reserved for VH-101' : 'Empty');
      setText(pc.ob, p.blocked ? 'Unblock' : 'Block'); setText(pc.cl, p.closed ? 'Reopen' : 'Close'); pc.cl.disabled = p.occupants.length > 0 && !p.closed;
    }

    // Weather
    const w = s.weather, active = document.activeElement;
    if (active !== wx.speed) wx.speed.value = w.speed; if (active !== wx.int) wx.int.value = w.intensity; if (active !== wx.dir) wx.dir.value = w.dir;
    updateWxLabels(w.speed, w.intensity, w.dir);
    const over = w.peak > w.limit; setText($('wxPill'), `gusts ${w.peak.toFixed(0)} / limit ${w.limit} m/s`); setClass($('wxPill'), 'pill ' + (over ? 'bad' : w.peak > w.limit * .75 ? 'warn' : 'ok'));
    setText($('wxNote'), over ? 'Gusts are above the limit, so new landing and departure requests are held.' : 'Wind is within limits.');

    if (performance.now() - lastNotice > 6000 && $('notice').textContent) $('notice').textContent = '';
    if (s.time - lastTrail > .6) { lastTrail = s.time; trail.push({ x: a.pos.x, z: a.pos.z }); if (trail.length > 200) trail.shift(); }
    if (s.complete && !doneDismissed && $('doneModal').hidden) {
      const td = a.touchdown, rows = [['Elapsed', N1Link.fmt.clock(s.time)], ['Verified messages', `${s.counters.verified} / ${s.counters.sent}`], ['Rejected', String(s.counters.rejected)], ['Touchdown sink', td ? td.sink.toFixed(2) + ' m/s' : '—'], ['Scenario', s.scenario.label], ['Approvals', s.config.mode === 'auto' ? 'Automatic' : 'A person']];
      $('doneStats').replaceChildren(...rows.map(([k, v]) => { const d = el('div'); d.append(el('small', '', k), el('b', '', v)); return d; })); $('doneModal').hidden = false;
    }
    if (!s.complete) { $('doneModal').hidden = true; doneDismissed = false; }
  }

  function fit(canvas) {
    const dpr = Math.min(2, window.devicePixelRatio || 1), w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); return { ctx, W: w, H: h };
  }
  let last = performance.now();
  function frame(now) {
    const dt = Math.max(0, Math.min(.1, (now - last) / 1000)); last = now;
    if (st && disp.ready && !document.hidden) {
      try {
        const a = st.ac, age = link ? Math.min(.12, link.age()) : 0, k = 1 - Math.exp(-dt * 14);
        disp.x += (a.pos.x + a.vel.x * age - disp.x) * k; disp.y += (a.pos.y + a.vel.y * age - disp.y) * k; disp.z += (a.pos.z + a.vel.z * age - disp.z) * k;
        disp.yaw += Math.atan2(Math.sin(a.yaw - disp.yaw), Math.cos(a.yaw - disp.yaw)) * k;
        const { ctx, W, H } = fit($('radar'));
        if (W && H) {
          const term = { x: 0, z: 20 }, d = Math.hypot(a.pos.x - term.x, a.pos.z - term.z);
          let rT, cT;
          if (mapMode === 'term') { rT = 110; cT = term; } else if (mapMode === 'area') { rT = 520; cT = { x: 0, z: -110 }; }
          else { rT = Math.max(130, Math.min(520, d * .8 + 80)); cT = d > 200 ? { x: (term.x + a.pos.x) / 2, z: (term.z + a.pos.z) / 2 } : term; }
          rangeSm += (rT - rangeSm) * .06; centerSm.x += (cT.x - centerSm.x) * .06; centerSm.z += (cT.z - centerSm.z) * .06;
          N1Map.draw(ctx, W, H, { ...st, ac: { ...a, pos: { x: disp.x, y: disp.y, z: disp.z }, yaw: disp.yaw } }, { range: rangeSm, center: centerSm, style: 'ground', trail, hi: hiPad });
        }
      } catch (err) { console.error('Ground render error', err); }
    }
    requestAnimationFrame(frame);
  }

  N1Link.connect('ground', {
    onState: render,
    onLog: log => { msgList.update(log.messages); decLog.update(log.decisions); setText($('msgCount'), String(log.messages.length)); },
    onReset: () => { msgList.clear(); decLog.clear(); trail.length = 0; disp.ready = false; doneDismissed = false; }
  }).then(l => { link = l; });
  requestAnimationFrame(frame);
})();
