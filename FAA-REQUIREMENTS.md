# GroundNode Link — U.S. requirements reference

Reviewed: 2026-09-13. Preliminary applicability map, not a compliance finding or exhaustive list of aviation requirements.

GroundNode uses an original Vahnim request/reservation workflow. Its messages and interface are not CPDLC implementations. The 0.8-second delivery delay, 30-second response deadline and 90-second operation deadline are prototype design choices, not FAA-prescribed values. Existing third-party dependencies retain their own licences.

## Applicability before implementation

Define aircraft category and weight, piloted versus uncrewed operation, operating purpose, site, airspace, jurisdiction and authorization basis. The labels UAV and UAM do not establish a regulatory category. A small-UAS profile cannot stand in for a passenger powered-lift operation.

| Topic / source | Current representation | Evidence or work still required |
| --- | --- | --- |
| [FAA small-UAS / Part 107 overview](https://www.faa.gov/newsroom/small-unmanned-aircraft-systems-uas-regulations-part-107) | Operator-review gate for responsibility, permissions and readiness. Demo profile only. | Determine applicability, certificates, operating limitations, waivers and actual aircraft/site conditions. Checkbox acknowledgement does not verify any of these. |
| [FAA UAS operating framework and airspace authorization](https://www.faa.gov/air_traffic/publications/atpubs/aim_html/chap11_section_1.html) | Pad reservation is expressly separate from airspace permission. | Verify site and airspace restrictions, authorization requirements and any needed operator integration. No LAANC/DroneZone connection exists. |
| [FAA UAS safety responsibility](https://www.faa.gov/air_traffic/publications/atpubs/aim_html/chap11_section_8.html) | Responsible-operator review; aircraft flight control remains external. | Establish applicable operating procedures and validated contingency responsibilities. |
| [FAA Remote ID](https://www.faa.gov/uas/getting_started/remote_id) | Unknown tracks remain unidentified; guest identity review is simulated. | Determine applicability, receiver integration, identity association and limitations. Remote ID reception is not a command channel or proof of authorization. |
| [FAA powered-lift framework](https://www.faa.gov/air-taxis/FAQ) | Separate powered-lift/UAM research notice. | Establish aircraft certification, pilot/operator requirements and applicable operating rules. No autonomous passenger-operation approval is implied. |
| [FAA EB 105A vertiport design guidance](https://www.faa.gov/airports/engineering/engineering_briefs/eb_105a_vertiports) | Preliminary pad geometry and synthetic obstruction scenario. | Determine guidance applicability and evaluate the reference aircraft, site layout, structural design and other engineering requirements. Existing visual dimensions are not shown to satisfy this guidance. |

## Vahnim prototype controls

These are engineering choices informed by operational concerns, not claims that particular FAA clauses require this exact software design:

- GN-01: retain separate delivered and accepted states; require explicit acceptance.
- GN-02: only one aircraft can reserve the exercise pad; physical occupancy survives connection loss.
- GN-03: obstruction or conflicting-traffic inputs inhibit new reservations and revoke active ones.
- GN-04: expiry and connection loss invalidate reservations. An aircraft must use its own contingency procedure; this UI cannot command it.
- GN-05: a guest must establish a supported operator channel, exchange capabilities and complete operator review.
- GN-06: an unidentified visual track cannot receive a reservation without a supported channel.
- GN-07: record bounded, exportable operational events; export before reset/reload if evidence is needed. This is not a certified recorder.
- GN-08: free text can draft a request only. The current assistant is a deterministic intent parser, not a language model or autonomous authority.

`coordination.test.js` verifies these prototype behaviors, including review gating, arrival/departure cycles, delivery-before-acceptance, expiry, rejection, hazards and connection loss. It does not establish regulatory compliance.

## Before field deployment

Create an operation-specific compliance matrix with exact applicable provisions, owners, verification methods and evidence. Add authenticated transport, aircraft-specific adapters, real telemetry and perception, validated contingency logic, security testing and hardware-in-the-loop tests. Confirm the relevant regulatory and site approval path with qualified aviation specialists. This prototype has no FAA approval and does not implement all FAA rules.
