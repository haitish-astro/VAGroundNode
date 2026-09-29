// Guided cockpit encounter: a private Ground-N1 simulation ("encounter" room) with a plain-language coach.
(function () {
  'use strict';
  const $ = id => document.getElementById(id), ROOM = { room: 'encounter' };
  let link = null, st = null, blockedByUs = null, windy = false, lastSteps = '';
  const SPEEDS = [1, 2, 4];

  const say = {
    lost: ['The radio link to the ground dropped. The air taxi cannot talk to the ground, so it climbs and waits safely.', 'Wait for the link to come back, then press Connect again.', 'bad'],
    done: ['Finished. The air taxi took off and left, and every message was checked and logged.', 'Press Restart to fly it again, or try causing a problem first.', ''],
    idle: ['The air taxi is circling above the city. It has not spoken to the ground yet.', 'On the Pilot screen press Connect. That introduces the aircraft to the ground computer.', ''],
    connected: ['They are connected. Every message from now on is signed and checked, so nobody can fake one.', 'Press Request landing.', ''],
    goaround: ['The landing was cancelled for safety. The air taxi is climbing and will wait for a new offer.', 'Wait for the ground to offer another pad, then accept it.', 'warn'],
    transit: ['The autopilot is flying the route to the pad. Look for the beam of light on the pad it was given.', 'Nothing to press. You can still press Go around (or G) if you want to cancel.', ''],
    descent: ['Final descent: slowly and gently straight down onto the pad.', 'Nothing to press. Watch the ground get closer.', ''],
    landed: ['Touchdown. The rotors are slowing down.', 'Wait a few seconds for the rotors to stop.', ''],
    safe: ['The rotors have stopped.', 'Press Propulsion safe. This tells the ground it is safe to plug in the charger.', ''],
    charging: ['The battery is charging (sped up so you do not wait long).', 'Wait until it is charged.', ''],
    charged: ['The battery is charged and the aircraft is ready to leave.', 'Press Request departure.', ''],
    leaving: ['Taking off. The ground frees the pad as soon as the aircraft is clear of it.', 'Nothing to press. Watch it climb away.', '']
  };
  const HOLD = { wind: 'The wind is too strong right now, so the ground asks the air taxi to wait. It will decide again by itself.', nopad: 'No pad is free at the moment. The ground will offer one as soon as it can.', supervisor: 'A person on the ground must approve this first. Switch to the Ground team screen to approve it.', 'supervisor-denied': 'The person on the ground said not yet.', battery: 'The battery is not charged enough to leave yet. Charging continues.', blocked: 'There is something on the pad, so departure is on hold.', operator: 'The ground team told the air taxi to hold.' };

  function coach(s) {
    const a = s.ac, c = s.clearance, n = s.ui.next;
    if (!s.link.up) return say.lost;
    if (s.complete) return say.done;
    if (!a.connected) return say.idle;
    if (a.stage === 'goaround') return say.goaround;
    if (n === 'accept') return [`The ground computer checked the five pads, the wind and the battery, and offers pad ${c.padName.slice(3)}. The offer is only valid for ${c.remaining} seconds.`, 'Press Accept. You repeat back the code so both sides know they agree.', 'warn'];
    if (n === 'engage') return [c.op === 'departure' ? 'The ground checked your read-back code and cleared you to leave.' : 'The ground checked your read-back code. Pad ' + c.padName.slice(3) + ' is now reserved for you.', c.op === 'departure' ? 'Press Engage departure.' : 'Press Engage approach. The autopilot will fly it in.', ''];
    if (n === 'confirmSafe') return say.safe;
    if (n === 'requestDeparture') return say.charged;
    if (s.request) return [HOLD[a.holdReason] || 'The ground computer is checking the five pads, the wind and the battery. This takes a moment.', s.pending ? 'Open the Ground team screen and approve or deny.' : 'Nothing to press. Wait for the offer.', s.pending ? 'warn' : ''];
    if (['transit', 'inbound'].includes(a.stage)) return say.transit;
    if (a.stage === 'descent') return say.descent;
    if (a.stage === 'landed') return say.landed;
    if (a.stage === 'onpad') return s.serviced || a.serviced ? say.charged : say.charging;
    if (['spoolup', 'liftoff', 'climbout', 'outbound', 'departed'].includes(a.stage)) return say.leaving;
    if (n === 'requestLanding') return say.connected;
    return say.connected;
  }

  function render(s) {
    st = s; const [now, next, tone] = coach(s);
    $('now').textContent = now; $('next').textContent = next;
    $('now').parentElement.className = 'card now ' + tone;
    const key = s.ui.steps.join() + s.ui.step;
    if (key !== lastSteps) { lastSteps = key; $('steps').replaceChildren(...s.ui.steps.map((n, i) => { const li = document.createElement('li'); li.textContent = n; li.className = i < s.ui.step ? 'done' : i === s.ui.step ? 'now' : ''; return li; })); }
    $('autoplay').setAttribute('aria-pressed', String(s.autoplay)); $('speed').textContent = 'Speed ' + s.speed + '×';
    $('pSuper').setAttribute('aria-pressed', String(s.config.mode === 'supervised'));
    $('pBlock').textContent = blockedByUs && s.pads.find(p => p.id === blockedByUs && p.blocked) ? 'Clear the pad' : 'Block the pad';
    windy = s.weather.speed >= 10; $('pWind').textContent = windy ? 'Calm the wind' : 'Strong wind';
  }

  async function ground(cmd, args) { const r = await link.cmd(cmd, args || {}); $('pMsg').textContent = r.ok ? '' : r.reason; return r; }
  $('restart').onclick = () => { blockedByUs = null; link.sys('reset', { scenario: 'nominal', mode: st ? st.config.mode : 'auto' }); };
  $('autoplay').onclick = () => link.sys('autoplay', !st.autoplay);
  $('speed').onclick = () => link.sys('speed', SPEEDS[(SPEEDS.indexOf(st.speed) + 1) % SPEEDS.length]);
  $('pBlock').onclick = () => {
    if (blockedByUs) { ground('setPad', { padId: blockedByUs, field: 'blocked', value: false }); blockedByUs = null; return; }
    const a = st.ac, target = a.padId || (st.clearance && st.clearance.padId) || (st.pads.find(p => p.status === 'free') || {}).id;
    if (!target) { $('pMsg').textContent = 'No free pad to block right now.'; return; }
    blockedByUs = target; ground('setPad', { padId: target, field: 'blocked', value: true });
  };
  $('pWind').onclick = () => ground('setWeather', windy ? { speed: 4, intensity: 1 } : { speed: 14, intensity: 4 });
  $('pLink').onclick = () => ground('linkDrop', { seconds: 10 });
  $('pFake').onclick = () => ground('tamper').then(r => { if (r.ok) $('pMsg').textContent = 'A forged message was sent. Watch it get rejected in the message log.'; });
  $('pSuper').onclick = () => ground('setMode', { mode: st.config.mode === 'supervised' ? 'auto' : 'supervised' });
  const tab = which => { const p = which === 'pilot'; $('pilot').hidden = !p; $('ground').hidden = p; $('tabPilot').setAttribute('aria-selected', String(p)); $('tabGround').setAttribute('aria-selected', String(!p)); };
  $('tabPilot').onclick = () => tab('pilot'); $('tabGround').onclick = () => tab('ground');

  N1Link.connect('ground', {
    onState: render,
    onLog: log => { const d = log.decisions.at(-1); $('last').textContent = d ? 'Ground computer: ' + d.text : ''; },
    onReset: () => { blockedByUs = null; }
  }, ROOM).then(l => { link = l; });
})();
