// Ground-N1 launcher: scenario / mode / speed / autoplay controls and window opener.
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  let link = null, st = null, scenarios = {};
  const SCENARIOS = [
    ['nominal', 'Normal landing', 'Calm wind and clear pads.'],
    ['windy', 'Strong wind', 'The wind is too strong to land, so the request is held until the ground team eases the wind.'],
    ['incursion', 'Something on the pad', 'Debris appears on the assigned pad just before landing: go around and use another pad.'],
    ['lowbattery', 'Low battery', 'The battery is low, so the request is treated as urgent and needs no approval.'],
    ['linkloss', 'Radio link drops', 'The radio link drops during the approach: the aircraft goes around and holds until you reconnect.']
  ];
  for (const [id, label, note] of SCENARIOS) { const o = document.createElement('option'); o.value = id; o.textContent = label; $('scenario').append(o); scenarios[id] = note; }
  const noteFor = () => { $('scenarioNote').textContent = scenarios[$('scenario').value]; };
  noteFor();
  let pendingScenario = null;
  $('scenario').onchange = () => { noteFor(); pendingScenario = $('scenario').value; link.sys('reset', { scenario: pendingScenario }); };
  $('restart').onclick = () => link.sys('reset', { scenario: $('scenario').value });
  document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => link.sys('mode', b.dataset.mode));
  document.querySelectorAll('[data-speed]').forEach(b => b.onclick = () => link.sys('speed', +b.dataset.speed));
  $('pause').onclick = () => link.sys('pause', !st.paused);
  $('autoplay').onclick = () => link.sys('autoplay', !st.autoplay);

  // Open the three windows side by side. Browsers may block pop-ups after the first.
  $('openAll').onclick = () => {
    link.sys('reset', { scenario: $('scenario').value });
    const w = screen.availWidth, h = screen.availHeight, left = screen.availLeft || 0, top = screen.availTop || 0;
    const specs = [
      ['n1-live.html', 'n1-live', `left=${left},top=${top},width=${w},height=${h}`],
      ['n1-pilot.html', 'n1-pilot', `left=${left},top=${top},width=${Math.round(w * .5)},height=${h}`],
      ['n1-ground.html', 'n1-ground', `left=${left + Math.round(w * .5)},top=${top},width=${Math.round(w * .5)},height=${h}`]
    ];
    const opened = specs.map(([url, name, feat]) => window.open(url, name, feat));
    if (opened.some(x => !x)) $('popupNote').textContent = 'Your browser blocked some windows. Allow pop-ups for this site, or open the screens from the Ground-N1 menu, or use All on one screen.';
    else $('popupNote').textContent = 'Windows opened. Move the live window to a second display if you have one.';
  };

  function update(s) {
    st = s;
    const mode = s.config.mode;
    document.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    document.querySelectorAll('[data-speed]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.speed === s.speed)));
    $('autoplay').setAttribute('aria-pressed', String(s.autoplay)); $('pause').textContent = s.paused ? 'Resume' : 'Pause';
    if (document.activeElement !== $('scenario') && $('scenario').value !== s.scenario.id) { $('scenario').value = s.scenario.id; noteFor(); }
    $('lsPhase').textContent = s.ac.phase; $('lsTime').textContent = N1Link.fmt.clock(s.time);
    $('lsVer').textContent = `${s.counters.verified}/${s.counters.sent}`;
    const peers = link.peers.filter(r => r !== 'launcher' && r !== 'viewer'); $('lsWin').textContent = String(new Set(peers).size) + '/3';
    $('statusPill').textContent = s.paused ? 'Paused' : s.complete ? 'Complete' : link.mode === 'local' ? 'Local mode' : 'Live'; $('statusPill').className = 'pill ' + (s.paused ? 'warn' : s.complete ? 'ok' : 'info');
  }
  N1Link.connect('launcher', { onState: update }).then(l => { link = l; });
})();
