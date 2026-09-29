// Plain-language description of the Ground-N1 state. One source of truth for the pilot card and the guided encounter.
//   N1Coach.describe(state) -> { title, now, next, tone, pill:[text, cls], route, code, remaining, fraction }
//   N1Coach.ACTIONS[cmd]    -> button label for a pilot command
(function (g) {
  'use strict';
  const HOLD = {
    wind: 'The wind is too strong right now, so the ground asks you to wait. It will decide again by itself.',
    nopad: 'No pad is free at the moment. The ground will offer one as soon as it can.',
    supervisor: 'A person on the ground has to approve this first.',
    'supervisor-denied': 'The person on the ground said not yet.',
    battery: 'The battery is not charged enough to leave yet. Charging continues.',
    blocked: 'Something is on the pad, so departure is on hold.',
    operator: 'The ground team told the air taxi to hold.'
  };
  const ACTIONS = {
    connect: 'Connect to ground', requestLanding: 'Request landing', accept: 'Accept and read back', engage: 'Start approach',
    confirmSafe: 'Confirm rotors stopped', requestDeparture: 'Request departure', goAround: 'Go around', decline: 'Decline', disconnect: 'End session'
  };
  const padNum = c => (c && c.padName ? c.padName.slice(3) : '');

  function describe(s) {
    const a = s.ac, c = s.clearance, n = s.ui.next, out = { title: '', now: '', next: '', tone: '', pill: ['Ready', ''], route: [], code: null, remaining: null, fraction: null };
    const set = (title, now, next, pill, tone) => Object.assign(out, { title, now, next, pill, tone: tone || '' });
    if (c) { out.route = c.route.map(w => w.name); out.code = c.digest; }
    if (!s.link.up) return set('Radio link lost', 'The air taxi cannot talk to the ground, so it climbs and waits safely.', 'Wait for the link to return, then connect again.', ['Link lost', 'bad'], 'bad');
    if (s.complete) return set('Departure complete', 'The air taxi took off and left. Every message was checked and logged.', 'Restart to fly it again.', ['Complete', 'ok']);
    if (!a.connected) return set('Connect to ground', 'The air taxi is circling above the city and has not spoken to the ground yet.', 'Press Connect. That introduces the aircraft to the ground computer.', ['Offline', '']);
    if (a.stage === 'goaround') return set('Going around', 'The landing was cancelled for safety. The air taxi is climbing and will wait.', 'Wait for a new offer from the ground, then accept it.', ['Go-around', 'warn'], 'warn');
    if (n === 'accept') { out.remaining = c.remaining; out.fraction = c.remaining / 30; return set(`Cleared to ${c.op === 'landing' ? 'land' : 'depart'} on pad ${padNum(c)}`, `The ground checked the five pads, the wind and the battery. The offer is valid for ${c.remaining} more seconds.`, 'Press Accept. You repeat the code back so both sides know they agree.', ['Your turn', 'warn'], 'warn'); }
    if (n === 'engage') return set(`Confirmed · pad ${padNum(c)}`, c.op === 'departure' ? 'The ground checked your read-back and cleared you to leave.' : `The ground checked your read-back. Pad ${padNum(c)} is reserved for you.`, c.op === 'departure' ? 'Press Start departure.' : 'Press Start approach. The autopilot flies it in.', ['Confirmed', 'ok']);
    if (n === 'confirmSafe') return set('Rotors stopped', 'The air taxi is on the pad and the rotors have stopped.', 'Press Confirm. This tells the ground it is safe to plug in the charger.', ['On pad', 'ok']);
    if (n === 'requestDeparture') return set('Ready to leave', 'The battery is charged.', 'Press Request departure.', ['Ready', 'ok']);
    if (s.request) {
      const why = HOLD[a.holdReason];
      return set(s.request.op === 'landing' ? 'Landing request sent' : 'Departure request sent', why || 'The ground computer is checking the five pads, the wind and the battery.', s.pending ? 'Waiting for a person on the ground to approve.' : 'Nothing to press. Wait for the offer.', ['Request open', 'info'], why ? 'warn' : '');
    }
    if (c && c.status === 'offered' && !c.delivered) return set('Clearance incoming', 'The offer is travelling over the radio link.', 'Wait a moment.', ['Incoming', 'info']);
    if (['transit', 'inbound'].includes(a.stage)) return set(`Approaching pad ${padNum(c) || (a.padId || '').slice(1)}`, 'The autopilot is flying the route to the pad. A beam of light marks it.', 'Nothing to press. You can still go around (G).', ['Approach', 'info']);
    if (a.stage === 'descent') return set('Final descent', 'Coming straight down slowly and gently.', 'Nothing to press.', ['Landing', 'info']);
    if (a.stage === 'landed') return set('Touchdown', 'The rotors are slowing down.', 'Wait a few seconds.', ['On pad', 'ok']);
    if (a.stage === 'onpad') return a.serviced ? set('Ready to leave', 'The battery is charged.', 'Press Request departure.', ['Ready', 'ok']) : set('Charging', `The battery is at ${a.battery.toFixed(0)}% (charging is sped up for the demo).`, 'Wait until it is charged.', ['Charging', 'info']);
    if (['spoolup', 'liftoff', 'climbout', 'outbound', 'departed'].includes(a.stage)) return set('Departing', 'Taking off. The ground frees the pad once the aircraft is clear of it.', 'Nothing to press.', ['Departing', 'info']);
    return set('Ready to request', 'You are connected. Every message from now on is signed and checked.', 'Press Request landing.', ['Connected', 'ok']);
  }
  g.N1Coach = { describe, ACTIONS, HOLD };
  if (typeof module !== 'undefined') module.exports = g.N1Coach;
})(typeof window === 'undefined' ? globalThis : window);
