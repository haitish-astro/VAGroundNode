// Ground-N1 host: owns the one authoritative engine instance and talks to any number of screens.
// Used by n1-worker.js (SharedWorker, the normal path) and by n1-link.js (single-page fallback).
(function (g) {
  'use strict';
  function createHost() {
    const N1 = g.GroundN1;
    let options = { scenario: 'nominal', mode: 'auto', autoplay: false }, epoch = 1;
    let s = N1.create(options);
    const peers = new Map();       // port -> {role, seen}
    let lastTime = Date.now(), lastState = 0, lastLogVersion = -1, lastLogAt = 0;

    const post = (port, msg) => { try { port.postMessage(msg); } catch (e) { peers.delete(port); } };
    const broadcast = msg => { for (const port of peers.keys()) post(port, msg); };
    function sendLog(port, force) {
      if (!force && s.msgVersion === lastLogVersion) return;
      const payload = { t: 'log', epoch, ...N1.log(s) };
      if (port) post(port, payload); else { lastLogVersion = s.msgVersion; broadcast(payload); }
    }
    function sendState(port) { const msg = { t: 'state', epoch, s: N1.snapshot(s), peers: [...peers.values()].map(p => p.role) }; if (port) post(port, msg); else broadcast(msg); }

    function reset(o) {
      options = { ...options, ...(o || {}) };
      s = N1.create(options); s.speed = options.speed || 1; epoch++; lastLogVersion = -1;
      sendState(); sendLog(null, true);
    }

    function handle(port, msg) {
      if (!msg || typeof msg !== 'object') return;
      const peer = peers.get(port);
      if (peer) peer.seen = Date.now();
      switch (msg.t) {
        case 'hello': peers.set(port, { role: String(msg.role || 'viewer'), seen: Date.now() }); sendState(port); sendLog(port, true); broadcastPeers(); break;
        case 'ping': break;
        case 'bye': peers.delete(port); break;
        case 'cmd': {
          const role = peer ? peer.role : msg.role;
          let res;
          try { res = N1.command(s, role, msg.cmd, msg.args); } catch (e) { res = { ok: false, reason: 'Engine error: ' + e.message }; }
          post(port, { t: 'result', id: msg.id, ok: !!res.ok, reason: res.reason || '' });
          sendState(); if (res.ok) sendLog(null, true);
          break; }
        case 'sys':
          if (msg.op === 'reset') reset(msg.arg);
          else if (msg.op === 'pause') { N1.setPaused(s, msg.arg); sendState(); }
          else if (msg.op === 'speed') { N1.setSpeed(s, msg.arg); options.speed = s.speed; sendState(); }
          else if (msg.op === 'mode') { options.mode = msg.arg === 'supervised' ? 'supervised' : 'auto'; N1.command(s, 'ground', 'setMode', { mode: options.mode }); sendState(); sendLog(null, true); }
          else if (msg.op === 'autoplay') { options.autoplay = !!msg.arg; N1.setAutoplay(s, msg.arg); sendState(); }
          break;
        default: break;
      }
    }
    function broadcastPeers() { sendState(); }

    function tick() {
      const now = Date.now(), dt = Math.min(0.1, (now - lastTime) / 1000); lastTime = now;
      if (!s.paused) N1.advance(s, dt * s.speed);
      if (now - lastState >= 33) { lastState = now; sendState(); }
      if (now - lastLogAt >= 100) { lastLogAt = now; sendLog(null); }
      for (const [port, p] of peers) if (now - p.seen > 8000) peers.delete(port);
    }
    return { handle, tick, addPort(port) { peers.set(port, { role: 'viewer', seen: Date.now() }); }, removePort(port) { peers.delete(port); }, get state() { return s; } };
  }
  g.GroundN1Host = { createHost };
})(typeof self !== 'undefined' ? self : globalThis);
