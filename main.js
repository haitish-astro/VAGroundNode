// GroundNode Live — wiring: controls, fixed-timestep sim loop, DOM panels.
(function () {
  'use strict';

  const Sim = window.GroundNodeSim;
  const Render = window.GroundNodeRender;

  const TICK_MS = 33; // ~30 sim ticks/sec, independent of display refresh rate
  const UI_THROTTLE_FRAMES = 3; // station cards / detail panel / metrics don't need 60fps

  const canvas = document.getElementById('mapCanvas');
  const mapWrap = canvas.parentElement;
  const stationCardsEl = document.getElementById('stationCards');
  const commsFeedEl = document.getElementById('commsFeed');
  const detailEmpty = document.getElementById('detailEmpty');
  const detailContent = document.getElementById('detailContent');

  const droneCountInput = document.getElementById('droneCount');
  const droneCountVal = document.getElementById('droneCountVal');
  const trafficUp = document.getElementById('trafficUp');
  const trafficDown = document.getElementById('trafficDown');
  const missionDemandInput = document.getElementById('missionDemand');
  const missionDemandVal = document.getElementById('missionDemandVal');
  const modeToggle = document.getElementById('modeToggle');
  const pauseBtn = document.getElementById('pauseBtn');
  const resetBtn = document.getElementById('resetBtn');

  const mMissions = document.getElementById('mMissions');
  const mIntervention = document.getElementById('mIntervention');
  const mUptime = document.getElementById('mUptime');
  const mSaved = document.getElementById('mSaved');

  const controlParams = {
    droneCount: Number(droneCountInput.value),
    missionDemand: Number(missionDemandInput.value),
    mode: 'charge'
  };

  let state = Sim.createInitialState(controlParams);
  const renderer = Render.createRenderer(canvas);
  let selection = { type: null, id: null };
  let paused = false;

  const stationCardEls = new Map();
  const renderedCommIds = new Set();

  function demandLabel(v) {
    if (v < 0.33) return 'Low';
    if (v < 0.66) return 'Medium';
    return 'High';
  }

  function buildStationCards() {
    stationCardsEl.innerHTML = '';
    stationCardEls.clear();
    state.stations.forEach((s) => {
      const el = document.createElement('div');
      el.className = 'station-card';
      el.addEventListener('click', () => { selection = { type: 'station', id: s.id }; });
      stationCardsEl.appendChild(el);
      stationCardEls.set(s.id, el);
    });
  }

  function updateStationCards() {
    const wrapRect = mapWrap.getBoundingClientRect();
    state.stations.forEach((s) => {
      const el = stationCardEls.get(s.id);
      if (!el) return;
      const pos = renderer.stationScreenPos(state, s);
      el.style.left = (pos.x - wrapRect.left) + 'px';
      el.style.top = (pos.y - wrapRect.top) + 'px';

      const batteries = s.dockedDrones
        .map((id) => Sim.findDroneById(state, id))
        .filter(Boolean)
        .map((d) => d.battery);
      const avgBattery = batteries.length
        ? Math.round(batteries.reduce((a, b) => a + b, 0) / batteries.length)
        : null;

      el.innerHTML =
        '<div class="name"><span class="health-dot ' + s.health + '"></span>' + s.name + '</div>' +
        '<div class="row"><span>Docked</span><span>' + s.dockedDrones.length + '/' + s.capacity + '</span></div>' +
        '<div class="row"><span>Queue</span><span>' + s.queue.length + '</span></div>' +
        '<div class="row"><span>Avg charge</span><span>' + (avgBattery != null ? avgBattery + '%' : '—') + '</span></div>';
    });
  }

  function updateCommsFeed() {
    state.comms.forEach((c) => {
      if (renderedCommIds.has(c.id)) return;
      renderedCommIds.add(c.id);
      const li = document.createElement('li');
      li.className = 'comms-line ' + (c.direction === 'toDrone' ? 'to-drone' : 'to-station');
      li.dataset.id = c.id;
      const highlighted = c.text.split(c.callsign).join('<span class="cs">' + c.callsign + '</span>');
      li.innerHTML = '<span class="tick">t+' + c.tick + '</span> ' + highlighted;
      commsFeedEl.appendChild(li);
    });
    while (commsFeedEl.children.length > 60) {
      const first = commsFeedEl.firstChild;
      renderedCommIds.delete(first.dataset.id);
      commsFeedEl.removeChild(first);
    }
  }

  function closeDetail() { selection = { type: null, id: null }; }

  function updateDetailPanel() {
    if (selection.type === 'station') {
      const st = Sim.findStationById(state, selection.id);
      if (!st) { closeDetail(); }
      else {
        detailEmpty.hidden = true;
        detailContent.hidden = false;
        const avgTurnSec = (Sim.averageTurnaroundTicks(st) * TICK_MS / 1000).toFixed(1);
        const uptime = Sim.stationUptimePercent(st).toFixed(1);
        detailContent.innerHTML =
          '<button class="detail-close" id="detailCloseBtn">✕ Close</button>' +
          '<div class="kicker">GroundNode Station</div>' +
          '<div class="title">' + st.name + '</div>' +
          statRow('Health', st.health.charAt(0).toUpperCase() + st.health.slice(1)) +
          statRow('Docked / capacity', st.dockedDrones.length + ' / ' + st.capacity) +
          statRow('Queue length', st.queue.length) +
          statRow('Total drones served', st.stats.totalServed) +
          statRow('Avg turnaround', avgTurnSec + 's') +
          statRow('Uptime', uptime + '%');
        document.getElementById('detailCloseBtn').onclick = closeDetail;
        return;
      }
    }

    if (selection.type === 'drone') {
      const dr = Sim.findDroneById(state, selection.id);
      if (!dr) { closeDetail(); }
      else {
        detailEmpty.hidden = true;
        detailContent.hidden = false;
        const remainingTicks = Math.max(0, dr.stateDurationTicks - (state.tick - dr.stateEnteredAtTick));
        const etaSec = (remainingTicks * TICK_MS / 1000).toFixed(1);
        detailContent.innerHTML =
          '<button class="detail-close" id="detailCloseBtn">✕ Close</button>' +
          '<div class="kicker">Drone</div>' +
          '<div class="title">' + dr.callsign + '</div>' +
          statRow('Current task', dr.currentTaskLabel) +
          statRow('Battery', dr.battery.toFixed(0) + '%') +
          '<div class="battery-bar"><div class="battery-bar-fill" style="width:' + dr.battery + '%"></div></div>' +
          '<div style="height:12px"></div>' +
          statRow('ETA to next phase', dr.stateDurationTicks > 0 ? etaSec + 's' : '—') +
          statRow('Missions completed', dr.missionsCompleted) +
          statRow('Flagged for review', dr.flagged ? 'Yes' : 'No');
        document.getElementById('detailCloseBtn').onclick = closeDetail;
        return;
      }
    }

    detailEmpty.hidden = false;
    detailContent.hidden = true;
  }

  function statRow(k, v) {
    return '<div class="detail-stat"><span class="k">' + k + '</span><span class="v">' + v + '</span></div>';
  }

  function updateMetrics() {
    mMissions.textContent = state.metrics.missionsCompleted;
    mIntervention.textContent = state.metrics.interventionEvents;
    mUptime.textContent = Sim.fleetUptimePercent(state).toFixed(1) + '%';
    mSaved.textContent = '$' + Math.round(state.metrics.costSavedUsd).toLocaleString();
  }

  // ---- Controls ----

  droneCountInput.addEventListener('input', () => {
    controlParams.droneCount = Number(droneCountInput.value);
    droneCountVal.textContent = controlParams.droneCount;
  });

  trafficUp.addEventListener('click', () => {
    droneCountInput.value = Math.min(20, Number(droneCountInput.value) + 1);
    droneCountInput.dispatchEvent(new Event('input'));
  });

  trafficDown.addEventListener('click', () => {
    droneCountInput.value = Math.max(1, Number(droneCountInput.value) - 1);
    droneCountInput.dispatchEvent(new Event('input'));
  });

  missionDemandInput.addEventListener('input', () => {
    controlParams.missionDemand = Number(missionDemandInput.value);
    missionDemandVal.textContent = demandLabel(controlParams.missionDemand);
  });

  modeToggle.querySelectorAll('.toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      modeToggle.querySelectorAll('.toggle-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      controlParams.mode = btn.dataset.mode;
    });
  });

  pauseBtn.addEventListener('click', () => {
    paused = !paused;
    pauseBtn.textContent = paused ? 'Resume' : 'Pause';
  });

  resetBtn.addEventListener('click', () => {
    state = Sim.createInitialState(controlParams);
    selection = { type: null, id: null };
    renderedCommIds.clear();
    commsFeedEl.innerHTML = '';
    buildStationCards();
    lastTime = null;
  });

  canvas.addEventListener('click', (e) => {
    // Drones first: docked/charging drones render inside their station's
    // (larger) hit radius, so the more specific target has to win the tie.
    const droneHit = renderer.hitTestDrone(state, e.clientX, e.clientY);
    if (droneHit) { selection = { type: 'drone', id: droneHit.id }; return; }
    const stationHit = renderer.hitTestStation(state, e.clientX, e.clientY);
    if (stationHit) { selection = { type: 'station', id: stationHit.id }; return; }
  });

  // ---- Loop ----

  buildStationCards();

  let lastTime = null;
  let uiFrameCounter = 0;

  // One simTick call per animation frame, scaled to that frame's real
  // elapsed time (dtTicks), instead of a fixed-step catch-up loop — a catch-up
  // loop can burst several ticks into a single rendered frame after any
  // stutter, which is exactly what reads as motion "teleporting"/cutting.
  // This way the sim always advances by precisely as much as real time did.
  function frame(now) {
    if (lastTime == null) lastTime = now;
    const dtMs = Math.min(now - lastTime, 150); // clamp so a backgrounded tab doesn't leap on return
    lastTime = now;

    if (!paused) {
      Sim.simTick(state, controlParams, dtMs / TICK_MS);
    }

    renderer.drawFrame(state, selection);
    updateCommsFeed();

    uiFrameCounter += 1;
    if (uiFrameCounter % UI_THROTTLE_FRAMES === 0) {
      updateStationCards();
      updateDetailPanel();
      updateMetrics();
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})();
