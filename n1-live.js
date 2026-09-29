// Ground-N1 live window: 3D view of the five-pad terminal with VH-101, driven by the shared simulation.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createSmartPad } from './pad-model.js';
import { createAircraft, createSkyEnvironment } from './aircraft-model.js';

const $ = id => document.getElementById(id), DECK = 1.12;
const STATUS_COL = { free: '#4ade80', reserved: '#6cb6ff', occupied: '#f5b544', blocked: '#ff5a6a', closed: '#6b7280' };
const STATUS_TXT = { free: 'FREE', reserved: 'RESERVED', occupied: 'OCCUPIED', blocked: 'OBSTRUCTED', closed: 'CLOSED' };
let link = null, st = null, camMode = 'auto', autoShot = 'chase', autoSince = 0, clean = false, view = null;
const seen = new Set(); let seenReady = false, captionTimer = 0;

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function setText(node, t) { if (node.textContent !== t) node.textContent = t; }

// ---------------------------------------------------------------- scene
function build(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(42, 1, .3, 3000);
  const sky = createSkyEnvironment(renderer); scene.environment = sky.envMap; scene.add(sky.dome); scene.fog = new THREE.Fog('#cfe0e8', 260, 1500);
  scene.add(new THREE.HemisphereLight('#e7f5ff', '#5a6e69', 1.0));
  const sun = new THREE.DirectionalLight('#fff0d7', 2.8); sun.position.set(-70, 130, 60); sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, { left: -120, right: 120, top: 100, bottom: -100, near: 10, far: 400 }); sun.shadow.bias = -.0004; sun.shadow.normalBias = .04; scene.add(sun); sun.target.position.set(0, 0, 25); scene.add(sun.target);
  const controls = new OrbitControls(camera, canvas); controls.enableDamping = true; controls.maxPolarAngle = Math.PI * .49; controls.minDistance = 8; controls.maxDistance = 900; controls.enabled = false;

  const mat = (c, r = .85, m = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
  // Ground and apron
  const speck = document.createElement('canvas'); speck.width = speck.height = 256; { const g = speck.getContext('2d'); g.fillStyle = '#7a8a89'; g.fillRect(0, 0, 256, 256); for (let i = 0; i < 2600; i++) { const v = 100 + Math.random() * 60 | 0; g.fillStyle = `rgba(${v},${v + 8},${v + 6},.35)`; g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); } }
  const groundTex = new THREE.CanvasTexture(speck); groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping; groundTex.repeat.set(160, 160); groundTex.anisotropy = 8; groundTex.colorSpace = THREE.SRGBColorSpace;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 })); ground.rotation.x = -Math.PI / 2; ground.position.y = -.08; ground.receiveShadow = true; scene.add(ground);
  const apron = new THREE.Mesh(new THREE.BoxGeometry(270, .3, 150), mat('#56666c', .9)); apron.position.set(0, -.02, 30); apron.receiveShadow = true; scene.add(apron);
  const apronEdge = new THREE.Mesh(new THREE.BoxGeometry(274, .32, 154), mat('#d8dfe0', .9)); apronEdge.position.set(0, -.06, 30); apronEdge.receiveShadow = true; scene.add(apronEdge);
  const lines = new THREE.Group(); scene.add(lines);
  for (let x = -120; x <= 120; x += 12) { const m = new THREE.Mesh(new THREE.PlaneGeometry(4.5, .35), mat('#e9d15b', .8)); m.rotation.x = -Math.PI / 2; m.position.set(x, .14, 96); m.receiveShadow = true; lines.add(m); }
  // Edge lights
  const lightGeo = new THREE.SphereGeometry(.28, 8, 6), lightMat = new THREE.MeshBasicMaterial({ color: '#ffc9a1' });
  const edge = new THREE.InstancedMesh(lightGeo, lightMat, 90); let n = 0; const dummy = new THREE.Object3D();
  for (let x = -130; x <= 130 && n < 90; x += 10) for (const z of [-44, 104]) { dummy.position.set(x, .3, z); dummy.updateMatrix(); edge.setMatrixAt(n++, dummy.matrix); }
  edge.count = n; scene.add(edge);

  // City backdrop (instanced)
  const b = window.VahnimCity.buildings, city = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .55, metalness: .1 }), b.length);
  const cols = ['#77929d', '#536f7f', '#a5b6bb', '#667b88'].map(c => new THREE.Color(c));
  b.forEach((bb, i) => { dummy.position.set(bb.x, bb.height / 2, bb.z); dummy.scale.set(bb.width, bb.height, bb.depth); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); city.setMatrixAt(i, dummy.matrix); city.setColorAt(i, cols[i % 4]); });
  city.castShadow = true; city.receiveShadow = true; scene.add(city);
  const winGeo = new THREE.PlaneGeometry(1, 1), winMat = new THREE.MeshStandardMaterial({ color: '#0f3345', roughness: .2, metalness: .6, emissive: '#1b5a73', emissiveIntensity: .25 });
  const wins = []; for (const bb of b) for (let l = 3; l < bb.height - 1; l += 4) wins.push([bb.x, l, bb.z + bb.depth / 2 + .05, bb.width * .85]);
  const winMesh = new THREE.InstancedMesh(winGeo, winMat, wins.length); wins.forEach((w, i) => { dummy.position.set(w[0], w[1], w[2]); dummy.scale.set(w[3], 1.4, 1); dummy.updateMatrix(); winMesh.setMatrixAt(i, dummy.matrix); }); scene.add(winMesh);
  const roads = new THREE.Group(); for (let row = 0; row < 11; row++) { const r = new THREE.Mesh(new THREE.PlaneGeometry(850, 12), mat('#2b3a43', .95)); r.rotation.x = -Math.PI / 2; r.position.set(0, -.04, -63 - row * 52); roads.add(r); } scene.add(roads);

  // Control tower + hangars
  const tower = new THREE.Group(); tower.position.set(0, 0, 76); scene.add(tower);
  const tm = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; tower.add(o); return o; };
  tm(new THREE.CylinderGeometry(3.2, 4, 3, 16), mat('#cfd9dc', .6), 0, 1.5, 0); tm(new THREE.CylinderGeometry(1.7, 2.2, 22, 16), mat('#e6eef0', .5), 0, 14, 0);
  tm(new THREE.CylinderGeometry(4.6, 3.2, 3.6, 16), new THREE.MeshPhysicalMaterial({ color: '#0e2c3d', roughness: .05, metalness: .2, clearcoat: 1 }), 0, 26.6, 0); tm(new THREE.CylinderGeometry(5, 5, .6, 16), mat('#e6eef0', .5), 0, 28.6, 0);
  tm(new THREE.CylinderGeometry(.12, .12, 6, 6), mat('#9fb0b8', .4, .8), 0, 32, 0);
  const towerLight = new THREE.Mesh(new THREE.SphereGeometry(.35, 10, 8), new THREE.MeshBasicMaterial({ color: '#ff4058' })); towerLight.position.set(0, 35.2, 0); tower.add(towerLight);
  const towerTop = new THREE.Vector3(0, 33, 76);
  for (const s of [-1, 1]) { const h = new THREE.Mesh(new THREE.BoxGeometry(34, 9, 22), mat('#9aa9ae', .7)); h.position.set(s * 122, 4.5, 44); h.castShadow = true; h.receiveShadow = true; scene.add(h); const r = new THREE.Mesh(new THREE.BoxGeometry(35, .6, 23), mat('#5d6f76', .8)); r.position.set(s * 122, 9.3, 44); scene.add(r); }
  // Wind sock
  const sockRoot = new THREE.Group(); sockRoot.position.set(30, 0, 76); scene.add(sockRoot);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(.12, .16, 9, 8), mat('#dfe6e8', .5)); pole.position.y = 4.5; pole.castShadow = true; sockRoot.add(pole);
  const sock = new THREE.Group(); sock.position.y = 9; sockRoot.add(sock); const sockSegs = [];
  for (let i = 0; i < 5; i++) { const r1 = 1 - i * .16, r2 = 1 - (i + 1) * .16, seg = new THREE.Mesh(new THREE.CylinderGeometry(r2 * .9, r1 * .9, .9, 12, 1, true), new THREE.MeshStandardMaterial({ color: i % 2 ? '#f4f4f4' : '#ff7a2f', side: THREE.DoubleSide, roughness: .8 })); seg.rotation.z = -Math.PI / 2; seg.position.x = .5 + i * .9; seg.castShadow = true; sock.add(seg); sockSegs.push(seg); }

  // Pads
  const pads = new Map(); const beamTex = (() => { const c = document.createElement('canvas'); c.width = 4; c.height = 128; const g = c.getContext('2d'), gr = g.createLinearGradient(0, 128, 0, 0); gr.addColorStop(0, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 4, 128); return new THREE.CanvasTexture(c); })();
  const ambient = new THREE.Group(); scene.add(ambient);
  function buildPad(p) {
    const entry = createSmartPad(p.name); entry.group.position.set(p.x, 0, p.z); scene.add(entry.group);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(11.5, 11.5, 70, 36, 1, true), new THREE.MeshBasicMaterial({ map: beamTex, color: '#6cb6ff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, opacity: .0 })); beam.position.set(p.x, 36, p.z); scene.add(beam);
    const debris = new THREE.Group(); debris.position.set(p.x + 3, DECK, p.z + 2); debris.visible = false; scene.add(debris);
    for (let i = 0; i < 5; i++) { const c = new THREE.Mesh(i % 2 ? new THREE.ConeGeometry(.5, 1.2, 10) : new THREE.BoxGeometry(1.3, .7, 1), mat(i % 2 ? '#ff7a2f' : '#c9d3d6', .7)); c.position.set((i - 2) * 1.2, i % 2 ? .6 : .35, Math.sin(i) * 1.5); c.rotation.y = i; c.castShadow = true; debris.add(c); }
    const label = document.createElement('canvas'); label.width = 320; label.height = 110; const tex = new THREE.CanvasTexture(label); tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })); sprite.scale.set(15, 5.2, 1); sprite.position.set(p.x, 17, p.z); scene.add(sprite);
    const e = { ...entry, beam, debris, sprite, label, tex, key: '', status: 'free' }; pads.set(p.id, e); return e;
  }
  function paintLabel(e, p) {
    const key = p.name + p.status; if (e.key === key) return; e.key = key;
    const g = e.label.getContext('2d'), col = STATUS_COL[p.status]; g.clearRect(0, 0, 320, 110); g.fillStyle = 'rgba(6,16,24,.82)'; g.strokeStyle = col; g.lineWidth = 4; g.beginPath(); g.roundRect(6, 6, 308, 98, 22); g.fill(); g.stroke();
    g.fillStyle = '#e6f1f5'; g.font = '700 42px system-ui,sans-serif'; g.textAlign = 'center'; g.fillText(p.name, 160, 54); g.fillStyle = col; g.font = '700 26px ui-monospace,Consolas,monospace'; g.fillText(STATUS_TXT[p.status], 160, 88); e.tex.needsUpdate = true;
  }
  const uam = createAircraft('UAM', { callsign: 'VH-101' }); scene.add(uam);
  let ambientBuilt = false;
  function buildAmbient(state) {
    ambient.clear();
    for (const p of state.pads) {
      if (p.id === 'P2' || p.id === 'P5') p.occupants.forEach((o, i) => {
        if (o.id === 'VH-101') return; const craft = createAircraft(o.type, { callsign: o.type === 'UAM' ? o.id : undefined, cargo: i === 1 });
        if (o.type === 'UAM') craft.position.set(p.x, DECK, p.z), craft.rotation.y = .5; else { const bays = [[-6.5, 0], [0, -2], [6.5, 0]][i] || [0, 0]; craft.position.set(p.x + bays[0], DECK, p.z + bays[1]); craft.rotation.y = -.4 + i * .3; }
        craft.userData.ambientId = o.id; ambient.add(craft);
      });
    }
    ambientBuilt = true;
  }

  // Data link line + pulses
  const linkGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]); const linkLine = new THREE.Line(linkGeo, new THREE.LineBasicMaterial({ color: '#33e5ec', transparent: true, opacity: .45 })); linkLine.frustumCulled = false; scene.add(linkLine);
  const pulses = []; const glow = (() => { const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d'), gr = g.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, '#fff'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 32, 32); return new THREE.CanvasTexture(c); })();
  for (let i = 0; i < 8; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); s.scale.set(3.4, 3.4, 1); s.visible = false; scene.add(s); pulses.push({ s, t: 1, dir: 1 }); }
  // Route preview
  const routeGeo = new THREE.BufferGeometry(); routeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3)); const route = new THREE.Line(routeGeo, new THREE.LineDashedMaterial({ color: '#6cb6ff', dashSize: 4, gapSize: 3, transparent: true, opacity: .7 })); route.frustumCulled = false; scene.add(route);

  // Downwash dust
  const dustTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const DN = 110, dust = { pos: new Float32Array(DN * 3), life: new Float32Array(DN), ang: new Float32Array(DN), spd: new Float32Array(DN), r: new Float32Array(DN) };
  dust.pos.fill(-1000); const dustGeo = new THREE.BufferGeometry(); dustGeo.setAttribute('position', new THREE.BufferAttribute(dust.pos, 3));
  const dustPts = new THREE.Points(dustGeo, new THREE.PointsMaterial({ map: dustTex, color: '#e2dccd', size: 3.2, transparent: true, opacity: .34, depthWrite: false, sizeAttenuation: true })); dustPts.frustumCulled = false; scene.add(dustPts);

  function resize() { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  addEventListener('resize', resize); resize();
  return { renderer, scene, camera, controls, sun, pads, buildPad, paintLabel, uam, ambient, buildAmbient, get ambientBuilt() { return ambientBuilt; }, resetAmbient() { ambientBuilt = false; }, linkLine, linkGeo, pulses, route, routeGeo, dust, dustGeo, sock, sockSegs, sockRoot, towerTop, towerLight };
}

// ---------------------------------------------------------------- per-frame
const disp = { p: new THREE.Vector3(), yaw: 0, pitch: 0, roll: 0, rotor: 0, pusher: 0, ready: false };
const camPos = new THREE.Vector3(120, 60, 150), camTarget = new THREE.Vector3(0, 10, 20); let camFov = 42, time = 0, lastFrame = performance.now(), orbitInit = false;
const tmpV = new THREE.Vector3(), fwd = new THREE.Vector3(), right = new THREE.Vector3();

function chooseAuto(now) {
  const a = st.ac, far = Math.hypot(a.pos.x, a.pos.z) > 210; let want;
  if (['hold', 'goaround', 'transit'].includes(a.stage)) want = 'chase';
  else if (a.stage === 'inbound') want = far ? 'chase' : 'pad';
  else if (['descent', 'landed', 'onpad', 'spoolup', 'liftoff', 'climbout'].includes(a.stage)) want = 'pad';
  else if (a.stage === 'outbound') want = 'chase';
  else want = 'wide';
  if (want !== autoShot && now - autoSince > 4) { autoShot = want; autoSince = now; }
  return autoShot;
}
function assignedPad() { const id = st.ac.padId || (st.clearance && st.clearance.padId); return st.pads.find(p => p.id === id) || st.pads[2]; }

function shot(mode, dt) {
  const p = disp.p, out = { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 42 };
  fwd.set(-Math.sin(disp.yaw), 0, -Math.cos(disp.yaw)); right.set(Math.cos(disp.yaw), 0, -Math.sin(disp.yaw));
  if (mode === 'chase') { out.pos.copy(p).addScaledVector(fwd, -40).addScaledVector(right, 13).add(tmpV.set(0, 14, 0)); out.target.copy(p).addScaledVector(fwd, 8); out.fov = 46; }
  else if (mode === 'pad') {
    const pad = assignedPad(); out.pos.set(pad.x + 30, DECK + 8 + Math.min(20, p.y * .12), pad.z + 36);
    out.target.set(pad.x, DECK + 3, pad.z).lerp(p, Math.min(1, Math.max(.2, p.y / 25))); out.fov = p.y > 25 ? 50 : 44;
  }
  else if (mode === 'cockpit') { out.pos.copy(p).addScaledVector(fwd, 2.4).add(tmpV.set(0, 2.5, 0)); out.target.copy(out.pos).addScaledVector(fwd, 60).add(tmpV.set(0, -Math.max(-6, Math.min(6, (disp.pitch || 0) * -60)) - 3, 0)); out.fov = 72; }
  else if (mode === 'tower') { out.pos.copy(view.towerTop).add(tmpV.set(0, 2, 0)); out.target.copy(p); out.fov = Math.min(44, Math.max(10, 2 * Math.atan2(24, p.distanceTo(out.pos)) * 57.3)); }
  else { const t = time * .06; out.pos.set(Math.sin(t) * 150, 62, 60 + Math.cos(t) * 150); out.target.set(0, 12, 20); out.fov = 44; } // wide
  return out;
}

function updateHud() {
  const a = st.ac;
  setText($('phase'), a.phase); setText($('scenarioTag'), st.scenario.label + ' · ' + (st.config.mode === 'auto' ? 'automatic' : 'supervised'));
  setText($('linkTxt'), !st.link.up ? 'Link lost' : a.connected ? 'Verified link' : 'No session');
  $('linkPill').className = 'pill ' + (!st.link.up ? 'bad' : a.connected ? 'ok' : 'warn'); $('linkDot').className = 'dot ' + (!st.link.up ? 'bad' : a.connected ? 'ok' : 'warn');
  setText($('tAlt'), a.pos.y.toFixed(0) + ' m'); setText($('tGs'), a.groundSpeed.toFixed(0) + ' m/s'); setText($('tVs'), a.vsi.toFixed(1)); setText($('tHdg'), String(Math.round(a.heading) % 360 || 360).padStart(3, '0') + '°'); setText($('tBat'), a.battery.toFixed(0) + '%');
  const pad = a.padId && st.pads.find(p => p.id === a.padId); setText($('tPad'), pad ? pad.name : st.clearance ? st.clearance.padName : '—');
}

function frame(now) {
  const dt = Math.max(0, Math.min(.1, (now - lastFrame) / 1000)); lastFrame = now; time += dt;
  if (st && view) {
    const a = st.ac, age = link ? Math.min(.12, link.age()) : 0, k = 1 - Math.exp(-dt * 14);
    tmpV.set(a.pos.x + a.vel.x * age, a.pos.y + a.vel.y * age + DECK, a.pos.z + a.vel.z * age);
    if (!disp.ready) { disp.p.copy(tmpV); disp.yaw = a.yaw; disp.ready = true; }
    disp.p.lerp(tmpV, k); disp.pitch += (a.pitch - disp.pitch) * k; disp.roll += (a.roll - disp.roll) * k; disp.rotor += (a.rotor - disp.rotor) * k; disp.pusher += (a.pusher - disp.pusher) * k; disp.yaw += Math.atan2(Math.sin(a.yaw - disp.yaw), Math.cos(a.yaw - disp.yaw)) * k;
    const u = view.uam; u.position.copy(disp.p); u.rotation.set(disp.pitch, disp.yaw, disp.roll, 'YXZ'); u.userData.animate(dt, disp.rotor, { pusher: disp.pusher, time, flying: !a.onGround }); u.visible = camMode !== 'cockpit';

    // Pads
    for (const p of st.pads) {
      const e = view.pads.get(p.id) || view.buildPad(p); const col = new THREE.Color(STATUS_COL[p.status]);
      e.ring.material.color.copy(col); e.ring.material.emissive.copy(col); e.ring.material.emissiveIntensity = p.status === 'reserved' ? .8 + Math.sin(time * 4) * .35 : p.status === 'blocked' ? .6 + Math.sin(time * 9) * .5 : .8;
      const uavPad = p.occupants.length && p.occupants[0].type === 'UAV'; e.guidance.visible = !!uavPad; e.centerMark.visible = !uavPad;
      e.debris.visible = p.blocked; view.paintLabel(e, p); e.sprite.material.opacity = 1;
      const beamOn = (a.padId === p.id || (st.clearance && st.clearance.padId === p.id)) && p.status !== 'blocked';
      e.beam.material.opacity += ((beamOn ? .55 : 0) - e.beam.material.opacity) * (1 - Math.exp(-dt * 4)); e.beam.visible = e.beam.material.opacity > .01; e.beam.material.color.set(p.status === 'occupied' ? '#ffb454' : '#6cb6ff');
    }
    if (!view.ambientBuilt) view.buildAmbient(st);
    for (const c of view.ambient.children) c.userData.animate(dt, 0, { time });

    // Link line and pulses
    const connected = a.connected && st.link.up, ends = [view.towerTop, disp.p];
    view.linkLine.visible = connected; if (connected) { view.linkGeo.setFromPoints(ends); }
    for (const pl of view.pulses) if (pl.s.visible) { pl.t += dt / .7; if (pl.t >= 1) pl.s.visible = false; else { const f = pl.dir > 0 ? pl.t : 1 - pl.t; pl.s.position.lerpVectors(view.towerTop, disp.p, f); pl.s.material.opacity = 1 - pl.t * .4; } }

    // Route
    const cl = st.clearance, showRoute = cl && cl.route && ['offered', 'accepted'].includes(cl.status);
    view.route.visible = !!showRoute;
    if (showRoute) { const pts = [disp.p.clone(), ...cl.route.map(w => new THREE.Vector3(w.x, w.y + DECK, w.z))]; view.routeGeo.setFromPoints(pts); view.route.computeLineDistances(); }

    // Downwash dust
    const d = view.dust, active = a.pos.y < 14 && disp.rotor > .7 && !(a.stage === 'hold'); const cx = disp.p.x, cz = disp.p.z;
    for (let i = 0; i < d.life.length; i++) {
      if (d.life[i] <= 0) { if (active && Math.random() < dt * 90) { d.life[i] = 1 + Math.random() * .9; d.ang[i] = Math.random() * 6.283; d.r[i] = 3 + Math.random() * 3; d.spd[i] = 5 + Math.random() * 5; } else { d.pos[i * 3 + 1] = -1000; continue; } }
      d.life[i] -= dt; d.r[i] += d.spd[i] * dt; d.pos[i * 3] = cx + Math.cos(d.ang[i]) * d.r[i]; d.pos[i * 3 + 1] = DECK + .3 + (1 - d.life[i]) * 1.4; d.pos[i * 3 + 2] = cz + Math.sin(d.ang[i]) * d.r[i];
    }
    view.dustGeo.attributes.position.needsUpdate = true;

    // Wind sock and tower beacon
    const wv = st.weather.vec, gx = wv.x + st.weather.gust.x, gz = wv.z + st.weather.gust.z, ws = Math.hypot(gx, gz);
    view.sock.rotation.y += (-Math.atan2(gz, gx) - view.sock.rotation.y) * (1 - Math.exp(-dt * 2)); view.sock.rotation.z += (-(1 - Math.min(1, ws / 8)) * 1.1 - view.sock.rotation.z) * (1 - Math.exp(-dt * 3));
    view.sockSegs.forEach((s, i) => { s.rotation.x = Math.sin(time * 5 + i) * .05 * Math.min(1, ws / 4); });
    view.towerLight.visible = Math.floor(time * 1.4) % 2 === 0;

    // Camera
    const mode = camMode === 'auto' ? chooseAuto(time) : camMode;
    if (mode === 'orbit') {
      if (!orbitInit) { orbitInit = true; view.controls.target.copy(camTarget); }
      view.controls.enabled = true; view.controls.update();
    } else {
      orbitInit = false; view.controls.enabled = false;
      const s = shot(mode, dt), fast = mode === 'cockpit', kp = 1 - Math.exp(-dt * (fast ? 20 : mode === 'tower' ? 4 : 1.8)), kt = 1 - Math.exp(-dt * (fast ? 20 : 4));
      camPos.lerp(s.pos, kp); camTarget.lerp(s.target, kt); camFov += (s.fov - camFov) * (1 - Math.exp(-dt * 2.5));
      view.camera.position.copy(camPos); view.camera.lookAt(camTarget); if (Math.abs(view.camera.fov - camFov) > .05) { view.camera.fov = camFov; view.camera.updateProjectionMatrix(); }
    }
    if (mode === 'orbit') { camPos.copy(view.camera.position); camTarget.copy(view.controls.target); }
    view.renderer.render(view.scene, view.camera);
  }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- messages -> captions, ticker, pulses
const CAPTIONS = {
  SESSION_ACCEPTED: ['', 'SESSION VERIFIED', t => 'Vahnim Link session open'],
  CLEARANCE_OFFER: ['', 'CLEARANCE OFFERED', t => 'Cleared to land ' + (t.match(/GN-0\d/) || [''])[0]],
  DEPARTURE_OFFER: ['', 'DEPARTURE CLEARANCE', t => 'Cleared to depart ' + (t.match(/GN-0\d/) || [''])[0]],
  CLEARANCE_CONFIRMED: ['', 'READBACK VERIFIED', t => (t.match(/GN-0\d/) || [''])[0] + ' reserved'],
  FINAL_CLEARANCE: ['', 'CLEARED TO LAND', t => (t.match(/GN-0\d/) || [''])[0]],
  CLEARANCE_REVOKED: ['warn', 'CLEARANCE REVOKED', t => t.replace('Clearance revoked: ', '')],
  GO_AROUND_REPORT: ['warn', 'GO-AROUND', t => 'Climbing and holding'],
  GO_AROUND: ['warn', 'GO-AROUND ORDERED', t => t],
  HOLD: ['warn', 'HOLD', t => t.replace('Hold: ', '')],
  TOUCHDOWN_REPORT: ['', 'TOUCHDOWN', t => (t.match(/sink [\d.]+ m\/s/) || [''])[0]],
  SERVICE_COMPLETE: ['', 'CHARGING COMPLETE', t => 'Ready for departure'],
  PAD_RELEASED: ['', 'PAD RELEASED', t => t],
  SESSION_CLOSED: ['', 'DEPARTED', t => 'Departure complete']
};
function caption(kind, text, bad) {
  const c = bad ? ['bad', 'MESSAGE REJECTED', () => text] : CAPTIONS[kind]; if (!c) return;
  const box = $('caption'); box.hidden = false; box.className = 'caption ' + c[0]; box.replaceChildren(el('small', '', c[1]), el('b', '', c[2](text))); box.style.animation = 'none'; void box.offsetWidth; box.style.animation = '';
  clearTimeout(captionTimer); captionTimer = setTimeout(() => { box.hidden = true; }, 3400);
}
function firePulse(dir) { if (!view) return; const pl = view.pulses.find(p => !p.s.visible); if (!pl) return; pl.t = 0; pl.dir = dir; pl.s.visible = true; pl.s.material.color.set(dir > 0 ? '#6cb6ff' : '#e07a3c'); }
function onLog(log) {
  const list = log.messages;
  for (const m of list) {
    const key = m.id + ':' + (m.status === 'rejected' ? 'r' : 'ok');
    if (seen.has(key)) continue; seen.add(key);
    if (!seenReady) continue;
    if (m.status === 'rejected') caption(m.kind, m.note, true);
    else { firePulse(m.from === 'VH-101' ? 1 : -1); caption(m.kind, m.text); }
  }
  seenReady = true;
  const tk = $('ticker'), tkKey = list.slice(-3).map(m => m.id + m.status + m.ack).join(); if (tk.dataset.key === tkKey) return; tk.dataset.key = tkKey;
  tk.replaceChildren(...list.slice(-3).map(m => { const row = el('div', 'tick ' + (m.verified === false ? 'bad' : m.from === 'VH-101' ? 'air' : '')); row.append(el('b', '', (m.from === 'VH-101' ? 'AIR→' : 'NODE→') + m.kind.replaceAll('_', ' ')), el('span', '', m.text), el('i', '', m.verified === false ? '✗ REJECTED' : m.verified ? '✓ VERIFIED' : '…')); return row; }));
}

// ---------------------------------------------------------------- boot
document.querySelectorAll('[data-cam]').forEach(b => b.onclick = () => setCam(b.dataset.cam));
function setCam(mode) { camMode = mode; document.querySelectorAll('[data-cam]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.cam === mode))); if (mode !== 'auto') autoSince = 0; }
function toggleClean() { clean = !clean; $('hud').classList.toggle('clean', clean); const nav = document.getElementById('site-nav'); if (nav) nav.style.display = clean ? 'none' : ''; }
$('hudToggle').onclick = toggleClean;
addEventListener('keydown', e => { if (e.target.closest('input,select,textarea')) return; const map = { 1: 'auto', 2: 'chase', 3: 'pad', 4: 'tower', 5: 'orbit', 6: 'cockpit' }; if (map[e.key]) setCam(map[e.key]); if (e.key === 'h' || e.key === 'H') toggleClean(); if (e.key === 'f' || e.key === 'F') { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.(); } });

try { view = build($('scene')); } catch (err) { console.error(err); $('fallback').hidden = false; }
window.N1Link.connect('live', {
  onState: s => { st = s; if (view) updateHud(); },
  onLog,
  onReset: () => { seen.clear(); seenReady = false; disp.ready = false; if (view) view.resetAmbient(); }
}).then(l => { link = l; });
requestAnimationFrame(frame);
{ const q = new URLSearchParams(location.search); if (q.get('cam')) setCam(q.get('cam')); if (q.has('compact')) $('hud').classList.add('compact'); }
window.__live = { get view() { return view; }, setCam, get st() { return st; } };
