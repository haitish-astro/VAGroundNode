// Primary flight display drawn on a 2D canvas: attitude, speed and altitude tapes, vertical speed, heading, approach data.
//   N1PFD.draw(ctx, W, H, d, st)   d = smoothed pose {x,y,z,yaw,pitch,roll,gs,vsi}; st = simulation snapshot
(function (g) {
  'use strict';
  const R2D = 180 / Math.PI, MONO = '600 13px ui-monospace,Consolas,monospace', YEL = '#ffd24d', INK = 'rgba(3,8,12,.8)', EDGE = 'rgba(190,205,220,.35)';

  function tapeBox(ctx, x0, x1, ay1) { ctx.fillStyle = INK; ctx.fillRect(x0, 0, x1 - x0, ay1); ctx.strokeStyle = EDGE; ctx.lineWidth = 1; ctx.strokeRect(x0 + .5, .5, x1 - x0 - 1, ay1 - 1); }
  function readout(ctx, x, y, w, text) { ctx.fillStyle = '#000'; ctx.strokeStyle = YEL; ctx.lineWidth = 2; ctx.beginPath(); ctx.rect(x, y - 15, w, 30); ctx.fill(); ctx.stroke(); ctx.fillStyle = YEL; ctx.font = '700 18px ui-monospace,Consolas,monospace'; ctx.textAlign = 'center'; ctx.fillText(text, x + w / 2, y + 1); }

  function draw(ctx, W, H, d, st) {
    const a = st.ac, tapeW = Math.max(62, Math.min(86, W * .13)), hdgH = 44, ay1 = H - hdgH, cx = W / 2, cy = ay1 / 2, ppd = ay1 / 46;
    ctx.clearRect(0, 0, W, H);

    // Horizon
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, ay1); ctx.clip(); ctx.translate(cx, cy); ctx.rotate(d.roll); ctx.translate(0, d.pitch * R2D * ppd);
    let gr = ctx.createLinearGradient(0, -ay1 * 1.2, 0, 0); gr.addColorStop(0, '#0f4a8a'); gr.addColorStop(1, '#69b6ea'); ctx.fillStyle = gr; ctx.fillRect(-W * 2, -H * 4, W * 4, H * 4);
    gr = ctx.createLinearGradient(0, 0, 0, ay1 * 1.2); gr.addColorStop(0, '#8b6c45'); gr.addColorStop(1, '#3f2c1a'); ctx.fillStyle = gr; ctx.fillRect(-W * 2, 0, W * 4, H * 4);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-W * 2, 0); ctx.lineTo(W * 2, 0); ctx.stroke();
    ctx.font = '600 11px ui-monospace,Consolas,monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff'; ctx.lineWidth = 1.5;
    for (let p = -20; p <= 20; p += 5) { if (!p) continue; const y = -p * ppd, w = p % 10 ? 22 : 46; ctx.beginPath(); ctx.moveTo(-w, y); ctx.lineTo(w, y); ctx.stroke(); if (!(p % 10)) { ctx.fillText(Math.abs(p), -w - 14, y); ctx.fillText(Math.abs(p), w + 14, y); } }
    ctx.restore();

    // Roll scale and pointer
    ctx.save(); ctx.translate(cx, cy); const Rr = ay1 * .4; ctx.strokeStyle = '#fff'; ctx.fillStyle = '#fff'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, Rr, -Math.PI / 2 - 1.05, -Math.PI / 2 + 1.05); ctx.stroke();
    for (const t of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) { ctx.save(); ctx.rotate(t / R2D); ctx.beginPath(); ctx.moveTo(0, -Rr); ctx.lineTo(0, -Rr - (t % 30 === 0 ? 12 : 7)); ctx.stroke(); ctx.restore(); }
    ctx.beginPath(); ctx.moveTo(0, -Rr + 1); ctx.lineTo(-7, -Rr + 14); ctx.lineTo(7, -Rr + 14); ctx.closePath(); ctx.fill();
    ctx.rotate(d.roll); ctx.fillStyle = YEL; ctx.beginPath(); ctx.moveTo(0, -Rr - 2); ctx.lineTo(-7, -Rr - 15); ctx.lineTo(7, -Rr - 15); ctx.closePath(); ctx.fill(); ctx.restore();

    // Aircraft symbol
    ctx.strokeStyle = YEL; ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.beginPath(); ctx.moveTo(cx - 92, cy); ctx.lineTo(cx - 38, cy); ctx.lineTo(cx - 38, cy + 12); ctx.moveTo(cx + 92, cy); ctx.lineTo(cx + 38, cy); ctx.lineTo(cx + 38, cy + 12); ctx.stroke(); ctx.fillStyle = YEL; ctx.fillRect(cx - 4, cy - 4, 8, 8);

    // Speed tape (ground speed, m/s)
    tapeBox(ctx, 0, tapeW, ay1); tapeBox(ctx, W - tapeW, W, ay1);
    ctx.font = MONO; ctx.fillStyle = '#e8eef3'; ctx.textBaseline = 'middle';
    const spd = d.gs, ps = ay1 / 24; ctx.save(); ctx.beginPath(); ctx.rect(0, 0, tapeW, ay1); ctx.clip(); ctx.textAlign = 'right'; ctx.strokeStyle = '#cfd8e0';
    for (let v = Math.max(0, Math.floor(spd - 12)); v <= spd + 12; v++) { const y = cy - (v - spd) * ps; ctx.beginPath(); ctx.moveTo(tapeW, y); ctx.lineTo(tapeW - (v % 5 ? 8 : 15), y); ctx.stroke(); if (v % 5 === 0) ctx.fillText(v, tapeW - 20, y); }
    ctx.restore(); readout(ctx, 4, cy, tapeW - 6, spd.toFixed(0));
    ctx.font = '10px ui-monospace,Consolas,monospace'; ctx.fillStyle = '#8f9aa6'; ctx.textAlign = 'center'; ctx.fillText('GS m/s', tapeW / 2, ay1 - 10);

    // Altitude tape (above ground, m)
    const alt = d.y, pa = ay1 / 120; ctx.save(); ctx.beginPath(); ctx.rect(W - tapeW, 0, tapeW, ay1); ctx.clip();
    const gy = cy + alt * pa; if (gy < ay1) { ctx.fillStyle = 'rgba(139,108,69,.55)'; ctx.fillRect(W - tapeW, gy, tapeW, ay1 - gy); }
    ctx.fillStyle = '#e8eef3'; ctx.textAlign = 'left'; ctx.strokeStyle = '#cfd8e0'; ctx.font = MONO;
    for (let v = Math.floor((alt - 62) / 10) * 10; v <= alt + 62; v += 10) { if (v < 0) continue; const y = cy - (v - alt) * pa; ctx.beginPath(); ctx.moveTo(W - tapeW, y); ctx.lineTo(W - tapeW + (v % 20 ? 8 : 15), y); ctx.stroke(); if (v % 20 === 0) ctx.fillText(v, W - tapeW + 20, y); }
    ctx.restore(); readout(ctx, W - tapeW + 2, cy, tapeW - 6, alt.toFixed(alt < 10 ? 1 : 0));
    ctx.font = '10px ui-monospace,Consolas,monospace'; ctx.fillStyle = '#8f9aa6'; ctx.textAlign = 'center'; ctx.fillText('ALT m', W - tapeW / 2, ay1 - 10);

    // Vertical speed
    const vx = W - tapeW - 22; ctx.fillStyle = 'rgba(3,8,12,.7)'; ctx.fillRect(vx, cy - 70, 22, 140); ctx.strokeStyle = EDGE; ctx.strokeRect(vx + .5, cy - 69.5, 21, 139);
    ctx.strokeStyle = '#cfd8e0'; ctx.lineWidth = 1; for (let v = -4; v <= 4; v += 2) { const y = cy - v * 15; ctx.beginPath(); ctx.moveTo(vx, y); ctx.lineTo(vx + (v ? 8 : 14), y); ctx.stroke(); }
    const vs = Math.max(-4.5, Math.min(4.5, d.vsi)); ctx.fillStyle = vs < -2.5 ? '#f5b544' : '#57f5a5'; ctx.fillRect(vx + 15, Math.min(cy, cy - vs * 15), 5, Math.abs(vs * 15) + 1);
    ctx.fillStyle = '#8f9aa6'; ctx.font = '9px ui-monospace,Consolas,monospace'; ctx.textAlign = 'center'; ctx.fillText('VS', vx + 11, cy - 78); ctx.fillStyle = '#e8eef3'; ctx.fillText(d.vsi.toFixed(1), vx + 11, cy + 82);

    // Approach data
    const pad = a.padId && st.pads.find(p => p.id === a.padId);
    if (pad && ['transit', 'inbound', 'descent', 'goaround'].includes(a.stage)) {
      const dist = Math.hypot(d.x - pad.x, d.z - pad.z), eta = a.groundSpeed > 1 ? dist / a.groundSpeed : 0, bw = 200;
      ctx.fillStyle = INK; ctx.strokeStyle = 'rgba(224,122,60,.7)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect(cx - bw / 2, 8, bw, 28, 8); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#f0975c'; ctx.font = '600 12px ui-monospace,Consolas,monospace'; ctx.textAlign = 'center'; ctx.fillText(`${pad.name}  ${dist.toFixed(0)} m${eta ? '  ETA ' + eta.toFixed(0) + ' s' : ''}`, cx, 23);
    }

    // Heading tape
    ctx.fillStyle = 'rgba(3,8,12,.88)'; ctx.fillRect(0, ay1, W, hdgH); ctx.strokeStyle = EDGE; ctx.strokeRect(.5, ay1 + .5, W - 1, hdgH - 1);
    const hdg = ((-d.yaw * R2D) % 360 + 360) % 360, ph = 5.2; ctx.save(); ctx.beginPath(); ctx.rect(0, ay1, W, hdgH); ctx.clip(); ctx.strokeStyle = '#cfd8e0'; ctx.fillStyle = '#e8eef3'; ctx.font = '600 12px ui-monospace,Consolas,monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let v = Math.floor(hdg - 36); v <= hdg + 36; v++) { if (v % 5) continue; const x = cx + (v - hdg) * ph, dd = ((v % 360) + 360) % 360; ctx.beginPath(); ctx.moveTo(x, ay1 + 1); ctx.lineTo(x, ay1 + (v % 10 ? 7 : 13)); ctx.stroke(); if (v % 10 === 0) ctx.fillText(dd % 90 === 0 ? ['N', 'E', 'S', 'W'][dd / 90] : String(dd / 10).padStart(2, '0'), x, ay1 + 27); }
    ctx.restore(); ctx.fillStyle = '#000'; ctx.strokeStyle = YEL; ctx.lineWidth = 2; ctx.beginPath(); ctx.rect(cx - 26, ay1 + 2, 52, 22); ctx.fill(); ctx.stroke(); ctx.fillStyle = YEL; ctx.font = '700 15px ui-monospace,Consolas,monospace'; ctx.fillText(String(Math.round(hdg) % 360 || 360).padStart(3, '0'), cx, ay1 + 14);
    ctx.fillStyle = YEL; ctx.beginPath(); ctx.moveTo(cx, ay1); ctx.lineTo(cx - 5, ay1 - 7); ctx.lineTo(cx + 5, ay1 - 7); ctx.closePath(); ctx.fill();
  }
  g.N1PFD = { draw };
})(window);
