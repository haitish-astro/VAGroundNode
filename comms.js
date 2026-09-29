// Guided cockpit encounter: a private Ground-N1 simulation ("encounter" room) with a plain-language coach.
(function () {
  'use strict';
  const $ = id => document.getElementById(id), ROOM = { room: 'encounter' }, SPEEDS = [1, 2, 4];
  let link = null, st = null, blockedByUs = null, lastSteps = '';

  function render(s) {
    st = s; const c = N1Coach.describe(s);
    $('now').textContent = c.now; $('next').textContent = c.next;
    $('now').parentElement.className = 'card now ' + c.tone;
    const key = s.ui.steps.join() + s.ui.step;
    if (key !== lastSteps) {
      lastSteps = key;
      $('steps').replaceChildren(...s.ui.steps.map((n, i) => { const li = document.createElement('li'); li.textContent = n; li.className = i < s.ui.step ? 'done' : i === s.ui.step ? 'now' : ''; if (i === s.ui.step) li.setAttribute('aria-current', 'step'); return li; }));
    }
    $('autoplay').setAttribute('aria-pressed', String(s.autoplay)); $('speed').textContent = 'Speed ' + s.speed + '×';
    $('pSuper').setAttribute('aria-pressed', String(s.config.mode === 'supervised'));
    const blocked = blockedByUs && s.pads.find(p => p.id === blockedByUs && p.blocked);
    $('pBlock').textContent = blocked ? 'Clear the pad' : 'Block the pad'; if (!blocked) blockedByUs = null;
    $('pWind').textContent = s.weather.speed >= 10 ? 'Calm the wind' : 'Strong wind';
  }

  async function ground(cmd, args) { const r = await link.cmd(cmd, args || {}); $('pMsg').textContent = r.ok ? '' : r.reason; return r; }
  $('restart').onclick = () => { blockedByUs = null; link.sys('reset', { scenario: 'nominal', mode: st ? st.config.mode : 'auto' }); };
  $('autoplay').onclick = () => link.sys('autoplay', !st.autoplay);
  $('speed').onclick = () => link.sys('speed', SPEEDS[(SPEEDS.indexOf(st.speed) + 1) % SPEEDS.length]);
  $('pBlock').onclick = () => {
    if (blockedByUs) { ground('setPad', { padId: blockedByUs, field: 'blocked', value: false }); blockedByUs = null; return; }
    const a = st.ac, target = a.padId || (st.clearance && st.clearance.padId) || (st.pads.find(p => p.status === 'free') || {}).id;
    if (!target) { $('pMsg').textContent = 'There is no free pad to block right now.'; return; }
    blockedByUs = target; ground('setPad', { padId: target, field: 'blocked', value: true });
  };
  $('pWind').onclick = () => ground('setWeather', st.weather.speed >= 10 ? { speed: 4, intensity: 1 } : { speed: 14, intensity: 4 });
  $('pLink').onclick = () => ground('linkDrop', { seconds: 10 });
  $('pFake').onclick = () => ground('tamper').then(r => { if (r.ok) $('pMsg').textContent = 'A fake message was sent. Watch it get rejected in the message log.'; });
  $('pSuper').onclick = () => ground('setMode', { mode: st.config.mode === 'supervised' ? 'auto' : 'supervised' });
  const tab = which => { const p = which === 'pilot'; $('pilot').hidden = !p; $('ground').hidden = p; $('tabPilot').setAttribute('aria-selected', String(p)); $('tabGround').setAttribute('aria-selected', String(!p)); };
  $('tabPilot').onclick = () => tab('pilot'); $('tabGround').onclick = () => tab('ground');

  N1Link.connect('ground', {
    onState: render,
    onLog: log => { const d = log.decisions.at(-1); $('last').textContent = d ? 'Ground computer: ' + d.text : ''; },
    onReset: () => { blockedByUs = null; }
  }, ROOM).then(l => { link = l; });
})();
