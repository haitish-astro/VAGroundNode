import * as THREE from 'three';
// Vahnim procedural aircraft. Nose points along local -Z, origin sits on the ground plane (wheel/skid base).
//  - UAM  "Vahnim V6": lift-plus-cruise eVTOL — lofted fuselage, swept high wing, six lift rotors on twin
//         booms, rear pusher, V-tail, tricycle gear, navigation + strobe lighting.
//  - UAV  "Vahnim S4": ducted quad with sensor gimbal, optional cargo pod, skid legs, arm LEDs.
// Public API (kept compatible with earlier builds): group.userData.{rotors, discs, beacon, rpm}
// plus group.userData.animate(dt, rpm, options) for spin, rotor blur, strobes and pusher.

const KEEP = o => { o.userData.keep = true; return o; };            // shared resources survive group disposal
const cache = {};
const memo = (key, make) => cache[key] || (cache[key] = make());

function glowTexture() {
  return memo('glow', () => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.25, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    return KEEP(new THREE.CanvasTexture(c));
  });
}
function discTexture() {
  return memo('disc', () => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 6, 64, 64, 64);
    g.addColorStop(0, 'rgba(210,225,235,.15)'); g.addColorStop(.55, 'rgba(210,225,235,.55)'); g.addColorStop(.92, 'rgba(230,240,245,.75)'); g.addColorStop(1, 'rgba(230,240,245,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    return KEEP(new THREE.CanvasTexture(c));
  });
}

function materials() {
  const paint = new THREE.MeshPhysicalMaterial({ color: '#eef3f5', metalness: .12, roughness: .3, clearcoat: 1, clearcoatRoughness: .1 });
  const paintV = new THREE.MeshPhysicalMaterial({ color: '#ffffff', vertexColors: true, metalness: .12, roughness: .3, clearcoat: 1, clearcoatRoughness: .1 });
  const accent = new THREE.MeshPhysicalMaterial({ color: '#ff7a2f', metalness: .2, roughness: .35, clearcoat: .8, clearcoatRoughness: .15 });
  const graphite = new THREE.MeshStandardMaterial({ color: '#1b2730', metalness: .55, roughness: .5 });
  const carbon = new THREE.MeshStandardMaterial({ color: '#10181e', metalness: .4, roughness: .42 });
  const metal = new THREE.MeshStandardMaterial({ color: '#8b9aa3', metalness: .9, roughness: .32 });
  const glass = new THREE.MeshPhysicalMaterial({ color: '#0a2636', metalness: .1, roughness: .04, clearcoat: 1, clearcoatRoughness: 0, transparent: true, opacity: .86, envMapIntensity: 1.6 });
  const tyre = new THREE.MeshStandardMaterial({ color: '#0c1114', roughness: .85 });
  const lit = c => new THREE.MeshBasicMaterial({ color: c });
  return { paint, paintV, accent, graphite, carbon, metal, glass, tyre, lit };
}

function add(parent, geometry, material, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(geometry, material); m.position.set(x, y, z);
  m.castShadow = shadow; m.receiveShadow = shadow; parent.add(m); return m;
}
const box = (p, w, h, d, mat, x, y, z) => add(p, new THREE.BoxGeometry(w, h, d), mat, x, y, z);
const cyl = (p, r1, r2, h, mat, x, y, z, seg = 14) => add(p, new THREE.CylinderGeometry(r1, r2, h, seg), mat, x, y, z);

// Streamlined body of revolution along Z (nose at -Z) with an elliptical section and a graphite belly.
function fuselageGeometry(length, radius, sx, sy, noseFrac = .3, belly = true) {
  const pts = [], N = 56;
  for (let i = 0; i <= N; i++) {
    const t = i / N; // 0 nose .. 1 tail
    const r = t < noseFrac ? Math.sqrt(Math.max(0, 1 - Math.pow((noseFrac - t) / noseFrac, 2.2))) : Math.pow(1 - (t - noseFrac) / (1 - noseFrac), .82) * .96 + .04;
    pts.push(new THREE.Vector2(Math.max(0.001, r * radius), length / 2 - t * length));
  }
  pts.reverse(); // lathe wants ascending y for outward-facing normals
  const geo = new THREE.LatheGeometry(pts, 40);
  geo.rotateX(-Math.PI / 2); geo.scale(sx, sy, 1);
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
  const white = new THREE.Color('#f1f5f7'), dark = new THREE.Color('#2a3a45');
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / (radius * sy);
    const k = belly ? THREE.MathUtils.smoothstep(-y, .5, .82) : 0;
    const c = white.clone().lerp(dark, k);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

// Planform extruded into an aerofoil-ish slab. pts are (x, z) with -Z forward; slab hangs down from y=0 by `depth`.
function slab(points, depth, bevel = .03) {
  const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, z)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, steps: 1 });
  geo.rotateX(Math.PI / 2); // shape y -> world z, extrusion -> downward
  return geo;
}

function bladeGeometry(radius, hub, chord, twistRoot, twistTip) {
  return memo(`blade-${radius}-${hub}-${chord}`, () => {
    const geo = new THREE.BoxGeometry(1, 1, 1, 14, 1, 2), pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const t = pos.getX(i) + .5, r = hub + t * (radius - hub);
      const c = chord * (1.15 - .75 * t) * (t < .08 ? .6 + t * 5 : 1);
      let y = pos.getY(i) * chord * .085 * (1 - .5 * t), z = pos.getZ(i) * c;
      const tw = twistRoot + (twistTip - twistRoot) * t, ct = Math.cos(tw), st = Math.sin(tw);
      pos.setXYZ(i, r, y * ct - z * st, y * st + z * ct);
    }
    geo.computeVertexNormals();
    return KEEP(geo);
  });
}

function makeRotor(parent, mats, x, y, z, radius, blades, hubRadius, direction, opts = {}) {
  const rotor = new THREE.Group(); rotor.position.set(x, y, z); parent.add(rotor);
  rotor.userData.direction = direction;
  const geo = bladeGeometry(radius, hubRadius, radius * .17, .34, .1);
  for (let i = 0; i < blades; i++) {
    const b = new THREE.Mesh(geo, mats.carbon); b.rotation.y = i / blades * Math.PI * 2; b.castShadow = true; rotor.add(b);
  }
  cyl(rotor, hubRadius, hubRadius * 1.1, hubRadius * .8, mats.graphite, 0, 0, 0, 16).castShadow = false;
  const cone = add(rotor, new THREE.ConeGeometry(hubRadius * .95, hubRadius * 1.3, 16), mats.accent, 0, hubRadius * .7, 0, false);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(radius, 40), new THREE.MeshBasicMaterial({ map: discTexture(), transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, color: opts.blur || '#c9d8e2' }));
  disc.position.set(x, y + .02, z); disc.rotation.x = -Math.PI / 2; parent.add(disc);
  return { rotor, disc, cone };
}

function light(parent, color, x, y, z, size, glowScale) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(size, 10, 8), new THREE.MeshBasicMaterial({ color })); m.position.set(x, y, z); parent.add(m);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: .9 }));
  s.scale.set(glowScale, glowScale, 1); s.position.set(x, y, z); parent.add(s);
  return { core: m, glow: s };
}

function callsignDecal(text, group, x, y, z, width) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d'); g.fillStyle = 'rgba(0,0,0,0)'; g.clearRect(0, 0, 256, 64);
  g.fillStyle = '#ff7a2f'; g.font = '700 38px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 128, 34);
  const map = new THREE.CanvasTexture(c); map.anisotropy = 4;
  for (const side of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(width, width / 4), new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false }));
    m.position.set(side * x, y, z); m.rotation.y = side * Math.PI / 2; group.add(m);
  }
}

function buildUAM(mats, opts) {
  const group = new THREE.Group(), R = [], D = [], lights = {}, strobes = [];
  const { paint, paintV, accent, graphite, carbon, metal, glass, tyre, lit } = mats;
  // Fuselage
  add(group, fuselageGeometry(10.6, 1, 1.02, 1.12, .3), paintV, 0, 2.05, 0.15);
  add(group, (() => { const g = new THREE.SphereGeometry(1, 28, 16); g.scale(.93, .82, 2.55); return g; })(), glass, 0, 2.62, -2.05, false);
  // Cabin side glazing strip and door line
  for (const s of [-1, 1]) {
    box(group, .04, .5, 2.6, glass, s * 1.02, 2.35, -1.7).castShadow = false;
    box(group, .02, .8, .02, graphite, s * 1.03, 2.2, -0.35);
    box(group, .02, .8, .02, graphite, s * 1.03, 2.2, -3.0);
  }
  // Wing: swept, tapered, tips in accent colour
  const wing = slab([[-7, 1.0], [-7, .1], [-1, -.35], [1, -.35], [7, .1], [7, 1.0], [1, 1.75], [-1, 1.75]], .18);
  add(group, wing, paint, 0, 2.98, .1);
  for (const s of [-1, 1]) {
    box(group, .16, .7, .8, accent, s * 7.02, 3.25, .55);
    box(group, .12, .16, 1.1, accent, s * 6.9, 2.9, .5);
    // Twin booms + pylons + rotor motors
    const boom = cyl(group, .17, .13, 9.6, graphite, s * 5.4, 2.95, .35); boom.rotation.x = Math.PI / 2;
    box(group, .14, .28, 1.4, paint, s * 5.4, 2.85, .4);
    for (const z of [-3.4, .35, 4.0]) {
      cyl(group, .34, .3, .5, graphite, s * 5.4, 3.25, z);
      const f = add(group, new THREE.SphereGeometry(1, 16, 10), paint, s * 5.4, 2.9, z); f.scale.set(.34, .3, 1.15);
      const { rotor, disc } = makeRotor(group, mats, s * 5.4, 3.58, z, 1.72, 5, .3, (s * z) > 0 ? 1 : -1);
      R.push(rotor); D.push(disc);
    }
    // Main gear
    box(group, .12, 1.1, .24, graphite, s * 1.45, .7, 1.4);
    const w = cyl(group, .36, .36, .26, tyre, s * 1.5, .36, 1.4, 20); w.rotation.z = Math.PI / 2;
    const hub = cyl(group, .17, .17, .28, metal, s * 1.5, .36, 1.4, 12); hub.rotation.z = Math.PI / 2;
    const sup = cyl(group, .05, .05, 1.35, graphite, s * 1.15, 1.15, 1.4); sup.rotation.z = s * .55;
    // Lighting
    const nav = lights[s < 0 ? 'left' : 'right'] = light(group, s < 0 ? '#ff2f45' : '#38ff9c', s * 7.02, 3.25, .55, .1, 1.1);
    strobes.push(light(group, '#ffffff', s * 7.02, 3.6, .55, .08, 1.5));
  }
  // Nose gear
  box(group, .1, 1.1, .2, graphite, 0, .75, -3.3);
  const nw = cyl(group, .3, .3, .22, tyre, 0, .3, -3.3, 18); nw.rotation.z = Math.PI / 2;
  const nh = cyl(group, .14, .14, .24, metal, 0, .3, -3.3, 12); nh.rotation.z = Math.PI / 2;
  // V-tail
  for (const s of [-1, 1]) {
    const fin = slab([[0, 0], [1.9, -.15], [1.9, .35], [0, .9]], .1);
    const m = add(group, fin, paint, s * .12, 2.5, 4.7);
    m.scale.x = s; m.rotation.z = s * .78;
    const tip = add(group, slab([[1.75, -.14], [1.95, -.15], [1.95, .35], [1.75, .33]], .105), accent, s * .12, 2.5, 4.7); tip.scale.x = s; tip.rotation.z = s * .78;
  }
  // Pusher propeller
  cyl(group, .22, .3, .6, graphite, 0, 2.4, 5.55).rotation.x = Math.PI / 2;
  const pusher = new THREE.Group(); pusher.position.set(0, 2.4, 5.9); group.add(pusher);
  const pBlade = bladeGeometry(1.35, .2, .3, .5, .18);
  for (let i = 0; i < 4; i++) { const holder = new THREE.Group(); holder.rotation.z = i / 4 * Math.PI * 2; const b = new THREE.Mesh(pBlade, carbon); b.rotation.x = Math.PI / 2; b.castShadow = true; holder.add(b); pusher.add(holder); }
  add(pusher, new THREE.SphereGeometry(.22, 14, 10), accent, 0, 0, .12, false);
  const pDisc = new THREE.Mesh(new THREE.CircleGeometry(1.35, 32), new THREE.MeshBasicMaterial({ map: discTexture(), transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
  pDisc.position.set(0, 2.4, 5.9); group.add(pDisc);
  // Landing light, tail light, belly beacon
  light(group, '#fff3d6', 0, 1.55, -5.1, .13, 1.3);
  lights.tail = light(group, '#ffffff', 0, 3.3, 5.3, .07, .8);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(.13, 10, 8), new THREE.MeshBasicMaterial({ color: '#ff3b30' })); beacon.position.set(0, .95, .5); group.add(beacon);
  const beaconGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ff3b30', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); beaconGlow.scale.set(1.5, 1.5, 1); beaconGlow.position.copy(beacon.position); group.add(beaconGlow);
  group.userData.beacon = beacon; group.userData.beaconGlow = beaconGlow;
  if (opts.callsign) callsignDecal(opts.callsign, group, 1.06, 2.1, .3, 2.4);
  Object.assign(group.userData, { rotors: R, discs: D, pusher, pusherDisc: pDisc, strobes, lights, span: 15.4, length: 12 });
  return group;
}

function buildUAV(mats, opts) {
  const group = new THREE.Group(), R = [], D = [], strobes = [], lights = {};
  const { paint, paintV, accent, graphite, carbon, metal, glass, tyre, lit } = mats;
  add(group, fuselageGeometry(1.9, .5, 1.05, .62, .34), paintV, 0, .72, .05);
  add(group, (() => { const g = new THREE.SphereGeometry(1, 20, 12); g.scale(.36, .18, .62); return g; })(), accent, 0, 1.02, .18);
  // Gimbal: camera ball under the nose
  add(group, new THREE.SphereGeometry(.19, 16, 12), graphite, 0, .42, -.72);
  add(group, new THREE.SphereGeometry(.09, 14, 10), glass, 0, .4, -.88, false);
  cyl(group, .03, .03, .2, metal, 0, .55, -.72, 8);
  if (opts.cargo) { box(group, .62, .34, .85, graphite, 0, .27, .35); box(group, .6, .05, .83, accent, 0, .46, .35); }
  // Arms, motors, ducts and props
  const span = 1.55, dz = .95;
  for (const x of [-1, 1]) for (const z of [-1, 1]) {
    const px = x * span, pz = z * dz;
    const len = Math.hypot(px, pz), arm = box(group, len, .1, .14, carbon, px / 2, .78, pz / 2); arm.rotation.y = -Math.atan2(pz, px);
    cyl(group, .12, .14, .22, graphite, px, .86, pz, 14);
    const duct = add(group, new THREE.TorusGeometry(.66, .028, 8, 40), accent, px, 1.0, pz); duct.rotation.x = Math.PI / 2;
    for (let k = 0; k < 2; k++) { const sp = box(group, 1.3, .018, .018, carbon, px, .99, pz); sp.rotation.y = .4 + k * Math.PI / 2; }
    const { rotor, disc } = makeRotor(group, mats, px, 1.03, pz, .6, 3, .1, x * z > 0 ? 1 : -1);
    R.push(rotor); D.push(disc);
    strobes.push(light(group, z < 0 ? (x < 0 ? '#ff3b4e' : '#3dff9e') : '#ffffff', px, .75, pz, .05, .55));
  }
  // Skid legs
  for (const x of [-1, 1]) {
    for (const z of [-.5, .55]) { const leg = box(group, .05, .55, .05, graphite, x * .55, .3, z); leg.rotation.z = x * .28; }
    box(group, .07, .05, 1.8, graphite, x * .64, .04, .02);
  }
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(.07, 8, 8), new THREE.MeshBasicMaterial({ color: '#ffffff' })); beacon.position.set(0, 1.17, .25); group.add(beacon);
  const beaconGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ffffff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); beaconGlow.scale.set(.8, .8, 1); beaconGlow.position.copy(beacon.position); group.add(beaconGlow);
  group.userData.beacon = beacon; group.userData.beaconGlow = beaconGlow;
  Object.assign(group.userData, { rotors: R, discs: D, strobes, lights, span: 4.2, length: 2.4 });
  return group;
}

export function createAircraft(type = 'UAM', opts = {}) {
  const mats = materials();
  const group = type === 'UAM' ? buildUAM(mats, opts) : buildUAV(mats, opts);
  group.rotation.order = 'YXZ';   // yaw, then pitch, then roll — matches the flight-dynamics attitude convention
  const u = group.userData;
  u.rpm = 0; u.phase = Math.random() * 10;
  // Spin rotors, fade blades into a blur disc, pulse strobes. rpm 0..1; options {pusher: 0..1, time, flying}
  u.animate = (dt, rpm, o = {}) => {
    u.rpm = rpm; u.phase += dt;
    const spin = dt * (type === 'UAM' ? 70 : 120) * rpm;
    for (const r of u.rotors) r.rotation.y += spin * r.userData.direction;
    for (const d of u.discs) d.material.opacity = Math.min(.42, Math.max(0, (rpm - .2) * .55));
    if (u.pusher) {
      const p = o.pusher || 0; u.pusher.rotation.z += dt * 60 * p; u.pusherDisc.material.opacity = Math.min(.4, p * .5);
    }
    const t = o.time == null ? u.phase : o.time, on = rpm > .05 || o.flying;
    const pulse = on && (t % 1.3) < .12, flash = on && ((t * 1.7) % 1) < .09;
    u.beacon.visible = pulse; u.beaconGlow.visible = pulse;
    for (const s of u.strobes) { s.core.visible = flash; s.glow.visible = flash; }
  };
  return group;
}

// Procedural sky dome used for both the visible sky and image-based reflections on the aircraft paint.
export function createSkyEnvironment(renderer, options = {}) {
  const zenith = new THREE.Color(options.zenith || '#5f8fb8'), horizon = new THREE.Color(options.horizon || '#cfe0e8'), ground = new THREE.Color(options.ground || '#6d7a78');
  const dome = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { zenith: { value: zenith }, horizon: { value: horizon }, ground: { value: ground } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 zenith, horizon, ground; varying vec3 vP; void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(horizon, zenith, pow(h, .55)) : mix(horizon, ground, smoothstep(0.0, -.35, h)); gl_FragColor = vec4(c, 1.0); }'
  }));
  const envScene = new THREE.Scene(); envScene.add(dome.clone());
  const sun = new THREE.Mesh(new THREE.SphereGeometry(40, 12, 8), new THREE.MeshBasicMaterial({ color: '#fff2d8' })); sun.position.set(-500, 600, 300); envScene.add(sun);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envMap = pmrem.fromScene(envScene, 0.02).texture; pmrem.dispose();
  return { dome, envMap };
}
