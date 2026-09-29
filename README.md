# Vahnim GroundNode — urban flight simulation

Vahnim's aircraft-to-ground coordination software, shown as a live simulation: a five-pad city terminal, a pilot screen, a ground-control screen and a live 3D view, all on one shared engine.

**Quick start:** `npm install`, then `npm start`, then open http://localhost:8123 (Chrome or Edge). `npm test` runs every check.
**User manual (PDF):** [docs/Vahnim-Simulation-User-Manual.pdf](docs/Vahnim-Simulation-User-Manual.pdf) (source: `docs/manual.html`).

## Pages

Every page shares one header (`site-nav.js`): the Vahnim logo (click for home), **Home**, **Ground-N1 demo**, **Explore**, **Guide**, and a **Help** button that explains the current page in plain words.

| Section | Page | Purpose |
| --- | --- | --- |
| Home | `index.html` | City simulation: five pads, air taxis and drones flying out, hovering, returning and charging |
| Ground-N1 demo | `n1.html` | Launcher: pick a story, then start (3 windows), all on one screen, or play the film |
| | `n1-pilot.html` | Pilot: flight display, terminal map, one guidance card with a single main button, verified messages |
| | `n1-ground.html` | Ground control: radar, aircraft strip, five pad controls, weather, approvals, decisions log |
| | `n1-live.html` | Live 3D view with director camera and event captions |
| | `n1-wall.html` | All three screens on one display (`?film=1` plays a hands-free film for recording) |
| Explore | `explore.html` | Plain-language menu and glossary |
| | `comms.html` | Guided encounter: private simulation, cockpit-seat view, coach, "cause a problem" buttons |
| | `hangar.html` | Aircraft models with hover, cruise and parked modes and key facts |
| | `smart-pad.html`, `coordination-lab.html` | Smart pad concept and integration lab |

All Ground-N1 windows must be in the same browser: they share one SharedWorker, so the simulation keeps running while a window is in the background. If SharedWorker is unavailable or fails, a page falls back to a private in-page simulation (add `?local=1` to force it; `?room=name` gives a separate shared simulation). Screens show a "Connecting" or "Connection lost" banner instead of freezing silently.

## Ground-N1 in one paragraph

The pilot connects (signed hello checked against a registry), requests landing, the ground computer assesses five pads, wind and battery and offers a clearance, the pilot accepts with a read-back code the node verifies, the autopilot flies the approach, the aircraft lands, charges (time-compressed) and departs. Every datalink message carries a sequence number, timestamp and signature and shows TX / RX / SIG / ACK; forged and replayed messages are rejected without changing state (signing is a demo hash, not cryptography). **Enter** presses the highlighted next step, **G** commands a go-around.

**Stories:** Normal landing, Strong wind, Something on the pad (revoke, go-around, divert), Low battery (priority), Radio link drops. **Approvals:** *the computer* offers clearances at once, or *a person* on the ground approves each one. **Autoplay** lets the pilot press every step for hands-free presentations.

## Physics and models

`flight-dynamics.js` is a point-mass plus attitude model. Desired acceleration becomes a required thrust vector (with gravity and air-relative drag); commanded tilt drives a second-order attitude response; rotor lag limits thrust; wind and gusts act through drag; an integral trim (with anti-windup) absorbs steady wind; ground effect trims hover power; battery energy follows momentum-theory power plus parasitic power. `sim.js` (city) uses the same idea for attitude: tilt follows acceleration, yaw is rate-limited, hover is still.

`aircraft-model.js` builds the Vahnim V6 lift-plus-cruise UAM and the S4 ducted quad UAV with sky-based reflections. `n1-coach.js` holds the plain-language wording used by the pilot card and the guided encounter.

## Design and quality

- **Design system:** `n1.css` tokens (`:root`): graphite surfaces, copper accent from the logo, semantic green / amber / red / blue. Reduced-motion and keyboard focus are supported everywhere. The logo is `assets/vahnim-logo.webp` (transparent), cropped in `site-nav.css`.
- **One source of truth:** state comes from one engine (`n1-engine.js`); wording from `n1-coach.js`; the header from `site-nav.js`.
- **Server:** `serve.js` serves only the app's files (no dotfiles, tests, package files or other `node_modules`), with nosniff, referrer and frame headers, ETag caching and clear errors. It listens on this computer only unless `HOST=0.0.0.0` is set; `PORT` changes the port.
- **Tests (`npm test`):** city simulation and flight feel (`sim.test.js`), protocol, coordination, classic encounter, Ground-N1 engine (`n1.test.js`: physics bounds, handshake, readback mismatch, forged and replayed messages, wind hold, incursion, link loss, supervised approval, low battery, determinism) and static site checks (`site.test.js`: every local file, script syntax, element ids used by scripts, navigation targets, server rules).

## Tuning cheat-sheet (small changes later)

| Change | Where |
| --- | --- |
| Pad positions in the Ground-N1 terminal | `PAD_DEFS` in `n1-engine.js` |
| Pad positions in the city simulation | `DEFAULT_STATIONS` in `sim.js` |
| Wind limit, offer and accept timeouts, departure battery minimum, charge rate | `config` in `create()` in `n1-engine.js` |
| Stories (wind, battery, drills, labels) | `SCENARIOS` in `n1-engine.js` and the list in `n1-launch.js` |
| Datalink latency | `LATENCY` in `n1-engine.js` |
| Plain-language wording | `n1-coach.js` (pilot card and guided encounter), `EXPLAIN` in `site-nav.js` (Help) |
| Aircraft mass, speed, acceleration, tilt, battery | `PROFILES` in `flight-dynamics.js` |
| Aircraft geometry and livery colours | `materials()`, `buildUAM`, `buildUAV` in `aircraft-model.js` |
| Colours and typography for all screens | `:root` in `n1.css` (city page: `style.css`) |
| Header sections and pages | `SECTIONS` in `site-nav.js` |
| Camera shots in the live view | `shot()` and `chooseAuto()` in `n1-live.js` |

**Limits:** one aircraft is simulated in Ground-N1; the other pads show parked aircraft. Flight dynamics are illustrative, not validated aerodynamics. Charging is time-compressed. The pilot screen is a software concept, not an FMS or certified flight instrument. Registry, readback and signing are demonstrations, and no FAA compliance is claimed.

---

## Controls and fleet

Use the independent UAM (0–12) and UAV (0–20) sliders to change the home fleet. Defaults are 3 UAMs and 5 UAVs. Additions enter from regional airspace; reductions retire aircraft after they return and finish service, so the flight board can temporarily exceed the requested count. Up to two regional UAV visitors operate separately from the home fleet.

The terminal has five pads (GN-01 to GN-05). Each UAM reserves an entire pad. Each pad accommodates up to three UAVs, with no mixed occupancy. Arrivals receive distinct holding points and wait for a reserved bay. Takeoffs and landings are serialized at each pad.

Drag to orbit and scroll to zoom. City overview frames the expanded city; Follow aircraft tracks the selected vehicle through its mission; Pad approach shows precision arrival. Select an aircraft on the flight board or in the scene for its mission, battery, altitude and traffic status. Scene focus hides panels. Pause freezes simulation and aircraft animations while camera controls remain usable.

## City and missions

The city contains 187 buildings and four named mission districts: Medical quarter, Riverside logistics, Central business district and North research campus. Aircraft fly hundreds of metres from the pads to destinations distributed across these districts, perform a timed mission, return, request clearance, land, receive service and redeploy. UAMs perform passenger transfers; UAVs perform medical, cargo and inspection missions.

Cruise altitude starts at 100 metres for UAMs and 75 metres for UAVs, above the generated rooftops. Departures climb vertically before traveling toward the city, hover still over the mission site (no orbiting, heading held), then return. Attitude follows thrust: forward and lateral acceleration tilt the aircraft (tan tilt = a/g) through a critically damped response, and yaw turns toward the direction of travel at a limited rate (0.6 rad/s UAM, 1.6 rad/s UAV) and holds when nearly stationary. UAM acceleration is capped at 2.5 m/s² and UAV at 4 m/s². Arrivals align over their reserved bay before descending. Queue and avoidance altitude assignments can be higher than normal cruise altitude.

## Flight and separation

A fixed 120 Hz kinematic controller limits horizontal speed and acceleration, smooths acceleration commands, brakes toward waypoints and slows the final descent. Touchdown requires low horizontal and vertical speed. Built-in aircraft include glazed cabins, windows, lift rotors, landing gear, navigation lights and UAV camera/cargo pods. Rotor spool, translucent rotor discs, beacon pulses and acceleration-driven pitch/roll animate flight.

The traffic coordinator predicts closest approach five seconds ahead using aircraft-sized separation envelopes. En-route aircraft brake and climb when a conflict is predicted; aircraft taking off or landing have priority. A temporary higher cruise floor keeps the yielding vehicle from descending immediately into the same conflict. Safety messages identify the aircraft, conflicting traffic and commanded altitude.

A swept-volume interlock checks movement between simulation steps and stops closing motion before an envelope violation. It permits retreating aircraft to move away. This fallback can stop a vehicle abruptly; it is a simulation safeguard, not an aerodynamic maneuver. Avoidance assumes initially separated aircraft and does not resolve externally injected initial overlaps.

## Communications and performance

Messages cover dispatch, periodic mission telemetry, arrival on site, completion, city departure/inbound handoff, landing requests, clearances, service and separation advisories. Filters isolate mission, safety, handoff, arrival, departure, service or selected-aircraft events. The separation metric counts predictive advisories.

Communications display the latest 30 matching messages from a bounded 60-event history and update only when relevant data changes. The flight board reuses button elements and refreshes at approximately 7 Hz. City windows use instanced geometry. Communications are simulated operational events; radio propagation, packet loss and network latency are not modeled.

## Scale, validation and limits

Ten legacy simulation units equal one scene metre on every axis. Pads are 24 metres across, UAM rotor span is approximately 18 metres and UAV span approximately 5 metres. Maximum horizontal speed is approximately 18 m/s for UAMs and 14 m/s for UAVs. Dimensions, mission durations and battery consumption are illustrative.

Tests cover head-on avoidance, mixed-fleet separation, bounded acceleration, continuous positions, vertical takeoff, gentle touchdown, bay exclusivity/capacity, holding assignments, battery bounds, fleet retirement, independent fleet counts, distant missions and visitor landing/departure cycles.

This is an operational simulation with simplified flight dynamics, not validated aerodynamics. Routes use rooftop-clearing altitudes; arbitrary building obstacle avoidance, wind, emergency diversion and depleted-battery flight termination are not implemented. Procedural models keep the demo self-contained; no external models or Unreal installation are required.

## Showcase walkthrough

1. Open `smart-pad.html` to explore the interactive product concept.
2. Open `index.html` for the city simulation and its glass camera menu.
3. Open `comms.html` for the **guided cockpit encounter**: a private Ground-N1 simulation (`?room=encounter` SharedWorker) with a cockpit-seat 3D view, the pilot or ground screen, a plain-language coach and "cause a problem" buttons. `explore.html` is a plain-language menu of the Explore pages; each page also has an **ⓘ In simple words** helper (edit `EXPLAIN` in `site-nav.js`). The earlier one-pad encounter described below is kept at `comms-classic.html`.
4. Open `coordination-lab.html` for the earlier Node Operations and Aircraft Client integration exercise.

### One pad, one UAM: cockpit encounter

The 3D aircraft and adjacent Vahnim Link display share a single simulation. Choose Overview, Follow UAM or Cockpit seat; the cockpit contains a live software screen showing the same operational instruction. Switch Pilot cockpit / Ground supervisor to inspect the same message IDs, timestamps and status from either perspective. This is one local session, not a network connection between separate devices.

Request landing while the synthetic obstruction is present to receive an automatic hold. Remove obstruction and GroundNode automatically reassesses the open request and offers a reservation. Accept it, then separately choose Start simulated approach. The aircraft aligns over the pad, descends gently, reports touchdown and completes service. Request departure, accept the automatic offer and start simulated departure to climb out and release the pad.

Add an obstruction or simulate link loss during approach to invalidate the reservation and trigger simulated recovery. Declined or expired requests require a fresh pilot request. Restore demo link after a disconnection before requesting again. Pause freezes flight and protocol timers; cameras remain usable. Hidden tabs pause this encounter. Restart resets the scenario, and Export shared report downloads its bounded 120-event audit and current state.

Preflight checks and pad inspection are synthetic scenario inputs. Flight is an acceleration-limited kinematic illustration, not validated aircraft dynamics. The cockpit is a software concept, not an installed FMS or certified flight-control interface. Routine ground responses are automatic; pilot acceptance and engaging simulated flight remain distinct actions.

### Integration lab

The coordination exercise is independent of city aircraft. Its collapsible live mirror still receives city telemetry through BroadcastChannel from another tab in the same browser and origin. Hidden source tabs may slow or pause. The exercise has one pad and two cooperative aircraft; the city has its own separate five-pad capacity model.

### Equipped aircraft walkthrough

Select VH-101. Connect and exchange capabilities in Aircraft Client. In Node Operations, check the three demo operator-review items and record the review. Request landing in Aircraft Client. After simulated delivery, assess and offer the reservation on the ground side. Accept it on the aircraft side, report approach, confirm touchdown, then confirm propulsion safe. Request departure, assess/offer, accept and confirm departure complete to release the pad.

### Visitor and failure scenarios

Select VIS-204. Connect to its simulated guest operator channel, exchange capabilities, then verify guest identity/channel on the ground side before recording the operator review. It uses the same explicit request and acceptance sequence. TRACK-03 has no channel and is track-only.

Obstruction or conflicting traffic revokes active reservations and prevents new offers. Removing a hazard does not reinstate permission: submit a new request. Disconnecting invalidates the reservation but retains actual pad occupancy. Offers expire after 30 seconds; accepted operations after 90 seconds. Messages take a simulated 0.8 seconds to deliver. These are demo choices, not aviation performance requirements.

The local request assistant recognizes simple landing/departure intent and prepares a draft requiring review and submission. It cannot offer or accept a reservation. The exercise does not use an LLM, live cameras, radio links or FAA services.

Export audit downloads the latest 120 events and current exercise state as JSON. Reload/reset discards the session. `npm test` covers the flight engine, legacy concept protocol and new coordination engine.

See [FAA-REQUIREMENTS.md](FAA-REQUIREMENTS.md) for a preliminary U.S. applicability map. Operator review is self-attestation, not certificate or authorization verification. No FAA compliance or universal aircraft compatibility is claimed.
### Interactive 3D pad concept

The smart-pad page now uses the same `pad-model.js` geometry as the city simulation. Orbit or zoom to inspect the platform, click geometry or the system explorer to highlight components, and switch between a whole-pad UAM reference and three UAV bay guides. Top view, reset view, optional auto rotation and an animated exploded view support a presentation. Exploded positions separate conceptual system groups; they are not an assembly drawing. Rendering pauses when the viewer is offscreen or the page is hidden. The annotated 2D diagram remains available as a fallback if WebGL cannot initialize.

