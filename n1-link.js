// Ground-N1 client link. Every screen calls N1Link.connect(role, handlers, opts).
//   handlers.onState(snapshot)  ~30 Hz, latest authoritative state
//   handlers.onLog({messages, decisions}) whenever messages / decisions change
//   handlers.onReset() when the scenario is restarted
// link.cmd(name, args) -> Promise<{ok, reason}> ; link.sys(op, arg) for reset / pause / speed / autoplay.
// Uses a SharedWorker so every window sees one simulation. If that is unavailable or fails to start, it falls
// back to a private in-page simulation. A shared banner reports connecting / reconnecting states.
(function (g) {
  'use strict';
  const loadScript = src => new Promise((res, rej) => { const el = document.createElement('script'); el.src = src; el.onload = res; el.onerror = () => rej(new Error('Could not load ' + src)); document.head.append(el); });

  function banner() {
    let box = document.querySelector('.conn');
    if (!box) { box = document.createElement('div'); box.className = 'conn info'; box.setAttribute('role', 'status'); box.hidden = true; document.body.append(box); }
    return {
      show(text, tone, spin) { box.className = 'conn ' + (tone || 'info'); box.replaceChildren(...(spin ? [Object.assign(document.createElement('span'), { className: 'spinner' })] : []), document.createTextNode(text)); box.hidden = false; },
      hide() { box.hidden = true; }
    };
  }

  async function connect(role, handlers, opts) {
    const h = handlers || {}, o = opts || {}, ui = o.banner === false ? { show() {}, hide() {} } : banner();
    const link = { role, state: null, log: { messages: [], decisions: [], version: -1 }, received: 0, mode: 'shared', epoch: 0, pending: new Map(), seq: 0, peers: [], status: 'connecting' };
    let port = null, localTimer = 0, worker = null;

    function onMessage(msg) {
      if (msg.t === 'state') {
        if (msg.epoch !== link.epoch) { const first = link.epoch === 0; link.epoch = msg.epoch; if (!first && h.onReset) h.onReset(); }
        link.state = msg.s; link.peers = msg.peers || []; link.received = performance.now();
        if (link.status !== 'live') { link.status = 'live'; ui.hide(); }
        if (h.onState) h.onState(msg.s, link);
      } else if (msg.t === 'log') {
        if (msg.epoch !== link.epoch) link.epoch = msg.epoch;
        link.log = { messages: msg.messages, decisions: msg.decisions, version: msg.version }; if (h.onLog) h.onLog(link.log, link);
      } else if (msg.t === 'result') {
        const p = link.pending.get(msg.id); if (p) { link.pending.delete(msg.id); p({ ok: msg.ok, reason: msg.reason }); }
      }
    }

    async function startLocal(reason) {
      link.mode = 'local'; link.state = null;
      if (!g.GroundN1Host) { await loadScript('flight-dynamics.js'); await loadScript('n1-engine.js'); await loadScript('n1-host.js'); }
      const host = g.GroundN1Host.createHost();
      const fake = { postMessage: m => queueMicrotask(() => onMessage(JSON.parse(JSON.stringify(m)))) };
      port = { postMessage: m => host.handle(fake, m) };
      host.addPort(fake); clearInterval(localTimer); localTimer = setInterval(() => host.tick(), 16);
      port.postMessage({ t: 'hello', role });
      if (reason) console.warn('Ground-N1: running in single-window mode (' + reason + ')');
    }

    const forceLocal = /[?&]local(=|&|$)/.test(location.search);
    if ('SharedWorker' in g && !forceLocal) {
      try {
        // ?room=name gives a private simulation (used by the guided encounter).
        const room = o.room || (location.search.match(/[?&]room=([\w-]+)/) || [])[1];
        worker = new SharedWorker('n1-worker.js', { name: 'vahnim-ground-n1' + (room ? '-' + room : '') });
        port = worker.port; port.onmessage = e => onMessage(e.data); port.start();
        worker.onerror = e => { console.error('Ground-N1 worker error', e.message); if (!link.state) startLocal('worker error'); };
        port.postMessage({ t: 'hello', role });
        setTimeout(() => { if (!link.state && link.mode === 'shared') startLocal('worker did not answer'); }, 3000);
      } catch (err) { await startLocal(err.message); }
    } else await startLocal(forceLocal ? '' : 'SharedWorker unavailable');

    link.cmd = (cmd, args) => new Promise(resolve => {
      const id = ++link.seq; link.pending.set(id, resolve);
      try { port.postMessage({ t: 'cmd', id, cmd, args }); } catch (e) { link.pending.delete(id); resolve({ ok: false, reason: 'Not connected.' }); return; }
      setTimeout(() => { if (link.pending.delete(id)) resolve({ ok: false, reason: 'No response from the simulation. Check the connection.' }); }, 4000);
    });
    link.sys = (op, arg) => { try { port.postMessage({ t: 'sys', op, arg }); } catch (e) { console.warn('sys failed', e); } };
    link.age = () => (performance.now() - link.received) / 1000;

    setInterval(() => { try { port.postMessage({ t: 'ping' }); } catch (e) { /* reported below */ } }, 2500);
    // Watchdog: tell the user instead of silently freezing.
    const started = performance.now();
    setInterval(() => {
      if (document.hidden) return;
      if (!link.state) { if (performance.now() - started > 1200) ui.show('Connecting to the simulation…', 'info', true); return; }
      if (link.age() > 3) { if (link.status !== 'stale') { link.status = 'stale'; ui.show('Connection to the simulation lost. Reconnecting…', 'bad', true); if (h.onStatus) h.onStatus('stale'); } }
    }, 700);
    addEventListener('pagehide', () => { try { port.postMessage({ t: 'bye' }); } catch (e) { /* ignore */ } });
    return link;
  }

  // Shared formatting helpers used by the UI scripts.
  const fmt = {
    clock: t => { const m = Math.floor(t / 60), s = Math.floor(t % 60); return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0'); },
    hdg: d => String(Math.round(d) % 360 || 360).padStart(3, '0')
  };
  g.N1Link = { connect, fmt };
})(window);
