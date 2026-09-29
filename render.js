// GroundNode Live — rendering layer. Reads sim state, never mutates it.
(function (global) {
  'use strict';

  const Sim = global.GroundNodeSim;

  const DOCKED_LIKE = new Set([
    'idle', 'docking', 'charging', 'swapping', 'uploading', 'redeploying', 'awaitingDeparture'
  ]);

  // Scaled to the pad's real visual radius in vertipad-bg-v1.png (~120 map units).
  const STATION_VISUAL_RADIUS = 120;
  const STATION_HIT_RADIUS = 130;
  const DRONE_HIT_RADIUS = 26;

  const DRONE_SPRITE_SRC = 'assets/drone-quad-v1.png';
  const BACKGROUND_SRC = 'assets/vertipad-bg-v1.png';
  const DRONE_BASE_WIDTH = 72; // map units, at full (in-flight) scale
  const DOCKED_SCALE = 0.6;
  const DOCKED_ALPHA = 0.82;

  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    const get = (name, fallback) => (cs.getPropertyValue(name) || fallback).trim();
    return {
      bg: get('--bg', '#0b0c10'),
      mesh: get('--mesh', 'rgba(255,140,66,0.16)'),
      panel: get('--panel', '#15171c'),
      border: get('--border', 'rgba(255,255,255,0.12)'),
      text: get('--text', '#f5f2ee'),
      textDim: get('--text-dim', '#9a9691'),
      orange: get('--orange', '#ff6a1a'),
      orangeBright: get('--orange-bright', '#ff9152'),
      orangeDim: get('--orange-dim', 'rgba(255,106,26,0.35)'),
      green: get('--green', '#3ddc84'),
      yellow: get('--yellow', '#ffcc4d'),
      red: get('--red', '#ff5470'),
      cyan: get('--cyan', '#4dd2ff')
    };
  }

  function loadImage(src) {
    const img = new Image();
    img.src = src;
    return img;
  }

  function ready(img) { return img.complete && img.naturalWidth > 0; }

  function createRenderer(canvas) {
    const ctx = canvas.getContext('2d');
    const colors = readColors();
    let dpr = Math.max(1, window.devicePixelRatio || 1);

    const bgImage = loadImage(BACKGROUND_SRC);
    const droneImage = loadImage(DRONE_SPRITE_SRC);
    const uamImage = loadImage('assets/evtol-v1.png');

    function resize() {
      // Re-read every time, not just at construction — devicePixelRatio can
      // change mid-session (window dragged to a different monitor, browser
      // zoom), and a stale value here desyncs click hit-testing from the
      // canvas's actual scale.
      dpr = Math.max(1, window.devicePixelRatio || 1);
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
    }
    resize();
    window.addEventListener('resize', resize);

    // "Cover" fit: scale up to fill the canvas and crop overflow, same as
    // CSS background-size:cover — but computed once here so the background
    // image, station markers, and drone positions all share one mapping and
    // never drift apart at different viewport sizes.
    function transform(state) {
      const scale = Math.min(canvas.width / state.mapW, canvas.height / state.mapH);
      const offX = (canvas.width - state.mapW * scale) / 2;
      const offY = (canvas.height - state.mapH * scale) / 2;
      return { scale, offX, offY };
    }

    function toScreen(tf, x, y) {
      return { x: tf.offX + x * tf.scale, y: tf.offY + y * tf.scale };
    }

    function screenToMap(state, clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const sx = (clientX - rect.left) * dpr;
      const sy = (clientY - rect.top) * dpr;
      const tf = transform(state);
      return { x: (sx - tf.offX) / tf.scale, y: (sy - tf.offY) / tf.scale };
    }

    function droneTintColor(drone) {
      switch (drone.state) {
        case 'awaitingDeparture':
        case 'awaitingClearance': return colors.cyan;
        case 'queued': return colors.yellow;
        case 'uploading': return colors.cyan;
        case 'redeploying': return colors.green;
        default: return colors.orangeBright;
      }
    }

    function drawBackground(state, tf) {
      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (ready(bgImage)) {
        const dst = toScreen(tf, 0, 0);
        ctx.drawImage(bgImage, dst.x, dst.y, state.mapW * tf.scale, state.mapH * tf.scale);
        // Faint vignette so orange UI elements stay legible against bright sky.
        const grad = ctx.createRadialGradient(
          canvas.width / 2, canvas.height / 2, canvas.height * 0.35,
          canvas.width / 2, canvas.height / 2, canvas.height * 0.9
        );
        grad.addColorStop(0, 'rgba(0,0,0,0)');
        grad.addColorStop(1, 'rgba(0,0,0,0.28)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    }

    function nearestNeighbors(state, station, n) {
      return state.stations
        .filter((s) => s.id !== station.id)
        .map((s) => ({ s, d: Math.hypot(s.x - station.x, s.y - station.y) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, n)
        .map((e) => e.s);
    }

    function drawMesh(state, tf) {
      ctx.strokeStyle = colors.mesh;
      ctx.lineWidth = 1.5;
      const drawn = new Set();
      state.stations.forEach((s) => {
        nearestNeighbors(state, s, 2).forEach((n) => {
          const key = [s.id, n.id].sort().join('|');
          if (drawn.has(key)) return;
          drawn.add(key);
          const a = toScreen(tf, s.x, s.y);
          const b = toScreen(tf, n.x, n.y);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        });
      });
    }

    function healthColor(health) {
      if (health === 'red') return colors.red;
      if (health === 'yellow') return colors.yellow;
      return colors.green;
    }

    // The pad itself is already in the photo — this only overlays a live
    // status ring (health/selection) at the pad's real radius, so it reads
    // as UI laid over the scene rather than replacing the rendered pad.
    function drawStation(state, station, tf, selected) {
      const p = toScreen(tf, station.x, station.y);
      const r = STATION_VISUAL_RADIUS * tf.scale;

      ctx.save();
      ctx.translate(p.x, p.y);

      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = healthColor(station.health);
      ctx.globalAlpha = 0.85;
      ctx.stroke();
      ctx.globalAlpha = 1;

      if (selected) {
        ctx.beginPath();
        ctx.arc(0, 0, r + 10, 0, Math.PI * 2);
        ctx.setLineDash([6, 6]);
        ctx.strokeStyle = colors.orangeBright;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.restore();
    }

    function drawCommsBeam(state, drone, tf) {
      const stationId = drone.state === 'awaitingDeparture' ? drone.currentStationId : drone.targetStationId;
      const station = Sim.findStationById(state, stationId);
      if (!station) return;
      const dp = drone.pos;
      const a = toScreen(tf, station.x, station.y);
      const b = toScreen(tf, dp.x, dp.y);

      ctx.save();
      ctx.strokeStyle = colors.cyan;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1.25;
      ctx.setLineDash([4, 5]);
      ctx.lineDashOffset = -state.tick * 1.5;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);

      const pulseT = (state.tick % 24) / 24;
      const pulse = { x: a.x + (b.x - a.x) * pulseT, y: a.y + (b.y - a.y) * pulseT };
      ctx.globalAlpha = 1;
      ctx.fillStyle = colors.cyan;
      ctx.beginPath();
      ctx.arc(pulse.x, pulse.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    function drawFlightTrail(state, drone, tf) {
      if (drone.state !== 'outbound' && drone.state !== 'returning') return;
      const a = toScreen(tf, drone.pathFrom.x, drone.pathFrom.y);
      const b = toScreen(tf, drone.pathTo.x, drone.pathTo.y);
      ctx.save();
      ctx.strokeStyle = colors.orangeDim;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 5]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.restore();
    }

    function clamp01(v) { return Math.max(0, Math.min(1, v)); }

    function drawDroneFallback(size, color) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }

    function drawDrone(state, drone, tf, selected) {
      const pos = drone.pos;
      const p = toScreen(tf, pos.x, pos.y - drone.altitude);
      const sprite = drone.aircraftType === 'UAM' ? uamImage : droneImage;
      const docked = DOCKED_LIKE.has(drone.state);
      // Perspective decreases toward the distant city; UAM spans most of a pad.
      const perspective = 0.35 + 0.65 * clamp01((pos.y - 180) / 400);
      const width = (drone.aircraftType === 'UAM' ? 310 : 65) * tf.scale * perspective;
      const aspect = ready(sprite) ? sprite.naturalHeight / sprite.naturalWidth : 0.75;
      const height = width * aspect;

      ctx.save();
      ctx.translate(p.x, p.y);

      // Soft glow under in-flight drones so they read clearly against the photo.
      if (!docked) {
        const glowR = width * 0.6;
        const grad = ctx.createRadialGradient(0, height * 0.18, 1, 0, height * 0.18, glowR);
        grad.addColorStop(0, 'rgba(255,145,82,0.55)');
        grad.addColorStop(1, 'rgba(255,145,82,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, height * 0.18, glowR, 0, Math.PI * 2);
        ctx.fill();
      }

      if (selected) {
        ctx.beginPath();
        ctx.arc(0, 0, Math.max(width, height) * 0.62, 0, Math.PI * 2);
        ctx.strokeStyle = colors.text;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      if (drone.flagged) {
        ctx.beginPath();
        ctx.arc(0, 0, Math.max(width, height) * 0.62 + 4, 0, Math.PI * 2);
        ctx.strokeStyle = colors.red;
        ctx.globalAlpha = 0.4 + 0.4 * Math.sin(state.tick * 0.3);
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // Flight direction as a subtle bank/lean, not a full top-down rotation —
      // the sprite is a 3/4-angle render, so a small tilt reads as motion
      // without looking like the aircraft flipped onto its side.
      if (drone.state === 'outbound' || drone.state === 'returning') {
        ctx.rotate(drone.velocity.x / 55 * 0.12);
      }

      ctx.globalAlpha = docked ? DOCKED_ALPHA : 1;
      if (ready(sprite)) {
        ctx.drawImage(sprite, -width / 2, -height / 2, width, height);
      } else {
        drawDroneFallback(width, droneTintColor(drone));
      }
      ctx.globalAlpha = 1;

      if (docked && (drone.state === 'charging' || drone.state === 'swapping')) {
        const pct = clamp01(drone.battery / 100);
        ctx.strokeStyle = colors.text;
        ctx.globalAlpha = 0.85;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, Math.max(width, height) * 0.58, -Math.PI / 2, -Math.PI / 2 + pct * Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      ctx.restore();
      if (selected || drone.altitude > 1) {
        ctx.fillStyle = colors.text;
        ctx.font = `${Math.max(10, 13 * tf.scale)}px system-ui`;
        ctx.textAlign = 'center';
        ctx.fillText(`${drone.callsign} · ${drone.aircraftType} · ${Math.round(drone.altitude)}m`, p.x, p.y + height / 2 + 14);
      }
    }

    function drawFrame(state, selection) {
      const tf = transform(state);
      drawBackground(state, tf);
      drawMesh(state, tf);

      state.stations.forEach((s) => {
        drawStation(state, s, tf, selection.type === 'station' && selection.id === s.id);
      });

      state.drones.forEach((d) => drawFlightTrail(state, d, tf));
      state.drones.forEach((d) => {
        if (d.state === 'awaitingDeparture' || d.state === 'awaitingClearance') drawCommsBeam(state, d, tf);
      });
      state.drones.forEach((d) => {
        drawDrone(state, d, tf, selection.type === 'drone' && selection.id === d.id);
      });
    }

    function hitTestStation(state, clientX, clientY) {
      const m = screenToMap(state, clientX, clientY);
      let best = null, bestD = STATION_HIT_RADIUS;
      state.stations.forEach((s) => {
        const d = Math.hypot(s.x - m.x, s.y - m.y);
        if (d < bestD) { bestD = d; best = s; }
      });
      return best;
    }

    function hitTestDrone(state, clientX, clientY) {
      const m = screenToMap(state, clientX, clientY);
      let best = null, bestD = Infinity;
      state.drones.forEach((d) => {
        const dist = Math.hypot(d.pos.x - m.x, d.pos.y - d.altitude - m.y);
        const perspective = 0.35 + 0.65 * clamp01((d.pos.y - 180) / 400);
        const radius = (d.aircraftType === 'UAM' ? 140 : 30) * perspective;
        if (dist < radius && dist < bestD) { bestD = dist; best = d; }
      });
      return best;
    }

    function stationScreenPos(state, station) {
      const tf = transform(state);
      const p = toScreen(tf, station.x, station.y);
      const rect = canvas.getBoundingClientRect();
      return { x: rect.left + p.x / dpr, y: rect.top + p.y / dpr };
    }

    return { drawFrame, resize, screenToMap, hitTestStation, hitTestDrone, stationScreenPos };
  }

  global.GroundNodeRender = { createRenderer };
})(typeof window !== 'undefined' ? window : globalThis);
