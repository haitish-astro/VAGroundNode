# Vahnim GroundNode — urban flight simulation

**User manual (PDF):** [docs/Vahnim-Simulation-User-Manual.pdf](docs/Vahnim-Simulation-User-Manual.pdf) (source: `docs/manual.html`). Home is the city simulation (`index.html`); every page has the same top bar with a **← Home** button.

## Vahnim Ground-N1 (main demo)

Run `npm start`, then open http://localhost:8123/n1.html. Ground-N1 is the proprietary aircraft-to-ground-node software concept: **two software screens and a live window running one shared simulation**.

| Window | File | Who uses it |
| --- | --- | --- |
| Pilot screen | `n1-pilot.html` | UAM pilot: glass-cockpit PFD, moving map, Vahnim Link clearance card, action buttons, verified datalink |
| Ground control | `n1-ground.html` | Ground-control team for the area: radar, five pad controls, weather, supervisor approvals, fault tests, automation log |
| Live window | `n1-live.html` | 3D view of the five-pad terminal and VH-101 approaching, director camera, event captions, datalink pulses |
| Launcher | `n1.html` | Scenario, supervision mode, speed, autoplay; opens the three windows |
| Demo wall | `n1-wall.html` | All three screens tiled on one display |

**Start:** click *Start demo · open 3 windows* (allow pop-ups) or use the Demo wall. All windows must be in the same browser; they share one SharedWorker, so the simulation keeps running while a window is in the background. Without SharedWorker support each page falls back to a private in-page simulation (add `?local=1` to force that).

**Flow (pilot presses, ground automation answers):** Connect (signed HELLO, registry check) → Request landing → automation assesses the five pads, wind and battery and offers a clearance → Accept with the read-back code (the node verifies the digest) → Engage approach (guidance flies the fix, short final and descent) → touchdown → Propulsion safe → automated charging → Request departure → clearance → Engage departure → climb-out. **Enter** presses the highlighted next step; **G** commands a go-around.

**Verified messages:** every datalink message carries a sequence number, timestamp and signature, and shows TX / RX / SIG / ACK chips. The ground screen's *Send forged message* and *Replay last message* buttons show that a bad signature or a replayed sequence is rejected without changing state. Signing is a keyed demo hash, not cryptography.

**Scenarios:** nominal; gusty wind hold; pad-incursion drill (revoke, go-around, divert); low-battery priority; link-loss drill. **Supervision:** *Automatic* offers clearances immediately; *Supervised* holds each recommendation until a ground operator approves it, overrides the pad or denies it. **Autoplay** lets the pilot press every recommended step for hands-free presentations.

### Physics and models

`flight-dynamics.js` is a point-mass plus attitude model. Desired acceleration becomes a required thrust vector (with gravity and air-relative drag); commanded tilt drives a second-order attitude response; rotor lag limits thrust; wind and gusts act through drag; an integral trim (with anti-windup) absorbs steady wind; ground effect trims hover power; battery energy follows momentum-theory power plus parasitic power.

`aircraft-model.js` builds the Vahnim V6 lift-plus-cruise UAM (lofted fuselage, swept wing, six lift rotors, pusher, V-tail, gear, navigation and strobe lights) and the S4 ducted quad UAV (sensor gimbal, optional cargo pod), with sky-based reflections from `createSkyEnvironment`. `hangar.html` is a turntable viewer. The city simulation and the cockpit encounter use the same models.

### Tuning cheat-sheet (small changes later)

| Change | Where |
| --- | --- |
| Pad positions in the Ground-N1 terminal | `PAD_DEFS` in `n1-engine.js` |
| Pad positions in the city simulation | `DEFAULT_STATIONS` in `sim.js` |
| Wind limit, offer and accept timeouts, departure battery minimum, charge rate | `config` in `create()` in `n1-engine.js` |
| Scenario presets (wind, battery, drills) | `SCENARIOS` in `n1-engine.js` |
| Datalink latency | `LATENCY` in `n1-engine.js` |
| Aircraft mass, speed, acceleration, tilt, battery | `PROFILES` in `flight-dynamics.js` |
| Aircraft geometry and livery colours | `materials()`, `buildUAM`, `buildUAV` in `aircraft-model.js` |
| Screen colours and typography (all three screens) | `:root` in `n1.css` |
| Camera shots in the live window | `shot()` and `chooseAuto()` in `n1-live.js` |

**Limits:** one aircraft is simulated; the other pads show parked aircraft. Flight dynamics are illustrative, not validated aerodynamics. Charging is time-compressed for the demo. The pilot screen is a software concept, not an FMS or certified flight instrument. Registry, readback and signing are demonstrations, and no FAA compliance is claimed.

`npm test` also runs `n1.test.js`: physics bounds, verified handshake, readback mismatch, forged and replayed messages, wind hold, incursion drill, link loss, supervised approval, low-battery priority and determinism.

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

