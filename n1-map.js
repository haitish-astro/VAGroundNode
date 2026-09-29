// Top-down tactical map for the pilot MFD and the ground radar. North is up (-Z), 1 px = 1/k metres.
(function (g) {
  'use strict';
  const PAD_R = 12.4;
  const COL = { free: '#4ade80', reserved: '#6cb6ff', occupied: '#f5b544', blocked: '#ff5a6a', closed: '#6b7280' };
  const STATUS_TXT = { free: 'FREE', reserved: 'RESERVED', occupied: 'OCCUPIED', blocked: 'OBSTRUCTED', closed: 'CLOSED' };

  function niceStep(range) { const raw = range / 5, p = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / p; return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p; }

  // opts: {range (m from centre to nearest edge), center {x,z}, style: 'pilot'|'ground', trail: [{x,z}], hi (highlight pad id), dpr}
  function draw(ctx, W, H, st, opts) {
    const o = opts || {}, ac = st.ac, ground = o.style === 'ground';
    const c = o.center || { x: 0, z: 20 }, range = o.range || 120, k = Math.min(W, H) / (2 * range);
    const sx = x => W / 2 + (x - c.x) * k, sy = z => H / 2 + (z - c.z) * k;
    ctx.save(); ctx.clearRect(0, 0, W, H);
    const bg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * .7); bg.addColorStop(0, '#151a22'); bg.addColorStop(1, '#0a0c10');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    // Grid
    const step = niceStep(range), x0 = Math.floor((c.x - W / 2 / k) / step) * step, z0 = Math.floor((c.z - H / 2 / k) / step) * step;
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,.045)'; ctx.beginPath();
    for (let x = x0; x < c.x + W / 2 / k; x += step) { ctx.moveTo(sx(x) + .5, 0); ctx.lineTo(sx(x) + .5, H); }
    for (let z = z0; z < c.z + H / 2 / k; z += step) { ctx.moveTo(0, sy(z) + .5); ctx.lineTo(W, sy(z) + .5); }
    ctx.stroke();
    ctx.fillStyle = 'rgba(143,169,184,.55)'; ctx.font = '10px ui-monospace,Consolas,monospace'; ctx.textAlign = 'left';
    ctx.fillText(step + ' m grid', 10, H - 10);

    // Range rings around the terminal (ground radar look)
    if (ground) {
      ctx.strokeStyle = 'rgba(224,122,60,.22)'; ctx.setLineDash([2, 6]);
      for (const r of [100, 200, 300, 400, 500]) { ctx.beginPath(); ctx.arc(sx(0), sy(0), r * k, 0, Math.PI * 2); ctx.stroke(); if (r * k > 20 && r * k < Math.max(W, H)) { ctx.fillStyle = 'rgba(224,122,60,.55)'; ctx.fillText(r + ' m', sx(0) + 4, sy(0) - r * k - 3); } }
      ctx.setLineDash([]);
    }

    // Approach / departure fixes
    for (const f of [st.fixes.hold, st.fixes.exit]) {
      const x = sx(f.x), y = sy(f.z);
      if (x < -20 || x > W + 20 || y < -20 || y > H + 20) continue;
      ctx.strokeStyle = '#9f8cff'; ctx.fillStyle = 'rgba(159,140,255,.15)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, y - 8); ctx.lineTo(x + 7, y + 6); ctx.lineTo(x - 7, y + 6); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#b6a9ff'; ctx.textAlign = 'center'; ctx.fillText(f.name, x, y + 20);
    }

    // Pads
    for (const p of st.pads) {
      const x = sx(p.x), y = sy(p.z), r = PAD_R * k, col = COL[p.status], hi = o.hi === p.id || (st.ac.padId === p.id);
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = p.status === 'free' ? 'rgba(74,222,128,.08)' : col + '22'; ctx.fill();
      ctx.lineWidth = hi ? 3 : 1.6; ctx.strokeStyle = col; ctx.stroke();
      if (p.status === 'blocked' || p.status === 'closed') { ctx.beginPath(); ctx.moveTo(x - r * .55, y - r * .55); ctx.lineTo(x + r * .55, y + r * .55); ctx.moveTo(x + r * .55, y - r * .55); ctx.lineTo(x - r * .55, y + r * .55); ctx.lineWidth = 2; ctx.stroke(); }
      if (p.occupants.length) { p.occupants.forEach((occ, i) => { const n = p.occupants.length, a = (i - (n - 1) / 2) * .9, ox = x + Math.sin(a) * r * .5 * (n > 1 ? 1 : 0), oy = y + (n > 1 ? -Math.cos(a) * 0 : 0); ctx.fillStyle = occ.type === 'UAM' ? '#ffb454' : '#e6c98a'; ctx.beginPath(); ctx.arc(ox, oy, Math.max(2.5, r * (occ.type === 'UAM' ? .32 : .16)), 0, Math.PI * 2); ctx.fill(); }); }
      if (hi) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.arc(x, y, r + 6, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
      ctx.textAlign = 'center'; ctx.fillStyle = '#e6f1f5'; ctx.font = `600 ${Math.max(10, Math.min(13, r * .42))}px system-ui,sans-serif`;
      if (r > 9) ctx.fillText(p.name, x, y + r + 14);
      if (r > 22) { ctx.fillStyle = col; ctx.font = '10px ui-monospace,Consolas,monospace'; ctx.fillText(STATUS_TXT[p.status], x, y + r + 26); }
    }

    // Wind arrow
    const w = st.weather, wl = Math.hypot(w.vec.x, w.vec.z);
    ctx.save(); ctx.translate(W - 48, 48); ctx.strokeStyle = 'rgba(143,169,184,.35)'; ctx.beginPath(); ctx.arc(0, 0, 30, 0, Math.PI * 2); ctx.stroke();
    if (wl > .05) { const ang = Math.atan2(w.vec.z, w.vec.x); ctx.rotate(ang); ctx.strokeStyle = '#f0975c'; ctx.fillStyle = '#f0975c'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-18, 0); ctx.lineTo(16, 0); ctx.stroke(); ctx.beginPath(); ctx.moveTo(20, 0); ctx.lineTo(10, -5); ctx.lineTo(10, 5); ctx.fill(); }
    ctx.restore(); ctx.fillStyle = '#8fa9b8'; ctx.font = '10px ui-monospace,Consolas,monospace'; ctx.textAlign = 'center'; ctx.fillText('WIND ' + w.speed.toFixed(0) + ' G' + w.peak.toFixed(0) + ' m/s', W - 48, 92);
    ctx.fillStyle = '#e07a3c'; ctx.fillText('N', W - 48, 14);

    // Active clearance route
    const cl = st.clearance, pos = ac.pos;
    if (cl && cl.route && ['accepted', 'offered'].includes(cl.status)) {
      ctx.strokeStyle = cl.status === 'accepted' ? '#f0975c' : 'rgba(240,151,92,.5)'; ctx.lineWidth = 1.6; ctx.setLineDash([7, 5]); ctx.beginPath(); ctx.moveTo(sx(pos.x), sy(pos.z));
      for (const wp of cl.route) ctx.lineTo(sx(wp.x), sy(wp.z)); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#f0975c'; ctx.font = '10px ui-monospace,Consolas,monospace'; ctx.textAlign = 'left';
      for (const wp of cl.route.slice(0, -1)) { ctx.beginPath(); ctx.arc(sx(wp.x), sy(wp.z), 3.5, 0, Math.PI * 2); ctx.fill(); ctx.fillText(wp.name, sx(wp.x) + 7, sy(wp.z) - 6); }
    }

    // Trail
    if (o.trail && o.trail.length > 1) {
      ctx.lineWidth = 1.5; for (let i = 1; i < o.trail.length; i++) { ctx.strokeStyle = `rgba(255,180,84,${i / o.trail.length * .55})`; ctx.beginPath(); ctx.moveTo(sx(o.trail[i - 1].x), sy(o.trail[i - 1].z)); ctx.lineTo(sx(o.trail[i].x), sy(o.trail[i].z)); ctx.stroke(); }
    }

    // Aircraft
    const ax = sx(pos.x), ay = sy(pos.z), inside = ax > 14 && ax < W - 14 && ay > 14 && ay < H - 14;
    if (inside) {
      const vx = ac.vel.x, vz = ac.vel.z;
      if (Math.hypot(vx, vz) > 1) { ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(sx(pos.x + vx * 10), sy(pos.z + vz * 10)); ctx.stroke(); }
      ctx.save(); ctx.translate(ax, ay); ctx.rotate(-ac.yaw);
      const s = Math.max(9, Math.min(15, 7 + k * 8));
      ctx.fillStyle = '#ffb454'; ctx.strokeStyle = '#1a1206'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s * .7, s * .8); ctx.lineTo(0, s * .4); ctx.lineTo(-s * .7, s * .8); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
      ctx.font = '600 11px ui-monospace,Consolas,monospace'; ctx.textAlign = 'left'; ctx.fillStyle = '#ffb454';
      ctx.fillText(ac.id, ax + 16, ay - 4); ctx.fillStyle = '#e6f1f5'; ctx.fillText(Math.round(pos.y) + ' m  ' + ac.groundSpeed.toFixed(0) + ' m/s', ax + 16, ay + 9);
    } else {
      const ang = Math.atan2(ay - H / 2, ax - W / 2), ex = W / 2 + Math.cos(ang) * (W / 2 - 24), ey = H / 2 + Math.sin(ang) * (H / 2 - 24);
      const ex2 = Math.max(24, Math.min(W - 24, ex)), ey2 = Math.max(24, Math.min(H - 24, ey));
      ctx.save(); ctx.translate(ex2, ey2); ctx.rotate(ang + Math.PI / 2); ctx.fillStyle = '#ffb454'; ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(8, 8); ctx.lineTo(-8, 8); ctx.closePath(); ctx.fill(); ctx.restore();
      ctx.fillStyle = '#ffb454'; ctx.font = '600 10px ui-monospace,Consolas,monospace'; ctx.textAlign = 'center'; ctx.fillText(ac.id + ' ' + Math.round(Math.hypot(pos.x - c.x, pos.z - c.z)) + ' m', ex2, ey2 + (ey2 < H / 2 ? 24 : -16));
    }
    ctx.restore();
  }
  g.N1Map = { draw, COL, STATUS_TXT };
})(window);
