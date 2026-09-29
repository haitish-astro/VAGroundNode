// GroundNode Live — core simulation engine.
// Pure state/logic, no DOM access. Public elapsed ticks are accumulated into
// fixed 120 Hz integration steps. One nominal tick represents 33 milliseconds.
(function (global) {
  'use strict';

  // 16:9 to match vertipad-bg-v1.png's aspect ratio so station coordinates
  // (below) line up with the pads actually rendered in that image.
  const MAP_W = 1600;
  const MAP_H = 900;

  const STATION_CAPACITY = 3; // UAV spaces; a UAM reserves all three.
  const CHARGE_DURATION_TICKS = 220; // charge-in-place dwell
  const SWAP_DURATION_TICKS = 35;    // battery-swap dwell
  const DOCKING_DURATION_TICKS = 18;
  const UPLOAD_DURATION_TICKS = 25;
  const REDEPLOY_DURATION_TICKS = 12;

  const OUTBOUND_SPEED = 6.0; // map units / tick
  const RETURN_SPEED = 6.0;
  const MISSION_MIN_TICKS = 300;
  const MISSION_MAX_TICKS = 650;

  const FLIGHT_BATTERY_DRAIN = 0.003;
  const MISSION_BATTERY_DRAIN = 0.01; // % per tick while on mission
  const LOW_BATTERY_THRESHOLD = 20;
  const MIN_DISPATCH_BATTERY = 30;
  const DISPATCH_BASE_P = 0.004; // per-tick dispatch chance at 0 demand
  const DISPATCH_DEMAND_P = 0.02; // additional per-tick chance at max demand

  const INTERVENTION_BASE_RATE = 0.06; // chance per mission completion, early on
  const INTERVENTION_DECAY = 0.985;    // multiplies rate after each mission -> trends to 0

  const TIME_SAVED_PER_MISSION_MIN = 42; // illustrative: manual round trip vs autonomous
  const COST_SAVED_PER_MISSION_USD = 65; // illustrative

  const DEPARTURE_CLEARANCE_MIN_TICKS = 60; // clearance + rotor spool-up
  const DEPARTURE_CLEARANCE_MAX_TICKS = 100;
  const ARRIVAL_CLEARANCE_MIN_TICKS = 5;
  const ARRIVAL_CLEARANCE_MAX_TICKS = 12;
  const HOLD_ORBIT_RADIUS = 80; // map units — "holding pattern" circle above the pad
  const MAX_COMMS_LOG = 60;

  // Dock slots sit within the pad's real visual radius (~120 map units),
  // spread enough that parked/charging sprites don't overlap each other.
  const SLOT_OFFSETS = [
    { dx: -65, dy: 0 }, { dx: 0, dy: -20 }, { dx: 65, dy: 0 }
  ];

  // Five pads in a shallow W across the apron (map units; 10 units = 1 m in the 3D scene, so pads sit
  // 35-45 m apart with clear space between their 24 m decks). Change this list to re-lay the terminal.
  const DEFAULT_STATIONS = [
    { name: 'GN-01 Pad A', x: 100, y: 510 },
    { name: 'GN-02 Pad B', x: 450, y: 790 },
    { name: 'GN-03 Pad C', x: 800, y: 530 },
    { name: 'GN-04 Pad D', x: 1150, y: 790 },
    { name: 'GN-05 Pad E', x: 1500, y: 510 }
  ];

  let uid = 0;
  function nextId(prefix) { uid += 1; return prefix + uid; }

  function dist(a, b) {
    const dx = a.x - b.x, dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function lerpPoint(a, b, t) { return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) }; }
  function randRange(min, max) { return min + Math.random() * (max - min); }
  function randInt(min, max) { return Math.floor(randRange(min, max + 1)); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function clamp01(v) { return clamp(v, 0, 1); }

  // Stable per-drone phase so hover/orbit motion doesn't sync up across drones.
  function hashPhase(id) {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return (h % 1000) / 1000 * Math.PI * 2;
  }

  function createStation(def) {
    return {
      id: nextId('st-'),
      name: def.name,
      x: def.x,
      y: def.y,
      capacity: STATION_CAPACITY,
      dockedDrones: [],
      queue: [],
      mode: 'charge',
      health: 'green',
      stats: { totalServed: 0, turnaroundTimes: [], upTicks: 0, totalTicks: 0 }
    };
  }

  let droneSeq = 0;
  function createDrone(homeStation, aircraftType) {
    droneSeq += 1;
    return {
      id: nextId('dr-'),
      callsign: 'DR-' + String(droneSeq).padStart(2, '0'),
      state: 'idle',
      currentStationId: homeStation.id,
      targetStationId: homeStation.id,
      dockSlot: 0,
      pos: { x: homeStation.x, y: homeStation.y },
      pathFrom: { x: homeStation.x, y: homeStation.y },
      pathTo: { x: homeStation.x, y: homeStation.y },
      progress: 0,
      battery: randRange(70, 100),
      stateEnteredBattery: null,
      missionWaypoint: null,
      stateEnteredAtTick: 0,
      stateDurationTicks: 0,
      missionStartTick: 0,
      missionsCompleted: 0,
      currentTaskLabel: 'Docked · standby',
      flagged: false,
      altitude: 0, verticalSpeed: 0, velocity: { x: 0, y: 0 }, acceleration: { x: 0, y: 0 },
      yaw: 0, pitch: 0, roll: 0, yawRate: 0, pitchRate: 0, rollRate: 0,
      aircraftType
    };
  }

  function createInitialState(options) {
    const opts = options || {};
    const stationDefs = opts.stationDefs || DEFAULT_STATIONS;
    const droneCount = opts.droneCount != null ? opts.droneCount : 8;
    const missionDemand = opts.missionDemand != null ? opts.missionDemand : 0.5;
    const mode = opts.mode || 'charge';

    const stations = stationDefs.map(createStation);

    const state = {
      tick: 0,
      mapW: MAP_W,
      mapH: MAP_H,
      stations,
      drones: [],
      comms: [],
      visitorTraffic: opts.visitorTraffic !== false,
      nextVisitorTick: 450,
      metrics: {
        missionsCompleted: 0,
        interventionEvents: 0,
        interventionRate: INTERVENTION_BASE_RATE,
        timeSavedMinutes: 0,
        costSavedUsd: 0
      },
      params: { droneCount: 0, missionDemand, mode }
    };

    setFleetCounts(state, opts.uamCount ?? Math.min(3,droneCount), opts.uavCount ?? Math.max(0,droneCount-3));
    applyMode(state, mode);
    return state;
  }

  function applyMode(state, mode) {
    state.params.mode = mode;
    state.stations.forEach((s) => { s.mode = mode; });
  }

  // Lowest slot number (0..capacity-1) not currently held by another docked
  // drone at this station. Assigned once per dock and kept until departure,
  // so a neighbor leaving never reshuffles anyone else's parked position.
  function assignDockSlot(state, station) {
    const used = new Set();
    station.dockedDrones.forEach((id) => {
      const d = findDroneById(state, id);
      if (d) used.add(d.dockSlot);
    });
    for (let i = 0; i < station.capacity; i++) if (!used.has(i)) return i;
    return 0;
  }

  function dockSlotPos(station, slot) {
    if (slot === -1) return { x: station.x, y: station.y };
    const o = SLOT_OFFSETS[slot % SLOT_OFFSETS.length];
    return { x: station.x + o.dx, y: station.y + o.dy };
  }

  function queueSlotPos(station, idx) {
    return { x: station.x + 200 + idx * 240, y: station.y - 160 };
  }
  function assignApproach(state, station, drone) {
    const used = new Set(state.drones.filter(d => d.id !== drone.id && d.targetStationId === station.id && ['returning', 'awaitingClearance', 'queued'].includes(d.state)).map(d => d.approachSlot));
    let slot = 0;
    while (used.has(slot)) slot++;
    drone.approachSlot = slot;
    drone.pathTo = queueSlotPos(station, slot);
  }

  function setFleetCounts(state, uamCount, uavCount) {
    for (const [type, count] of [['UAM',uamCount],['UAV',uavCount]]) {
      const target = clamp(Math.round(Number(count) || 0), 0, 20);
      state.params[type === 'UAM' ? 'uamCount' : 'uavCount'] = target;
      const current = state.drones.filter(d => !d.visitor && d.aircraftType === type).length;
      for (let i = current; i < target; i++) {
        // UAMs take pads from the front of the list, UAV groups fill from the back, so the two never share a pad at start.
        const n = state.stations.length, home = state.stations[type === 'UAM' ? i % n : (((n - 1 - Math.floor(i / 3)) % n) + n) % n];
        const d = createDrone(home,type);
        d.callsign = type + '-' + String(droneSeq).padStart(2,'0');
        d.cruiseAltitude = type === 'UAM' ? 1000 : 750;
        if (state.tick === 0 && (type === 'UAV' || i < 3) && canAccept(state,home,d)) {
          d.dockSlot = type === 'UAM' ? -1 : assignDockSlot(state,home);
          home.dockedDrones.push(d.id); d.pos = dockSlotPos(home,d.dockSlot);
        } else {
          d.pos = {x: -2400 - droneSeq * 240, y:-1500};
          d.altitude = d.cruiseAltitude; d.currentStationId = null;
          d.missionWaypoint = {...d.pos}; d.missionName = 'Regional patrol';
          enterState(d,state.tick,'onMission',120+i*35,'City mission · regional patrol');
        }
        state.drones.push(d);
      }
    }
    state.params.droneCount = state.params.uamCount + state.params.uavCount;
  }
  function setDroneCount(state,count) {
    setFleetCounts(state,Math.min(3,count),Math.max(0,count-3));
  }
  function trimTraffic(state) {
    for(const type of ['UAM','UAV']) {
      let excess = state.drones.filter(d=>!d.visitor && d.aircraftType===type).length - state.params[type==='UAM'?'uamCount':'uavCount'];
      for(const d of [...state.drones]) if(excess>0 && !d.visitor && d.aircraftType===type && d.state==='idle') {
        const st=findStationById(state,d.currentStationId);
        if(st) st.dockedDrones=st.dockedDrones.filter(id=>id!==d.id);
        state.drones=state.drones.filter(other=>other.id!==d.id); excess--;
      }
    }
  }
  function addDrones(state, n) { setDroneCount(state, state.params.droneCount + Math.max(0, n)); }
  function removeDrones(state, n) { setDroneCount(state, state.params.droneCount - Math.max(0, n)); }

  function logComm(state, { stationName, callsign, direction, channel, text }) {
    state.comms.push({ id: nextId('cm-'), tick: Math.round(state.tick), stationName, callsign, direction, channel, text });
    if (state.comms.length > MAX_COMMS_LOG) state.comms.shift();
  }

  function findDroneById(state, id) { return state.drones.find((d) => d.id === id); }
  function findStationById(state, id) { return state.stations.find((s) => s.id === id); }

  function canAccept(state, station, drone) {
    const occupants = station.dockedDrones.map(id => findDroneById(state, id)).filter(Boolean);
    return drone.aircraftType === 'UAM' ? occupants.length === 0
      : occupants.length < 3 && occupants.every(d => d.aircraftType === 'UAV');
  }

  function occupancyLabel(state, station) {
    const departing = state.drones.find(d => d.state === 'takeoff' && d.targetStationId === station.id);
    if (departing) return `${departing.aircraftType} departing`;
    const occupants = station.dockedDrones.map(id => findDroneById(state, id)).filter(Boolean);
    return occupants.some(d => d.aircraftType === 'UAM') ? 'UAM · whole pad' : `${occupants.length}/3 UAV spaces`;
  }

  // Biased toward the upper arc (open sky above the pads) rather than a full
  // circle, so flights climb into the empty sky instead of skimming sideways
  // through ground clutter around the pads.
  function pickMissionWaypoint(station) {
    const district = global.VahnimCity.districts[randInt(0,global.VahnimCity.districts.length-1)];
    return {...district, x:district.x+randRange(-180,180), y:district.y+randRange(-150,150)};
  }

  function pickReturnStation(state, fromPos, drone) {
    let best = null;
    let bestScore = Infinity;
    state.stations.forEach((s) => {
      const queueLoad = s.dockedDrones.length + s.queue.length;
      const score = dist(fromPos, s) + queueLoad * 180 + (canAccept(state, s, drone) ? 0 : 600);
      if (score < bestScore) { bestScore = score; best = s; }
    });
    return best;
  }

  function enterState(drone, tick, newState, durationTicks, label) {
    drone.state = newState;
    drone.stateEnteredAtTick = tick;
    drone.stateDurationTicks = durationTicks;
    drone.currentTaskLabel = label;
  }

  function dispatchDrone(state, station, drone) {
    station.dockedDrones = station.dockedDrones.filter((id) => id !== drone.id);
    drone.currentStationId = null;
    drone.missionStartTick = state.tick;
    const waypoint = pickMissionWaypoint(station);
    drone.missionWaypoint = waypoint;
    drone.missionName = (drone.aircraftType === 'UAM' ? 'Passenger transfer' : waypoint.task) + ' · ' + waypoint.name;
    logComm(state,{stationName:station.name,callsign:drone.callsign,direction:'toDrone',channel:'mission',text:`${drone.callsign} dispatched: ${drone.missionName}. Cruise corridor ${drone.cruiseAltitude / 10} m.`});
    drone.pathFrom = { ...drone.pos }; // launch from wherever it was actually parked, not the pad center
    drone.pathTo = waypoint;
    const travelTicks = Math.max(1, Math.round(dist(drone.pathFrom, drone.pathTo) / OUTBOUND_SPEED));
    drone.launchPos = { ...drone.pos };
    enterState(drone, state.tick, 'takeoff', 0, 'Vertical departure · climbing to corridor');
  }

  function beginDocking(state, station, drone) {
    if (!canAccept(state, station, drone)) return;
    drone.trafficFloor = 0; drone.avoidUntil = 0;
    drone.dockSlot = drone.aircraftType === 'UAM' ? -1 : assignDockSlot(state, station);
    station.dockedDrones.push(drone.id);
    drone.pathFrom = { ...drone.pos }; // continue smoothly from the holding pattern / queue spot
    drone.pathTo = dockSlotPos(station, drone.dockSlot);
    enterState(drone, state.tick, 'docking', 0, 'Precision approach · aligning over bay');
  }

  function tryDockQueued(state, station) {
    while (station.queue.length > 0 && station.dockedDrones.length < station.capacity && !padBusy(state, station)) {
      const first = findDroneById(state, station.queue[0]);
      if (first && !canAccept(state, station, first)) break;
      const droneId = station.queue.shift();
      const drone = findDroneById(state, droneId);
      if (!drone) continue;
      logComm(state, {
        stationName: station.name, callsign: drone.callsign, direction: 'toDrone', channel: 'arrival',
        text: `Bay open, ${drone.callsign} cleared to land.`
      });
      beginDocking(state, station, drone);
    }
  }

  function recordTurnaround(station, ticks) {
    station.stats.turnaroundTimes.push(ticks);
    if (station.stats.turnaroundTimes.length > 50) station.stats.turnaroundTimes.shift();
  }

  function updateStationHealth(station) {
    const load = station.queue.length;
    if (load >= 3) station.health = 'red';
    else if (load >= 1) station.health = 'yellow';
    else station.health = 'green';
  }

  function maybeFlagIntervention(state, drone) {
    if (drone.battery < LOW_BATTERY_THRESHOLD && !drone.flagged) {
      state.metrics.interventionEvents += 1;
      drone.flagged = true;
    }
  }

  function padBusy(state, station) {
    return state.drones.some(d =>
      (d.state === 'takeoff' && d.targetStationId === station.id) ||
      (d.state === 'docking' && d.targetStationId === station.id));
  }

  // Map units are illustrative metres; integrate bounded velocity at 120 Hz.
  // Braking distance sets desired speed, so arrival is position-driven.
  function fly(drone, target, altitude, dtTicks) {
    const dt = dtTicks * 0.033;
    const avoiding = drone.avoidUntil > drone.simTick;
    if (avoiding) { target = drone.avoidPoint; altitude = drone.avoidAltitude; }
    else if (!['docking','takeoff'].includes(drone.state)) altitude=Math.max(altitude,drone.trafficFloor || 0);
    const dx = target.x - drone.pos.x, dy = target.y - drone.pos.y;
    const distance = Math.hypot(dx, dy);
    const acceleration = drone.aircraftType === 'UAM' ? 25 : 40;
    const speed = Math.min(drone.aircraftType === 'UAM' ? 180 : 140, Math.sqrt(acceleration * distance), distance * .65);
    const vx = distance ? dx / distance * speed : 0;
    const vy = distance ? dy / distance * speed : 0;
    const change = Math.hypot(vx - drone.velocity.x, vy - drone.velocity.y);
    const blend = change ? Math.min(2.5, acceleration / change) : 1;
    const desiredAx = (vx - drone.velocity.x) * blend;
    const desiredAy = (vy - drone.velocity.y) * blend;
    const smoothing = 1 - Math.exp(-dt * 6);
    drone.acceleration.x += (desiredAx - drone.acceleration.x) * smoothing;
    drone.acceleration.y += (desiredAy - drone.acceleration.y) * smoothing;
    drone.velocity.x += drone.acceleration.x * dt;
    drone.velocity.y += drone.acceleration.y * dt;
    drone.pos.x += drone.velocity.x * dt;
    drone.pos.y += drone.velocity.y * dt;
    const dz = altitude - drone.altitude;
    const descentLimit = drone.state === 'docking' && drone.altitude < 8 ? 1.2 : 30;
    const desiredVz = Math.sign(dz) * Math.min(dz < 0 ? Math.min(descentLimit,Math.sqrt(16*Math.abs(dz))) : 40, Math.abs(dz) * 1.5);
    drone.verticalSpeed += clamp(desiredVz - drone.verticalSpeed, -15 * dt, 15 * dt);
    drone.altitude = Math.max(0, drone.altitude + drone.verticalSpeed * dt);
    return !avoiding && distance < 0.08 && Math.hypot(drone.velocity.x, drone.velocity.y) < 0.15 && Math.abs(dz) < 0.08 && Math.abs(drone.verticalSpeed) < .05;
  }

  // Attitude follows thrust: forward/lateral acceleration tilts the aircraft (tan(tilt) = a/g) through a
  // critically damped second-order response. Yaw turns toward the direction of travel at a limited rate and
  // holds heading when the aircraft is (nearly) stationary, so hovering never spins.
  const ATTITUDE = { UAM: { maxTilt: 0.2, omega: 5, yawRate: 0.6, trim: 0.03 }, UAV: { maxTilt: 0.4, omega: 10, yawRate: 1.6, trim: 0.06 } };
  function updateAttitude(d, dtTicks) {
    const dt = dtTicks * 0.033, p = ATTITUDE[d.aircraftType] || ATTITUDE.UAV, airborne = d.altitude > 0.3;
    const speed = Math.hypot(d.velocity.x, d.velocity.y); // map units per second, 10 units = 1 m
    if (airborne && speed > 25) {
      const want = Math.atan2(-d.velocity.x, -d.velocity.y), diff = Math.atan2(Math.sin(want - d.yaw), Math.cos(want - d.yaw));
      d.yawRate += (clamp(diff * 1.2, -p.yawRate, p.yawRate) - d.yawRate) * (1 - Math.exp(-dt * 3));
    } else d.yawRate *= Math.exp(-dt * 3);
    d.yaw += d.yawRate * dt;
    const s = Math.sin(d.yaw), c = Math.cos(d.yaw);
    const aF = (-s * d.acceleration.x - c * d.acceleration.y) * 0.1, aR = (c * d.acceleration.x - s * d.acceleration.y) * 0.1;
    const sway = airborne ? Math.max(0, 1 - speed / 60) * 0.012 : 0, ph = hashPhase(d.id), t = (d.simTick || 0) * 0.033;
    const pitchCmd = airborne ? clamp(-Math.atan2(aF, 9.81) - p.trim * Math.min(1, speed / 150) + sway * Math.sin(t * 1.3 + ph), -p.maxTilt, p.maxTilt) : 0;
    const rollCmd = airborne ? clamp(-Math.atan2(aR, 9.81) + sway * Math.sin(t * 1.7 + ph * 2), -p.maxTilt, p.maxTilt) : 0;
    const w = p.omega;
    d.pitchRate += (w * w * (pitchCmd - d.pitch) - 2 * w * d.pitchRate) * dt; d.pitch += d.pitchRate * dt;
    d.rollRate += (w * w * (rollCmd - d.roll) - 2 * w * d.rollRate) * dt; d.roll += d.rollRate * dt;
  }

  function processDrone(state, drone, dtTicks) {
    drone.simTick = state.tick;
    if (['outbound','onMission','returning'].includes(drone.state) && state.tick >= (drone.nextTelemetry || 0)) {
      drone.nextTelemetry=state.tick+900;
      logComm(state,{stationName:'City network',callsign:drone.callsign,direction:'toStation',channel:drone.state==='returning'?'arrival':'mission',text:`${drone.callsign} ${drone.state==='returning'?'inbound from city':drone.missionName || 'regional transit'}; altitude ${(drone.altitude/10).toFixed(0)} m, battery ${drone.battery.toFixed(0)}%. Link active.`});
    }
    if (['queued', 'awaitingClearance', 'docking'].includes(drone.state)) {
      drone.battery = clamp(drone.battery - 0.008 * dtTicks, 0, 100);
    }
    const elapsed = state.tick - drone.stateEnteredAtTick;
    const t = drone.stateDurationTicks > 0 ? clamp01(elapsed / drone.stateDurationTicks) : 1;

    switch (drone.state) {
      case 'idle': {
        drone.progress = 0;
        const p = DISPATCH_BASE_P + state.params.missionDemand * DISPATCH_DEMAND_P;
        const pFrame = 1 - Math.pow(1 - p, dtTicks); // per-frame chance equivalent to rate p per tick
        if (state.tick > 100 && drone.battery >= MIN_DISPATCH_BATTERY && (drone.visitor || state.drones.filter(d => !d.visitor && d.aircraftType === drone.aircraftType).length <= state.params[drone.aircraftType === 'UAM' ? 'uamCount' : 'uavCount']) && Math.random() < pFrame) {
          const station = findStationById(state, drone.currentStationId);
          if (station && !padBusy(state, station)) {
            logComm(state, {
              stationName: station.name, callsign: drone.callsign, direction: 'toStation', channel: 'departure',
              text: `${drone.callsign} ready for pushback, requesting departure clearance.`
            });
            enterState(
              drone, state.tick, 'awaitingDeparture',
              randInt(DEPARTURE_CLEARANCE_MIN_TICKS, DEPARTURE_CLEARANCE_MAX_TICKS),
              'Requesting departure clearance'
            );
          }
        }
        break;
      }

      case 'awaitingDeparture': {
        drone.progress = t;
        if (t >= 1) {
          const station = findStationById(state, drone.currentStationId);
          if (station && !padBusy(state, station)) {
            logComm(state, {
              stationName: station.name, callsign: drone.callsign, direction: 'toDrone', channel: 'departure',
              text: `${station.name} to ${drone.callsign}: cleared for departure, safe flight.`
            });
            dispatchDrone(state, station, drone);
          }
        }
        break;
      }

      case 'takeoff': {
        drone.battery = clamp(drone.battery - 0.005 * dtTicks, 0, 100);
        if (fly(drone, drone.launchPos, drone.cruiseAltitude, dtTicks)) {
          enterState(drone, state.tick, 'outbound', 0, 'Cruising to mission site');
        }
        break;
      }
      case 'outbound': {
        drone.battery = clamp(drone.battery - FLIGHT_BATTERY_DRAIN * dtTicks, 0, 100);
        const arrived = fly(drone, drone.pathTo, drone.cruiseAltitude, dtTicks);
        drone.progress = t;
        if (arrived) {
          if (drone.visitor) { drone.finished = true; break; }
          logComm(state,{stationName:'City network',callsign:drone.callsign,direction:'toStation',channel:'mission',text:`${drone.callsign} on site: ${drone.missionName}. Mission in progress.`});
          drone.pos = { ...drone.missionWaypoint };
          enterState(drone, state.tick, 'onMission', randInt(MISSION_MIN_TICKS, MISSION_MAX_TICKS), 'Beyond view · city mission');
        }
        break;
      }

      case 'onMission': {
        drone.battery = clamp(drone.battery - MISSION_BATTERY_DRAIN * dtTicks, 0, 100);
        // Fly out, hover still over the site, then return. No orbiting: the aircraft holds position and heading.
        fly(drone, drone.missionWaypoint, drone.cruiseAltitude, dtTicks);
        drone.currentTaskLabel = 'Hovering on site · ' + (drone.missionName || 'mission');
        drone.progress = t;
        if (t >= 1 || drone.battery < 40) {
          const station = pickReturnStation(state, drone.pos, drone);
          drone.targetStationId = station.id;
          logComm(state, {
            stationName: station.name, callsign: drone.callsign, direction: 'toStation', channel: 'handoff',
            text: `${drone.callsign} mission complete: ${drone.missionName}. Leaving city for ${station.name}; requesting inbound sequencing.`
          });
          drone.pathFrom = { ...drone.pos };
          assignApproach(state, station, drone);
          const travelTicks = Math.max(1, Math.round(dist(drone.pathFrom, drone.pathTo) / RETURN_SPEED));
          enterState(drone, state.tick, 'returning', 0, `Returning to ${station.name}`);
        }
        break;
      }

      case 'returning': {
        drone.battery = clamp(drone.battery - FLIGHT_BATTERY_DRAIN * dtTicks, 0, 100);
        const arrived = fly(drone, drone.pathTo, drone.cruiseAltitude + (drone.approachSlot || 0) * 100, dtTicks);
        drone.progress = t;
        if (arrived) {
          const station = findStationById(state, drone.targetStationId);
          logComm(state, {
            stationName: station.name, callsign: drone.callsign, direction: 'toStation', channel: 'arrival',
            text: `${drone.callsign} inbound, requesting clearance to land.`
          });
          enterState(
            drone, state.tick, 'awaitingClearance',
            randInt(ARRIVAL_CLEARANCE_MIN_TICKS, ARRIVAL_CLEARANCE_MAX_TICKS),
            `Requesting landing clearance · ${station.name}`
          );
        }
        break;
      }

      case 'awaitingClearance': {
        // Continuous holding-pattern circle above the pad — radius eases in
        // from 0 so entering the hold is a smooth curve, not a snap onto the
        // circle's edge; this is also the drone's *real* simulated position,
        // so docking afterward starts exactly where the circle left off.
        const station = findStationById(state, drone.targetStationId);
        if (station) {
          const rampT = Math.min(1, t * 5);
          const angle = state.tick * 0.08 + hashPhase(drone.id);
          const r = HOLD_ORBIT_RADIUS * rampT;
          fly(drone, drone.pathTo, drone.cruiseAltitude + (drone.approachSlot || 0) * 100, dtTicks);
        }
        drone.progress = t;
        if (t >= 1 && station) {
          if (canAccept(state, station, drone) && !padBusy(state, station) && station.queue.length === 0) {
            logComm(state, {
              stationName: station.name, callsign: drone.callsign, direction: 'toDrone', channel: 'arrival',
              text: `${station.name} to ${drone.callsign}: cleared to land, proceed to bay.`
            });
            beginDocking(state, station, drone);
          } else {
            station.queue.push(drone.id);
            logComm(state, {
              stationName: station.name, callsign: drone.callsign, direction: 'toDrone', channel: 'arrival',
              text: `${station.name} to ${drone.callsign}: hold pattern, queue position ${station.queue.length}.`
            });
            enterState(drone, state.tick, 'queued', 0, `Queued at ${station.name}`);
          }
        }
        break;
      }

      case 'queued': {
        drone.progress = 0;
        const station = findStationById(state, drone.targetStationId);
        if (station) {
          const idx = Math.max(0, station.queue.indexOf(drone.id));
          const target = drone.pathTo;
          // Ease toward the current queue slot rather than snapping — the
          // target itself shifts forward as drones ahead get cleared to land.
          fly(drone, target, drone.cruiseAltitude + (drone.approachSlot || 0) * 100, dtTicks);
          drone.currentTaskLabel = `Queued at ${station.name} · position ${idx + 1}`;
        }
        break;
      }

      case 'docking': {
        const aligned = dist(drone.pos, drone.pathTo) < 1 && Math.hypot(drone.velocity.x, drone.velocity.y) < 1;
        const landed = fly(drone, drone.pathTo, aligned ? 0 : drone.cruiseAltitude, dtTicks);
        drone.currentTaskLabel = aligned ? (drone.altitude < 8 ? 'Landing flare · gentle touchdown' : 'Vertical descent · bay locked') : 'Precision approach · aligning over bay';
        drone.progress = t;
        if (landed && aligned) {
          const station = findStationById(state, drone.targetStationId);
          drone.currentStationId = station.id;
          drone.pos = dockSlotPos(station, drone.dockSlot);
          drone.altitude = 0;
          drone.verticalSpeed = 0;
          drone.velocity = { x: 0, y: 0 };
          drone.acceleration = { x: 0, y: 0 };
          logComm(state, { stationName: station.name, callsign: drone.callsign, direction: 'toStation', channel: 'service', text: `${drone.callsign} touchdown confirmed. Propulsion winding down; service connection established.` });
          maybeFlagIntervention(state, drone);
          drone.stateEnteredBattery = drone.battery;
          const charging = station.mode === 'charge';
          enterState(
            drone, state.tick,
            charging ? 'charging' : 'swapping',
            charging ? CHARGE_DURATION_TICKS : SWAP_DURATION_TICKS,
            charging ? 'Charging in dock' : 'Battery swap in progress'
          );
          recordTurnaround(station, state.tick - drone.missionStartTick);
        }
        break;
      }

      case 'charging':
      case 'swapping': {
        const startBattery = drone.stateEnteredBattery != null ? drone.stateEnteredBattery : drone.battery;
        drone.battery = lerp(startBattery, 100, t);
        drone.progress = t;
        if (t >= 1) {
          drone.battery = 100;
          enterState(drone, state.tick, 'uploading', UPLOAD_DURATION_TICKS, 'Uploading mission data');
        }
        break;
      }

      case 'uploading': {
        drone.progress = t;
        if (t >= 1) {
          const station = findStationById(state, drone.currentStationId);
          drone.missionsCompleted += 1;
          state.metrics.missionsCompleted += 1;
          state.metrics.timeSavedMinutes += TIME_SAVED_PER_MISSION_MIN;
          state.metrics.costSavedUsd += COST_SAVED_PER_MISSION_USD;
          if (station) station.stats.totalServed += 1;
          maybeFlagIntervention(state, drone);
          enterState(drone, state.tick, 'redeploying', REDEPLOY_DURATION_TICKS, 'Pre-flight checks');
        }
        break;
      }

      case 'redeploying': {
        drone.progress = t;
        if (t >= 1) {
          drone.flagged = false;
          enterState(drone, state.tick, 'idle', 0, 'Docked · standby');
        }
        break;
      }
    }
  }

  // A single fixed integration step, invoked by the public accumulator.
  function step(state, params, dtTicks) {
    const dt = dtTicks != null ? dtTicks : 1;
    state.tick += dt;
    if (params) {
      if ((params.uamCount != null && params.uamCount !== state.params.uamCount) || (params.uavCount != null && params.uavCount !== state.params.uavCount)) setFleetCounts(state,params.uamCount ?? state.params.uamCount,params.uavCount ?? state.params.uavCount);
      if (params.droneCount != null && params.droneCount !== state.params.droneCount) {
        setDroneCount(state, params.droneCount);
      }
      if (params.missionDemand != null) state.params.missionDemand = params.missionDemand;
      if (params.mode != null && params.mode !== state.params.mode) applyMode(state, params.mode);
    }

    if (state.visitorTraffic && state.tick >= state.nextVisitorTick) {
      state.nextVisitorTick = state.tick + 1100;
      if (state.drones.filter(d => d.visitor).length < 2) {
        const home = state.stations[0];
        const visitor = createDrone(home, 'UAV');
        visitor.visitor = true;
        visitor.callsign = 'VIS-' + visitor.id.slice(3);
        visitor.pos = { x: -4000 - droneSeq * 200, y: -2500 };
        visitor.cruiseAltitude = 750;
        visitor.altitude = 750;
        visitor.currentStationId = null;
        const station = pickReturnStation(state, visitor.pos, visitor);
        visitor.targetStationId = station.id;
        visitor.pathFrom = { ...visitor.pos };
        assignApproach(state, station, visitor);
        enterState(visitor, state.tick, 'returning', 0, 'Regional visitor · inbound for service');
        state.drones.push(visitor);
        logComm(state, { stationName: station.name, callsign: visitor.callsign, direction: 'toStation', channel: 'arrival',
          text: `${visitor.callsign} entering city corridor, requesting service at ${station.name}.` });
      }
    }
    state.stations.forEach((station) => {
      station.stats.totalTicks += dt;
      if (station.health !== 'red') station.stats.upTicks += dt;
      updateStationHealth(station);
      tryDockQueued(state, station);
    });

    global.VahnimTraffic.plan(state,logComm);
    const positions = new Map(state.drones.map(d=>[d.id,{x:d.pos.x,y:d.pos.y,z:d.altitude}]));
    state.drones.forEach((drone) => processDrone(state, drone, dt));
    global.VahnimTraffic.guard(state,positions);
    state.drones.forEach((drone) => updateAttitude(drone, dt));
    state.drones = state.drones.filter(d => !d.finished);
    trimTraffic(state);

    return state;
  }

  function simTick(state, params, dtTicks = 1) {
    if (!Number.isFinite(dtTicks) || dtTicks < 0) throw new Error('Invalid timestep');
    state.accumulator = (state.accumulator || 0) + dtTicks;
    const fixed = 1 / (120 * 0.033);
    while (state.accumulator >= fixed) {
      step(state, params, fixed);
      state.accumulator -= fixed;
    }
    return state;
  }

  function averageTurnaroundTicks(station) {
    const samples = station.stats.turnaroundTimes;
    if (!samples.length) return 0;
    return samples.reduce((a, b) => a + b, 0) / samples.length;
  }

  function stationUptimePercent(station) {
    if (!station.stats.totalTicks) return 100;
    return (station.stats.upTicks / station.stats.totalTicks) * 100;
  }

  function fleetUptimePercent(state) {
    if (!state.stations.length) return 100;
    const sum = state.stations.reduce((a, s) => a + stationUptimePercent(s), 0);
    return sum / state.stations.length;
  }

  global.GroundNodeSim = {
    createInitialState,
    simTick,
    setDroneCount,
    setFleetCounts,
    addDrones,
    removeDrones,
    applyMode,
    findDroneById,
    findStationById,
    averageTurnaroundTicks,
    stationUptimePercent,
    fleetUptimePercent,
    canAccept, occupancyLabel,
    constants: {
      MAP_W, MAP_H, STATION_CAPACITY,
      CHARGE_DURATION_TICKS, SWAP_DURATION_TICKS,
      DOCKING_DURATION_TICKS, UPLOAD_DURATION_TICKS, REDEPLOY_DURATION_TICKS
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);



