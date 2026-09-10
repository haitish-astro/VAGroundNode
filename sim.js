// GroundNode Live — core simulation engine.
// Pure state/logic, no DOM access. simTick(state, params, dtTicks) advances
// by a *continuous* dtTicks (nominal: 1 tick ≈ 33ms of real time) — exactly
// one call per animation frame, scaled to that frame's real elapsed time.
// Durations/speeds below are still expressed "per tick" for readability, but
// nothing assumes a fixed tick size, so motion stays smooth at any frame rate.
(function (global) {
  'use strict';

  // 16:9 to match vertipad-bg-v1.png's aspect ratio so station coordinates
  // (below) line up with the pads actually rendered in that image.
  const MAP_W = 1600;
  const MAP_H = 900;

  const STATION_CAPACITY = 4;
  const CHARGE_DURATION_TICKS = 220; // charge-in-place dwell
  const SWAP_DURATION_TICKS = 35;    // battery-swap dwell
  const DOCKING_DURATION_TICKS = 18;
  const UPLOAD_DURATION_TICKS = 25;
  const REDEPLOY_DURATION_TICKS = 12;

  const OUTBOUND_SPEED = 6.0; // map units / tick
  const RETURN_SPEED = 6.0;
  const MISSION_MIN_TICKS = 60;
  const MISSION_MAX_TICKS = 160;

  const FLIGHT_BATTERY_DRAIN = 0.18;  // % per tick while outbound/returning
  const MISSION_BATTERY_DRAIN = 0.10; // % per tick while on mission
  const LOW_BATTERY_THRESHOLD = 20;
  const MIN_DISPATCH_BATTERY = 30;
  const DISPATCH_BASE_P = 0.004; // per-tick dispatch chance at 0 demand
  const DISPATCH_DEMAND_P = 0.02; // additional per-tick chance at max demand

  const INTERVENTION_BASE_RATE = 0.06; // chance per mission completion, early on
  const INTERVENTION_DECAY = 0.985;    // multiplies rate after each mission -> trends to 0

  const TIME_SAVED_PER_MISSION_MIN = 42; // illustrative: manual round trip vs autonomous
  const COST_SAVED_PER_MISSION_USD = 65; // illustrative

  const DEPARTURE_CLEARANCE_MIN_TICKS = 6;
  const DEPARTURE_CLEARANCE_MAX_TICKS = 14;
  const ARRIVAL_CLEARANCE_MIN_TICKS = 5;
  const ARRIVAL_CLEARANCE_MAX_TICKS = 12;
  const HOLD_ORBIT_RADIUS = 80; // map units — "holding pattern" circle above the pad
  const MAX_COMMS_LOG = 60;

  // Dock slots sit within the pad's real visual radius (~120 map units),
  // spread enough that parked/charging sprites don't overlap each other.
  const SLOT_OFFSETS = [
    { dx: -55, dy: -38 }, { dx: 55, dy: -38 },
    { dx: -55, dy: 38 }, { dx: 55, dy: 38 }
  ];

  // Pixel-measured against assets/vertipad-bg-v1.png (1672x941), then scaled
  // to MAP_W x MAP_H — these line up with the 3 physical pads in that render.
  const DEFAULT_STATIONS = [
    { name: 'GN-01 Pad A', x: 402, y: 550 },
    { name: 'GN-02 Pad B', x: 1211, y: 579 },
    { name: 'GN-03 Pad C', x: 822, y: 717 }
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
  function createDrone(homeStation) {
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
      flagged: false
    };
  }

  function createInitialState(options) {
    const opts = options || {};
    const stationDefs = opts.stationDefs || DEFAULT_STATIONS;
    const droneCount = opts.droneCount != null ? opts.droneCount : 6;
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
      metrics: {
        missionsCompleted: 0,
        interventionEvents: 0,
        interventionRate: INTERVENTION_BASE_RATE,
        timeSavedMinutes: 0,
        costSavedUsd: 0
      },
      params: { droneCount: 0, missionDemand, mode }
    };

    setDroneCount(state, droneCount);
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
    const o = SLOT_OFFSETS[slot % SLOT_OFFSETS.length];
    return { x: station.x + o.dx, y: station.y + o.dy };
  }

  function queueSlotPos(station, idx) {
    return { x: station.x + 95, y: station.y - 50 - idx * 24 };
  }

  function setDroneCount(state, count) {
    const target = Math.max(0, count);
    state.params.droneCount = target;
    const current = state.drones.length;

    if (target > current) {
      for (let i = current; i < target; i++) {
        const home = state.stations[i % state.stations.length];
        const drone = createDrone(home);
        if (home.dockedDrones.length < home.capacity) {
          drone.dockSlot = assignDockSlot(state, home);
          home.dockedDrones.push(drone.id);
          drone.pos = dockSlotPos(home, drone.dockSlot);
        } else {
          drone.state = 'queued';
          home.queue.push(drone.id);
        }
        state.drones.push(drone);
      }
    }
    // Shrinking never yanks a drone mid-flight — trimTraffic() sweeps idle
    // drones toward the target continuously, every tick, as they land.
  }

  // Called once per tick. If the fleet is above target, retires idle drones
  // (never mid-flight) until it converges — trimming isn't a one-shot filter
  // at the moment the slider moves, since not enough drones may be idle then.
  function trimTraffic(state) {
    let excess = state.drones.length - state.params.droneCount;
    if (excess <= 0) return;
    for (let i = 0; i < state.drones.length && excess > 0; i++) {
      const drone = state.drones[i];
      if (drone.state !== 'idle') continue;
      const station = findStationById(state, drone.currentStationId);
      if (station) station.dockedDrones = station.dockedDrones.filter((id) => id !== drone.id);
      state.drones.splice(i, 1);
      i -= 1;
      excess -= 1;
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

  // Biased toward the upper arc (open sky above the pads) rather than a full
  // circle, so flights climb into the empty sky instead of skimming sideways
  // through ground clutter around the pads.
  function pickMissionWaypoint(station) {
    const angle = randRange(-Math.PI * 0.95, -Math.PI * 0.05);
    const radius = randRange(140, 380);
    return {
      x: clamp(station.x + Math.cos(angle) * radius, 20, MAP_W - 20),
      y: clamp(station.y + Math.sin(angle) * radius, 20, MAP_H - 20)
    };
  }

  function pickReturnStation(state, fromPos) {
    let best = null;
    let bestScore = Infinity;
    state.stations.forEach((s) => {
      const queueLoad = s.dockedDrones.length + s.queue.length;
      const score = dist(fromPos, s) + queueLoad * 40;
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
    drone.pathFrom = { ...drone.pos }; // launch from wherever it was actually parked, not the pad center
    drone.pathTo = waypoint;
    const travelTicks = Math.max(1, Math.round(dist(drone.pathFrom, drone.pathTo) / OUTBOUND_SPEED));
    enterState(drone, state.tick, 'outbound', travelTicks, 'Outbound to mission site');
  }

  function beginDocking(state, station, drone) {
    drone.dockSlot = assignDockSlot(state, station);
    station.dockedDrones.push(drone.id);
    drone.pathFrom = { ...drone.pos }; // continue smoothly from the holding pattern / queue spot
    drone.pathTo = dockSlotPos(station, drone.dockSlot);
    enterState(drone, state.tick, 'docking', DOCKING_DURATION_TICKS, 'Docking sequence');
  }

  function tryDockQueued(state, station) {
    while (station.queue.length > 0 && station.dockedDrones.length < station.capacity) {
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
    const rate = state.metrics.interventionRate;
    const lowBattery = drone.battery < LOW_BATTERY_THRESHOLD;
    const roll = Math.random();
    if (roll < rate || (lowBattery && roll < rate * 3)) {
      state.metrics.interventionEvents += 1;
      drone.flagged = true;
    }
    state.metrics.interventionRate = Math.max(0.002, rate * INTERVENTION_DECAY);
  }

  function processDrone(state, drone, dtTicks) {
    const elapsed = state.tick - drone.stateEnteredAtTick;
    const t = drone.stateDurationTicks > 0 ? clamp01(elapsed / drone.stateDurationTicks) : 1;

    switch (drone.state) {
      case 'idle': {
        drone.progress = 0;
        const p = DISPATCH_BASE_P + state.params.missionDemand * DISPATCH_DEMAND_P;
        const pFrame = 1 - Math.pow(1 - p, dtTicks); // per-frame chance equivalent to rate p per tick
        if (drone.battery >= MIN_DISPATCH_BATTERY && Math.random() < pFrame) {
          const station = findStationById(state, drone.currentStationId);
          if (station) {
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
          if (station) {
            logComm(state, {
              stationName: station.name, callsign: drone.callsign, direction: 'toDrone', channel: 'departure',
              text: `${station.name} to ${drone.callsign}: cleared for departure, safe flight.`
            });
            dispatchDrone(state, station, drone);
          }
        }
        break;
      }

      case 'outbound': {
        drone.battery = clamp(drone.battery - FLIGHT_BATTERY_DRAIN * dtTicks, 0, 100);
        drone.pos = lerpPoint(drone.pathFrom, drone.pathTo, t);
        drone.progress = t;
        if (t >= 1) {
          drone.pos = { ...drone.missionWaypoint };
          enterState(drone, state.tick, 'onMission', randInt(MISSION_MIN_TICKS, MISSION_MAX_TICKS), 'On mission · scanning site');
        }
        break;
      }

      case 'onMission': {
        drone.battery = clamp(drone.battery - MISSION_BATTERY_DRAIN * dtTicks, 0, 100);
        // Gentle loiter/scan drift around the waypoint instead of freezing in
        // place for the whole mission — reads as an active hover, not a stall.
        const hoverAngle = state.tick * 0.05 + hashPhase(drone.id);
        drone.pos = {
          x: drone.missionWaypoint.x + Math.cos(hoverAngle) * 16,
          y: drone.missionWaypoint.y + Math.sin(hoverAngle) * 10
        };
        drone.progress = t;
        if (t >= 1) {
          const station = pickReturnStation(state, drone.pos);
          drone.targetStationId = station.id;
          drone.pathFrom = { ...drone.pos };
          drone.pathTo = { x: station.x, y: station.y };
          const travelTicks = Math.max(1, Math.round(dist(drone.pathFrom, drone.pathTo) / RETURN_SPEED));
          enterState(drone, state.tick, 'returning', travelTicks, `Returning to ${station.name}`);
        }
        break;
      }

      case 'returning': {
        drone.battery = clamp(drone.battery - FLIGHT_BATTERY_DRAIN * dtTicks, 0, 100);
        drone.pos = lerpPoint(drone.pathFrom, drone.pathTo, t);
        drone.progress = t;
        if (t >= 1) {
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
          drone.pos = { x: station.x + Math.cos(angle) * r, y: station.y + Math.sin(angle) * r * 0.6 };
        }
        drone.progress = t;
        if (t >= 1 && station) {
          if (station.dockedDrones.length < station.capacity) {
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
          const target = queueSlotPos(station, idx);
          // Ease toward the current queue slot rather than snapping — the
          // target itself shifts forward as drones ahead get cleared to land.
          const ease = 1 - Math.pow(0.02, dtTicks);
          drone.pos = lerpPoint(drone.pos, target, ease);
          drone.currentTaskLabel = `Queued at ${station.name} · position ${idx + 1}`;
        }
        break;
      }

      case 'docking': {
        drone.pos = lerpPoint(drone.pathFrom, drone.pathTo, t);
        drone.progress = t;
        if (t >= 1) {
          const station = findStationById(state, drone.targetStationId);
          drone.currentStationId = station.id;
          drone.pos = dockSlotPos(station, drone.dockSlot);
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

  // dtTicks: continuous elapsed time for this call, in nominal ticks (1 tick
  // ≈ 33ms). Call exactly once per animation frame with the real elapsed
  // time — never in a catch-up loop — so motion always matches wall-clock
  // time 1:1 and never bursts forward after a stutter.
  function simTick(state, params, dtTicks) {
    const dt = dtTicks != null ? dtTicks : 1;
    state.tick += dt;
    if (params) {
      if (params.droneCount != null && params.droneCount !== state.params.droneCount) {
        setDroneCount(state, params.droneCount);
      }
      if (params.missionDemand != null) state.params.missionDemand = params.missionDemand;
      if (params.mode != null && params.mode !== state.params.mode) applyMode(state, params.mode);
    }

    state.stations.forEach((station) => {
      station.stats.totalTicks += dt;
      if (station.health !== 'red') station.stats.upTicks += dt;
      updateStationHealth(station);
      tryDockQueued(state, station);
    });

    state.drones.forEach((drone) => processDrone(state, drone, dt));
    trimTraffic(state);

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
    addDrones,
    removeDrones,
    applyMode,
    findDroneById,
    findStationById,
    averageTurnaroundTicks,
    stationUptimePercent,
    fleetUptimePercent,
    constants: {
      MAP_W, MAP_H, STATION_CAPACITY,
      CHARGE_DURATION_TICKS, SWAP_DURATION_TICKS,
      DOCKING_DURATION_TICKS, UPLOAD_DURATION_TICKS, REDEPLOY_DURATION_TICKS
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
