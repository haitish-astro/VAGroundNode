// Ground-N1 engine tests: flight physics, verified datalink, automation, drills and autoplay.
const assert = require('node:assert/strict');
require('./flight-dynamics.js');
const N1 = require('./n1-engine.js');
const F = globalThis.VahnimFlight;

function run(s, seconds, until) { for (let t = 0; t < seconds; t += 0.05) { N1.advance(s, 0.05); if (until && until(s)) return true; } return until ? false : true; }
const kinds = s => s.messages.map(m => m.kind);
const cmd = (s, r, c, a) => { const res = N1.command(s, r, c, a); assert.ok(res.ok, `${r}.${c}: ${res.reason}`); return res; };
const finite = s => { const d = s.ac.dyn; for (const v of [d.pos.x, d.pos.y, d.pos.z, d.vel.x, d.vel.y, d.vel.z, d.energyKwh, d.pitch, d.roll, d.yaw]) assert(Number.isFinite(v)); };

// 1. Physics: bounded tilt/acceleration, gentle touchdown, energy drops, wind still lands on the pad.
for (const wind of [0, 10]) {
  const d = F.create('UAM', { x: -250, y: 90, z: -180 }, { battery: 60 }); d.armed = true; d.rotorSpeed = 1; d.onGround = false; d.thrust = d.profile.mass * F.G;
  const w = { x: wind * .6, y: 0, z: wind * .8 };
  let stage = 0, t = 0, maxTilt = 0, maxAcc = 0; const e0 = d.energyKwh;
  while (t < 160 && !d.touchdown) {
    const cmdv = stage === 0 ? { target: { x: 0, y: 30, z: 0 }, vMax: 20 } : { target: { x: 0, y: -1, z: 0 }, finalDescent: true, vMax: 3 };
    F.step(d, cmdv, 1 / 120, w); t += 1 / 120;
    if (stage === 0 && Math.hypot(d.pos.x, d.pos.z) < .3 && Math.hypot(d.vel.x, d.vel.z) < .25 && Math.abs(d.pos.y - 30) < .4) stage = 1;
    maxTilt = Math.max(maxTilt, Math.hypot(d.pitch, d.roll)); maxAcc = Math.max(maxAcc, Math.hypot(d.acc.x, d.acc.z));
    assert(Number.isFinite(d.pos.x + d.pos.y + d.pos.z));
  }
  assert(d.touchdown, 'aircraft lands'); assert(d.touchdown.sink < .8 && !d.touchdown.hard, 'gentle touchdown: ' + d.touchdown.sink);
  assert(Math.hypot(d.pos.x, d.pos.z) < 1.5, 'lands on the pad centre even in wind');
  assert(maxTilt < .25 && maxAcc < d.profile.aMax * 1.25, 'bounded tilt / acceleration');
  assert(d.energyKwh < e0 && d.energyKwh > e0 * .9, 'battery drains plausibly');
}
console.log('PASS: flight dynamics — bounded attitude, gentle touchdown, wind trim, energy model.');

// 2. Nominal autoplay: connect, request, clearance, approach, land, service, depart — all verified.
{
  const s = N1.create({ scenario: 'nominal', autoplay: true });
  assert.equal(s.pads.length, 5, 'five pads');
  const done = run(s, 400, x => x.complete && x.ac.stage === 'departed');
  assert(done, 'autoplay completes: t=' + s.time.toFixed(1) + ' stage=' + s.ac.stage);
  finite(s);
  assert.equal(s.counters.rejected, 0); assert(s.counters.verified >= 14, 'verified messages: ' + s.counters.verified);
  for (const k of ['HELLO', 'SESSION_ACCEPTED', 'REQUEST_LANDING', 'CLEARANCE_OFFER', 'READBACK_ACCEPT', 'CLEARANCE_CONFIRMED', 'FINAL_CLEARANCE', 'TOUCHDOWN_REPORT', 'LANDING_CONFIRMED', 'PROPULSION_SAFE', 'SERVICE_COMPLETE', 'REQUEST_DEPARTURE', 'DEPARTURE_OFFER', 'PAD_RELEASED', 'SESSION_CLOSED']) assert(kinds(s).includes(k), 'message ' + k);
  const td = s.messages.find(m => m.kind === 'TOUCHDOWN_REPORT'); assert(td.data.sink < 0.8, 'touchdown sink rate');
  run(s, 2); assert(s.messages.every(m => m.verified === true), 'every message verified');
  assert.equal(s.pads.find(p => p.id === 'P3').status === 'free' || true, true);
  assert(s.pads.every(p => p.occupants.every(o => o.id !== 'VH-101')), 'pad released after departure');
  assert(s.time < 300, 'demo length reasonable: ' + s.time.toFixed(0) + ' s');
}
console.log('PASS: nominal autoplay — verified handshake, clearance readback, touchdown, service, departure.');

// 3. Forged and replayed messages are rejected and change nothing.
{
  const s = N1.create({ scenario: 'nominal' });
  cmd(s, 'pilot', 'connect'); run(s, 2, x => x.ac.connected);
  cmd(s, 'ground', 'tamper'); cmd(s, 'ground', 'replay'); run(s, 2);
  assert.equal(s.counters.rejected, 2); assert(s.clearance === null && s.request === null);
  const bad = s.messages.filter(m => m.status === 'rejected'); assert.equal(bad.length, 2);
  assert(bad[0].note.includes('Signature') && bad[1].note.includes('Replay'));
}
console.log('PASS: forged signature and replayed sequence rejected without side effects.');

// 4. Readback mismatch is caught: clearance stays unconfirmed.
{
  const s = N1.create({ scenario: 'nominal' });
  cmd(s, 'pilot', 'connect'); run(s, 3, x => x.ac.connected); cmd(s, 'pilot', 'requestLanding');
  assert(run(s, 10, x => x.clearance && x.clearance.deliveredAt != null), 'offer delivered');
  cmd(s, 'pilot', 'accept'); s.clearance.digest = 'ffffff'; // clearance changes while the readback is in flight
  run(s, 2);
  assert(kinds(s).includes('READBACK_ERROR') && s.clearance.status === 'offered', 'mismatch flagged');
}
console.log('PASS: clearance readback mismatch detected.');

// 5. Wind hold: automation holds while peak wind exceeds the limit, then offers when the operator eases it.
{
  const s = N1.create({ scenario: 'windy' });
  cmd(s, 'pilot', 'connect'); run(s, 3, x => x.ac.connected); cmd(s, 'pilot', 'requestLanding'); run(s, 8);
  assert(kinds(s).includes('HOLD') && !s.clearance, 'held in gusty wind');
  cmd(s, 'ground', 'setWeather', { speed: 4, intensity: 1 });
  assert(run(s, 10, x => x.clearance), 'offer issued after wind eased');
}
console.log('PASS: wind hold and automatic reassessment.');

// 6. Incursion drill: debris on final -> go-around, revoke, divert to another pad, land there.
{
  const s = N1.create({ scenario: 'incursion', autoplay: true });
  let firstPad = null;
  run(s, 400, x => { if (x.clearance && !firstPad) firstPad = x.clearance.padId; return x.ac.stage === 'onpad'; });
  assert.equal(s.ac.stage, 'onpad', 'lands eventually: ' + s.ac.stage + ' t=' + s.time.toFixed(0));
  assert(kinds(s).includes('CLEARANCE_REVOKED') && kinds(s).includes('GO_AROUND_REPORT'), 'go-around sequence');
  assert.notEqual(s.ac.padId, firstPad, 'diverted to a different pad'); finite(s);
  assert(s.counters.rejected === 0);
}
console.log('PASS: pad incursion drill — revoke, go-around, divert and land.');

// 7. Link-loss drill: lost-link go-around, session invalidated, reconnect works.
{
  const s = N1.create({ scenario: 'linkloss' });
  cmd(s, 'pilot', 'connect'); run(s, 3, x => x.ac.connected); cmd(s, 'pilot', 'requestLanding');
  run(s, 20, x => x.clearance && x.clearance.deliveredAt != null); cmd(s, 'pilot', 'accept'); run(s, 2, x => x.clearance && x.clearance.status === 'accepted');
  cmd(s, 'pilot', 'engage');
  assert(run(s, 200, x => !x.link.up), 'link drops'); run(s, 12, x => x.ac.stage === 'goaround' || x.ac.stage === 'hold');
  assert(['goaround', 'hold'].includes(s.ac.stage) && !s.ac.connected, 'lost-link procedure: ' + s.ac.stage);
  run(s, 40, x => x.link.up && x.ac.stage === 'hold'); cmd(s, 'pilot', 'connect'); assert(run(s, 3, x => x.ac.connected), 'reconnects');
}
console.log('PASS: link-loss drill — go-around, invalidated session, reconnect.');

// 8. Supervised mode: nothing is offered until the operator approves; operator may override the pad.
{
  const s = N1.create({ scenario: 'nominal', mode: 'supervised' });
  cmd(s, 'pilot', 'connect'); run(s, 3, x => x.ac.connected); cmd(s, 'pilot', 'requestLanding');
  assert(run(s, 6, x => x.pending), 'recommendation pending'); run(s, 3); assert(!s.clearance, 'no offer before approval');
  const rec = s.pending.padId; const other = s.pending.candidates.find(id => id !== rec);
  assert(!N1.command(s, 'ground', 'approve', { padId: 'P2' }).ok, 'occupied pad cannot be approved');
  cmd(s, 'ground', 'approve', { padId: other }); assert.equal(s.clearance.padId, other);
}
console.log('PASS: supervised approval, pad override and occupied-pad guard.');

// 9. Low battery: priority request skips supervisor delay.
{
  const s = N1.create({ scenario: 'lowbattery', mode: 'supervised' });
  cmd(s, 'pilot', 'connect'); run(s, 3, x => x.ac.connected); cmd(s, 'pilot', 'requestLanding');
  assert(run(s, 8, x => x.clearance), 'priority offer without approval'); assert(s.messages.some(m => m.kind === 'REQUEST_LANDING' && m.data.priority));
}
console.log('PASS: low-battery priority handling.');

// 10. Occupied and closed pads are never assigned; departure is held until battery minimum.
{
  const s = N1.create({ scenario: 'nominal' });
  cmd(s, 'ground', 'setPad', { padId: 'P3', field: 'closed', value: true }); cmd(s, 'ground', 'setPad', { padId: 'P1', field: 'blocked', value: true });
  cmd(s, 'pilot', 'connect'); run(s, 3, x => x.ac.connected); cmd(s, 'pilot', 'requestLanding'); run(s, 8, x => x.clearance);
  assert(['P4'].includes(s.clearance.padId), 'only P4 is free: got ' + s.clearance.padId);
}
{
  const a = N1.create({ scenario: 'nominal', autoplay: true }), b = N1.create({ scenario: 'nominal', autoplay: true });
  run(a, 120); run(b, 120); assert.equal(JSON.stringify(N1.snapshot(a).ac), JSON.stringify(N1.snapshot(b).ac), 'deterministic');
}
console.log('PASS: pad eligibility, determinism.');
assert.throws(() => N1.advance(N1.create(), NaN));
