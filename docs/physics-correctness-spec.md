# Game Audit Findings and Physics Correctness Specification

**Status:** Confirmed audit defects implemented and validated (2026-09-05); hardware validation and baseline tooling debt remain explicitly scoped below.  
**Date:** 2026-09-05.  
**Audit baseline:** commit `f07a4e9`, Bun 1.2.16, Three.js and Cannon-es from the existing lockfile.  
**Scope:** Complete game-audit findings and proposed physics correctness work for the browser game
entered through `src/index.html` and `src/main.ts`. The full findings register is in section 11;
section 12 records the subsequent validation pass and supersedes earlier evidence limitations.

## 1. Problem and intended outcome

The audit found that identical scenarios behaved differently with render frame rate, pause duration, and shop
slow motion. Several calculations returned impossible results, and rendering and gameplay maintained
inconsistent entity records. Existing passing tests do not establish correctness of the running game.

The intended result is a consistent, simplified game simulation: the same initial state, seed, and
simulation-tick inputs produce the same outcomes regardless of rendering frequency. Calculations
must respect their declared assumptions, units, and validity limits. Visual presentation must follow
the authoritative simulation state.

The user authorized implementation after the validation pass. Section 13 records completed work;
sections 2 and 11–12 retain historical audit evidence, not current completion claims. This spec
does not claim real-world weapon accuracy or validated physical damage probabilities. Existing
reference documents contain illustrative and conflicting formulas; this document defines the
acceptance contract for the proposed work.

## 2. Evidence and limits

The audit used source inspection, independent numerical cases, and real class methods exercised
with controlled clocks and in-memory scene objects. Browser access was unavailable during the
initial audit. The subsequent headless-browser validation and remaining limits are in section 12.

| Check | Baseline result |
| --- | --- |
| Existing suite with `bun test --preload ./tests/setup.ts` | 228 passed across 31 files |
| Default `bun test`, earlier audit run | Setup/import failures; browser global mock not reliably loaded |
| Additional numerical probes | 29 checks: 9 passed, 20 failed |
| Additional integration probes | 10 checks: 0 passed, 10 failed |
| Production build | Passed; audit output was outside the repository |
| `bun run typecheck`, earlier audit run | 348 errors, including active and alternate implementations |

The 39 probes deliberately target suspected failures and boundary conditions. Their 30 failures
are not 30 independent defects or a representative failure rate for the entire game.

Temporary evidence was saved under `/tmp/irondome-physics-audit/` as `probes.ts`,
`integration-probes.ts`, `results.json`, `integration-results.json`, and `existing-suite.log`.
These files are not durable dependencies. Section 11 preserves every probe outcome and the
additional source findings inline. The evidence and acceptance cases below must be converted
into repository tests during implementation.

## 3. Implementation scope

### Required for the first correctness release

- One simulation clock, fixed stepping, consistent pause and time scaling, and one update owner.
- Explicit units and angle conventions; valid trajectory and launch results.
- Collision and fuse checks over movement intervals, including moving targets.
- Shared gameplay records for buildings, damage, batteries, and entity termination.
- Rendering cleanup and bounds maintenance for moving instances.
- Tests that exercise the production calculation and integration paths.

### Separate follow-up work

- Repair and validate optional advanced ballistics, the alternate navigation class, and tracking
  APIs before enabling them in gameplay. Their presence in the repository does not make them active.
- Profile lighting, trails, allocations, and adaptive quality after correctness is established.
- Add replay UI, targeting explanations, tactical overlays, and expanded city objectives later.

Do not expand this work into a Unity port, a graphics redesign, real-world parameter calibration,
or unrelated cleanup of every existing TypeScript error. Do not retune damage, ammunition costs,
or difficulty merely to recover a historical interception percentage after fixing a bug.

## 4. Current paths and ownership

| Concern | Current path | Required disposition |
| --- | --- | --- |
| Physics stepping | `main.ts` calls Cannon stepping, then entity updates | One fixed-step simulation owner; forces before each step |
| Interceptor capability and launch planning | `IronDomeBattery` → `UnifiedTrajectorySystem` → improved/basic calculator | Shared, validated result contract |
| In-flight steering | `Projectile.updateGuidance()` | Keep the default game steering model explicit; test it through the actual entity path |
| Optional navigation | `physics/ProportionalNavigation.ts` via optional unified guidance | Repair separately; not the current default flight law |
| Optional environmental model | `physics/AdvancedBallistics.ts` | Disabled by default until validated; advanced interception corrections are currently a TODO |
| Active predictive history | `PredictiveTargeting` | Use simulation timestamps; do not describe position/velocity history as a Kalman filter |
| Kalman tracking | `KalmanFilter` and `ThreatTracker` | Matrix checks passed; tracker forecast mutates state; no default-game tracker instantiation found |
| Pure physics helpers | `physics/ballistics.ts`, `interception.ts`, `kalman.ts` | Reuse through adapters where appropriate; tests of helpers alone are insufficient |
| City | `BuildingSystem` and `InstancedBuildingRenderer` hold separate maps | One gameplay registry; renderer maps IDs to instances |

Prefer consolidation and small adapters over another parallel physics implementation. A simulator
used in tests must invoke the same production stepping and calculation functions as the game.

## 5. Proposed simulation contract

### 5.1 Units and state

- Simulation distance is metres, time is seconds, mass is kilograms, velocity is metres/second,
  acceleration is metres/second squared, and force is newtons.
- `+Y` is up. Horizontal azimuth is measured from `+X` toward `+Z`.
- Core angles use radians. Degree-based UI and legacy APIs convert explicitly at their boundaries;
  use names such as `elevationRad` and `azimuthDeg` to make the distinction visible.
- Use one configurable gravity value. Initially retain `9.82 m/s²` for the default game to avoid
  an unrelated parameter change. Optional altitude-dependent gravity must be declared separately.
- Render scale, exaggerated model size, and camera effects must not silently scale simulation
  coordinates or collision geometry. Collision radii are explicit gameplay properties.
- Inputs must be finite. Reject nonpositive mass, invalid speed, negative time intervals, and
  nonpositive trajectory sampling intervals with a documented failure result or configuration error.
- Read-only prediction queries must not mutate live state or caller-owned vectors.

### 5.2 Clock, pause, and time scale

Use a fixed simulation step of `1/60 s`. Render time only determines how many steps are requested.
The simulation clock advances exclusively when a fixed step executes.

Simulation time owns spawning, wave preparation and deadlines, projectile age and failures,
guidance history, fuse sampling, reloads, repairs, laser damage and energy, score combo windows,
damage effects that affect gameplay, and time-of-impact estimates. Gameplay must not depend on
`Date.now()`, wall-clock `setTimeout`, or render callbacks.

Camera motion, menu transitions, and audio fades may use presentation time. Environmental state
that affects gameplay must follow simulation time; freeze the day/night simulation during pause.

- Pause freezes simulation timers and preserves remaining durations. Resuming causes no catch-up
  from paused wall time, no expired projectile burst, and no wave reward while paused.
- Treat hidden-tab time as suspended gameplay. Reset the presentation time sample on return and
  preserve any independent user pause state. A portrait overlay that blocks play must also suspend it.
- Shop slow motion at `0.1×` applies to every simulation system. Closing the shop restores the prior
  selected speed. User pause takes precedence over slow motion.
- Test `0.1×`, `1×`, `2×`, and `10×`. At adequate capacity, ten wall seconds at `0.1×` execute one
  simulation second; one wall second at `10×` executes ten simulation seconds.
- Bound catch-up work per render frame. The initial proposed cap is 32 fixed steps, sufficient for
  the 30 FPS/10× synthetic test. Measure its runtime cost before finalizing it.
- If the cap or CPU budget prevents keeping up, all gameplay slows together. Bound accumulated
  debt, record requested versus executed time and intentional dropped debt in diagnostics, and
  never advance a gameplay deadline for time that physics did not execute. Do not claim the
  requested speed was achieved during overload.

### 5.3 Fixed-step sequence

1. Consume queued player commands and due simulation events in stable order.
2. Update battery state once, choose engagements, and compute forces from the current state.
3. Apply forces to each body, then execute one Cannon fixed step.
4. Resolve swept contact/fuse events, damage, and termination using pre/post-step positions.
5. Commit removals, counters, and rewards exactly once; publish render/effect events.
6. Advance the tick clock; retain previous/current transforms for rendering.

Declare each timer's boundary convention and use it consistently; events due on a tick must never
be lost or processed twice. Commands arriving between rendered frames are assigned simulation
ticks, not applied opportunistically during rendering.

Rendering interpolates between completed states and never applies forces or gameplay damage.
Use stable IDs/order and injected seeded gameplay randomness. Cosmetic randomness must not alter
the random sequence used for gameplay. Determinism is required within the same runtime/configuration;
cross-platform bit-identical Cannon results are not assumed.

## 6. Calculation and gameplay requirements

### 6.1 Trajectories and launch solutions

- Define the model attached to every prediction: vacuum ballistic, constant velocity, or guided
  game motion. A straight-line reachability estimate is not proof that a guided launch will succeed.
- Separate a planning estimate from a validated launch solution. A finite, above-ground result is
  necessary but not sufficient: validation must account for actual launch position, tube departure,
  configured lifetime, and the declared motion model.
- For ballistic ground impact, select the earliest admissible nonnegative surface crossing.
  Above ground, use the positive future root. At the surface, a downward/stationary body is already
  impacted; an upward launch seeks the later return. A below-ground state is already invalid/impacted.
- Reject interception times before now, beyond the planning/lifetime horizon, or at/after an earlier
  ground impact. Require finite outputs, an acceptable residual, and valid altitude after convergence.
- Handle equal-speed/linear cases explicitly. A coarse sample interval must not create holes in
  otherwise valid reachability. Use a bounded solve with convergence and physical-domain checks.
- A coincident launch/target request returns an explicit already-at-target/no-flight result, not
  `NaN` angles. Unreachable and invalid requests must be distinguishable in diagnostics.
- Fix radians/degrees conversion in both mortar paths and the manual-launch fallback.
- Low/high ballistic arcs must remain actual solutions. Tube departure and cosmetic loft must be
  represented as a guided launch phase or validated separately; do not relabel an altered angle as
  an exact ballistic solution. Predict from the actual tube launch position.
- Forecasts must use the configured motion model, including any retained damping. Vacuum oracle
  tests disable damping. Recompute ETA from current simulation state when motion changes.

### 6.2 Steering, tracking, and optional environmental physics

Default steering must apply bounded acceleration/force per simulation step and use explicit units.
Test planar symmetry, left/right symmetry, zero-distance behavior, acceleration bounds, and
re-engagement through `Projectile`, not only the alternate navigation helper. Changing the default
steering algorithm is a separate decision from correcting its time integration.

Before enabling the optional navigation class, fix its normalized-position reuse, angular-rate
versus acceleration-direction mismatch, timestamp initialization, and degenerate geometry handling.
Stateful guidance must be per engagement; unrelated targets must not share line-of-sight history.

Before enabling optional advanced ballistics:

- Acceleration is gravity plus force divided by mass; do not divide gravity acceleration by mass.
- Drag must oppose velocity relative to air and dissipate energy in the air-rest frame. Its
  coefficient cannot become negative. Reject unsupported domains or return finite bounded behavior.
- Specify whether pressure is local or sea-level reference pressure. Internally use pascals and
  kelvin; explicitly convert legacy hPa/Celsius inputs. Apply altitude consistently to gravity/density.
- Define the supported atmospheric altitude and speed envelope. Do not extrapolate a single lapse
  rate into invalid temperatures. Zero drag must recover the declared gravity model.
- Integration must not reverse a body's velocity solely through an oversized drag step. Use a
  stable method or documented substepping and verify convergence.
- Omit unsupported Magnus/Coriolis claims, or implement them with explicit inputs, axes, and units.
  Environmental options must not silently claim to affect a solver that ignores them.

Retain the validated Kalman matrix behavior. Specify process noise relative to elapsed time and
motion type; a zero-duration forecast must not add physical uncertainty. Future-position queries
operate on a snapshot. Repeated identical queries leave the live filter unchanged. Enabling Kalman
tracking in default gameplay is not required by this release.

### 6.3 Collision, fuse, and termination

- Use pre/post-step positions of both participants. Check the swept relative path against the
  declared fuse volume; endpoint-only distance tests are insufficient.
- Respect arming distance along the simulated path, including arming partway through a step.
  Tangency counts as contact. Zero relative displacement is a finite overlap/separation check.
- Resolve the earliest eligible event within the step. Ground/building contact, fuse events,
  expiration, and direct damage must have documented tie-breaking rules.
- Evaluate effects and damage at the resolved event location/time, not at an unrelated endpoint.
- Each entity has one terminal outcome with an explicit reason: intercepted, impact, expired,
  payload-deployed, reset, or capacity-removed. Do not infer interception from altitude or `isActive`.
- Emit one accounting event per termination. Laser kills count as interceptions; payload deployment,
  resets, and capacity removal do not create kill rewards. Clear dependent assignments and trails.
- Define wave membership for deployed payloads. Proposed default: children retain the parent's wave;
  the parent deployment is not a kill and required children must be resolved before completion.

### 6.4 Buildings, batteries, and damage

- Keep authoritative building IDs, dimensions, transforms, health, and destruction state outside
  renderer-only storage. Collision queries and visual damage reference this same registry.
- Use actual building bounds, account for projectile radius, and sweep through motion. The current
  common 24 × 24 × 80 box and altitude shortcut are not valid substitutes for variable building sizes.
- Battery update ownership is singular. Repair integrates `rate × simulated duration`; setting an
  unchanged repair rate must not reset elapsed time. Laser damage and energy follow the same clock.
- Laser placement must satisfy the battery event/lifecycle contract. Give laser batteries real
  health/destruction behavior consistent with their configuration; remove placeholder health and
  unsupported method calls from playable flows.
- Wave progress, completion, and rewards use explicit wave membership/outcomes. A deadline may end
  spawning, but must not reward a completed defense while required threats remain unresolved.
- Preserve the current blast probability curve initially as a named game damage model. Make its
  deterministic probability calculation separate from the seeded random outcome. Probabilities
  stay in `[0,1]`; fixed-condition distance tests must be non-increasing.
- Resolve unused damage configuration fields explicitly: deprecate/document them or connect them
  to a specified game rule. Do not imply that warhead mass or physical fragmentation is modeled when
  those inputs do not affect `calculateDamage()`.

### 6.5 Rendering consistency

- Reset/removal releases all instance slots, tracking assignments, trails, and queued entity events.
  Repeated reset must not exhaust pools or leave ghosts.
- Moving instances require current aggregate bounds, conservative chunk bounds, or an explicit
  culling policy. Zero-sized initialization bounds must not remain authoritative after movement.
- Keep rendered orientation and position consistent with authoritative velocity/state. A renderer
  change must not change collision outcomes. Interpolation must not resurrect removed entities.

## 7. Acceptance cases

These cases use synthetic game objects. Numeric criteria are correctness targets, not real-world
calibration. `V(x,y,z)` denotes a vector in the units from section 5.1.

| ID | Input/operation | Required result; baseline evidence |
| --- | --- | --- |
| TIME-01 | Mass 1, no gravity/damping, force `V(10,0,0)` for 60 fixed ticks, render at 30/60/120 FPS | Velocity `V(10,0,0)` within `1e-6`; same tick state. Baseline game ordering gave 4.833/9.833/19.833 m/s |
| TIME-02 | Unit-speed body; one wall second at 10×, adequate step budget | 10 m displacement within one fixed-step travel distance; baseline 3 m |
| TIME-03 | Pause during wave preparation, spawning, deadline, and shop slow motion | Remaining simulation durations unchanged; no spawns, credits, or completion during pause |
| TIME-04 | Pause a 30-second-lifetime projectile for 31 wall seconds without simulating | Still active on resume unless already expired in simulation time; ETA unchanged |
| BAT-01 | Health 50/100, repair 2 HP/s for ten simulation seconds | Health 70 within `1e-6`; baseline 50 |
| BAT-02 | Laser 20 DPS with valid continuous target for one simulation second | Damage 20 within `1e-6` at 30/60/120 FPS; baseline 30/40/60. Independently verify energy |
| BAT-03 | Place, damage, repair, and destroy laser in game mode | No missing event/method errors; one destruction event; real health changes |
| TRAJ-01 | Vacuum `p=V(0,100,0)`, `v=V(20,10,0)`, `g=9.82`, `t=2` | `p=V(40,100.36,0)`, `v=V(20,-9.64,0)` within `1e-8`; baseline passed |
| TRAJ-02 | Speed 50; ranges 1/10/80/200; height differences -20/0/30; both feasible arcs | Target-height residual below `1e-6`; 24 audited arcs passed; preserve energy and input immutability |
| TRAJ-03 | Zero horizontal range and coincident endpoints | Explicit finite no-flight/invalid result; baseline `NaN` angles |
| TRAJ-04 | Stationary target `V(105,10,0)`, launch `V(0,10,0)`, constant speed 100 | Interception at 1.05 s within `1e-6`; baseline basic solver returned null |
| TRAJ-05 | Target `V(100,10,0)` moving `V(-10,0,0)`, launch `V(0,10,0)`, speed 10 | 5 s solution; with target x=101, 5.05 s; tolerance `1e-6`. Baseline equal-speed helpers missed cases |
| TRAJ-06 | Target `V(0,1,0)`, velocity `V(0,-10,0)`, launch `V(100,0,0)`, speed 50 | Reject interception after ground impact; baseline returned y=-44.3605 at t=2.18795. At speed 250, actual battery capability must also reject |
| TRAJ-07 | Mortar from origin toward `+Z`; both spawn paths | Bearing 90° within `1e-6` degrees; baseline 1.5708°. Cover all four horizontal quadrants and manual fallback |
| TRAJ-08 | Ballistic target `V(100,0,0)`, speed 50, high arc | Valid high-arc round trip, or explicitly guided departure; baseline altered loft gave y=50.4417 at x=100 |
| FUSE-01 | Armed projectile moves x=-10 to +10 past stationary target at origin; radius 8 | One detonation within the segment; baseline none. Also test both bodies moving, tangency, misses, and mid-step arming |
| FUSE-02 | Equal velocities, separation 5, radius 8 | Finite immediate eligible-overlap result; no division by zero in optional detonation predictor |
| CITY-01 | Create instanced building at `V(50,0,50)`, dimensions 20×30×20, apply 50 damage | One gameplay building and health 50; baseline query count 0 and health 100 |
| CITY-02 | Short/tall/wide buildings; fast movement through bounds | Collision agrees with actual bounds; reject neighboring empty space; resolve earliest hit |
| LIFE-01 | Reset active threats repeatedly, including pending callbacks and payloads | Zero stale instances/assignments; pool capacity restored; baseline one render slot remained |
| LIFE-02 | Laser kill, ground hit, payload deployment, expiration, reset | Exactly one appropriate outcome each; no altitude-based kill classification or duplicate rewards |
| RENDER-01 | Initialize hidden instance, move it to `V(100,50,0)` | Bounds contain the active instance or culling is intentionally conservative; baseline sphere stayed at origin, radius zero |
| NAV-01 | Interceptor at origin moving `V(10,0,0)`; target `V(100,0,0)` moving `V(0,1,0)`; optional PN | For the declared true-PN convention, acceleration `V(0,0.3,0)` within `1e-8`; pure helper passed, class returned `V(0,0,0.003)` |
| NAV-02 | Coincident objects and zero relative velocity | Finite bounded commands; predicted miss for equal velocities and separation 10 is 10, not `NaN` |
| ADV-01 | Zero velocity/drag, altitude 100, masses 1/10/100, one-second advanced step | Same gravity acceleration for all masses within `1e-8`; baseline velocities scaled inversely with mass |
| ADV-02 | Sea-level dry air, 30°C, 101325 Pa | Density approximately 1.164386 kg/m³, tolerance `1e-6`; baseline 0.891709 |
| ADV-03 | 50 km altitude and 5000 m/s stress inputs | Explicit unsupported-domain result or finite dissipative behavior; baseline `NaN` density and forward drag |
| ADV-04 | Drag-only: speed 100, Cd=1, density=1, area=1, mass=1, dt=0.1 | Nonnegative speed no greater than 100, with step-refinement convergence; baseline -400 m/s |
| TRACK-01 | Position/velocity/acceleration covariance initially 100I; predict 1 s, Q acceleration diagonal=1; x measurement 10, R=5 | Updated x/vx/ax = 9.7826087 / 6.5217391 / 2.1739130 within `1e-6`; both Kalman implementations passed |
| TRACK-02 | Track starts `p=V(0,100,0)`, `v=V(10,0,0)`; query one-second future twice at frozen clock | Same forecast both times; live state unchanged. Baseline x advanced 10 then 20 |
| TRACK-03 | 1,000 Kalman prediction/measurement cycles | Finite symmetric covariance and nonnegative variances; retain audited symmetry error below `1e-8`; add positive-semidefinite checks |
| DAMAGE-01 | Fixed random draw 0.5, stationary target at distances 0/3/6/10/15/20 | Preserve initial curve 0.95/0.95/0.8/0.3/0/0; separate probability from random outcome |

Additionally run seeded full scenarios through the production simulation driver at equal tick
counts. Compare 30/60/120 FPS schedules, jittered rendering, pause/resume, slow motion, and overload.
Within the same runtime, require equal event order and counters, and position/velocity differences
below `1e-6`. Include a test proving that cosmetic effects cannot change seeded gameplay outcomes.

Browser acceptance remains a release gate: desktop plus a mobile landscape viewport; portrait
overlay; pause/menu/shop controls; laser placement; visible city damage; moving-instance culling;
and repeated resets. Capture console errors and screenshots. Do not label this gate passed based
on a successful build or mocked integration tests.

## 8. Implementation phases and exit gates

| Phase | Deliverable | Exit gate |
| --- | --- | --- |
| 0 — Reproducible baseline | Fix test setup entry point; turn audit cases into Bun tests; separate active/optional paths | Plain `bun test` loads reliably; known failures are explicitly tracked, not silently skipped |
| 1 — Clock and ownership | Fixed-step driver, timer migration, pause/scale semantics, seeded gameplay RNG, one battery update | TIME/BAT timing cases and equal-tick scenarios pass |
| 2 — Units and valid solutions | Angle adapters, root/domain checks, accurate constant-velocity cases, valid ballistic arcs, production-path coverage | TRAJ cases pass; impossible predictions cannot trigger capability approval |
| 3 — Contacts and lifecycle | Swept detection, shared city registry, explicit outcomes, laser lifecycle, reset/bounds fixes | FUSE/CITY/LIFE/RENDER and remaining BAT cases pass; default steering invariants pass |
| 4 — Optional model repair | Advanced model, alternate navigation, snapshot tracking, declared noise/domains | NAV/ADV/TRACK cases pass before any optional feature is enabled; otherwise retain an explicit deferred status |
| 5 — Browser verification and profiling | Complete interaction matrix; measure effects, lighting, and quality control | Browser evidence and performance measurements recorded; default correctness release ready |

The implementation goal now includes phases 0–5, including repair of optional models. Repair
does not enable those models in default gameplay. Product enhancements still require separate scope.

Use Bun for installation, tests, builds, and scripts. Run focused regressions first, then the full
suite and production build. Run lint/typecheck; changed modules must introduce no new diagnostics.
Record remaining baseline errors separately and do not describe a failing global check as passing.
Do not suppress mathematical failures by loosening tolerances or removing cases without documented
model reasoning and replacement coverage.

## 9. Performance and enhancement backlog

These are candidates, not measured gains or requirements to add features during the physics fixes.

| Candidate | Validation needed |
| --- | --- |
| Throttle instanced building/window lighting | Profile current per-frame scan; update on meaningful time changes without visible flicker |
| Partial trail-buffer updates and bounded pools | Measure CPU work/upload volume; maintain continuity and cleanup under sustained load |
| Spatial indexing for building/contact queries | Add after registry correctness; compare candidate counts and query time against full scans |
| Adaptive resolution | Apply quality changes to the actual render target; use averaged frame times, hysteresis, and recovery |
| Reduce per-frame allocations | Profile allocations/GC; reuse scratch vectors and buffers without shared-state corruption |
| Replay and scenario comparison UI | Build on seeded tick inputs; add after deterministic tests exist |
| Targeting explanations and tactical overlays | Surface actual solver rejection reasons, uncertainty, and outcomes rather than hard-coded success claims |
| District objectives and persistent city damage | Balance after damage and wave accounting are reliable |

Record CPU simulation-step time, CPU render preparation, GPU/frame time when available, p50/p95
frame times, draw calls, active entities, and pool usage for idle, ordinary waves, and sustained
load. Compare identical seeds and hardware. Prefer reducing cosmetic load over changing simulation
rules or silently deleting threats to meet a frame-rate target.

## 10. Review points and completion criteria

The proposed defaults are a 60 Hz simplified game model, gravity 9.82, radians internally, preserved
initial damage curves, suspension during blocked/hidden gameplay, and optional advanced systems
disabled. These defaults guide the authorized implementation; numeric balance values remain separate.

Before phase 2 is complete, document the default guided-launch model, its validation horizon, and
residual tolerance. Before phase 4, document the supported environmental envelope and noise model.
These choices must not be inferred from historical comments or claims of realism.

The first release is complete when active-path acceptance cases pass, browser gates are verified,
timing is frame-rate independent at equal ticks, counters and render state remain consistent, and
profiling shows no unexplained regression. Publish remaining optional failures and baseline tooling
errors explicitly. Update the architecture and physics references to match the final implementation.

## 11. Complete audit findings register

This register includes the findings from both research passes, including successful checks,
source-only observations, performance candidates, and unverified visual consequences. Inclusion
here does not expand the first-release scope in section 3. All defects remain open; no fixes
were made as part of the audit or this specification.

**Evidence labels:** **Reproduced failure** means a controlled probe failed its stated expectation;
**Passed check** is limited to that probe; **Source finding** identifies an inspected code path
without an end-to-end reproduction; **Candidate** requires profiling or product evaluation.
High priority means active gameplay correctness; medium priority covers presentation or integration
risk; optional-model work is gated by phase 4 regardless of its mathematical severity. The numeric
probe counts refer only to sections 11.1 and 11.2, not the additional source observations.

### 11.1 Every numerical probe

| ID | Audited check | Evidence | Observed result and applicable path | Source / follow-up |
| --- | --- | --- | --- | --- |
| NUM-01 | vacuum position and velocity against independent constants | Passed check | Position V(40,100.36,0), velocity V(20,-9.64,0); correct for the specified vacuum case. | [physics/ballistics.ts](../src/physics/ballistics.ts); TRAJ-01 |
| NUM-02 | vacuum mechanical energy conserved | Passed check | Specific mechanical-energy difference was zero in the vacuum probe. | [physics/ballistics.ts](../src/physics/ballistics.ts); TRAJ-02 |
| NUM-03 | vacuum launch angle round trips over range-height grid | Passed check | All 24 feasible low/high arcs passed; maximum target-height residual 2.75e-11 m. | [physics/ballistics.ts](../src/physics/ballistics.ts); TRAJ-02 |
| NUM-04 | zero-range launch returns finite angles or no solution | Reproduced failure | Coincident/zero-range request returned NaN for both angles. Helper boundary case. | [physics/ballistics.ts](../src/physics/ballistics.ts); TRAJ-03 |
| NUM-05 | lofted launch still reaches requested target | Reproduced failure | Altered loft returns 40° and y=50.4417 m at target x=100 m. Used in gameplay launch planning, but later guidance may compensate; this is not a measured final gameplay miss. | [utils/TrajectoryCalculator.ts](../src/utils/TrajectoryCalculator.ts); TRAJ-08 |
| NUM-06 | constant velocity equal-speed head-on crossing | Reproduced failure | Equal-speed head-on case has exact t=5 s; pure helper returned null. | [physics/interception.ts](../src/physics/interception.ts); TRAJ-05 |
| NUM-07 | basic solver finds crossing between 0.1s samples | Reproduced failure | Exact t=1.05 s crossing falls between samples; basic-mode solver returned null. | [utils/TrajectoryCalculator.ts](../src/utils/TrajectoryCalculator.ts); TRAJ-04 |
| NUM-08 | improved solver rejects interception after ground impact | Reproduced failure | Default improved solver returned t=2.187953 s, y=-44.360456 m, confidence=0.9. Wrong ground root permits an invalid solution. | [utils/ImprovedTrajectoryCalculator.ts](../src/utils/ImprovedTrajectoryCalculator.ts); TRAJ-06 |
| NUM-09 | improved equal-speed off-grid crossing accuracy | Reproduced failure | Exact t=5.05 s equal-speed crossing returned null in the improved iterative fallback. | [utils/ImprovedTrajectoryCalculator.ts](../src/utils/ImprovedTrajectoryCalculator.ts); TRAJ-05 |
| NUM-10 | advanced gravity independent of object mass | Reproduced failure | For masses 1/10/100 kg, gravity-only velocities were -9.806342/-0.980634/-0.098063 m/s. Optional model divides gravity by mass. | [physics/AdvancedBallistics.ts](../src/physics/AdvancedBallistics.ts); ADV-01 |
| NUM-11 | advanced density at sea level uses supplied temperature | Reproduced failure | At sea level, 30°C and dry air: expected 1.164386 kg/m³, actual 0.891709. Optional model combines temperature and pressure inconsistently. | [physics/AdvancedBallistics.ts](../src/physics/AdvancedBallistics.ts); ADV-02 |
| NUM-12 | advanced high-altitude density remains finite | Reproduced failure | Density at 50 km returned NaN. Stress-domain test, not a claim that default gameplay uses this model there. | [physics/AdvancedBallistics.ts](../src/physics/AdvancedBallistics.ts); ADV-03 |
| NUM-13 | drag opposes relative air velocity at ordinary speed | Passed check | At ordinary speed, drag opposed velocity relative to the supplied wind. This pass does not validate high-speed behavior. | [physics/AdvancedBallistics.ts](../src/physics/AdvancedBallistics.ts); ADV-03 |
| NUM-14 | high-speed drag never becomes thrust | Reproduced failure | At 5000 m/s, computed drag x was +686303.2 N, in the direction of motion. Negative drag coefficient outside the valid extrapolation range; optional stress case. | [physics/AdvancedBallistics.ts](../src/physics/AdvancedBallistics.ts); ADV-03 |
| NUM-15 | drag-only integration does not reverse velocity | Reproduced failure | A 0.1 s drag-only step changed +100 m/s to -400 m/s. Pure helper overshoots, reverses motion, and increases kinetic energy. | [physics/ballistics.ts](../src/physics/ballistics.ts); ADV-04 |
| NUM-16 | pure PN responds within engagement plane | Passed check | Pure navigation helper returned the expected planar acceleration V(0,0.3,0). | [physics/interception.ts](../src/physics/interception.ts); NAV-01 |
| NUM-17 | class PN responds within engagement plane | Reproduced failure | Alternate navigation class returned V(0,0,0.003), wrong axis and magnitude; not the default Projectile flight law. | [physics/ProportionalNavigation.ts](../src/physics/ProportionalNavigation.ts); NAV-01 |
| NUM-18 | class PN coincident positions remain finite | Reproduced failure | Coincident positions produced NaN acceleration, requiredG, and timeToGo in the alternate class. | [physics/ProportionalNavigation.ts](../src/physics/ProportionalNavigation.ts); NAV-02 |
| NUM-19 | predicted miss distance at zero relative velocity is separation | Reproduced failure | Equal velocities and 10 m separation produced NaN instead of a finite 10 m predicted miss. | [physics/ProportionalNavigation.ts](../src/physics/ProportionalNavigation.ts); NAV-02 |
| NUM-20 | proximity fuse detects swept crossing | Reproduced failure | Armed sweep from x=-10 to +10 across an 8 m radius produced no detonation at either sample. Active fuse path. | [systems/ProximityFuse.ts](../src/systems/ProximityFuse.ts); FUSE-01 |
| NUM-21 | optimal detonation handles equal velocities | Reproduced failure | Equal velocities and 5 m separation produced NaN position/time/distance in the optional detonation predictor. Active fuse uses a separate implementation. | [systems/BlastPhysics.ts](../src/systems/BlastPhysics.ts); FUSE-02 |
| NUM-22 | blast probability bounded and non-increasing at fixed velocity | Passed check | Fixed-condition probabilities at distances 0/3/6/10/15/20 m were 0.95/0.95/0.8/0.3/0/0. Bounded and non-increasing in this case. | [systems/BlastPhysics.ts](../src/systems/BlastPhysics.ts); DAMAGE-01 |
| NUM-23 | pure Kalman agrees with independently calculated scalar gain | Passed check | Pure Kalman update matched independent scalar-gain result: x/vx/ax=9.7826087/6.5217391/2.1739130. | [physics/kalman.ts](../src/physics/kalman.ts); TRACK-01 |
| NUM-24 | class Kalman agrees with independently calculated scalar gain | Passed check | Class Kalman update matched the same independent scalar-gain result. | [utils/KalmanFilter.ts](../src/utils/KalmanFilter.ts); TRACK-01 |
| NUM-25 | Kalman repeated updates preserve covariance symmetry and nonnegative variances | Passed check | Across 1000 updates, minimum diagonal variance was 0.342647 and maximum asymmetry 2.66e-14. This did not test positive semidefiniteness of the full matrix. | [physics/kalman.ts](../src/physics/kalman.ts); TRACK-03 |
| NUM-26 | tracker future-position query is repeatable and read-only | Reproduced failure | Two identical one-second forecasts advanced the live track from x=0 to 10 then 20; y changed 100→95.095→80.38. Tracker is not instantiated in the default game path found in the audit. | [utils/ThreatTracker.ts](../src/utils/ThreatTracker.ts); TRACK-02 |
| NUM-27 | game-order force application independent of render FPS | Reproduced failure | Same one-second force experiment at 30/60/120 FPS gave vx=4.833333/9.833333/19.833333. Probe reproduces game update order; these are not measured browser FPS figures. | [main.ts](../src/main.ts); TIME-01 |
| NUM-28 | 10x time scale advances ten simulation seconds per wall second | Reproduced failure | At 10× and 60 FPS, a unit-speed body traveled 3 m rather than 10 m because only three fixed steps were allowed per frame. Synthetic capacity case. | [main.ts](../src/main.ts); TIME-02 |
| NUM-29 | mortar azimuth construction preserves target bearing | Reproduced failure | A target bearing of 90° became 1.570796°. Both mortar constructors supply radians to the degree-based velocity converter. | [scene/ThreatManager.ts](../src/scene/ThreatManager.ts); TRAJ-07 |

Numerical subtotal: **29 probes, 9 passes, 20 failures**. The successful results must remain covered;
replacing entire modules without preserving them would lose validated behavior. Lofting and
out-of-envelope atmospheric tests expose model-contract issues; they do not establish a measured
in-game miss distance or a supported real-world flight envelope.

### 11.2 Every integration probe

| ID | Audited check | Evidence | Observed result | Source / follow-up |
| --- | --- | --- | --- | --- |
| INT-01 | instanced city participates in collision and damage queries | Reproduced failure | One building existed in the instanced renderer, collision queries returned zero, and applying 50 damage left health at 100. | [world/BuildingSystem.ts](../src/world/BuildingSystem.ts); CITY-01 |
| INT-02 | clearAll releases threat rendering slots | Reproduced failure | clearAll removed all gameplay threats but left one allocated threat-rendering slot. Visual ghosts need browser confirmation; resource mismatch is reproduced. | [scene/ThreatManager.ts](../src/scene/ThreatManager.ts); LIFE-01 |
| INT-03 | moving threat updates culling bounds | Reproduced failure | After moving a threat to V(100,50,0), cached bounds remained centered at the origin with radius zero. Actual camera-dependent disappearance still needs browser confirmation. | [rendering/InstancedThreatRenderer.ts](../src/rendering/InstancedThreatRenderer.ts); RENDER-01 |
| INT-04 | auto-repair receives ten seconds of elapsed time | Reproduced failure | At 2 HP/s for ten simulated seconds, health stayed at 50 rather than reaching 70 because the setter resets the repair timestamp. | [entities/IronDomeBattery.ts](../src/entities/IronDomeBattery.ts); BAT-01 |
| INT-05 | laser configured DPS holds across duplicated game updates | Reproduced failure | Configured 20 DPS produced 30/40/60 damage over one second at 30/60/120 FPS under the two-update caller pattern. Energy consumption and recharge use the same duplicated update owner. | [entities/LaserBattery.ts](../src/entities/LaserBattery.ts); BAT-02 |
| INT-06 | laser satisfies placement destruction-event contract | Reproduced failure | LaserBattery has no on method; game-mode placement calls battery.on for destruction. The missing method was verified without a browser placement flow. | [game/DomePlacementSystem.ts](../src/game/DomePlacementSystem.ts); BAT-03 |
| INT-07 | paused wave cannot award completion credits | Reproduced failure | Invoking the retained wave deadline while paused completed one wave and awarded 100 credits. Controlled timers; no saved game state was modified. | [game/WaveManager.ts](../src/game/WaveManager.ts); TIME-03 |
| INT-08 | projectile lifetime excludes paused duration | Reproduced failure | A 30-second-lifetime projectile was inactive on resume after 31 wall seconds with no simulation updates. | [entities/Projectile.ts](../src/entities/Projectile.ts); TIME-04 |
| INT-09 | impact ETA remains valid when simulation is paused | Reproduced failure | An unchanged threat’s ETA decreased from 4.512937 seconds to zero during ten seconds of simulated wall-clock pause. | [entities/Threat.ts](../src/entities/Threat.ts); TIME-04 |
| INT-10 | battery capability check rejects an underground intercept solution | Reproduced failure | The actual battery capability method returned true for a case whose predicted interception occurs underground. Radar/stock dependencies were controlled. | [entities/IronDomeBattery.ts](../src/entities/IronDomeBattery.ts); TRAJ-06 |

Integration subtotal: **10 probes, 10 failures**. These run real methods with selected dependencies
controlled; they do not substitute for the desktop/mobile browser acceptance matrix.

### 11.3 Additional gameplay, visual, and model findings

These observations were initially identified in source review. Section 12 promotes specific claims
to executed evidence where validated; untested portions retain their source-only status. Some explain multiple reproduced failures;
they must not be counted again as independent probe failures. Priority and disposition are proposed.

| ID | Priority / scope | Source finding and consequence | Required follow-up |
| --- | --- | --- | --- |
| SRC-01 | High; active timing | [main.ts](../src/main.ts), [InterceptionSystem](../src/scene/InterceptionSystem.ts), [ThreatManager](../src/scene/ThreatManager.ts), and [WaveManager](../src/game/WaveManager.ts) mix scaled physics time, unscaled render deltas, fixed 1/60 updates, and wall clocks. Shop slow motion therefore does not scale guidance, laser damage, reloads, and deadlines together. Day/night updates run outside the pause guard. | Phase 1; TIME-01–04; explicitly test effects, reloads, spawning, and day/night in addition to projectile motion |
| SRC-02 | High; legacy city path | [ThreatManager](../src/scene/ThreatManager.ts) uses a 24×24×80 box for every building, checks only below altitude 100, and tests a sampled point. Even after fixing the empty instanced registry, variable buildings can be missed or hit in empty space, and fast threats can pass through. | Phase 3; CITY-02; real dimensions, projectile radius, and swept contact |
| SRC-03 | High; active accounting | Removal uses isActive and altitude >5 to infer a successful interception. A laser destroys its threat before removal and can become a miss; payload deployment or an airborne building/drone impact can become a kill. [ThreatManager](../src/scene/ThreatManager.ts), [LaserBattery](../src/entities/LaserBattery.ts). | Phase 3; LIFE-02; explicit cause and wave identity |
| SRC-04 | High; laser lifecycle | [LaserBattery](../src/entities/LaserBattery.ts) always reports health 100/100; repair and auto-repair methods do nothing. Some impact damage paths call methods not supplied by this battery type, while other paths only damage IronDomeBattery. | Phase 3; BAT-03; exercise both direct and splash damage, destruction, and repair |
| SRC-05 | High; wave lifecycle | [WaveManager](../src/game/WaveManager.ts) ends a wave on its duration timer without requiring all threats to be resolved. Timers for preparation/next wave are not suspended by pauseWave. startWave selects only threatTypes[0] unless mixed, so the listed rocket/mortar/drone progression does not actually select those added types before mixed mode. | Phases 1/3; test unspawned and surviving threats, pause in every wave phase, and configured type distribution |
| SRC-06 | Medium; mobile visual/interaction | [index.html](../src/index.html) forces the rotation overlay on narrow portrait screens while [checkOrientation](../src/main.ts) returns before pausing. The player can be blocked from play while the simulation proceeds. Source-confirmed conflict; not screenshot-verified. | Phase 5 browser gate; pause/resume and orientation-state preservation |
| SRC-07 | High; manual launch fallback | [IronDomeBattery](../src/entities/IronDomeBattery.ts) also constructs fallback azimuth with atan2 in radians for the degree-based converter. This is separate from the two mortar paths reproduced in NUM-29. | Phase 2; TRAJ-07; cover fallback activation and all quadrants |
| SRC-08 | High; launch/prediction mismatch | [IronDomeBattery](../src/entities/IronDomeBattery.ts) plans from the battery position, spawns at a tube offset, alters loft, then blends 70% tube direction with 30% calculated direction. Solvers assume simpler motion; projectile steering compensates later. [Projectile](../src/entities/Projectile.ts) adds Cannon damping while analytic predictions are vacuum-based; gravity constants differ between modules. | Phase 2; explicit prediction model and actual launch state; guided-flight integration tests; do not treat planning confidence as a success guarantee |
| SRC-09 | Medium; HUD accuracy | [main.ts](../src/main.ts) passes a fixed 0.95 success-rate value to [TacticalDisplay](../src/ui/TacticalDisplay.ts). Its performance interceptor count uses an empty systemInterceptors local while paused, although active system interceptors still exist. These inputs can misrepresent performance/current activity. | Phase 3/5; display live defined metrics or label estimates; pause must preserve counts |
| SRC-10 | Medium; load handling | [ThreatManager](../src/scene/ThreatManager.ts) removes oldest threats at its memory cap or explicit cleanup without normal outcome events. [InterceptionSystem](../src/scene/InterceptionSystem.ts) also has a hard-coded eight-active-interceptor cap. These are gameplay-affecting limits, not just rendering optimizations. | Phase 3 then profiling; explicit capacity outcome/backpressure policy; reconcile platform/configuration limits |
| SRC-11 | Optional; navigation | [ProportionalNavigation](../src/physics/ProportionalNavigation.ts) does not initialize previousTime on its first sample; the next augmented update uses elapsed time from zero. Terminal compensation multiplies acceleration by time, then adds it to acceleration. A unified instance also owns one history-bearing navigation object. | Phase 4; dimensional review, first/second-update tests, and independent engagement histories |
| SRC-12 | Optional; environmental model | [AdvancedBallistics](../src/physics/AdvancedBallistics.ts) treats Coriolis acceleration as a force before division by mass; its Magnus spin axis is parallel to relative velocity, so the cross product is zero. Gravity uses position.y plus environmental altitude, while drag density uses environmental altitude alone. | Phase 4; make inputs/units consistent and remove or correctly define unsupported effects |
| SRC-13 | Optional; firing solution | [AdvancedBallistics](../src/physics/AdvancedBallistics.ts) ignores targetVel, refines against ground impact, and does not enter its simulation loop for a launch at y=0. The [unified facade](../src/systems/UnifiedTrajectorySystem.ts) leaves environmental interception correction as a TODO. | Phase 4; explicit supported contract and tests before enabling; no claim that the advanced switch supplies wind-aware interception |
| SRC-14 | Optional; filter model | [KalmanFilter](../src/utils/KalmanFilter.ts) initializes gravity for every type, including drones; process noise is added per predict call without scaling by elapsed time. [ThreatTracker](../src/utils/ThreatTracker.ts) also uses a different position-integration approximation for plotted paths. Passing matrix checks do not validate those motion/noise assumptions. | Phase 4; stationary/constant-altitude and time-partition tests; model-specific initialization and consistent forecasts |
| SRC-15 | Active damage model; validity claim | [BlastPhysics](../src/systems/BlastPhysics.ts) ignores warheadMass, blastRadius, and fragmentationRadius in calculateDamage. Its relativeSpeed is target speed rather than relative velocity. Randomness is embedded in probability evaluation; returned damage can exceed the separately clamped killProbability. | Phase 3; DAMAGE-01; explicit game-model semantics, bounded outputs, injected randomness, and documented/deprecated inputs; no real-world accuracy claim |
| SRC-16 | Active architecture; test gap | Default flight uses [Projectile](../src/entities/Projectile.ts), while several test simulations use pure helpers or [GuidanceSimulator](../src/systems/GuidanceSimulator.ts). Active predictive history is not Kalman filtering. The [interception system](../src/scene/InterceptionSystem.ts) computes a lead prediction but does not use it as the projectile steering target. | Phases 0–3; verify the exact production call path and eliminate misleading capability claims |
| SRC-17 | Conditional rendering risk | [InstancedThreatRenderer](../src/rendering/InstancedThreatRenderer.ts) expects scene.userData.camera, but the audited entry point stores other camera references. If connected later, its 500 m distance cutoff can hide objects in a game with much longer spawn/view distances. This cutoff was not established as an active visual bug. | Phase 5; test camera wiring and distance policy before enabling it; distinguish from reproduced stale bounds |
| SRC-18 | Active steering; source-review concern | [Projectile.updateGuidance](../src/entities/Projectile.ts) uses a cross-product axis as an added turning correction and mixes that mass-scaled correction into a velocity error; its re-engagement closing test uses a negative direction dot product. Ordinary default steering is separate from the faulty optional PN class. | Phase 3; planar/mirrored re-engagement and dimensional tests before claiming default steering is correct; no full-flight reproduction yet |

### 11.4 Performance findings and measurement status

No frame-time or GPU improvement has been measured. Section 12 adds controlled execution of
PERF-01–04; it does not establish optimization gains. The following preserve concrete code
observations behind the optimization ideas, rather than presenting the ideas as proven wins.

| ID | Evidence / source | Finding | Next validation |
| --- | --- | --- | --- |
| PERF-01 | Source finding; [BuildingSystem](../src/world/BuildingSystem.ts), [InstancedBuildingRenderer](../src/rendering/InstancedBuildingRenderer.ts) | The instanced lighting path is called every frame and returns before the legacy ten-second throttle. It scans buildings and evaluates window lighting even when little changes. | Measure CPU cost; trigger/throttle meaningful lighting changes while preserving transitions |
| PERF-02 | Source finding; [PooledTrailSystem](../src/rendering/PooledTrailSystem.ts) | Every update counts segments, repacks active trails, and dirties both full-sized attributes; updateQueue does not limit this work. needsUpdate is assigned redundantly. | Compare partial-update ranges and bounded writes; measure CPU/GPU upload cost and continuity |
| PERF-03 | Source finding; [PooledTrailSystem](../src/rendering/PooledTrailSystem.ts) | MAX_TRAILS is not enforced on creation; totalPoints/drawRange are calculated without clamping to the 50,000-point backing arrays. Capacity overrun is a risk, not a reproduced default-wave failure. | Stress actual pool saturation and reset; require explicit allocation failure or bounded degradation, not out-of-range draws |
| PERF-04 | Source finding; [DeviceCapabilities](../src/utils/DeviceCapabilities.ts), [main.ts](../src/main.ts) | FPS adaptation changes the stored renderScale, but canvas sizing is applied at initialization/resize. Quality is reduced from individual low-FPS frames and has no recovery path. | Verify real render-target dimensions; average samples, add hysteresis/recovery, and measure sustained performance |
| PERF-05 | Source finding; [ThreatManager](../src/scene/ThreatManager.ts), [Projectile](../src/entities/Projectile.ts), [InstancedThreatRenderer](../src/rendering/InstancedThreatRenderer.ts) | Active lists and vectors are allocated repeatedly. The legacy building scan also creates boxes/vectors per threat/building pair. Duplicate battery updates add unnecessary work as well as changing gameplay. | Fix ownership first; then profile allocations and consider scratch objects/spatial queries without introducing mutable aliasing |
| PERF-06 | Candidate; current rendering settings in [main.ts](../src/main.ts) | Very wide camera depth range and large-area shadow coverage warrant checks for depth precision, shadow quality, and cost. Their visible severity was not verified. | Inspect near/far scenes and shadow artifacts in the browser; measure before changing settings |

### 11.5 Tooling, coverage, and unresolved verification

| ID | Finding | Evidence and disposition |
| --- | --- | --- |
| QA-01 | Test setup is not reliable through the advertised command | First default run: 214 pass, 13 fail, 1 unhandled error; failures included missing window and import initialization errors. Explicitly preloading tests/setup.ts produced 228 pass, 0 fail. Do not report the initial failures as 13 proven physics bugs |
| QA-02 | Typecheck is not clean | Earlier baseline contained 348 errors, across active and alternate paths, including battery contracts, cache API signatures, and stale modules. Track touched-path fixes and pre-existing debt separately |
| QA-03 | Successful build is weaker than behavioral validation | Production bundle completed, but this did not execute the browser interaction paths or validate physics. The build also does not make TypeScript diagnostics disappear |
| QA-04 | Some existing assertions are too weak | [trajectory-systems.test.ts](../tests/trajectory-systems.test.ts) checks navigation vector type/magnitude without expected direction, and advanced trajectory output types without numerical correctness. One atmosphere fixture supplies pressure 101325 to an hPa API. Add independent numerical assertions and correct fixture units |
| QA-05 | Deterministic helper simulations differ from gameplay | [deterministic-simulation.test.ts](../tests/integration/deterministic-simulation.test.ts) invokes pure helpers rather than the production game loop. Preserve those useful checks and add production-path timing, ownership, and lifecycle regressions |
| QA-06 | Browser capture and interaction proof are missing | In-app browser selection returned unavailable and browser discovery returned no connected browsers. No screenshots, mobile runs, console-health inspection, or real GPU/FPS measurements were obtained in the initial audit. Section 12 supersedes this limitation for the specified headless desktop/viewport checks |
| QA-07 | Physics validity is conditional | Ordinary vacuum and Kalman checks passed; exceptional geometry, optional advanced models, and stateful integration failed. Determinism alone does not imply correct physics, and game probability curves are not physical calibration |
| QA-08 | Local runtime discovery issue | Bun was initially missing from PATH; an existing Bun 1.2.16 executable under /tmp/irondome-bun was used. No runtime/dependency installation was performed. Repository commands should remain portable and must not embed this temporary path |

### 11.6 Enhancement ideas retained from the research

These are proposals rather than bugs or authorized implementation tasks. Preserve them in the
backlog even when they fall outside the first correctness release.

| ID | Proposal | Intended value / prerequisite |
| --- | --- | --- |
| IDEA-01 | Seeded scenario playback and replay UI | Reproduce incidents, inspect near misses, compare physics changes; depends on simulation-clock and RNG work |
| IDEA-02 | Explain why a battery fired or declined | Show range, ammunition, predicted impact, current assignments, and solver rejection reasons derived from real state |
| IDEA-03 | Distinct threat silhouettes | Improve recognition at a glance; evaluate existing models and distance scaling in actual play first |
| IDEA-04 | Off-screen threat indicators | Keep distant threats understandable without forcing constant camera searching; validate clutter and prioritization |
| IDEA-05 | Impact uncertainty areas and optional trajectory overlays | Communicate predictions and uncertainty honestly; depends on validated forecasts and the selected motion model |
| IDEA-06 | District health and protected objectives | Give city defense measurable consequences; requires the shared building registry and correct damage accounting |
| IDEA-07 | Persistent visible building damage | Preserve consequences across a wave/session as designed; separate game health from visual effects |
| IDEA-08 | After-wave defense and ammunition breakdown | Explain damage prevented, damage received, outcomes, and ammunition expenditure using corrected counters |

### 11.7 Traceability and closing findings

The record contains **29 numerical probes, 10 integration probes, 18 additional source findings,
6 performance observations/candidates, 8 QA findings, and 8 enhancement ideas**. These categories
overlap in root cause and are not additive counts of distinct bugs. All 39 original probe names and outcomes
are retained individually above; additional validation results are in section 12. Related acceptance
cases are intentionally consolidated in section 7.

Use NUM/INT/SRC/PERF/QA/IDEA IDs when referencing work. Closing a reproduced or source finding
requires a production-path regression and an explanation of the final behavior. Closing a visual
finding additionally requires browser evidence. Profiling closes performance claims; a build alone
does not. Optional modules may remain explicitly deferred rather than being described as repaired.
Enhancement ideas require a separate product decision and are not completed by fixing prerequisites.

## 12. Validation pass — 2026-09-05

### 12.1 Reproduction environment and baseline

Revalidated the unchanged game at commit `f07a4e9` using the existing Bun 1.2.16 executable.
No dependencies were installed and no game source, configuration, or repository tests were changed.
Temporary tests and logs are under `/tmp/irondome-validation-20260905/`; those paths are local,
ephemeral evidence, not prerequisites for building the game.

| Check | Rerun result |
| --- | --- |
| Default `bun test` | 214 pass, 13 fail, 1 unhandled error; setup/import problem persists |
| `bun test --preload ./tests/setup.ts` | 228 pass, 0 fail across 31 files |
| Original NUM-01–29 | Same 9 passes and 20 failures; no harness exceptions |
| Original INT-01–10 | Same 10 failures; no harness exceptions |
| Additional VAL-01–26 | 24 failed expectations, 1 correctness pass, 1 successful characterization |
| Typecheck | 348 TypeScript diagnostics; unchanged baseline |
| Production build | Passed with output redirected outside the repository |

The original probe scripts also require `--preload ./tests/setup.ts`. An initial attempt without
that preload failed during import (`window is not defined`); it produced no numerical evidence.
The completed reruns above use the preload. New checks use Bun `describe`/`test` blocks and call
real methods with controlled clocks, lightweight dependencies, and in-memory Three/Cannon objects.
All 26 completed without harness exceptions. Their expected failures are deliberately reported by
the test runner as failures; this is validation of the findings, not a green regression suite.

Across both passes there are **65 targeted checks: 54 failed expectations, 10 correctness passes,
and 1 characterization pass**. These are selected counterexamples and contract checks, with shared
root causes. They are not 54 distinct bugs or an estimate of the game's overall failure rate.

### 12.2 Additional executed checks

A characterization pass means the observed implementation behavior was reproduced; it is not
approval of that behavior. Performance expectations here describe unnecessary work or missing
policy, not a measured frame-rate regression. Model/policy expectations remain subject to the
specification's proposed contracts.

| ID | Finding | Expectation / observed result | Validation |
| --- | --- | --- | --- |
| VAL-01 | SRC-05 | Paused preparation should remain paused; invoking its retained callback emitted waveStarted and activated the wave. | Reproduced failed expectation |
| VAL-02 | SRC-05 | Paused inter-wave delay should not advance; callback changed wave number 1→2. | Reproduced failed expectation |
| VAL-03 | SRC-05 | Wave with zero spawned threats and a controlled survivor should not complete; deadline completed it and awarded 100 credits. | Reproduced failed expectation |
| VAL-04 | SRC-05 | Wave 4 config lists rockets, mortars, drones; production startWave selected rockets only. | Reproduced failed expectation |
| VAL-05 | PERF-03 | Declared 500-trail allocation limit accepted 501 trails. | Reproduced failed expectation |
| VAL-06 | PERF-03 | Synthetic 100-trail stress case with 300 stored points each requested 59,800 vertices from a 50,000-vertex buffer. This is not a default-wave load. | Reproduced failed expectation |
| VAL-07 | PERF-02 | An unchanged two-point trail still advanced both attribute versions 2→4 on the next update; no new points were supplied. | Reproduced failed expectation |
| VAL-08 | PERF-01 | Sixty identical time-of-day calls invoked the instanced lighting path 60 times despite a frozen clock. | Reproduced failed expectation |
| VAL-09 | PERF-04 | After 10 low-FPS samples renderScale reached 0.5; 600 good samples left it at 0.5. This tests adaptation logic, not measured device FPS. | Reproduced failed expectation |
| VAL-10 | SRC-03 | A threat already marked inactive, as after laser destruction, emitted threatMissed on the actual manager update path. | Reproduced failed expectation |
| VAL-11 | SRC-10 | clearOldestThreats removed one active threat and emitted no outcome event. | Reproduced failed expectation |
| VAL-12 | SRC-02 | A 10 m-high building was damaged by a threat at y=50 m, above its actual roof, through the legacy collision query. | Reproduced failed expectation |
| VAL-13 | SRC-02 | A 150 m-high building received no hit from a threat at y=110 m inside it. | Reproduced failed expectation |
| VAL-14 | SRC-03 | An actual building hit at y=50 m emitted threatDestroyed, incorrectly awarding interception classification. | Reproduced failed expectation |
| VAL-15 | SRC-04 | LaserBattery.takeDamage is undefined; this validates the missing contract, not the full browser purchase/destruction flow. | Reproduced failed expectation |
| VAL-16 | SRC-15 | Fixed-random head-on damage returned damage=1.425 while killProbability was clamped to 1. | Reproduced failed expectation |
| VAL-17 | SRC-15 | Setting warheadMass, blastRadius, and fragmentationRadius to zero left the same damage=0.933333 result. Characterization confirms those inputs have no effect in this case. | Characterization confirmed |
| VAL-18 | SRC-14 | Constant-altitude drone forecast dropped y=100→95.095 after one second. | Reproduced failed expectation |
| VAL-19 | SRC-14 | predict(0) changed acceleration variance 100→105 despite no elapsed time. | Reproduced failed expectation |
| VAL-20 | SRC-14 | One 1 s prediction gave position uncertainty 15; ten 0.1 s predictions gave 15.063752. | Reproduced failed expectation |
| VAL-21 | SRC-11 | The same two-sample augmented-PN geometry at different wall-clock epochs produced acceleration magnitudes differing by orders of magnitude. | Reproduced failed expectation |
| VAL-22 | SRC-13 | Upward launch from y=0 returned timeOfFlight=0 and the unchanged launch point in the optional trajectory simulator. | Reproduced failed expectation |
| VAL-23 | SRC-18 | Ordinary production Projectile guidance preserved the XY engagement plane: force.z=0 in the controlled case. | Passed check |
| VAL-24 | SRC-18 | Re-engagement for the same planar geometry added force.z≈400 N with a 1 kg body. | Reproduced failed expectation |
| VAL-25 | SRC-18 | At 15 m separation, moving toward the target at 100 m/s left re-engagement active. | Reproduced failed expectation |
| VAL-26 | SRC-18 | At 15 m separation, moving away at 100 m/s incorrectly ended re-engagement. | Reproduced failed expectation |

Building collision checks supplied a populated legacy registry to isolate geometric/accounting
errors from INT-01's empty instanced registry. Sound and visual effects were stubbed; collision
selection and manager outcome emission ran unchanged. VAL-10 supplies the inactive state produced
by laser destruction; it does not simulate a complete laser engagement. Guidance probes invoke the
actual private production method; they are force/state checks, not full-flight success measurements.

### 12.3 Browser validation

Browser discovery reported `No browser is available` and an empty browser list. After the user
approved a fallback, testing used the already-installed Chrome 152 and Playwright 1.57 through Bun.
No browser or package installation was performed. The development server was
`http://localhost:3000/`, titled **Iron Dome Simulator**. Each run used a fresh isolated browser
context; saved personal sessions were not used. Screenshots were inspected after capture.

Desktop runs used 1440×900 and 1024×768. The responsive run resized a desktop browser context to
390×844 portrait and 844×390 landscape. This validates CSS and viewport transitions; it is not a
physical phone, touch-input, or mobile-device capability test. Headless rendering and screenshot
stalls are not representative hardware performance measurements. City generation was unseeded.

| Required browser check | Result |
| --- | --- |
| Page identity | Passed: expected localhost URL and title |
| Meaningful rendering | Passed: initial interaction dismissed loading; city, battery, radar, and controls rendered |
| Framework error overlay | Passed in sandbox; failed on GAME selection with a runtime overlay |
| Console health | Failed overall: missing GameState method and window-pool exhaustion; material warnings also observed |
| Screenshot proof | Captured and inspected desktop gameplay, attack, focused pause, GAME crash, portrait overlay, and landscape |
| Interaction proof | Attack control increased active threats; world-focused pause/resume worked; GAME route failed; orientation transition failed its pause contract |

The first flow reached GAME and then lost its React controls. Its later SANDBOX click timed out
because the route had already crashed. That timeout is not counted as a second product defect.
Portrait checks were rerun in a fresh context without entering the broken GAME route.

| ID | Finding / priority | Reproduction and observed evidence | Disposition |
| --- | --- | --- | --- |
| BROW-01 | GAME mode crashes; high | Load sandbox, dismiss loading, click GAME. Runtime overlay: `TypeError: gameState2.getPlayerLevel is not a function`; React controls disappear. [GameUI.tsx](../src/ui/GameUI.tsx) calls a method absent from [GameState.ts](../src/game/GameState.ts). The existing typecheck also reports this exact missing method. | New confirmed blocker. Restore this contract and test mode switching before relying on game-mode wave, shop, and placement browser acceptance. No fix applied. |
| BROW-02 | Escape is swallowed by focused sandbox controls; medium | Click Launch Attack, leaving its button focused, then press Escape. pause remains false and threats move. Click the world and press Escape: pause becomes true, positions stay unchanged, and the pause menu appears. Resume Game returns pause to false. Installed lil-gui stops keydown propagation on controllers; [main.ts](../src/main.ts) listens on window. | New confirmed focus-specific input bug. Preserve text/control interaction while defining which global shortcuts must still work. Do not describe all pause handling as broken. |
| BROW-03 | Portrait overlay does not pause gameplay; high; SRC-06 | During an active attack, resize to 390×844. Overlay display is flex and fills the screenshot, but pause stays false. The same tracked threat moved from approximately (-586.966,281.990,-2589.630) to (-585.500,300.891,-2583.362) under the overlay. Landscape removes the overlay. | Promoted from source finding to browser reproduction. Test restoration of prior pause state as part of the fix. |
| BROW-04 | Default generated city exhausts its window pool; medium | Two fresh browser flows logged an unlit-window pool exhaustion at capacity 50,000. [InstancedBuildingRenderer](../src/rendering/InstancedBuildingRenderer.ts) skips creating that window when the pool is empty. This happened during normal city initialization, independently of the synthetic trail stress test. | New confirmed allocation failure. Determine capacity from generated demand or specify bounded visual degradation; measure affected windows. No claim that every random city exhausts it. |
| BROW-05 | Radar overlaps sandbox controls; medium | At 1440×900 the lower-left radar covers Time & Lighting and lower controls. At 844×390 it overlaps the attack-control panel. Screenshots show both surfaces occupying the same screen area. | New confirmed layout conflict in these desktop-context viewports. Separate their layout regions or provide a deliberate collapsible layout; actual touch interaction remains untested. |
| BROW-06 | Unsupported material properties; low | Browser logs say emissive and emissiveIntensity are not properties of MeshBasicMaterial. Calls with those fields exist in [FragmentationSystem](../src/systems/FragmentationSystem.ts), [LaserBeam](../src/entities/LaserBeam.ts), and debug markers. | Confirmed warning; property compatibility needs correction. Which visual contribution is missing was not measured, and not every listed path was activated. |
| BROW-07 | Renderer slots survive Clear Skies; high; INT-02 | After Clear Skies the browser held 2 live threats versus 24 renderer slots; a second flow that stopped attacks before clearing held 2 versus 23. Controlled INT-02 independently proved zero gameplay threats versus one retained slot. Delayed/spontaneous spawning makes the live count transient. | Browser supports the allocation mismatch. Do not infer exact ghost count from slots or claim Clear Skies cancels pending salvos. Camera-visible ghosts remain unproven. |
| BROW-08 | City registry and threat bounds disagree with live world; high; INT-01/03 | A captured live scene contained 106 rendered buildings but zero gameplay-query buildings. Moving threat meshes retained bounding-sphere radius zero at the origin. | Active browser state corroborates controlled probes. Specific camera-dependent disappearance and individual building hit screenshots remain pending. |

AudioContext autoplay warnings before the first user gesture are expected browser restrictions;
they are not classified as new game defects. ReadPixels GPU-stall messages occurred during
headless screenshot capture and do not establish ordinary gameplay frame-time cost.

### 12.4 What remains unvalidated

The investigation confirms counterexamples; it does **not** establish full correctness of any
system. No finding is closed and no enhancement is implemented by this validation pass.

| Area | Remaining validation |
| --- | --- |
| SRC-01, clock and ownership | Existing probes confirm mismatched clocks/update ownership. Exhaustive simulation-rate sweeps, hidden-tab behavior, all timers/effects, and complete deterministic wave replay remain future regression work. The short browser pause check did not establish day/night timing correctness. |
| SRC-02/03/04/05/10/18 | New execution covers specific collisions, removal, wave callbacks, missing laser damage, capacity removal, and steering forces. Full production flights, laser hit-to-score sequences, direct/splash battery damage, and full-wave accounting remain pending. |
| SRC-07/08/09/16/17 | Manual fallback activation, actual tube-offset launch residuals, HUD values, lead-target wiring, and conditional camera cutoff remain source-supported or partially covered by related probes. No new exhaustive behavioral claim is made. |
| SRC-11/12/13/14/15 | Optional timing, ground launch, covariance, and damage cases now have more evidence. Coriolis/Magnus/density conventions, moving-target firing solutions, complete uncertainty validity, and damage-model semantics still require their declared contracts and broader tests. |
| PERF-01–04 | Controlled work counts, buffer capacity, and adaptation logic were exercised. Partial GPU uploads, real render-size adaptation, representative scene costs, and before/after optimization gains remain unmeasured. |
| PERF-05/06 and visual ghosts | CPU allocation profiles, spatial-query scaling, memory soak, GPU/shadow/depth quality, and camera-specific disappearance require targeted profiling/rendering evidence. |
| Game-mode browser flows | GAME entry is blocked by BROW-01. Purchase/unlock, shop slow motion, wave completion, laser placement, repair, and resume flows cannot be signed off through this route until it is repaired. Controlled method tests are not substitutes. |
| Mobile | Viewport resize was tested. Real mobile GPU, touch targeting/placement, orientation events, and device-adaptive quality remain untested. |
| IDEA-01–08 | Product proposals; require a behavior/design decision before meaningful acceptance testing. No current implementation is claimed. |

### 12.5 Evidence and rerun commands

All following paths are temporary local artifacts. Section 12 preserves the observations needed
for review even if those files are removed. Use an available Bun executable; this environment used
`/tmp/irondome-bun/bun-linux-x64/bun` because Bun was not on PATH.

```bash
# Run from the repository root. Expected failures are part of this audit baseline.
bun test
bun test --preload ./tests/setup.ts
bun run typecheck
bun run build.ts --outdir /tmp/irondome-validation-20260905/build
bun --preload ./tests/setup.ts /tmp/irondome-physics-audit/probes.ts
bun --preload ./tests/setup.ts /tmp/irondome-physics-audit/integration-probes.ts
bun test --preload ./tests/setup.ts /tmp/irondome-validation-20260905/additional-validation.test.ts

# Browser scripts require the local dev server and the installed browser/tool paths recorded in them.
bun /tmp/irondome-validation-20260905/browser-flows.ts
bun /tmp/irondome-validation-20260905/browser-portrait.ts
bun /tmp/irondome-validation-20260905/browser-focused-pause.ts
```

Evidence directory: `/tmp/irondome-validation-20260905/`.

- Numerical/integration evidence: `numerical-results.json`, `integration-results.json`,
  `additional-results.json`, `additional-validation.test.ts`, and `additional-suite.log`.
- Baseline: `default-suite.log`, `preloaded-suite.log`, `typecheck.log`, and `build.log`.
- Browser flows: `browser-flows.json`, `browser-portrait.json`, `browser-focused-pause.json`,
  corresponding scripts/logs, plus the initial-load capture `browser-initial.json`.
- Screenshots: `desktop-gameplay.png`, `desktop-attack.png`, `game-mode.png`, `focused-pause.png`,
  `portrait-overlay.png`, and `landscape-gameplay.png`. `desktop-paused.png` records the failed
  GUI-focused Escape attempt, not a successfully paused state.

The next implementation order should account for BROW-01 as a prerequisite to browser acceptance,
then retain the existing clock/ownership → calculation → lifecycle/collision phases. Confirmed performance defects are included in the authorized goal. Enhancement ideas remain
separate product proposals. Section 13 records the implementation status.

## 13. Authorized implementation and completion ledger

The user requested updating this spec and running a goal to fix all findings on 2026-09-05.
The goal includes all confirmed defects and validation/disposition of remaining bug candidates;
it includes optional-model repairs without enabling them by default. IDEA-01–08 are feature
proposals and remain a separate backlog. Optimizations require measured evidence; candidates may
be closed as not justified only with an explanation and supporting measurements.

Historical failed probes must become meaningful repository regressions. Do not preserve tests
that assert obsolete caller patterns (such as deliberately updating batteries twice); replace them
with tests proving the corrected production owner and retain the original evidence here.
Keep positive numerical checks. Declared model changes need independent replacement oracles.

| Work package | Findings | Current status |
| --- | --- | --- |
| Test entry point and UI access | QA-01/04/05, BROW-01/02/05/06 | Implemented; suite, production GAME access, focused Escape and responsive layout verified |
| Simulation clock and update ownership | NUM-27/28, INT-04/05/07/08/09, SRC-01/05 | Fixed-step, simulation timers, single battery owner, wave membership and production-step regressions pass |
| Valid trajectory and launch calculations | NUM-04–09/29, INT-10, SRC-07/08/16 | Finite root contracts, actual tube-exit launch and resource/cancellation regressions pass |
| Guidance, optional physics and tracking | NUM-10–19/26, SRC-11–14/18 | Numerical, facade, read-only forecast and 1000-update positive-definite covariance checks pass |
| Swept collisions, fuse, damage and outcomes | NUM-20/21/22, INT-01/06, SRC-02–05/10/15 | Real projectile/manager contact ordering, explicit outcomes, laser direct/splash damage and lifecycle checks pass |
| Rendering, resets and bounded resources | INT-02/03, SRC-17, PERF-01–03, BROW-04/07/08 | City/trail/bounds regressions and production reset allocation comparisons pass |
| Pause, responsive UI and quality | SRC-06/09, PERF-04, BROW-02/03/05 | Pause/layout and adaptive-quality regressions pass; shop speed restoration and game-mode laser placement verified |
| Profiling and remaining verification | PERF-05/06, QA-02/03/06–08 | CPU measurement and baseline diagnostic comparison complete; hardware limits recorded below |
| Enhancement proposals | IDEA-01–08 | Separate backlog; not bug-fix completion requirements |

Completion requires a per-finding disposition, focused regressions and the existing suite,
production build and asset checks, no new TypeScript/lint diagnostics in changed paths, and
browser validation of mode changes, pause/scale, battery placement/damage, city damage, and resets.
Record real-device and hardware profiling limits honestly. Never mark an untested or merely
source-edited finding fixed. Any remaining baseline tooling debt must be identified explicitly.

### 13.1 Current verification

Sections 11–12 preserve the **pre-fix baseline**. Their phrases “no fix applied” and “pending”
describe that investigation, not the current implementation. The disposition below supersedes
those historical statuses while preserving counterexamples for review.

- The advertised `bun test` now preloads the browser stubs automatically. The latest complete
  run passed 282 tests, including direct/splash laser damage, relative re-engagement closing
  speed and manual fallback bearings in all four quadrants. Five new regression files cover the actual
  production step, entities/managers, mathematical boundaries, rendering and resource ownership.
- `bun run build` and `bun run check:build` pass; the latter verifies all 45 static file references.
  Production browser execution separately exposed and corrected a minified-class-name check.
- TypeScript diagnostics fell from **348 to 250**; lint messages fell from **1138 to 781** in the final comparison. These commands still fail on baseline debt. Comparisons against HEAD
  `f07a4e9` use `(file, diagnostic/rule, message)` multisets, ignoring line shifts; no new messages
  remain. No suppressions or loosened compiler options were added.
- Browser evidence uses isolated installed Chrome 152 with SwiftShader. Production laser placement,
  health 100→75→85, one destruction event, city health 100→0, desktop/landscape non-overlap and GAME
  entry have been observed. Five repeated attack/clear cycles retain matching live threats and
  instance slots (0/0 or 1/1), zero interceptors and 1–2 physics bodies. The extra body is the live
  threat above the persistent ground body: Clear Skies clears current/pending threats while an
  enabled attack can subsequently spawn again. This is not retained renderer allocation.
- Earlier desktop flow verifies GUI-focused Escape freezes tracked positions, portrait orientation
  freezes motion, and landscape resumes. Shop Escape initially failed to restore speed; the corrected effect lifecycle now restores 2× after Escape.
  The orientation round trip retains a pre-existing user pause. Controlled wave-3 game-mode laser
  placement passes with health 85 after damage/repair, two batteries and no runtime/console errors.
- Emulated Android quality adaptation changes actual canvas dimensions from 844×390 to 422×195
  in steps while keeping its CSS size/viewport fixed. Software-renderer overload is accounted
  explicitly (9.867 executed + 5.488 dropped seconds = 15.355 requested in the observed run).
  This demonstrates bounded overload accounting and live resize, not acceptable real-device FPS.
- The two production console 404s were `/favicon.ico`; a local inline SVG icon removes that request.
  Autoplay-before-gesture and screenshot readback warnings remain browser/environment conditions.

### 13.2 Explicit model decisions

- Active target reachability and vacuum launch are separate contracts. Reachability estimates a
  constant-speed interceptor against a ballistic/level target. Actual battery launch uses a
  gravity-aware initial-velocity solve from the tube exit; guidance can subsequently alter flight.
  Both return only validated finite roots before ground contact. Vacuum Cannon damping is zero.
- Advanced atmosphere inputs use **local hPa**, Celsius, humidity fraction and reference altitude;
  ADV-02's 101325 Pa oracle is supplied as 1013.25 hPa at this API. The optional atmosphere is a
  bounded game model, not a calibrated atmosphere. Spin/Coriolis are omitted without the missing
  spin/latitude inputs. Environmental interception requires explicit environment/coefficients and
  currently supports constant-velocity targets only; unsupported calls return null.
- Class tracking uses continuous white jerk process noise scaled by elapsed time. The old
  TRACK-01 oracle remains valid for the pure discrete-noise filter. The class replacement oracle
  uses Pxx=225.05, Pvx=150.125, Pax=50+1/6 and R=5 at one second (q=1); tests independently
  calculate the gains. Zero-time and time-partition invariance are regression requirements.
- Blast damage is the named game damage-zone model. `evaluateDamage` is deterministic;
  `calculateDamage` samples one injected/seeded random draw. Outputs are bounded and relative
  speed uses both velocities. Legacy mass/blast/fragmentation fields are deprecated descriptive
  metadata, rather than unsupported physical-effect claims.
- Solid contact wins exact-time ties, followed by fuse, expiry and payload deployment. Direct
  laser damage belongs to the start of a step. Cross-system contacts are queued and sorted by
  fractional step time. Real Projectile and ThreatManager updates verify fuse-before-ground and
  ground-before-fuse cases; a separate tie oracle verifies solid-contact precedence.
- Trail limits degrade visuals explicitly: a rejected allocation returns an empty trail ID and
  increments diagnostics; no gameplay entity is removed to make a trail fit. Window buffers grow
  before demand exceeds capacity, with old instance buffers released and cached assets retained.

### 13.3 Additional defects discovered during implementation

| ID | Defect | Resolution and evidence |
| --- | --- | --- |
| IMPL-01 | Manual launch inserted one interceptor into two update arrays. | One registration owner; shared production step deduplicates ownership. Seeded force/laser timing agrees at 30/60/120 render FPS. |
| IMPL-02 | GA shallow copies allowed mutation of parents/elites/best genes while retaining obsolete fitness. | Deep snapshots and injected randomness; seeded tests independently recompute returned fitness. |
| IMPL-03 | Material keys omitted emissive settings and texture identity. | Sorted property keys/texture UUID; independent material-identity regression. |
| IMPL-04 | BatteryCoordinator used an out-of-scope interceptTime and assumed 50 laser DPS. | One scoped engagement time, configured DPS and actual target health. Production placement/engagement and suite validation. |
| IMPL-05 | Delayed tube shots could outlive targets, reload a reserved tube or over-consume stock. | Simulation timers, target/reset cancellation, reservation protection and consumption at actual launch. Real tube launch regression verifies origin, flight residual, one consumption and cancelled delayed shot. |
| IMPL-06 | Importing Projectile first triggered a class-initialization cycle through missile factory and Threat. | ThreatConfig extracted without entity imports; isolated production test imports/constructs Projectile. |
| IMPL-07 | Rendering an explosion independently inflicted damage, including payload and purely visual effects. | Combat owners exclusively apply damage at resolved contacts. A rendering-only explosion regression verifies no building damage; direct/splash laser regression verifies gameplay still applies damage. |
| IMPL-08 | getPosition read a render mesh, and instancing without a manager could leave it absent. | Physics queries read Cannon state; every projectile has a transform object. Regression moves its mesh far from its body and checks real body motion. Render interpolation is separate. |
| IMPL-09 | Laser selection depended on constructor.name, which production minification changes. | Actual instanceof check; production bundle placement succeeds. |
| IMPL-10 | Bun template background/logo remained behind gameplay. | Removed animated template pseudo-element and supplied the simulator background/icon. Template logo is absent in final screenshots; the separate opaque-strip artifact is resolved in IMPL-17. |
| IMPL-11 | Craters shared one mutable fade material; cleanup disposed cached assets. | Owned material clones, common idempotent cleanup, cached geometry retained. Two-crater regression verifies independent opacity, exactly two material disposals and zero shared geometry disposals. |
| IMPL-12 | Drone mass changed without recomputing Cannon inverse mass; ballistic ETA retained its initial velocity. | Mass properties updated; current-state ballistic forecast. Regression checks inverse mass and ETA/impact changes after velocity changes. Forecasts remain vacuum estimates for later maneuvering flight. |
| IMPL-13 | Launcher-site impact marker called a threat API with a point and mixed Cannon/Three vector APIs. | Marker receives the created Threat; typecheck no longer reports those path errors. |
| IMPL-14 | Shop Escape bypassed restoration of selected time scale. | Slow motion now belongs to the open-shop effect and cleanup; production browser verifies 0.1× while open and restoration to 2× on Escape. |
| IMPL-15 | Collapsed shop panel retained a pointer-active container over the laser selector. | Container no longer intercepts empty-space input; visible children remain interactive. Actual game-mode laser selection and placement now pass. |
| IMPL-16 | FPS quality feedback used a capped 100 ms delta, understating long frames. | Uses actual render delta. An emulated Android browser now progressively resizes the drawing buffer from 844×390 to 422×195 while CSS remains 844×390, without a viewport resize or runtime error. |
| IMPL-17 | An opaque strip appeared below the clipped desktop GUI despite correct DOM bounds. | Controlled opacity comparison isolated a compositing artifact over the WebGL canvas: 1.0 reproduces the strip, 0.99 restores the scene. Desktop opacity is capped at 0.99; existing mobile/tablet opacity is preserved. Screenshots `strip-probe`/`opacity-probe` record the comparison; final production desktop capture confirms the strip is gone. |

### 13.4 Per-finding disposition

“Corrected” means the reported counterexample is addressed and the cited regression/observation
passes. It does not claim exhaustive correctness of every possible flight or real-world calibration.
Related VAL/BROW rows are corroborating evidence, not additional independent physics bugs.

| Findings | Current disposition and validation |
| --- | --- |
| NUM-01–03, NUM-13/16/22/23/25 | Retained positive controls. Existing vacuum/energy/arc, drag direction, pure PN, probability and pure Kalman tests remain passing. |
| NUM-04–09, INT-10 | Corrected. Finite input/zero-range rejection, true low/high arcs, bounded continuous roots, equal-speed and off-grid intercepts, and rejection after ground contact are covered by calculation-correctness. |
| NUM-10–12/14/15, SRC-12 | Corrected under the explicit atmosphere contract in 13.2. Mass-independent gravity, local hPa density, finite 50 km behavior, nonnegative drag and dissipative integration have independent numerical checks. |
| NUM-17–19, SRC-11 | Corrected. Planar/mirrored navigation, coincident/equal-velocity geometry and epoch-independent calculations pass. |
| NUM-20/21 | Corrected. Relative swept fuse, partial-step arming, first contact, ground/lifetime clipping and finite equal-velocity detonation prediction pass. |
| NUM-24/26, SRC-14, VAL-18–20 | Corrected/model clarified. Class noise uses continuous white jerk; new independent gains, zero-time/partition checks and 1000-step Cholesky verification replace the old class noise oracle. Forecast queries clone state. Pure discrete-noise oracle is retained. |
| NUM-27/28, INT-04/05/07–09, SRC-01/05, VAL-01–04 | Corrected. Fixed 1/60 steps, one force/battery owner, simulation timers, paused wave phases, scaled repair/laser/effects and overload accounting pass. Production-step scenarios compare seeded results across render schedules and unrelated cosmetic draws. |
| NUM-29, SRC-07 | Corrected radians/degrees at both mortar sites and manual fallback. All-quadrant bearing conversion and launch regressions pass; manual fallback remains an explicitly approximate guided launch. |
| INT-01, SRC-02, VAL-12/13 | Corrected. Both renderer modes use one authoritative city registry with real dimensions. Swept sphere/AABB contact covers height, earliest hit and rounded-corner rejection. City damage is visible in the production browser. |
| INT-02/03, SRC-17, BROW-07/08 | Corrected allocation/bounds invariants. Removal releases slots; moving instanced bounds track transforms; the conditional 500 m rejection is removed. Repeated production resets show matching live/slot counts. Camera-specific historical ghosts were never independently established. |
| INT-06, SRC-04, VAL-15 | Corrected. Laser implements battery events, health, repair and destruction. Actual laser direct/splash damage passes; production placement, health and destruction observed. |
| SRC-03/10, VAL-10/11/14 | Corrected. Explicit terminal causes and one manager outcome, payload wave inheritance, no reset/capacity/payload kill awards, cancellation of target assignments and delayed launches. Capacity admission uses configured operational battery limits; visual pool rejection does not remove gameplay objects. |
| SRC-06, BROW-03 | Corrected. Portrait/hidden suspension is independent of user pause; no accumulated resume debt. Viewport freeze/resume browser evidence and clock regression pass. Physical orientation hardware remains untested. |
| SRC-08/18, VAL-23–26 | Corrected reported model mismatches. Gravity-aware launch from actual tube exit, zero vacuum damping, planar lateral correction and correct closing sign. Real tube residual, production body motion and guidance regressions pass; guided flight is a feedback game model rather than the alternate PN class. |
| SRC-09 | Corrected inputs: observed outcome ratio and active interceptor count remain available while paused. Ratio is successes/(successes+misses), zero before resolved outcomes; it is not the planning confidence. |
| SRC-13, VAL-22 | Corrected bounded optional contract. Ground launch and constant-velocity moving-target shooting round trips pass; facade requires environment and coefficients and rejects unsupported inputs rather than silently returning a vacuum answer. |
| SRC-15, VAL-16/17 | Corrected/clarified. Deterministic bounded damage evaluation, one seeded sampling draw and both velocities; unused physical-sounding metadata deprecated. Game probability curve remains uncalibrated. |
| SRC-16 | Architecture/test gap addressed. Tests invoke the shared production step and actual Projectile/Threat/manager methods. Predictive lead remains planning/display metadata; live Projectile feedback follows the moving Threat. Kalman is optional, not advertised as default guidance. |
| BROW-01/02/05/06 | Corrected. GAME uses an existing wave contract, global Escape arbitration works with focused lil-gui, radar/control regions do not overlap at tested sizes, BasicMaterial callers no longer request unsupported emissive fields. |
| BROW-04 | Corrected. Window capacity grows to generated demand, preserving all slots through lighting transitions. A 60,000-window regression passes; default browser city has 106 authoritative and rendered buildings without pool-exhaustion logs. |
| PERF-01, VAL-08 | Corrected work frequency. Same-hour lighting updates once across 60 calls; forced edits update immediately. No separate GPU speedup claim. |
| PERF-02/03, VAL-05–07 | Corrected bounded work/buffers. Idle trails do not repack/upload; active upload ranges cover written vertices, one version change per repack. Capacity stress never exceeds 50,000 reserved vertices/500 trails and rejects excess visual allocation explicitly. |
| PERF-04, VAL-09 | Corrected adaptive control. Averaged windows, sustained-recovery hysteresis and resize-on-change wiring; quality regression covers degradation/recovery. Emulated Android buffer observation verifies 844×390→759×351→675×312→590×273→506×234→422×195 at fixed CSS size; real-device frame-rate benefit remains unmeasured. |
| PERF-05 | Measured optimization implemented; see 13.5. Cached bounds, one battery owner and scalar swept-bounds rejection remove repeated work. Spatial indexing deferred on current 106-building/50-threat workload. |
| PERF-06 | Unconfirmed candidate, not a proven defect. Tested screenshots show usable near-city geometry; the wide camera/shadow envelope is retained to support distant threats. SwiftShader cannot establish real GPU shadow cost or justify changing coverage. Hardware profiling remains a documented limitation, not a claimed optimization. |
| QA-01/04/05 | Corrected advertised setup and coverage gaps; independent oracles and production-path regressions added without weakening valid checks. |
| QA-02 | Baseline debt explicitly retained; diagnostic comparison has no new entries. A globally clean typecheck/lint is not claimed. |
| QA-03/06 | Build/assets plus isolated production-browser interaction and screenshot evidence now supplement the numerical suite. Hardware coverage limits below remain. |
| QA-07 | Model validity explicitly bounded in 13.2; deterministic simulation is not physical calibration. |
| QA-08 | Environment-only issue. Validation uses the available Bun binary/PATH; repository commands remain portable. |
| VAL-21 | Corrected with SRC-11's stateless/dimensionally consistent optional navigation. |
| IDEA-01–08 | Preserved proposals; none treated as an implicit feature requirement. |

### 13.5 Performance evidence and practical limits

A seeded Bun CPU benchmark runs 50 swept threat queries per tick against 106 varied buildings,
with 200 warmup ticks and 1000 measured ticks. It exercises the real BuildingSystem query and
includes colliding and non-colliding sweeps. Before/after use the same geometry and 7,200 hits
across all 1,200 ticks. This comparison isolates the new broad rejection inside the already-correct
sweep; it is **not** a whole-game comparison against the broken pre-audit collision path.

| Query batch | Median | P95 | Mean |
| --- | ---: | ---: | ---: |
| Exact sweep on every building | 0.869 ms | 1.665 ms | 1.029 ms |
| Scalar swept-bounds rejection before exact sweep | 0.137 ms | 0.292 ms | 0.162 ms |

This is roughly 84% less median CPU time for that workload. Avoid extrapolating it to overall FPS,
other cities, devices or GPU upload cost. A spatial index is not justified yet by the remaining
~0.14 ms median query batch. The exact rounded-corner solver still runs for overlapping bounds.

Headless Chrome uses software rendering. Screenshots, viewport transitions, dynamic buffer
invariants and CPU measurements do not establish mobile touch usability, real orientation events,
hardware GPU throughput, battery/thermal cost, depth precision at every far-camera position or a
long-duration memory leak guarantee. Those remain follow-up hardware validation, with no invented
performance improvement or real-world interception-success claim.

### 13.6 Reproducible evidence

Run `bun test`, `bun run typecheck`, `bun run lint`, `bun run build`, and `bun run check:build`.
Only test/build/assets are expected to exit successfully while the documented baseline diagnostic
debt remains. New regressions are in `tests/regressions/`; their presentation dependencies are
stubbed where needed, while the named production physics/lifecycle methods execute.

Temporary local evidence directory: `/tmp/irondome-validation-20260905/`.

- `suite-final.log`, `types-final.log`, `lint-original.json`, `lint-current.json`,
  `check-diagnostics.py`, `build-final.log`, `assets-final.log`.
- `performance.ts`, `performance-before-broadphase.json`, `performance-after-broadphase.json`.
- `implementation-flows/browser-flows.json`, `final-browser.json`, `final-game-soak.json`,
  `final-game-verification.json`, `mobile-quality.json` and their corresponding Bun scripts/logs.
- `final-laser.png`, `final-landscape.png`, `final-city-damage.png`, `final-game-laser.png`.

Browser harness timeouts are retained in evidence. A Launch Attack click that completed in the
page but exceeded Playwright's click deadline is not counted as a product crash. Reset soak uses
DOM-dispatched button clicks, while placement, shop, mode and Escape checks use mouse/keyboard.


## References

- [Current game loop](../src/main.ts), [trajectory facade](../src/systems/UnifiedTrajectorySystem.ts),
  [improved solver](../src/utils/ImprovedTrajectoryCalculator.ts), and
  [default projectile steering](../src/entities/Projectile.ts).
- [Existing physics reference](physics-reference.md) and
  [earlier testability proposal](../notes/testable-interception-architecture.md): historical context,
  not proof that the proposed behavior is implemented.
- [NASA: flight equations with drag](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/flight-equations-with-drag/):
  force/acceleration units and the gravity/drag distinction.
- [Welch and Bishop: the discrete Kalman filter](https://homepages.inf.ed.ac.uk/rbf/CVonline/LOCAL_COPIES/WELCH/kalman.1.html):
  prediction and measurement-update formulation, mirrored by the University of Edinburgh.
