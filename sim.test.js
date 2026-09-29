const assert = require('node:assert/strict');
require('./city.js'); require('./traffic.js'); require('./sim.js');
const Sim = globalThis.GroundNodeSim;
let seed = 913;
Math.random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
const initial = Sim.createInitialState();
assert.equal(initial.drones.filter(d => d.aircraftType === 'UAM').length, 3);
assert.equal(initial.drones.filter(d => d.aircraftType === 'UAV').length, 5);
assert.equal(initial.stations.length, 5, 'Five pads');
assert.equal(initial.stations[4].dockedDrones.length, 3);
assert.equal(initial.stations[3].dockedDrones.length, 2);
assert.equal(initial.stations.filter(s => s.dockedDrones.some(id => Sim.findDroneById(initial, id).aircraftType === 'UAM')).length, 3, 'Three UAMs on three pads');
assert.equal(Sim.canAccept(initial, initial.stations[0], { aircraftType: 'UAV' }), false);
assert.equal(Sim.canAccept(initial, initial.stations[2], { aircraftType: 'UAM' }), false);
assert.equal(Sim.canAccept(initial, initial.stations[2], { aircraftType: 'UAV' }), false);
assert.equal(Sim.canAccept(initial, initial.stations[3], { aircraftType: 'UAV' }), true, 'Partly filled UAV pad accepts one more UAV');
assert.equal(Sim.canAccept(initial, initial.stations[3], { aircraftType: 'UAM' }), false);
const state = Sim.createInitialState({ droneCount: 20, missionDemand: 1, mode: 'swap', visitorTraffic: false });
let takeoffs = 0, landings = 0;
for (let i = 0; i < 60000; i++) {
  const before = new Map(state.drones.map(d => [d.id, { ...d.pos, phase: d.state, verticalSpeed: d.verticalSpeed }]));
  Sim.simTick(state, null, 0.25);
  for(let a=0;a<state.drones.length;a++) for(let b=a+1;b<state.drones.length;b++) {
    const d=state.drones[a],e=state.drones[b],s=globalThis.VahnimTraffic.separation(d,e);
    assert(Math.hypot((d.pos.x-e.pos.x)/s.h,(d.pos.y-e.pos.y)/s.h,(d.altitude-e.altitude)/s.v)>=.999,'Aircraft safety volumes must not overlap');
  }
  for (const d of state.drones) {
    const previous = before.get(d.id);
    assert(Number.isFinite(d.altitude) && d.altitude >= 0);
    assert(d.battery >= 0 && d.battery <= 100);
    assert(Math.hypot(d.acceleration.x, d.acceleration.y) <= (d.aircraftType === 'UAM' ? 35 : 45) + 1e-6, 'Bounded horizontal acceleration');
    if (previous.phase === 'takeoff' && d.state === 'takeoff') assert(Math.hypot(d.pos.x - previous.x, d.pos.y - previous.y) < .001, 'Vertical takeoff holds launch position');
    if (previous.phase === 'docking' && d.state === 'swapping') assert(Math.abs(previous.verticalSpeed) < .2, 'Touchdown must be gentle');
    assert(Math.hypot(d.pos.x - previous.x, d.pos.y - previous.y) < 2, 'Position discontinuity');
    if (previous.phase !== 'takeoff' && d.state === 'takeoff') takeoffs++;
    if (previous.phase === 'docking' && d.state === 'swapping') landings++;
  }
  for (const s of state.stations) {
    const occupants = s.dockedDrones.map(id => Sim.findDroneById(state, id));
    const inbound = state.drones.filter(d => d.targetStationId === s.id && ['returning','awaitingClearance','queued'].includes(d.state));
    assert.equal(new Set(inbound.map(d => d.approachSlot)).size, inbound.length, 'Unique arrival holding fixes');
    if (occupants.some(d => d.aircraftType === 'UAM')) assert.equal(occupants.length, 1, 'UAM requires whole pad');
    assert(s.dockedDrones.length <= s.capacity);
    assert.equal(new Set(s.dockedDrones).size, s.dockedDrones.length);
    assert.equal(new Set(s.dockedDrones.map(id => Sim.findDroneById(state, id).dockSlot)).size, s.dockedDrones.length);
    assert(state.drones.filter(d => d.targetStationId === s.id && ['takeoff', 'docking'].includes(d.state)).length <= 1);
  }
}
assert(takeoffs > 3 && landings > 3, 'Traffic must complete flight cycles');
Sim.setDroneCount(state, 2);
for (let i = 0; i < 140000 && state.drones.length > 2; i++) Sim.simTick(state, null, 0.25);
assert.equal(state.drones.length, 2, 'Fleet reduction must converge');
assert.throws(() => Sim.simTick(state, null, NaN));
console.log(`PASS: ${takeoffs} departures, ${landings} landings; bounded motion, bay exclusivity, battery, fleet retirement.`);
const visitors = new Set();
let visitorLanded = false, visitorDeparted = false, distantMission = false;
for (let i = 0; i < 100000; i++) {
  Sim.simTick(initial, null, 0.25);
  assert.equal(initial.drones.filter(d => !d.visitor).length, 8);
  assert(initial.drones.filter(d => d.visitor).length <= 2);
  for (const d of initial.drones) {
    if (d.visitor) {
      visitors.add(d.id);
      if (d.state === 'charging') visitorLanded = true;
    }
    if (!d.visitor && d.state === 'onMission' && (d.pos.x < 0 || d.pos.x > initial.mapW)) distantMission = true;
  }
  if ([...visitors].some(id => !initial.drones.some(d => d.id === id))) visitorDeparted = true;
  for (const s of initial.stations) {
    const occupants = s.dockedDrones.map(id => Sim.findDroneById(initial, id));
    assert(occupants.length <= 3);
    if (occupants.some(d => d.aircraftType === 'UAM')) assert.equal(occupants.length, 1);
  }
}
assert(visitorLanded && visitorDeparted && distantMission);
console.log('PASS: 3 UAM / 5 UAV preset, regional visitor landing and departure, distant city missions.');
const encounter=Sim.createInitialState({uamCount:1,uavCount:1,visitorTraffic:false});
encounter.stations.forEach(s=>s.dockedDrones=[]);
for(const [i,d] of encounter.drones.entries()) {
  d.state='outbound';d.pos={x:i?1000:0,y:-2000};d.pathTo={x:i?0:1000,y:-2000};d.missionWaypoint={...d.pathTo};d.altitude=750;d.cruiseAltitude=750;d.currentStationId=null;
}
for(let i=0;i<12000;i++) {
  Sim.simTick(encounter,null,.25);
  const [a,b]=encounter.drones,s=globalThis.VahnimTraffic.separation(a,b);
  assert(Math.hypot((a.pos.x-b.pos.x)/s.h,(a.pos.y-b.pos.y)/s.h,(a.altitude-b.altitude)/s.v)>=.999,'Head-on encounter remains separated');
}
assert(encounter.metrics.conflictResolutions>0,'Predictive avoidance must activate');
Sim.setFleetCounts(encounter,4,7);
assert.equal(encounter.drones.filter(d=>d.aircraftType==='UAM').length,4);
assert.equal(encounter.drones.filter(d=>d.aircraftType==='UAV').length,7);
console.log('PASS: head-on avoidance, saturated-fleet separation, independent UAM/UAV counts.');



// Flight feel: fly out, hover still, return. Bounded tilt, limited yaw rate, no spinning in hover.
{
  const s = Sim.createInitialState({ uamCount: 2, uavCount: 4, missionDemand: 1, visitorTraffic: false });
  const lastYaw = new Map(), hoverStart = new Map(); let hoverSamples = 0, maxYawRate = 0, maxTilt = 0, hoverDrift = 0, hoverYawTurn = 0;
  for (let i = 0; i < 40000; i++) {
    Sim.simTick(s, null, 0.25);
    for (const d of s.drones) {
      assert(Number.isFinite(d.yaw + d.pitch + d.roll), 'Finite attitude');
      maxTilt = Math.max(maxTilt, Math.abs(d.pitch), Math.abs(d.roll));
      assert(Math.abs(d.pitch) <= (d.aircraftType === 'UAM' ? .25 : .5) && Math.abs(d.roll) <= (d.aircraftType === 'UAM' ? .25 : .5), 'Bounded tilt');
      maxYawRate = Math.max(maxYawRate, Math.abs(d.yawRate));
      if (d.state === 'onMission') {
        const h = hoverStart.get(d.id) || { tick: s.tick, yaw: d.yaw }; hoverStart.set(d.id, h);
        if (s.tick - h.tick > 150) { hoverSamples++; hoverDrift = Math.max(hoverDrift, Math.hypot(d.pos.x - d.missionWaypoint.x, d.pos.y - d.missionWaypoint.y)); hoverYawTurn = Math.max(hoverYawTurn, Math.abs(d.yaw - h.yaw)); }
      } else hoverStart.delete(d.id);
    }
  }
  assert(hoverSamples > 50, 'Aircraft reach and hold mission sites');
  assert(hoverDrift < 3, 'Hover holds position (units): ' + hoverDrift.toFixed(2));
  assert(hoverYawTurn < 0.3, 'Hover holds heading (rad): ' + hoverYawTurn.toFixed(2));
  assert(maxYawRate <= 1.65, 'Yaw rate limited: ' + maxYawRate.toFixed(2));
  console.log(`PASS: fly-hover-return feel — max tilt ${(maxTilt * 57.3).toFixed(1)} deg, hover drift ${hoverDrift.toFixed(2)} units, hover heading change ${hoverYawTurn.toFixed(2)} rad.`);
}
