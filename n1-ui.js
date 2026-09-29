// Shared UI pieces for the Ground-N1 screens: verified message list and automation decision log.
(function (g) {
  'use strict';
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const dirLabel = m => m.from === 'VH-101' ? 'AIR → NODE' : 'NODE → AIR';

  // Newest first. Elements are reused by message id; only changed chips are touched.
  class MessageList {
    constructor(container, opts) { this.root = container; this.items = new Map(); this.opts = opts || {}; container.classList.add('msg-list'); container.setAttribute('role', 'log'); container.setAttribute('aria-live', 'polite'); }
    update(messages) {
      const list = messages.slice(-(this.opts.limit || 60)), seen = new Set();
      for (const m of list) {
        seen.add(m.id);
        let it = this.items.get(m.id);
        if (!it) { it = this.build(m); this.items.set(m.id, it); }
        this.refresh(it, m);
      }
      for (const [id, it] of this.items) if (!seen.has(id)) { it.root.remove(); this.items.delete(id); }
      // Ensure newest-first order.
      let prev = null;
      for (let i = list.length - 1; i >= 0; i--) { const node = this.items.get(list[i].id).root; if (prev ? node.previousSibling !== prev : this.root.firstChild !== node) this.root.insertBefore(node, prev ? prev.nextSibling : this.root.firstChild); prev = node; }
    }
    build(m) {
      const root = el('div', 'msg'), head = el('div', 'msg-head'), left = el('span'), kind = el('b', 'msg-kind', m.kind.replaceAll('_', ' ')), meta = el('span', 'mono', ''), body = el('div', 'msg-body'), chain = el('div', 'msg-chain');
      left.append(kind); head.append(left, meta);
      const chips = { tx: el('span', 'chip on', 'TX'), rx: el('span', 'chip', 'RX'), sig: el('span', 'chip', 'SIG'), ack: el('span', 'chip', 'ACK') }, sig = el('span', 'sig', '');
      chain.append(chips.tx, chips.rx, chips.sig, chips.ack, sig);
      root.append(head, body, chain);
      return { root, meta, body, chips, sig, kind, chain, note: null, key: '' };
    }
    refresh(it, m) {
      const key = [m.status, m.verified, m.ack, m.note].join('|'); if (key === it.key) return; it.key = key;
      it.root.className = 'msg ' + (m.verified === false || m.status === 'lost' ? 'bad' : m.from === 'VH-101' ? 'air' : 'node');
      it.meta.textContent = `${m.id} · ${m.ts.toFixed(1)}s · ${dirLabel(m)}`;
      it.body.textContent = m.text;
      const c = it.chips;
      const delivered = m.status === 'verified' || m.status === 'rejected';
      c.rx.className = 'chip ' + (m.status === 'lost' ? 'fail' : delivered ? 'on' : 'wait'); c.rx.textContent = m.status === 'lost' ? 'LOST' : 'RX';
      c.sig.className = 'chip ' + (m.verified === true ? 'on' : m.verified === false ? 'fail' : 'wait'); c.sig.textContent = m.verified === false ? '✗ SIG' : m.verified ? '✓ SIG' : 'SIG';
      c.ack.className = 'chip ' + (m.ack ? 'on' : m.verified === false || m.status === 'lost' ? '' : 'wait'); c.ack.textContent = m.ack ? '✓ ACK' : 'ACK';
      it.sig.textContent = 'sig ' + m.sig.slice(0, 8) + (m.forged ? ' · FORGED TEST' : m.replay ? ' · REPLAY TEST' : '');
      if (m.note) { if (!it.note) { it.note = el('div', 'msg-body'); it.note.style.color = 'var(--red)'; it.root.insertBefore(it.note, it.chain); } it.note.textContent = m.note; }
    }
    clear() { this.items.clear(); this.root.replaceChildren(); }
  }

  class DecisionLog {
    constructor(container) { this.root = container; this.ids = new Set(); container.classList.add('dec-list'); }
    update(decisions) {
      const want = decisions.slice(-50);
      if (want.length && this.ids.has(want.at(-1).id) && this.ids.size === want.length) return;
      this.ids = new Set(want.map(d => d.id));
      this.root.replaceChildren(...want.slice().reverse().map(d => {
        const row = el('div', 'dec ' + d.level), t = el('span', 'dec-t mono', d.t.toFixed(1).padStart(6) + 's'), tx = el('span', 'dec-x', d.text);
        row.append(t, tx); return row;
      }));
    }
    clear() { this.ids.clear(); this.root.replaceChildren(); }
  }

  function setText(node, text) { if (node && node.textContent !== text) node.textContent = text; }
  function setClass(node, cls) { if (node && node.className !== cls) node.className = cls; }
  g.N1UI = { MessageList, DecisionLog, el, setText, setClass, dirLabel };
})(window);
