// Vahnim flight dynamics — point-mass + attitude model for multirotor / lift-plus-cruise aircraft.
// SI units, Y up, aircraft nose points along local -Z (matches the 3D models).
// Illustrative physics for demonstration: not validated aerodynamics, not a certified model.
//
// Model in one paragraph: a guidance layer turns a target (position / speed limit) into a desired
// acceleration; the required thrust vector (desired acceleration + gravity - drag) is converted to a
// commanded body tilt; attitude follows that command through a critically damped second-order lag and
// thrust magnitude through a first-order rotor lag; the *actual* thrust vector then produces the motion.
// Drag uses air-relative velocity so wind and gusts genuinely push the aircraft, an integral
// disturbance estimator trims steady wind, ground effect reduces induced power near the surface, and
// battery energy comes from momentum-theory hover power plus parasitic power.
(function (g) {
  'use strict';
  const G = 9.80665, RHO = 1.2;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  const PROFILES = {
    UAM: {
      type: 'UAM', mass: 1800, thrustToWeight: 1.55, maxTilt: 0.2, vMax: 20, aMax: 2.1, decel: 1.5, jerk: 2.4,
      climb: 4, sink: 3.2, yawRate: 0.55, attOmega: 5.2, thrustTau: 0.32, spoolTau: 1.6, idleRpm: 0.32,
      rotorCount: 6, rotorRadius: 2.4, figureOfMerit: 0.72, dragArea: 4.2, avionicsKw: 2.4, batteryKwh: 100,
      hardLanding: 1.6, gearHeight: 0, ceiling: 300
    },
    UAV: {
      type: 'UAV', mass: 14, thrustToWeight: 2.2, maxTilt: 0.42, vMax: 14, aMax: 4.5, decel: 3.2, jerk: 9,
      climb: 5, sink: 3.5, yawRate: 1.6, attOmega: 11, thrustTau: 0.09, spoolTau: 0.5, idleRpm: 0.3,
      rotorCount: 4, rotorRadius: 0.4, figureOfMerit: 0.62, dragArea: 0.09, avionicsKw: 0.06, batteryKwh: 1.4,
      hardLanding: 1.4, gearHeight: 0, ceiling: 120
    }
  };

  function create(type, pos, options) {
    const p = PROFILES[type] || PROFILES.UAM, o = options || {};
    return {
      profile: p,
      pos: { x: pos.x, y: pos.y, z: pos.z },
      vel: { x: 0, y: 0, z: 0 },
      acc: { x: 0, y: 0, z: 0 },
      yaw: o.yaw || 0, yawRate: 0,
      pitch: 0, roll: 0, pitchRate: 0, rollRate: 0,
      thrust: pos.y > 0.05 ? p.mass * G : 0,
      rotorSpeed: pos.y > 0.05 ? 1 : 0,       // normalised 0..1 for animation
      armed: pos.y > 0.05,
      onGround: pos.y <= 0.05,
      bias: { x: 0, y: 0, z: 0 },              // wind / disturbance trim estimate (m/s^2)
      aFilt: { x: 0, y: 0, z: 0 },
      energyKwh: (o.battery == null ? 80 : o.battery) / 100 * p.batteryKwh,
      power: 0, airspeed: 0, groundSpeed: 0,
      touchdown: null,                          // {sink, hard, time} set when the wheels meet the surface
      clock: 0
    };
  }

  const batteryPct = s => clamp(s.energyKwh / s.profile.batteryKwh * 100, 0, 100);

  // Target: {x,y,z}. Options: vMax, finalDescent, holdHeading (radians|null), climb, sink.
  function step(s, cmd, dt, wind) {
    const p = s.profile, w = wind || { x: 0, y: 0, z: 0 };
    s.clock += dt;
    let ah = { x: 0, z: 0 }, av = 0;

    if (cmd && cmd.target) {
      const t = cmd.target;
      const ex = t.x - s.pos.x, ez = t.z - s.pos.z, dh = Math.hypot(ex, ez);
      const vLim = Math.min(cmd.vMax == null ? p.vMax : cmd.vMax, p.vMax);
      const near = cmd.finalDescent ? 0.55 : 0.75;
      const vDes = Math.min(vLim, Math.sqrt(2 * p.decel * dh) * 0.9, dh * near);
      const dx = dh > 1e-6 ? ex / dh : 0, dz = dh > 1e-6 ? ez / dh : 0;
      // Velocity error drives acceleration; integral trim absorbs wind and drag.
      const evx = dx * vDes - s.vel.x, evz = dz * vDes - s.vel.z;
      // Integral trim only near the target (anti-windup); it decays while manoeuvring far from it.
      if (dh < 25) { s.bias.x = clamp(s.bias.x + 0.16 * evx * dt, -2.2, 2.2); s.bias.z = clamp(s.bias.z + 0.16 * evz * dt, -2.2, 2.2); }
      else { const k = Math.exp(-0.6 * dt); s.bias.x *= k; s.bias.z *= k; }
      let ax = 1.3 * evx + s.bias.x, az = 1.3 * evz + s.bias.z;
      const am = Math.hypot(ax, az);
      if (am > p.aMax) { ax *= p.aMax / am; az *= p.aMax / am; }
      // Jerk limit keeps accelerations smooth (passenger comfort).
      const dax = ax - s.aFilt.x, daz = az - s.aFilt.z, dm = Math.hypot(dax, daz), maxStep = p.jerk * dt;
      if (dm > maxStep) { s.aFilt.x += dax / dm * maxStep; s.aFilt.z += daz / dm * maxStep; }
      else { s.aFilt.x = ax; s.aFilt.z = az; }
      ah = { x: s.aFilt.x, z: s.aFilt.z };

      const ey = t.y - s.pos.y;
      const climb = cmd.climb == null ? p.climb : cmd.climb, sink = cmd.sink == null ? p.sink : cmd.sink;
      let vyDes;
      if (cmd.finalDescent) vyDes = -clamp(0.2 + 0.55 * Math.max(0, s.pos.y), 0.2, sink);
      else vyDes = clamp(ey * 0.7, -sink, climb);
      av = clamp(1.6 * (vyDes - s.vel.y), -2.6, 3.2);
    } else {
      // No target: hold current attitude/thrust for hover on the ground or free-fall protection.
      av = clamp(1.6 * (0 - s.vel.y), -2.6, 3.2);
    }

    // Required specific thrust vector (world) = desired accel + gravity - drag.
    const va = { x: s.vel.x - w.x, y: s.vel.y - w.y, z: s.vel.z - w.z };
    const vaMag = Math.hypot(va.x, va.y, va.z);
    const kd = 0.5 * RHO * p.dragArea / p.mass;
    const drag = { x: -kd * vaMag * va.x, y: -kd * vaMag * va.y * 0.6, z: -kd * vaMag * va.z };
    const rx = ah.x - drag.x, ry = av + G - drag.y, rz = ah.z - drag.z;

    const airborneIntent = !!(cmd && cmd.target) && (s.armed || !s.onGround);
    let tReq = Math.hypot(rx, ry, rz);
    let nx = tReq > 1e-6 ? rx / tReq : 0, ny = tReq > 1e-6 ? ry / tReq : 1, nz = tReq > 1e-6 ? rz / tReq : 0;
    // Tilt limit from vertical.
    const tiltNow = Math.acos(clamp(ny, -1, 1));
    if (tiltNow > p.maxTilt) {
      const hs = Math.hypot(nx, nz), k = Math.sin(p.maxTilt) / Math.max(hs, 1e-9);
      nx *= k; nz *= k; ny = Math.cos(p.maxTilt);
    }
    // Convert to commanded pitch / roll about the current yaw.
    const cy = Math.cos(s.yaw), sy = Math.sin(s.yaw);
    const xb = nx * cy - nz * sy, zb = nx * sy + nz * cy;
    const rollC = airborneIntent ? -Math.asin(clamp(xb, -0.99, 0.99)) : 0;
    const pitchC = airborneIntent ? Math.atan2(zb, ny) : 0;

    // Critically damped attitude response.
    const om = p.attOmega;
    s.pitchRate += (om * om * (pitchC - s.pitch) - 2 * om * s.pitchRate) * dt;
    s.rollRate += (om * om * (rollC - s.roll) - 2 * om * s.rollRate) * dt;
    s.pitch += s.pitchRate * dt; s.roll += s.rollRate * dt;

    // Thrust magnitude with rotor lag and limits.
    const tMax = p.thrustToWeight * p.mass * G;
    const tCmd = airborneIntent ? clamp(p.mass * tReq, 0, tMax) : (s.onGround ? 0 : p.mass * G);
    s.thrust += (tCmd - s.thrust) * (1 - Math.exp(-dt / p.thrustTau));

    // Actual thrust direction from actual attitude.
    const sp = Math.sin(s.pitch), cp = Math.cos(s.pitch), sr = Math.sin(s.roll), cr = Math.cos(s.roll);
    const ux = -sr * cy + cr * sp * sy, uy = cr * cp, uz = sr * sy + cr * sp * cy;

    // Ground effect: thrust efficiency improves within one rotor diameter of the surface.
    const d = 2 * p.rotorRadius;
    const groundEffect = 1 + 0.18 * Math.exp(-Math.max(0, s.pos.y) / (0.6 * d));

    const T = s.thrust;
    s.acc.x = T * ux / p.mass + drag.x;
    s.acc.y = T * uy / p.mass - G + drag.y;
    s.acc.z = T * uz / p.mass + drag.z;

    if (s.onGround) {
      // On the surface: the deck carries the weight until thrust exceeds it; friction damps any slide.
      s.acc.y = Math.max(0, s.acc.y);
      s.acc.x = 0; s.acc.z = 0;
      s.vel.x *= Math.exp(-6 * dt); s.vel.z *= Math.exp(-6 * dt);
    }

    s.vel.x += s.acc.x * dt; s.vel.y += s.acc.y * dt; s.vel.z += s.acc.z * dt;
    const prevY = s.pos.y;
    s.pos.x += s.vel.x * dt; s.pos.y += s.vel.y * dt; s.pos.z += s.vel.z * dt;

    if (s.pos.y <= 0) {
      if (!s.onGround && prevY > 0 && s.vel.y < 0) {
        const sink = -s.vel.y;
        s.touchdown = { sink, hard: sink > p.hardLanding, time: s.clock };
      }
      s.pos.y = 0; if (s.vel.y < 0) s.vel.y = 0;
      s.onGround = true;
    } else if (s.onGround && s.vel.y > 0.02 && T > p.mass * G) {
      s.onGround = false; s.touchdown = null;
    }
    if (s.onGround) {
      s.pitchRate *= Math.exp(-8 * dt); s.rollRate *= Math.exp(-8 * dt);
      s.pitch *= Math.exp(-5 * dt); s.roll *= Math.exp(-5 * dt);
      s.aFilt.x = 0; s.aFilt.z = 0;
    }

    // Yaw: follow commanded heading (or velocity direction when moving).
    let yawTarget = null;
    if (cmd && cmd.heading != null) yawTarget = cmd.heading;
    else if (Math.hypot(s.vel.x, s.vel.z) > 2.5) yawTarget = Math.atan2(-s.vel.x, -s.vel.z);
    if (yawTarget != null) {
      const diff = Math.atan2(Math.sin(yawTarget - s.yaw), Math.cos(yawTarget - s.yaw));
      const want = clamp(diff * 1.1, -p.yawRate, p.yawRate);
      s.yawRate += (want - s.yawRate) * (1 - Math.exp(-dt * 2.4));
    } else s.yawRate *= Math.exp(-dt * 2);
    s.yaw += s.yawRate * dt;

    // Rotor spool (normalised speed for animation).
    const thrustFrac = Math.sqrt(clamp(T / tMax, 0, 1));
    const rotorTarget = s.armed ? Math.max(p.idleRpm, 0.55 + 0.45 * thrustFrac) : 0;
    s.rotorSpeed += (rotorTarget - s.rotorSpeed) * (1 - Math.exp(-dt / p.spoolTau));

    // Power and energy.
    const area = p.rotorCount * Math.PI * p.rotorRadius * p.rotorRadius;
    const induced = s.armed ? Math.pow(Math.max(T, 0), 1.5) / Math.sqrt(2 * RHO * area) / p.figureOfMerit / groundEffect / 1000 : 0;
    const parasitic = Math.hypot(drag.x, drag.z) * Math.hypot(va.x, va.z) / 1000;
    s.power = s.armed ? induced + parasitic + p.avionicsKw : p.avionicsKw * 0.4;
    s.energyKwh = Math.max(0, s.energyKwh - s.power * dt / 3600);
    s.airspeed = Math.hypot(va.x, va.z); s.groundSpeed = Math.hypot(s.vel.x, s.vel.z);
    return s;
  }

  g.VahnimFlight = { PROFILES, create, step, batteryPct, G, clamp };
  if (typeof module !== 'undefined') module.exports = g.VahnimFlight;
})(typeof window === 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : window));
