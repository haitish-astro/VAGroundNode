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

  const uamInput = document.getElementById('uamCount');
  const uavInput = document.getElementById('uavCount');
  const missionDemandInput = document.getElementById('missionDemand');
  const missionDemandVal = document.getElementById('missionDemandVal');
  const modeToggle = document.getElementById('modeToggle');
  const pauseBtn = document.getElementById('pauseBtn');
  const resetBtn = document.getElementById('resetBtn');
  document.getElementById('focusBtn').onclick = e => {
    const active = document.querySelector('.app').classList.toggle('scene-focus');
    e.currentTarget.textContent = active ? 'Show operations' : 'Scene focus';
    e.currentTarget.setAttribute('aria-pressed', String(active));
  };

  const mMissions = document.getElementById('mMissions');
  const mIntervention = document.getElementById('mIntervention');
  const mUptime = document.getElementById('mUptime');
  const mSaved = document.getElementById('mSaved');

  const controlParams = {
    uamCount: Number(uamInput.value), uavCount: Number(uavInput.value),
    missionDemand: Number(missionDemandInput.value),
    mode: 'charge'
  };

  let state = Sim.createInitialState(controlParams);
  const renderer = Render.createRenderer(canvas);
  let selection = { type: null, id: null };
  let paused = false;
  // Read-only, same-browser telemetry for the separate communications lab.
  const telemetry = 'BroadcastChannel' in window ? new BroadcastChannel('vahnim-groundnode-telemetry') : null;
  const session = 'Flight ' + new Date().toLocaleTimeString() + ' / ' + Math.random().toString(36).slice(2,6);
  setInterval(() => telemetry?.postMessage({kind:'snapshot', session, paused, hidden:document.hidden,
    fleet:state.drones.map(d=>({callsign:d.callsign,state:d.state,altitude:d.altitude/10,battery:d.battery})),
    pads:state.stations.map(s=>({name:s.name,occupancy:Sim.occupancyLabel(state,s),queue:s.queue.length})),
    comms:state.comms.slice(-30)
  }), 500);

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
      el.hidden = pos.visible === false;
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
        '<div class="row"><span>Reserved</span><span>' + Sim.occupancyLabel(state, s) + '</span></div>' +
        '<div class="row"><span>Queue</span><span>' + s.queue.length + '</span></div>' +
        '<div class="row"><span>Avg charge</span><span>' + (avgBattery != null ? avgBattery + '%' : '—') + '</span></div>';
    });
  }

  let commsKey = '';
  const commsFilter = document.getElementById('commsFilter');
  function updateCommsFeed() {
    const filter = commsFilter.value;
    const key = [state.comms.at(-1)?.id, filter, selection.id].join('|');
    if (key === commsKey) return;
    commsKey = key;
    const selectedDrone = Sim.findDroneById(state, selection.id);
    const selectedStation = Sim.findStationById(state, selection.id);
    const events = state.comms.filter(c => filter === 'all' || (filter === 'selected'
      ? c.callsign === selectedDrone?.callsign || c.stationName === selectedStation?.name
      : c.channel === filter));
    const fragment = document.createDocumentFragment();
    for (const c of events.slice(-30)) {
      const li = document.createElement('li');
      li.className = 'comms-line ' + (c.direction === 'toDrone' ? 'to-drone' : 'to-station');
      const meta = document.createElement('div'); meta.className = 'comm-meta';
      meta.textContent = (c.tick * .033).toFixed(1) + 's · ' + c.channel.toUpperCase() + ' · ' + (c.direction === 'toDrone' ? 'NODE → AIR' : 'AIR → NODE');
      const message = document.createElement('div'); message.textContent = c.text;
      li.append(meta, message); fragment.appendChild(li);
    }
    commsFeedEl.replaceChildren(fragment);
    document.getElementById('commsSummary').textContent = events.length ? 'Latest ' + Math.min(30, events.length) + ' messages · simulated link' : 'Waiting for matching communications';
  }
  const flightRows = new Map();
  const phaseNames = {idle:'Standby', awaitingDeparture:'Clearance', takeoff:'Climbing', outbound:'Outbound', onMission:'City mission', returning:'Inbound', awaitingClearance:'Landing request', queued:'Holding', docking:'Landing', charging:'Charging', swapping:'Battery swap', uploading:'Data sync', redeploying:'Preflight'};
  function updateFlightBoard() {
    const board = document.getElementById('fleetBoard');
    for (const [id, row] of flightRows) if (!state.drones.some(d => d.id === id)) { row.remove(); flightRows.delete(id); }
    for (const d of state.drones) {
      if (!flightRows.has(d.id)) {
        const row = document.createElement('button'); row.className = 'flight-row';
        row.onclick = () => { selection = {type:'drone', id:d.id}; };
        board.appendChild(row); flightRows.set(d.id, row);
      }
      const row = flightRows.get(d.id);
      row.classList.toggle('selected', selection.id === d.id);
      row.setAttribute('aria-pressed', String(selection.id === d.id));
      const text = d.callsign + (d.visitor ? ' · visitor' : '') + '\n' + (d.avoidUntil > state.tick ? 'Avoidance' : phaseNames[d.state]) + ' · ' + Math.round(d.battery) + '%';
      if (row.textContent !== text) row.textContent = text;
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
          statRow('Pad occupancy', Sim.occupancyLabel(state, st)) +
          statRow('Capacity rule', '1 UAM or 3 UAVs') +
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
          statRow('Aircraft', dr.aircraftType) +
          statRow('Mission', dr.missionName || 'Awaiting dispatch') +
          statRow('Traffic', dr.avoidUntil > state.tick ? 'Yielding · brake and climb' : 'Clear') +
          statRow('Operator', dr.visitor ? 'Regional visitor' : 'Vahnim fleet') +
          statRow('Height above pad', (dr.altitude * .1).toFixed(1) + ' m') +
          statRow('Ground speed', (Math.hypot(dr.velocity.x, dr.velocity.y) * .1).toFixed(1) + ' m/s') +
          statRow('Vertical speed', (dr.verticalSpeed * .1).toFixed(1) + ' m/s') +
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
    mIntervention.textContent = state.metrics.conflictResolutions || 0;
    mUptime.textContent = state.drones.filter(d => d.altitude > 1).length;
    mSaved.textContent = state.stations.reduce((n, s) => n + s.queue.length, 0);
  }

  // ---- Controls ----

  for (const [input,key] of [[uamInput,'uamCount'],[uavInput,'uavCount']]) input.addEventListener('input', () => {
    controlParams[key] = Number(input.value);
    document.getElementById(key+'Val').textContent = input.value;
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
    document.querySelector('.live-badge').classList.toggle('paused', paused);
  });

  resetBtn.addEventListener('click', () => {
    state = Sim.createInitialState(controlParams);
    selection = { type: null, id: null };
    renderedCommIds.clear();
    commsFeedEl.innerHTML = '';
    buildStationCards();
    lastTime = null;
    paused = false;
    document.querySelector('.live-badge').classList.remove('paused');
    pauseBtn.textContent = 'Pause';
  });

  let pointerStart = null;
  canvas.addEventListener('pointerdown', e => { pointerStart = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener('click', (e) => {
    if (pointerStart && Math.hypot(e.clientX - pointerStart.x, e.clientY - pointerStart.y) > 5) return;
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

  // The engine integrates fixed substeps; the view renders once per frame.
  function frame(now) {
    if (lastTime == null) lastTime = now;
    const dtMs = Math.min(now - lastTime, 150); // clamp so a backgrounded tab doesn't leap on return
    lastTime = now;

    if (!paused) {
      Sim.simTick(state, controlParams, dtMs / TICK_MS);
    }

    renderer.drawFrame(state, selection);


    uiFrameCounter += 1;
    if (now - lastUiTime >= 150) {
      lastUiTime = now;
      updateCommsFeed();
      updateFlightBoard();
      updateStationCards();
      updateDetailPanel();
      updateMetrics();
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
  let lastUiTime = 0;
  document.addEventListener('visibilitychange', () => { lastTime = null; });
})();



