import { createSmartPad } from './pad-model.js';
import { createAircraft, createSkyEnvironment } from './aircraft-model.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';



const Sim = window.GroundNodeSim;
const SCALE = 0.1;
const point = (p, altitude = 0) => new THREE.Vector3((p.x - 800) * SCALE, altitude * SCALE + 1.2, (p.y - 450) * SCALE);
const material = (color, metalness = 0.2) => new THREE.MeshStandardMaterial({ color, metalness, roughness: 0.6 });
const white = material('#d9e6ea'), dark = material('#182c39'), orange = material('#ff792b'), glass = material('#123e53', 0.6);
const scene_env = () => window.__sceneEnv || null;
function disposeGroup(group) {
  if (group.userData.imported) return; // Clones share the template's resources.
  const geometries = new Set(), materials = new Set();
  group.traverse(o => { if (o.geometry && !o.geometry.userData.keep) geometries.add(o.geometry); if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m); });
  geometries.forEach(g => g.dispose());
  materials.forEach(m => { if (![white, dark, orange, glass].includes(m)) { for (const v of Object.values(m)) if (v?.isTexture && !v.userData.keep && v !== scene_env()) v.dispose(); m.dispose(); } });
}

function mesh(parent, geometry, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geometry, mat);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}
const box = (p, w, h, d, mat, x, y, z) => mesh(p, new THREE.BoxGeometry(w, h, d), mat, x, y, z);

function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
  const scene = new THREE.Scene(); scene.fog = new THREE.Fog('#cfe0e8', 400, 1500);
  const sky = createSkyEnvironment(renderer); scene.environment = sky.envMap; window.__sceneEnv = sky.envMap; scene.add(sky.dome);
  const camera = new THREE.PerspectiveCamera(45, 1, .1, 2500);
  const controls = new OrbitControls(camera, canvas); controls.enableDamping = true; controls.maxPolarAngle = Math.PI * .48; controls.minDistance = 12; controls.maxDistance = 1100;
  const overview = () => { camera.position.set(130, 115, 170); controls.target.set(0, 0, 0); controls.update(); };
  overview();
  scene.add(new THREE.HemisphereLight('#e5f5ff', '#6a7265', 2.5));
  const sun = new THREE.DirectionalLight('#fff0d9', 3.2); sun.position.set(-80, 150, 60); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -130, right: 130, top: 110, bottom: -110, near: 1, far: 400 }); sun.shadow.bias = -.0003; scene.add(sun);
  const environment = new THREE.Group(); scene.add(environment);
  box(environment, 1300, 1, 1500, material('#71817e'), 0, -.8, -200);
  box(environment, 300, .2, 150, material('#46575e'), 0, -.15, 30);
  const roadMat = material('#283943'), buildingMats = ['#77929d', '#536f7f', '#a5b6bb', '#667b88'].map(c => material(c));
  const windowPositions = [];
  for (let row=0;row<11;row++) box(environment,850,.1,12,roadMat,0,-.2,-63-row*52);
  for (let col=-8;col<=8;col++) box(environment,10,.1,650,roadMat,col*45+22.5,-.19,-320);
  for (const [i,b] of window.VahnimCity.buildings.entries()) {
    box(environment,b.width,b.height,b.depth,buildingMats[i%4],b.x,b.height/2,b.z);
    box(environment,12,2,13,dark,b.x,b.height+1,b.z);
    for(let level=3;level<b.height-1;level+=4) windowPositions.push([b.x,level,b.z+13.6]);
  }
  for(const district of window.VahnimCity.districts) {
    const labelCanvas=document.createElement('canvas');labelCanvas.width=512;labelCanvas.height=80;
    const context=labelCanvas.getContext('2d'); context.fillStyle='#112a36';context.fillRect(0,0,512,80);context.fillStyle='#9ef4e4';context.font='bold 27px system-ui';context.textAlign='center';context.fillText(district.name,256,49);
    const label=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(labelCanvas)})); label.position.copy(point(district,650));label.scale.set(50,8,1);environment.add(label);
  }  const windows = new THREE.InstancedMesh(new THREE.BoxGeometry(23, 1.3, .12), glass, windowPositions.length);
  windowPositions.forEach((p,i) => windows.setMatrixAt(i, new THREE.Matrix4().makeTranslation(...p))); environment.add(windows);
  for (let x = -120; x <= 120; x += 12) box(environment, 5, .02, .25, white, x, .02, 74);
  const pads = new Map(), fleet = new Map(), links = new Map();
  const raycaster = new THREE.Raycaster();
  let cameraMode = 'overview', lastTick = 0, lastFrame = performance.now();
  function pad(station) {
    const entry=createSmartPad(station.name);
    entry.group.position.copy(point(station,0));entry.group.position.y=0;
    entry.group.userData.entity=station.id;scene.add(entry.group);pads.set(station.id,entry);
  }
  function resize() {
    const { width, height } = canvas.getBoundingClientRect();
    renderer.setSize(Math.max(1, width), Math.max(1, height), false);
    camera.aspect = width / Math.max(1, height); camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas); resize();
  document.getElementById('cameraMode').addEventListener('change', e => { cameraMode = e.target.value; if (cameraMode === 'overview') overview(); if(cameraMode === 'city') {camera.position.set(330,330,300);controls.target.set(0,25,-220);controls.update();} });
  document.getElementById('cameraHome').onclick = () => { cameraMode = 'overview'; document.getElementById('cameraMode').value = 'overview'; document.getElementById('cameraMode').dispatchEvent(new Event('change')); overview(); };

  function drawFrame(state, selection) {
    const now = performance.now(), wallDt = Math.max(0, Math.min(.1, (now - lastFrame) / 1000)); lastFrame = now;
    const cameraBlend = 1 - Math.exp(-wallDt * 3);
    const delta = Math.max(0, state.tick - lastTick) * .033; lastTick = state.tick;
    for (const [id, entry] of pads) if (!state.stations.some(s => s.id === id)) { scene.remove(entry.group); disposeGroup(entry.group); pads.delete(id); }
    for (const st of state.stations) {
      if (!pads.has(st.id)) pad(st);
      const padEntry=pads.get(st.id);
      const active=state.drones.some(d=>d.targetStationId===st.id && ['takeoff','docking'].includes(d.state));
      padEntry.ring.material.color.set(selection.id===st.id?'#ffffff':active?'#64d5ff':st.queue.length?'#ff9944':'#56ebc2');
      padEntry.guidance.visible=!st.dockedDrones.some(id=>state.drones.find(d=>d.id===id)?.aircraftType==='UAM');
      padEntry.centerMark.visible=!padEntry.guidance.visible;
      padEntry.ring.material.emissive.copy(padEntry.ring.material.color);
    }
    for (const [id, entry] of fleet) if (!state.drones.some(d => d.id === id)) { scene.remove(entry.group); disposeGroup(entry.group); fleet.delete(id); }
    for (const [id, link] of links) if (!state.drones.some(d => d.id === id)) { scene.remove(link.group); disposeGroup(link.group); links.delete(id); }
    for (const d of state.drones) {
      if (!fleet.has(d.id)) {
        const group = createAircraft(d.aircraftType, { callsign: d.callsign, cargo: d.aircraftType === 'UAV' && d.callsign.endsWith('3') });

        group.userData.entity = d.id; scene.add(group); fleet.set(d.id, { group, type: d.aircraftType });
      }
      const g = fleet.get(d.id).group; g.position.copy(point(d.pos, d.altitude));
      const speed = Math.hypot(d.velocity.x, d.velocity.y), airborne = d.altitude > 2;
      g.rotation.set(d.pitch || 0, d.yaw || 0, d.roll || 0, 'YXZ');
      const targetRpm = d.altitude > .2 || ['takeoff', 'awaitingDeparture'].includes(d.state) ? 1 : 0;
      g.userData.rpm += (targetRpm - g.userData.rpm) * (1 - Math.exp(-delta * 1.8));
      g.userData.animate(delta, g.userData.rpm, { pusher: d.aircraftType === 'UAM' && airborne ? THREE.MathUtils.clamp((speed - 2) / 4, 0, 1) : 0, time: state.tick * .033, flying: targetRpm > 0 });
      const station = Sim.findStationById(state, d.targetStationId);
      const communicating = ['awaitingDeparture', 'awaitingClearance', 'queued'].includes(d.state);
      if (!links.has(d.id)) {
        const linkGroup = new THREE.Group();
        const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
        const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: '#33e5ec', transparent: true, opacity: .5 })); line.frustumCulled = false;
        linkGroup.add(line);
        const pulse = mesh(linkGroup, new THREE.SphereGeometry(.22, 8, 6), new THREE.MeshBasicMaterial({ color: '#9affee' }));
        scene.add(linkGroup); links.set(d.id, {group:linkGroup, line, pulse});
      }
      const link = links.get(d.id); link.group.visible = communicating && !!station;
      if (link.group.visible) {
        const a = point(station); a.x += 13; a.y = 8.5;
        const b = g.position.clone(); b.y += 1;
        const positions = link.line.geometry.attributes.position;
        positions.setXYZ(0,a.x,a.y,a.z); positions.setXYZ(1,b.x,b.y,b.z); positions.needsUpdate = true;
        link.pulse.position.lerpVectors(a,b,(state.tick % 50) / 50);
      }
    }
    if (cameraMode === 'follow') {
      const d = state.drones.find(d => d.id === selection.id) || state.drones.find(d => d.altitude > 1) || state.drones[0];
      if (d) { const p = point(d.pos, d.altitude); controls.target.lerp(p, cameraBlend); camera.position.lerp(p.clone().add(new THREE.Vector3(24, 15, 28)), cameraBlend * .7); }
    } else if (cameraMode === 'pad') {
      const st = state.stations.find(s => s.id === selection.id) || state.stations[0];
      const p = point(st); controls.target.lerp(p, cameraBlend); camera.position.lerp(p.clone().add(new THREE.Vector3(30, 14, 36)), cameraBlend * .7);
    }
    controls.update(); renderer.render(scene, camera);
  }
  function hit(state, x, y, entries, entities) {
    const r = canvas.getBoundingClientRect(); raycaster.setFromCamera(new THREE.Vector2((x - r.left) / r.width * 2 - 1, -(y - r.top) / r.height * 2 + 1), camera);
    const hits = raycaster.intersectObjects([...entries.values()].map(e => e.group), true);
    if (!hits.length) return null;
    let o = hits[0].object; while (o && !o.userData.entity) o = o.parent;
    return entities.find(e => e.id === o?.userData.entity) || null;
  }
  return { drawFrame, resize,
    hitTestDrone: (s, x, y) => hit(s, x, y, fleet, s.drones),
    hitTestStation: (s, x, y) => hit(s, x, y, pads, s.stations),
    stationScreenPos: (state, station) => {
      const p = point(station, 35).project(camera), r = canvas.getBoundingClientRect();
      return { x: r.left + (p.x + 1) * r.width / 2, y: r.top + (1 - p.y) * r.height / 2, visible: cameraMode !== 'follow' && p.z < 1 && p.z > -1 && Math.abs(p.x) < .95 && Math.abs(p.y) < .9 };
    }
  };
}
window.GroundNodeRender = { createRenderer };
await import('./main.js');




