// Vahnim Ground-N1 — authoritative engine for the one-aircraft / five-pad demonstration.
// Runs in a SharedWorker (browser) and directly in Node (tests). No DOM access.
//
// Everything the three screens show comes from this one state object:
//   pilot screen  -> sends commands as aircraft avionics (signed datalink messages)
//   ground screen -> sends commands as the ground operator; automation acts on its own
//   live screen   -> renders the shared state in 3D
//
// Datalink signing uses a small demo hash keyed per party. It shows the *shape* of message verification
// (integrity, sender identity, replay rejection). It is NOT cryptography and not a security design.
(function (g) {
  'use strict';
  if (typeof require !== 'undefined' && !g.VahnimFlight) require('./flight-dynamics.js');
  const F = g.VahnimFlight;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const AC_ID = 'VH-101', NODE_ID = 'GN-N1';
  const LATENCY = 0.35, STEP = 1 / 120;

  const PAD_DEFS = [
    { id: 'P1', name: 'GN-01', x: -72, z: 6 }, { id: 'P2', name: 'GN-02', x: -36, z: 38 }, { id: 'P3', name: 'GN-03', x: 0, z: 6 },
    { id: 'P4', name: 'GN-04', x: 36, z: 38 }, { id: 'P5', name: 'GN-05', x: 72, z: 6 }
  ];
  const HOLD_FIX = { name: 'ALFA', x: -330, y: 110, z: -300 };
  const EXIT_FIX = { name: 'OMEGA', x: 340, y: 110, z: -300 };
  const APPROACH_ALT = 60, HOVER_ALT = 32;
  const KEYS = { [AC_ID]: 'key-vh101-demo', [NODE_ID]: 'key-gnn1-demo' };
  const REGISTRY = { [AC_ID]: { operator: 'Vahnim Demo Air', type: 'UAM', model: 'V6', authorized: true } };

  const SCENARIOS = {
    nominal:    { label: 'Normal landing', note: 'Calm wind and clear pads.', wind: [4, 1, 315], battery: 58, drill: null },
    windy:      { label: 'Strong wind', note: 'The wind is too strong to land, so the request is held until the ground team eases the wind.', wind: [11, 3, 300], battery: 58, drill: null },
    incursion:  { label: 'Something on the pad', note: 'Debris appears on the assigned pad just before landing: go around and use another pad.', wind: [5, 1.5, 315], battery: 58, drill: 'incursion' },
    lowbattery: { label: 'Low battery', note: 'The battery is low, so the request is treated as urgent and needs no approval.', wind: [4, 1, 315], battery: 21, drill: null },
    linkloss:   { label: 'Radio link drops', note: 'The radio link drops during the approach: the aircraft goes around and holds until you reconnect.', wind: [4, 1, 315], battery: 58, drill: 'linkloss' }
  };

  // ---------- helpers ----------
  function mulberry(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function hash(str) { // cyrb53
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
  }
  const canon = m => [m.from, m.to, m.kind, m.seq, m.ts.toFixed(2), m.text, JSON.stringify(m.data || {})].join('|');
  const sign = (key, m) => hash(key + '|' + canon(m)).slice(0, 12);
  const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const round = (v, n = 2) => Math.round(v * 10 ** n) / 10 ** n;
  const deg = r => ((r * 180 / Math.PI) % 360 + 360) % 360;

  // ---------- state ----------
  function create(options) {
    const o = options || {}, sc = SCENARIOS[o.scenario] ? o.scenario : 'nominal', def = SCENARIOS[sc];
    const s = {
      time: 0, acc: 0, seed: o.seed == null ? 7 : o.seed, paused: false, speed: 1, complete: false,
      scenario: { id: sc, label: def.label, note: def.note, drill: def.drill, drillDone: false },
      config: { mode: o.mode === 'supervised' ? 'supervised' : 'auto', windLimit: 14, offerTtl: 30, acceptTtl: 120, minDepartureBattery: 60, lowBattery: 25, chargeRate: 2.0 },
      weather: { speed: def.wind[0], intensity: def.wind[1], dir: def.wind[2], gust: { x: 0, z: 0 }, vec: { x: 0, z: 0 } },
      link: { up: true, downUntil: 0 },
      session: { state: 'offline', id: null },
      pads: PAD_DEFS.map(p => ({ ...p, closed: false, blocked: false, occupants: [], reservedBy: null })),
      messages: [], msgSeq: 0, seqOut: { [AC_ID]: 0, [NODE_ID]: 0 }, seenSeq: { [AC_ID]: new Set(), [NODE_ID]: new Set() },
      outbox: [], msgVersion: 0, decSeq: 0, decisions: [], counters: { sent: 0, verified: 0, rejected: 0, lost: 0 },
      clearance: null, clearSeq: 0, request: null, pending: null, assessAt: 0, milestones: {},
      auto: { on: !!o.autoplay, at: 0 }, rng: null,
      ac: null
    };
    s.rng = mulberry(s.seed);
    s.pads[1].occupants = [{ id: 'VH-212', type: 'UAM' }];
    s.pads[4].occupants = [{ id: 'S4-07', type: 'UAV' }, { id: 'S4-08', type: 'UAV' }, { id: 'S4-11', type: 'UAV' }];
    const dyn = F.create('UAM', { x: HOLD_FIX.x, y: HOLD_FIX.y, z: HOLD_FIX.z }, { battery: def.battery, yaw: Math.atan2(-(0 - HOLD_FIX.x), -(0 - HOLD_FIX.z)) });
    dyn.armed = true; dyn.rotorSpeed = 1; dyn.onGround = false; dyn.thrust = dyn.profile.mass * F.G;
    s.ac = { id: AC_ID, dyn, stage: 'hold', engaged: false, connected: false, holdPos: { ...HOLD_FIX }, holdHeading: dyn.yaw, padId: null, holdReason: '', landedAt: null, spoolAt: 0, safeConfirmed: false, serviced: false, servicing: false, pusher: 0, lastReport: '', linkLostSince: null };
    weatherStep(s, 0);
    decide(s, 'info', `Ground-N1 online. Scenario: ${def.label}. ${s.pads.length} pads monitored; supervision mode: ${s.config.mode}.`);
    return s;
  }

  function decide(s, level, text) {
    s.decisions.push({ id: ++s.decSeq, t: round(s.time, 1), level, text });
    if (s.decisions.length > 80) s.decisions.shift(); s.msgVersion++;
  }

  // ---------- datalink ----------
  function send(s, from, kind, text, data, opts) {
    const o = opts || {}, to = from === AC_ID ? NODE_ID : AC_ID;
    const m = { id: 'M-' + String(++s.msgSeq).padStart(3, '0'), seq: ++s.seqOut[from], from, to, kind, text, data: data || {}, ts: round(s.time, 2), status: 'tx', verified: null, ack: false, note: '' };
    m.sig = sign(o.forgeKey || KEYS[from], m);
    if (o.replayOf) { m.seq = o.replayOf.seq; m.ts = o.replayOf.ts; m.sig = o.replayOf.sig; m.text = o.replayOf.text; m.kind = o.replayOf.kind; m.data = o.replayOf.data; m.id = 'M-' + String(s.msgSeq).padStart(3, '0'); }
    m.deliverAt = s.time + LATENCY; m.forged = !!o.forgeKey; m.replay = !!o.replayOf;
    s.messages.push(m); if (s.messages.length > 140) s.messages.shift();
    s.outbox.push(m); s.counters.sent++; s.msgVersion++;
    return m;
  }

  function deliver(s, m) {
    if (!s.link.up) { m.status = 'lost'; m.note = 'Datalink down: not delivered'; s.counters.lost++; s.msgVersion++; return; }
    // Verification: recompute signature with the sender's registered key, then reject replays.
    const ok = sign(KEYS[m.from], m) === m.sig;
    if (!ok) { m.status = 'rejected'; m.verified = false; m.note = 'Signature invalid: sender identity not verified. Message discarded.'; s.counters.rejected++; s.msgVersion++; decide(s, 'warn', `${m.id} ${m.kind} REJECTED: signature invalid. Command ignored.`); return; }
    if (s.seenSeq[m.from].has(m.seq)) { m.status = 'rejected'; m.verified = false; m.note = `Replay: sequence ${m.seq} already processed. Message discarded.`; s.counters.rejected++; s.msgVersion++; decide(s, 'warn', `${m.id} ${m.kind} REJECTED: replayed sequence ${m.seq}.`); return; }
    s.seenSeq[m.from].add(m.seq);
    m.verified = true; m.status = 'verified'; s.counters.verified++; m.ackAt = s.time + LATENCY; s.msgVersion++;
    if (m.to === NODE_ID) nodeReceive(s, m); else aircraftReceive(s, m);
  }

  // ---------- pads & assessment ----------
  const padById = (s, id) => s.pads.find(p => p.id === id);
  function padStatus(p) { return p.closed ? 'closed' : p.blocked ? 'blocked' : p.occupants.length ? 'occupied' : p.reservedBy ? 'reserved' : 'free'; }
  function peakWind(s) { return s.weather.speed + 2 * s.weather.intensity; }
  function routeFor(s, pad, op) {
    if (op === 'landing') {
      const dx = pad.x - HOLD_FIX.x, dz = pad.z - HOLD_FIX.z, len = Math.hypot(dx, dz), ux = dx / len, uz = dz / len;
      return [{ name: 'FAP-' + pad.name.slice(3), x: round(pad.x - ux * 90, 1), y: APPROACH_ALT, z: round(pad.z - uz * 90, 1) }, { name: pad.name, x: pad.x, y: HOVER_ALT, z: pad.z }];
    }
    return [{ name: 'CLIMB', x: pad.x, y: HOVER_ALT, z: pad.z }, { name: 'CLIMBOUT', x: round(pad.x + 45, 1), y: 70, z: round(pad.z - 70, 1) }, { name: EXIT_FIX.name, x: EXIT_FIX.x, y: EXIT_FIX.y, z: EXIT_FIX.z }];
  }
  function evaluatePads(s) {
    const ac = s.ac, out = [];
    for (const p of s.pads) {
      let reason = null;
      if (p.closed) reason = 'closed by operations';
      else if (p.blocked) reason = 'obstruction reported';
      else if (p.occupants.length) reason = `occupied by ${p.occupants.map(o => o.id).join(', ')}`;
      else if (p.reservedBy) reason = 'reserved';
      const d = dist2(ac.dyn.pos, p);
      const crowd = s.pads.filter(q => q !== p && q.occupants.length && dist2(p, q) < 50).length;
      out.push({ pad: p, reason, score: d + crowd * 25, crowd });
    }
    const free = out.filter(e => !e.reason).sort((a, b) => a.score - b.score);
    return { all: out, best: free[0] || null };
  }

  function hold(s, reasonKey, text) {
    const r = s.request; if (!r) return;
    if (r.holdKey !== reasonKey) { r.holdKey = reasonKey; send(s, NODE_ID, 'HOLD', text, { reason: reasonKey }); decide(s, 'warn', 'Automation: ' + text + ' Request stays open; reassessing.'); }
  }

  function assess(s) {
    const r = s.request; if (!r || r.status !== 'open' || s.clearance || s.pending) return;
    const ac = s.ac, battery = F.batteryPct(ac.dyn);
    if (r.op === 'landing') {
      if (!r.evaluated) { r.evaluated = true; decide(s, 'info', `Evaluating landing request ${AC_ID}: battery ${battery.toFixed(0)}%${r.priority ? ' (PRIORITY: below reserve)' : ''}, ${dist2(ac.dyn.pos, { x: 0, z: 0 }).toFixed(0)} m out, wind ${s.weather.speed.toFixed(0)} G${(s.weather.speed + 2 * s.weather.intensity).toFixed(0)} m/s.`); }
      if (peakWind(s) > s.config.windLimit) return hold(s, 'wind', `Hold: peak wind ${peakWind(s).toFixed(0)} m/s exceeds the ${s.config.windLimit} m/s limit.`);
      const ev = evaluatePads(s);
      if (r.holdKey === 'nopad' || !r.logged) { for (const e of ev.all) if (e.reason && !r.logged) decide(s, 'info', `${e.pad.name} rejected: ${e.reason}.`); r.logged = true; }
      if (!ev.best) return hold(s, 'nopad', 'Hold: no pad currently available. Automation will reassess as pads free up.');
      const p = ev.best.pad;
      if (s.config.mode === 'supervised' && !r.priority) {
        s.pending = { kind: 'landing', padId: p.id, since: s.time, candidates: ev.all.filter(e => !e.reason).map(e => e.pad.id) };
        send(s, NODE_ID, 'HOLD', 'Hold: recommendation awaiting supervisor approval.', { reason: 'supervisor' });
        decide(s, 'act', `Recommend ${p.name} for ${AC_ID} (${ev.best.score.toFixed(0)} m). Awaiting supervisor approval.`); s.msgVersion++; return;
      }
      decide(s, 'act', `Selected ${p.name}: nearest free pad (${ev.best.score.toFixed(0)} m)${r.priority ? ', priority handling' : ''}.`);
      offer(s, p, 'landing');
    } else {
      const p = padById(s, ac.padId);
      if (battery < s.config.minDepartureBattery) return hold(s, 'battery', `Hold: battery ${battery.toFixed(0)}% is below the ${s.config.minDepartureBattery}% departure minimum. Charging continues.`);
      if (peakWind(s) > s.config.windLimit) return hold(s, 'wind', `Hold: peak wind ${peakWind(s).toFixed(0)} m/s exceeds the ${s.config.windLimit} m/s limit.`);
      if (p.blocked) return hold(s, 'blocked', 'Hold: pad obstruction reported. Departure inhibited.');
      if (s.config.mode === 'supervised') { s.pending = { kind: 'departure', padId: p.id, since: s.time, candidates: [p.id] }; send(s, NODE_ID, 'HOLD', 'Hold: departure awaiting supervisor approval.', { reason: 'supervisor' }); decide(s, 'act', `Departure for ${AC_ID} awaiting supervisor approval.`); s.msgVersion++; return; }
      decide(s, 'act', `Departure conditions met (battery ${battery.toFixed(0)}%, wind within limit). Issuing departure clearance.`);
      offer(s, p, 'departure');
    }
  }

  function offer(s, pad, op) {
    const id = 'CL-' + String(++s.clearSeq).padStart(2, '0'), route = routeFor(s, pad, op);
    const digest = hash(id + pad.id + op + route.map(w => w.name).join('>')).slice(0, 6);
    s.clearance = { id, op, padId: pad.id, padName: pad.name, route, digest, status: 'offered', createdAt: s.time, expiresAt: s.time + s.config.offerTtl, deliveredAt: null };
    if (op === 'landing') pad.reservedBy = id;
    s.request.status = 'offered'; s.pending = null;
    const text = op === 'landing'
      ? `Cleared to land ${pad.name} via ${route[0].name}. Maintain ${APPROACH_ALT} m to the fix. Valid ${s.config.offerTtl} s. Read back code ${digest}.`
      : `Cleared to depart ${pad.name}: vertical climb to ${HOVER_ALT} m, climb-out to ${EXIT_FIX.name}. Valid ${s.config.offerTtl} s. Read back code ${digest}.`;
    send(s, NODE_ID, op === 'landing' ? 'CLEARANCE_OFFER' : 'DEPARTURE_OFFER', text, { clearance: id, pad: pad.id, digest });
  }

  function releaseClearance(s, status, why, notify) {
    const c = s.clearance; if (!c) return;
    c.status = status; const p = padById(s, c.padId);
    if (p && p.reservedBy === c.id) p.reservedBy = null;
    if (notify) send(s, NODE_ID, status === 'expired' ? 'CLEARANCE_EXPIRED' : 'CLEARANCE_REVOKED', why, { clearance: c.id });
    s.clearance = null; if (s.request && s.request.status !== 'closed') s.request = null;
  }

  // ---------- receiving ----------
  function nodeReceive(s, m) {
    const ac = s.ac, c = s.clearance;
    switch (m.kind) {
      case 'HELLO': {
        const reg = REGISTRY[m.data.identity];
        if (!reg || !reg.authorized || m.data.operator !== reg.operator) { send(s, NODE_ID, 'SESSION_REJECTED', 'Identity not in registry. Session refused.', {}); decide(s, 'warn', 'HELLO refused: unknown identity or operator.'); return; }
        s.session = { state: 'active', id: 'S-' + hash(m.sig).slice(0, 5).toUpperCase() };
        decide(s, 'info', `Session ${s.session.id} opened: ${m.data.identity} (${reg.operator}, ${reg.type} ${reg.model}) verified against registry.`);
        send(s, NODE_ID, 'SESSION_ACCEPTED', `Session ${s.session.id} accepted. ${s.pads.length} pads, wind ${s.weather.speed.toFixed(0)} m/s. Hold at ${HOLD_FIX.name} and request when ready.`, { session: s.session.id });
        break; }
      case 'REQUEST_LANDING':
        s.request = { op: 'landing', at: s.time, status: 'open', priority: !!m.data.priority, holdKey: null, evaluated: false };
        s.assessAt = s.time + 1.0; decide(s, 'info', `Received ${m.id} REQUEST_LANDING (signature verified).`);
        break;
      case 'READBACK_ACCEPT':
        if (!c || c.id !== m.data.clearance) { send(s, NODE_ID, 'READBACK_ERROR', 'Readback references no active clearance.', {}); break; }
        if (s.time > c.expiresAt) { releaseClearance(s, 'expired', 'Acceptance arrived after the clearance expired. Request again.', true); break; }
        if (m.data.digest !== c.digest) { send(s, NODE_ID, 'READBACK_ERROR', `Readback mismatch (expected ${c.digest}). Clearance not confirmed.`, {}); decide(s, 'warn', 'Readback mismatch. Clearance not confirmed.'); break; }
        c.status = 'accepted'; c.expiresAt = s.time + s.config.acceptTtl; s.request = null;
        decide(s, 'act', `Readback verified for ${c.id}. ${c.padName} locked for ${AC_ID}.`);
        send(s, NODE_ID, 'CLEARANCE_CONFIRMED', `Readback verified. ${c.padName} reserved. Engage ${c.op === 'landing' ? 'approach' : 'departure'} when ready.`, { clearance: c.id });
        break;
      case 'DECLINE':
        if (c) { decide(s, 'info', `${AC_ID} declined ${c.id}. Pad released.`); releaseClearance(s, 'declined', '', false); }
        break;
      case 'APPROACH_REPORT': s.milestones.approach ??= m.ts; break;
      case 'FAP_REPORT':
        decide(s, 'info', `${AC_ID} established at ${m.data.fix}. Checking pad and wind for final.`);
        if (c && padById(s, c.padId).blocked) break;
        send(s, NODE_ID, 'FINAL_CLEARANCE', `Pad clear, wind within limits. Cleared to land ${c ? c.padName : ''}. Continue.`, {});
        break;
      case 'GO_AROUND_REPORT':
        decide(s, 'warn', `${AC_ID} reports go-around.`);
        if (c && c.id === m.data.clearance) releaseClearance(s, 'aborted', '', false);
        break;
      case 'TOUCHDOWN_REPORT': {
        const p = padById(s, ac.padId); if (p) { p.occupants = [{ id: AC_ID, type: 'UAM' }]; p.reservedBy = null; }
        if (c) { c.status = 'completed'; s.clearance = null; }
        s.milestones.touchdown = round(s.time, 1);
        decide(s, 'act', `Touchdown confirmed on ${p.name}: sink ${m.data.sink.toFixed(2)} m/s. Pad occupied.`);
        send(s, NODE_ID, 'LANDING_CONFIRMED', `Touchdown recorded on ${p.name}. Rotors spooling down; report propulsion safe.`, {});
        break; }
      case 'PROPULSION_SAFE':
        ac.servicing = true; decide(s, 'act', 'Propulsion-safe confirmed. Starting automated turnaround: charging (demo time-compressed).');
        send(s, NODE_ID, 'SERVICE_STARTED', 'Ground power connected. Charging in progress.', {});
        break;
      case 'REQUEST_DEPARTURE':
        s.request = { op: 'departure', at: s.time, status: 'open', holdKey: null, evaluated: true }; s.assessAt = s.time + 0.8;
        decide(s, 'info', `Received ${m.id} REQUEST_DEPARTURE (signature verified).`);
        break;
      case 'DEPARTURE_REPORT':
        if (m.data.phase === 'airborne') { s.milestones.liftoff = round(s.time, 1); send(s, NODE_ID, 'DEPARTURE_ACK', 'Airborne. Continue climb-out.', {}); }
        if (m.data.phase === 'clear') {
          const p = padById(s, ac.padId); p.occupants = []; p.reservedBy = null;
          if (c) { c.status = 'completed'; s.clearance = null; }
          decide(s, 'act', `${AC_ID} clear of ${p.name}. Pad released.`); send(s, NODE_ID, 'PAD_RELEASED', `${p.name} released and available.`, {});
        }
        if (m.data.phase === 'outbound') { s.complete = true; s.milestones.complete = round(s.time, 1); decide(s, 'info', `${AC_ID} departed the terminal area. Session complete.`); send(s, NODE_ID, 'SESSION_CLOSED', 'Departure complete. Safe flight.', {}); s.session.state = 'closed'; }
        break;
      default: break;
    }
  }

  function aircraftReceive(s, m) {
    const ac = s.ac;
    if (m.kind === 'SESSION_ACCEPTED') { ac.connected = true; s.session.state = 'active'; }
    if (m.kind === 'CLEARANCE_OFFER' || m.kind === 'DEPARTURE_OFFER') { if (s.clearance && s.clearance.id === m.data.clearance) s.clearance.deliveredAt = s.time; }
    if (m.kind === 'HOLD') ac.holdReason = m.data.reason || '';
    if (m.kind === 'GO_AROUND' || m.kind === 'CLEARANCE_REVOKED') beginGoAround(s, m.kind === 'GO_AROUND' ? 'Ground ordered go-around' : 'Clearance revoked');
  }

  // ---------- aircraft autonomy ----------
  function airborneApproach(ac) { return ['transit', 'inbound', 'descent'].includes(ac.stage); }
  function beginGoAround(s, why) {
    const ac = s.ac;
    if (!airborneApproach(ac) || ac.dyn.pos.y < 3) return;
    const clearanceId = ac.approachClearance || null;
    ac.engaged = false; ac.stage = 'goaround'; ac.padId = null; ac.holdHeading = ac.dyn.yaw;
    ac.holdPos = { x: ac.dyn.pos.x, y: Math.max(ac.dyn.pos.y + 25, 75), z: ac.dyn.pos.z };
    // Only the clearance this approach was flown under is released; a divert offered meanwhile survives.
    if (s.clearance && s.clearance.id === clearanceId) { releaseClearance(s, 'aborted', '', false); s.request = null; }
    send(s, AC_ID, 'GO_AROUND_REPORT', `${why}. Going around: climbing to ${ac.holdPos.y.toFixed(0)} m and holding.`, { clearance: clearanceId });
    decide(s, 'warn', `${AC_ID} executing go-around (${why}).`);
  }

  function chooseAlternate(s, why) {
    const ev = evaluatePads(s);
    if (!ev.best) { decide(s, 'warn', 'No alternate pad available. Aircraft holds.'); return; }
    s.request = { op: 'landing', at: s.time, status: 'open', priority: true, holdKey: null, evaluated: true, logged: true };
    decide(s, 'act', `Divert: ${ev.best.pad.name} selected as alternate (${why}).`);
    if (s.config.mode === 'supervised') { s.pending = { kind: 'landing', padId: ev.best.pad.id, since: s.time, candidates: ev.all.filter(e => !e.reason).map(e => e.pad.id) }; return; }
    offer(s, ev.best.pad, 'landing');
  }

  function target(s) {
    const ac = s.ac, d = ac.dyn, pad = ac.padId && padById(s, ac.padId);
    switch (ac.stage) {
      case 'hold': case 'goaround': return { target: ac.holdPos, vMax: 10, heading: ac.holdHeading };
      case 'transit': { const fap = s.clearance.route[0]; return { target: { x: fap.x, y: fap.y, z: fap.z }, vMax: 18, heading: Math.atan2(-(pad.x - fap.x), -(pad.z - fap.z)) }; }
      case 'inbound': return { target: { x: pad.x, y: HOVER_ALT, z: pad.z }, vMax: 11, heading: approachHeading(s, pad) };
      case 'descent': return { target: { x: pad.x, y: -1, z: pad.z }, finalDescent: true, vMax: 3, heading: approachHeading(s, pad) };
      case 'liftoff': return { target: { x: pad.x, y: HOVER_ALT + 4, z: pad.z }, vMax: 3, climb: 3.4, heading: d.yaw };
      case 'climbout': return { target: { x: pad.x + 45, y: 70, z: pad.z - 70 }, vMax: 12, heading: null };
      case 'outbound': return { target: { x: EXIT_FIX.x, y: EXIT_FIX.y, z: EXIT_FIX.z }, vMax: 20, heading: null };
      default: return null;
    }
  }
  function approachHeading(s, pad) { const fap = s.clearance ? s.clearance.route[0] : HOLD_FIX; return Math.atan2(-(pad.x - fap.x), -(pad.z - fap.z)); }

  function aircraftStep(s, dt) {
    const ac = s.ac, d = ac.dyn, w = { x: s.weather.vec.x + s.weather.gust.x, y: 0, z: s.weather.vec.z + s.weather.gust.z };
    const pad = ac.padId && padById(s, ac.padId), c = s.clearance;
    if (['transit', 'inbound'].includes(ac.stage) && !c) { ac.stage = 'hold'; ac.engaged = false; ac.padId = null; ac.holdPos = { x: d.pos.x, y: d.pos.y, z: d.pos.z }; ac.holdHeading = d.yaw; }
    else if (ac.stage === 'descent' && !c && d.pos.y >= 3) beginGoAround(s, 'Clearance no longer valid');
    // Stage transitions
    if (ac.stage === 'transit' && pad && c) {
      const fap = c.route[0];
      if (Math.hypot(d.pos.x - fap.x, d.pos.z - fap.z) < 14 && d.groundSpeed < 19) {
        ac.stage = 'inbound'; send(s, AC_ID, 'FAP_REPORT', `Established at ${fap.name}, ${d.pos.y.toFixed(0)} m, ${d.groundSpeed.toFixed(0)} m/s. Requesting final.`, { fix: fap.name }); s.milestones.fap = round(s.time, 1);
      }
    } else if (ac.stage === 'inbound' && pad) {
      const dh = Math.hypot(d.pos.x - pad.x, d.pos.z - pad.z);
      if (s.scenario.drill === 'incursion' && !s.scenario.drillDone && dh < 90) {
        s.scenario.drillDone = true; pad.blocked = true; s.msgVersion++; decide(s, 'warn', `DRILL: debris detected on ${pad.name} by pad sensors.`);
      }
      if (s.scenario.drill === 'linkloss' && !s.scenario.drillDone && dh < 70) { s.scenario.drillDone = true; s.link.up = false; s.link.downUntil = s.time + 12; decide(s, 'warn', 'DRILL: datalink lost.'); }
      if (dh < 0.45 && d.groundSpeed < 0.35 && Math.abs(d.pos.y - HOVER_ALT) < 0.6) ac.stage = 'descent';
    } else if (ac.stage === 'descent' && d.onGround && d.touchdown) {
      ac.stage = 'landed'; ac.landedAt = s.time; ac.engaged = false; ac.safeConfirmed = false;
      send(s, AC_ID, 'TOUCHDOWN_REPORT', `Touchdown ${pad.name}: sink ${d.touchdown.sink.toFixed(2)} m/s, offset ${Math.hypot(d.pos.x - pad.x, d.pos.z - pad.z).toFixed(2)} m. Rotors spooling down.`, { sink: d.touchdown.sink });
    } else if (ac.stage === 'landed') {
      if (s.time - ac.landedAt > 2.5 && d.armed) { d.armed = false; }
      d.vel.x = d.vel.z = 0;
    } else if (ac.stage === 'spoolup') {
      if (s.time >= ac.spoolAt) { ac.stage = 'liftoff'; }
    } else if (ac.stage === 'liftoff') {
      if (d.pos.y > 4 && !ac.reportedAirborne) { ac.reportedAirborne = true; send(s, AC_ID, 'DEPARTURE_REPORT', 'Airborne, climbing to hover altitude.', { phase: 'airborne' }); }
      if (d.pos.y > HOVER_ALT + 2.5) ac.stage = 'climbout';
    } else if (ac.stage === 'climbout') {
      if (!ac.reportedClear && pad && Math.hypot(d.pos.x - pad.x, d.pos.z - pad.z) > 22) { ac.reportedClear = true; send(s, AC_ID, 'DEPARTURE_REPORT', 'Clear of the pad, climbing out.', { phase: 'clear' }); }
      if (Math.hypot(d.pos.x - (pad.x + 45), d.pos.z - (pad.z - 70)) < 12) ac.stage = 'outbound';
    } else if (ac.stage === 'outbound') {
      if (Math.hypot(d.pos.x - EXIT_FIX.x, d.pos.z - EXIT_FIX.z) < 30 && !ac.reportedOut) { ac.reportedOut = true; send(s, AC_ID, 'DEPARTURE_REPORT', `Passing ${EXIT_FIX.name}, leaving the terminal area.`, { phase: 'outbound' }); ac.stage = 'departed'; }
    } else if (ac.stage === 'goaround') {
      if (d.pos.y > ac.holdPos.y - 3 && d.groundSpeed < 1) { ac.stage = 'hold'; s.msgVersion++; }
    }
    if (ac.stage === 'departed') { ac.holdPos = { x: EXIT_FIX.x, y: EXIT_FIX.y, z: EXIT_FIX.z }; }

    // Service: charging on the pad
    if (ac.stage === 'landed' && ac.servicing && !d.armed) ac.stage = 'onpad';
    if (ac.stage === 'onpad' && ac.servicing && !ac.serviced) {
      d.energyKwh = Math.min(d.profile.batteryKwh, d.energyKwh + s.config.chargeRate / 100 * d.profile.batteryKwh * dt);
      if (F.batteryPct(d) >= 90) { ac.serviced = true; send(s, NODE_ID, 'SERVICE_COMPLETE', `Charging complete at ${F.batteryPct(d).toFixed(0)}%. Ready for departure request.`, {}); decide(s, 'act', 'Turnaround complete.'); }
    }
    // Dynamics
    let cmd = null;
    if (['hold', 'goaround', 'transit', 'inbound', 'descent', 'liftoff', 'climbout', 'outbound', 'departed'].includes(ac.stage)) cmd = target(s);
    if (ac.stage === 'departed') cmd = { target: ac.holdPos, vMax: 6, heading: null };
    if (ac.stage === 'landed' && d.armed) cmd = null;
    F.step(d, cmd, dt, w);
    ac.pusher = clamp((d.groundSpeed - 6) / 14, 0, 1) * (d.onGround ? 0 : 1);
  }

  // ---------- environment ----------
  function weatherStep(s, dt) {
    const wx = s.weather, th = wx.dir * Math.PI / 180;
    wx.vec = { x: -Math.sin(th) * wx.speed, z: Math.cos(th) * wx.speed };
    if (dt > 0) {
      const tau = 3.5, k = Math.sqrt(2 / tau * dt) * wx.intensity;
      const n1 = gauss(s), n2 = gauss(s);
      wx.gust.x += -wx.gust.x / tau * dt + k * n1; wx.gust.z += -wx.gust.z / tau * dt + k * n2;
      const m = Math.hypot(wx.gust.x, wx.gust.z), cap = wx.intensity * 2.4;
      if (m > cap && cap > 0) { wx.gust.x *= cap / m; wx.gust.z *= cap / m; }
      if (wx.intensity === 0) { wx.gust.x = 0; wx.gust.z = 0; }
    }
  }
  function gauss(s) { const u = Math.max(1e-9, s.rng()), v = s.rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

  // ---------- supervision of active clearance ----------
  function monitor(s) {
    const ac = s.ac, c = s.clearance;
    if (c && c.status === 'offered' && s.time > c.expiresAt) { decide(s, 'warn', `${c.id} expired unanswered.`); releaseClearance(s, 'expired', 'Clearance offer expired. Submit a new request.', true); return; }
    if (c && c.status === 'accepted' && !ac.engaged && ['hold', 'onpad'].includes(ac.stage) && s.time > c.expiresAt) { decide(s, 'warn', `${c.id} accepted but not used: expired.`); releaseClearance(s, 'expired', 'Accepted clearance expired unused. Request again.', true); return; }
    if (c && c.op === 'landing' && ['accepted'].includes(c.status) && ac.engaged) {
      const p = padById(s, c.padId);
      if (p.blocked || p.closed) {
        decide(s, 'warn', `${p.name} ${p.closed ? 'closed' : 'obstructed'} during approach. Revoking clearance.`);
        const airborneLow = ac.dyn.pos.y < 3 && ac.stage === 'descent';
        send(s, NODE_ID, 'CLEARANCE_REVOKED', `Clearance revoked: ${p.name} ${p.closed ? 'closed' : 'obstructed'}.${airborneLow ? '' : ' Go around.'}`, { clearance: c.id });
        if (ac.stage === 'transit') { releaseClearance(s, 'revoked', '', false); ac.stage = 'hold'; ac.engaged = false; ac.padId = null; ac.holdPos = { x: ac.dyn.pos.x, y: ac.dyn.pos.y, z: ac.dyn.pos.z }; ac.holdHeading = ac.dyn.yaw; chooseAlternate(s, `${p.name} unavailable`); }
        else { releaseClearance(s, 'revoked', '', false); chooseAlternate(s, `${p.name} unavailable`); }
        return;
      }
      if (ac.stage === 'descent' && peakWind(s) > s.config.windLimit + 3 && ac.dyn.pos.y > 4) {
        if (!ac.goAroundSent || s.time - ac.goAroundSent > 5) { ac.goAroundSent = s.time; send(s, NODE_ID, 'GO_AROUND', `Go around: wind ${peakWind(s).toFixed(0)} m/s exceeds limits on final.`, {}); decide(s, 'warn', 'Wind exceeds limit on final: ordering go-around.'); }
      }
    }
    // Link-loss procedure on the aircraft
    if (!s.link.up && airborneApproach(ac) && ac.dyn.pos.y > 5) { ac.linkLostSince ??= s.time; if (s.time - ac.linkLostSince > 2) beginGoAround(s, 'Lost-link procedure'); }
    if (s.link.up) ac.linkLostSince = null;
    if (!s.link.up && s.time >= s.link.downUntil && s.link.downUntil > 0) { s.link.up = true; s.link.downUntil = 0; decide(s, 'info', 'Datalink restored. Session must be re-established.'); }
    if (!s.link.up && ac.connected) { ac.connected = false; s.session.state = 'offline'; if (s.clearance) { const wasApp = s.clearance.op; releaseClearance(s, 'revoked', '', false); if (wasApp === 'landing' && ac.stage === 'transit') { ac.stage = 'hold'; ac.engaged = false; } } s.request = null; s.pending = null; decide(s, 'warn', 'Link lost: session, request and clearance invalidated.'); }
  }

  // ---------- commands ----------
  const fail = reason => ({ ok: false, reason });
  function can(s) {
    const ac = s.ac, c = s.clearance, d = ac.dyn, live = s.link.up && ac.connected && !s.complete;
    const offered = !!(c && c.status === 'offered' && c.deliveredAt != null);
    return {
      connect: s.link.up && !ac.connected && !s.complete && s.session.state !== 'closed',
      requestLanding: live && ac.stage === 'hold' && !c && !s.request,
      accept: live && offered, decline: live && offered,
      engage: live && !!c && c.status === 'accepted' && !ac.engaged && ((c.op === 'landing' && ac.stage === 'hold') || (c.op === 'departure' && ac.stage === 'onpad')),
      goAround: live && airborneApproach(ac) && d.pos.y > 3,
      confirmSafe: live && ac.stage === 'landed' && !d.armed && !ac.servicing,
      requestDeparture: live && ac.stage === 'onpad' && !c && !s.request,
      disconnect: ac.connected && !s.complete
    };
  }

  function pilotCommand(s, cmd, args) {
    const ac = s.ac, c = s.clearance, ok = can(s);
    if (!ok[cmd] && cmd !== 'reconnect') return fail(cmd === 'connect' ? 'Link is down or already connected.' : 'Not available in the current state.');
    switch (cmd) {
      case 'connect': send(s, AC_ID, 'HELLO', `Vahnim Link session request: ${AC_ID}, ${REGISTRY[AC_ID].type} ${REGISTRY[AC_ID].model}, operator ${REGISTRY[AC_ID].operator}. Capabilities: VTOL, 20 m/s, 6 lift rotors.`, { identity: AC_ID, operator: REGISTRY[AC_ID].operator, mass: 1800, battery: round(F.batteryPct(ac.dyn), 0) }); break;
      case 'requestLanding': { const bat = F.batteryPct(ac.dyn), pr = bat < s.config.lowBattery;
        send(s, AC_ID, 'REQUEST_LANDING', `Request landing at ${NODE_ID}. Position ${dist2(ac.dyn.pos, { x: 0, z: 0 }).toFixed(0)} m out, ${ac.dyn.pos.y.toFixed(0)} m, battery ${bat.toFixed(0)}%${pr ? ' (below reserve: priority requested)' : ''}.`, { battery: round(bat, 0), priority: pr }); break; }
      case 'accept': send(s, AC_ID, 'READBACK_ACCEPT', `Accept ${c.id}, readback ${c.padName} ${c.op}, code ${c.digest}.`, { clearance: c.id, digest: c.digest }); break;
      case 'decline': send(s, AC_ID, 'DECLINE', `Unable ${c.id}. Requesting release.`, { clearance: c.id }); break;
      case 'engage':
        ac.engaged = true; ac.padId = c.padId; ac.approachClearance = c.id; ac.reportedAirborne = ac.reportedClear = ac.reportedOut = false;
        if (c.op === 'landing') { ac.stage = 'transit'; ac.servicing = false; ac.serviced = false; ac.safeConfirmed = false; send(s, AC_ID, 'APPROACH_REPORT', `Approach guidance engaged, proceeding to ${c.route[0].name}.`, {}); decide(s, 'info', `${AC_ID} engaged approach to ${c.padName}.`); }
        else { ac.stage = 'spoolup'; ac.spoolAt = s.time + 3.5; ac.dyn.armed = true; send(s, AC_ID, 'DEPARTURE_REPORT', 'Departure engaged: rotor spool-up.', { phase: 'spoolup' }); decide(s, 'info', `${AC_ID} engaged departure from ${c.padName}.`); }
        break;
      case 'goAround': beginGoAround(s, 'Pilot commanded go-around'); break;
      case 'confirmSafe': ac.safeConfirmed = true; send(s, AC_ID, 'PROPULSION_SAFE', 'Propulsion safe: rotors stopped, ready for ground power.', {}); break;
      case 'requestDeparture': send(s, AC_ID, 'REQUEST_DEPARTURE', `Request departure from ${padById(s, ac.padId).name}. Battery ${F.batteryPct(ac.dyn).toFixed(0)}%.`, { battery: round(F.batteryPct(ac.dyn), 0) }); break;
      case 'disconnect': ac.connected = false; s.session.state = 'offline'; if (c) releaseClearance(s, 'revoked', '', false); s.request = null; s.pending = null; beginGoAround(s, 'Pilot ended session'); decide(s, 'info', `${AC_ID} ended the session.`); break;
      default: return fail('Unknown command.');
    }
    return { ok: true };
  }

  function groundCommand(s, cmd, a) {
    a = a || {};
    switch (cmd) {
      case 'setMode': s.config.mode = a.mode === 'supervised' ? 'supervised' : 'auto'; decide(s, 'info', `Supervision mode: ${s.config.mode}.`); return { ok: true };
      case 'approve': {
        const p = s.pending; if (!p) return fail('Nothing awaiting approval.');
        const pad = padById(s, a.padId || p.padId); if (!pad) return fail('Unknown pad.');
        if (padStatus(pad) !== 'free' && !(p.kind === 'departure' && pad.id === p.padId)) return fail(`${pad.name} is ${padStatus(pad)}.`);
        decide(s, 'act', `Supervisor approved ${p.kind} on ${pad.name}${a.padId && a.padId !== p.padId ? ' (override of recommendation)' : ''}.`); offer(s, pad, p.kind); return { ok: true }; }
      case 'deny': { if (!s.pending) return fail('Nothing awaiting approval.'); const k = s.pending.kind; s.pending = null; if (s.request) { s.request.holdKey = 'denied'; } send(s, NODE_ID, 'HOLD', `Hold: ${k} not approved by supervisor.${a.reason ? ' ' + a.reason : ''}`, { reason: 'supervisor-denied' }); decide(s, 'warn', `Supervisor denied ${k}. Request stays open.`); if (s.request) s.assessAt = s.time + 8; return { ok: true }; }
      case 'setPad': { const p = padById(s, a.padId); if (!p) return fail('Unknown pad.'); const key = a.field === 'closed' ? 'closed' : 'blocked'; if (key === 'closed' && p.occupants.length && a.value) return fail('Cannot close an occupied pad.'); p[key] = !!a.value; s.msgVersion++; decide(s, p[key] ? 'warn' : 'info', `${p.name} ${key === 'closed' ? (p.closed ? 'closed by operations' : 'reopened') : (p.blocked ? 'obstruction reported (operator)' : 'obstruction cleared (operator)')}.`); if (s.request) s.request.holdKey = null; return { ok: true }; }
      case 'setWeather': { const w = s.weather; if (a.speed != null) w.speed = clamp(+a.speed, 0, 25); if (a.intensity != null) w.intensity = clamp(+a.intensity, 0, 6); if (a.dir != null) w.dir = ((+a.dir % 360) + 360) % 360; weatherStep(s, 0); if (s.request) s.request.holdKey = s.request.holdKey === 'wind' && peakWind(s) <= s.config.windLimit ? null : s.request.holdKey; return { ok: true }; }
      case 'hold': send(s, NODE_ID, 'HOLD', 'Operator instruction: hold position. Await further advice.', { reason: 'operator' }); if (s.clearance && s.clearance.status === 'offered') { decide(s, 'warn', 'Operator hold: offered clearance withdrawn.'); releaseClearance(s, 'revoked', 'Clearance withdrawn by operator.', true); } return { ok: true };
      case 'goAround': if (!airborneApproach(s.ac)) return fail('Aircraft is not on approach.'); send(s, NODE_ID, 'GO_AROUND', 'Operator order: go around.', {}); decide(s, 'warn', 'Operator ordered go-around.'); return { ok: true };
      case 'revoke': if (!s.clearance) return fail('No active clearance.'); decide(s, 'warn', 'Operator revoked the active clearance.'); send(s, NODE_ID, 'CLEARANCE_REVOKED', 'Clearance revoked by operator.' + (airborneApproach(s.ac) ? ' Go around.' : ''), { clearance: s.clearance.id }); if (!airborneApproach(s.ac)) releaseClearance(s, 'revoked', '', false); return { ok: true };
      case 'tamper': { const m = send(s, AC_ID, 'READBACK_ACCEPT', 'Accept CL-99 (forged test message).', { clearance: 'CL-99', digest: '000000' }, { forgeKey: 'attacker-key' }); decide(s, 'info', `Injected forged message ${m.id} as a verification test.`); return { ok: true }; }
      case 'replay': { const last = [...s.messages].reverse().find(m => m.from === AC_ID && m.verified && !m.replay); if (!last) return fail('No verified aircraft message to replay yet.'); const m = send(s, AC_ID, last.kind, last.text, last.data, { replayOf: last }); decide(s, 'info', `Injected replay of ${last.id} as ${m.id} for verification test.`); return { ok: true }; }
      case 'linkDrop': s.link.up = false; s.link.downUntil = s.time + clamp(+a.seconds || 10, 2, 60); decide(s, 'warn', `Datalink dropped for ${clamp(+a.seconds || 10, 2, 60)} s (operator fault injection).`); return { ok: true };
      default: return fail('Unknown command.');
    }
  }

  function command(s, role, cmd, args) {
    if (s.complete && role === 'pilot' && cmd !== 'connect') return fail('Session complete. Restart the scenario.');
    if (role === 'pilot') return pilotCommand(s, cmd, args);
    if (role === 'ground') return groundCommand(s, cmd, args);
    return fail('Unknown role.');
  }

  // ---------- autoplay: presses the recommended next button ----------
  function autoStep(s) {
    if (!s.auto.on || s.complete) return;
    if (s.pending) { if (!s.auto.approveAt) s.auto.approveAt = s.time + 2.5; if (s.time >= s.auto.approveAt) { s.auto.approveAt = 0; groundCommand(s, 'approve', {}); s.auto.at = s.time + 1.5; } return; }
    if (s.time < s.auto.at) return;
    const n = ui(s).next;
    if (!n) return;
    const delay = { connect: 1.2, requestLanding: 1.5, accept: 2.2, engage: 2, confirmSafe: 1.5, requestDeparture: 2.5 }[n] || 1.5;
    if (s.auto.pendingAction !== n) { s.auto.pendingAction = n; s.auto.at = s.time + delay; return; }
    s.auto.pendingAction = null; s.auto.at = s.time + 0.5;
    pilotCommand(s, n === 'engage' ? 'engage' : n, {});
  }

  // ---------- UI derivations ----------
  const STEPS = ['Link', 'Request', 'Clearance', 'Approach', 'Touchdown', 'Service', 'Dep. clearance', 'Departure', 'Complete'];
  function ui(s) {
    const ac = s.ac, c = s.clearance, ok = can(s);
    let step = 0;
    if (s.complete) step = 8;
    else if (!ac.connected) step = ac.stage === 'onpad' || ac.stage === 'landed' ? 5 : 0;
    else if (['spoolup', 'liftoff', 'climbout', 'outbound', 'departed'].includes(ac.stage)) step = 7;
    else if (ac.stage === 'onpad' && (c || s.request)) step = 6;
    else if (ac.stage === 'onpad') step = ac.serviced ? 6 : 5;
    else if (ac.stage === 'landed') step = ac.servicing ? 5 : 4;
    else if (airborneApproach(ac)) step = 3;
    else if (c || s.request) step = 2;
    else step = 1;
    let next = null;
    if (ok.connect) next = 'connect';
    else if (ok.requestLanding) next = 'requestLanding';
    else if (ok.accept) next = 'accept';
    else if (ok.engage) next = 'engage';
    else if (ok.confirmSafe) next = 'confirmSafe';
    else if (ok.requestDeparture && ac.serviced) next = 'requestDeparture';
    return { steps: STEPS, step, next, can: ok };
  }

  const PHASE_LABEL = { hold: 'HOLDING', transit: 'APPROACH', inbound: 'SHORT FINAL', descent: 'FINAL DESCENT', goaround: 'GO-AROUND', landed: 'ON PAD · ROTORS STOPPING', onpad: 'ON PAD · SERVICE', spoolup: 'SPOOL-UP', liftoff: 'LIFT-OFF', climbout: 'CLIMB-OUT', outbound: 'OUTBOUND', departed: 'DEPARTED' };

  // ---------- public advance / snapshot ----------
  function tickOnce(s, dt) {
    s.time += dt;
    // deliver messages / acks
    if (s.outbox.length) {
      const rest = [];
      for (const m of s.outbox) { if (m.deliverAt <= s.time) deliver(s, m); else rest.push(m); }
      s.outbox = rest;
    }
    for (let i = s.messages.length - 1, n = 0; i >= 0 && n < 30; i--, n++) { const m = s.messages[i]; if (m.status === 'verified' && !m.ack && m.ackAt <= s.time) { m.ack = true; s.msgVersion++; } }
    weatherStep(s, dt);
    if (s.assessAt && s.time >= s.assessAt) { s.assessAt = s.request && s.request.status === 'open' ? s.time + 1.5 : 0; assess(s); }
    aircraftStep(s, dt);
    if (Math.floor(s.time * 4) !== Math.floor((s.time - dt) * 4)) { monitor(s); autoStep(s); }
    if (s.request && s.request.status === 'open' && !s.assessAt && !s.pending) s.assessAt = s.time + 1.5;
  }
  function advance(s, seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error('Invalid elapsed time');
    if (s.paused) return s;
    s.acc += seconds;
    let guard = 0;
    while (s.acc >= STEP && guard++ < 4000) { tickOnce(s, STEP); s.acc -= STEP; }
    return s;
  }

  function snapshot(s) {
    const ac = s.ac, d = ac.dyn, c = s.clearance, u = ui(s);
    return {
      time: round(s.time, 2), paused: s.paused, speed: s.speed, complete: s.complete, scenario: s.scenario, config: s.config,
      weather: { speed: s.weather.speed, intensity: s.weather.intensity, dir: s.weather.dir, gust: { x: round(s.weather.gust.x), z: round(s.weather.gust.z) }, vec: { x: round(s.weather.vec.x), z: round(s.weather.vec.z) }, peak: round(peakWind(s), 1), limit: s.config.windLimit, now: round(Math.hypot(s.weather.vec.x + s.weather.gust.x, s.weather.vec.z + s.weather.gust.z), 1) },
      link: { up: s.link.up, downFor: s.link.up ? 0 : Math.max(0, round(s.link.downUntil - s.time, 0)) },
      session: s.session, counters: s.counters, msgVersion: s.msgVersion,
      ac: {
        id: ac.id, pos: { x: round(d.pos.x, 3), y: round(d.pos.y, 3), z: round(d.pos.z, 3) }, vel: { x: round(d.vel.x, 3), y: round(d.vel.y, 3), z: round(d.vel.z, 3) },
        yaw: round(d.yaw, 4), pitch: round(d.pitch, 4), roll: round(d.roll, 4), rotor: round(d.rotorSpeed, 3), pusher: round(ac.pusher, 3), armed: d.armed, onGround: d.onGround,
        battery: round(F.batteryPct(d), 2), power: round(d.power, 1), thrustPct: round(d.thrust / (d.profile.mass * F.G * d.profile.thrustToWeight) * 100, 1), airspeed: round(d.airspeed, 2), groundSpeed: round(d.groundSpeed, 2), vsi: round(d.vel.y, 2), heading: round(deg(d.yaw), 0),
        stage: ac.stage, phase: PHASE_LABEL[ac.stage] || ac.stage.toUpperCase(), engaged: ac.engaged, connected: ac.connected, padId: ac.padId, servicing: ac.servicing, serviced: ac.serviced,
        touchdown: d.touchdown ? { sink: round(d.touchdown.sink, 2), hard: d.touchdown.hard } : null, holdReason: ac.holdReason
      },
      pads: s.pads.map(p => ({ id: p.id, name: p.name, x: p.x, z: p.z, status: padStatus(p), closed: p.closed, blocked: p.blocked, occupants: p.occupants, reservedBy: p.reservedBy })),
      clearance: c ? { id: c.id, op: c.op, padId: c.padId, padName: c.padName, route: c.route, digest: c.digest, status: c.status, delivered: c.deliveredAt != null, remaining: Math.max(0, round(c.expiresAt - s.time, 0)) } : null,
      request: s.request ? { op: s.request.op, status: s.request.status, priority: !!s.request.priority } : null,
      pending: s.pending ? { kind: s.pending.kind, padId: s.pending.padId, candidates: s.pending.candidates } : null,
      ui: u, autoplay: s.auto.on, fixes: { hold: HOLD_FIX, exit: EXIT_FIX }
    };
  }
  const log = s => ({ version: s.msgVersion, messages: s.messages.slice(-90).map(m => ({ id: m.id, seq: m.seq, from: m.from, to: m.to, kind: m.kind, text: m.text, ts: m.ts, status: m.status, verified: m.verified, ack: m.ack, note: m.note, sig: m.sig, forged: m.forged, replay: m.replay })), decisions: s.decisions.slice(-60) });

  function setPaused(s, v) { s.paused = !!v; }
  function setSpeed(s, v) { s.speed = [0.5, 1, 2, 4].includes(+v) ? +v : 1; }
  function setAutoplay(s, v) { s.auto.on = !!v; s.auto.pendingAction = null; s.auto.at = s.time + 1; }

  g.GroundN1 = { create, advance, command, snapshot, log, setPaused, setSpeed, setAutoplay, SCENARIOS, PAD_DEFS, HOLD_FIX, EXIT_FIX, AC_ID, NODE_ID, STEP };
  if (typeof module !== 'undefined') module.exports = g.GroundN1;
})(typeof window === 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : window));
