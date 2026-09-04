import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'events';
import { Vector3 } from 'three';
import { FixedStepDriver } from '@/simulation/FixedStepDriver';
import { SimulationClock } from '@/simulation/SimulationClock';
import { WaveManager } from '@/game/WaveManager';
import type { ThreatManager } from '@/scene/ThreatManager';
import type { GameState } from '@/game/GameState';
import { ProximityFuse } from '@/systems/ProximityFuse';
import { BlastPhysics } from '@/systems/BlastPhysics';
import { calculateVacuumLaunch } from '@/physics/interception';
import { calculateBallisticPosition } from '@/physics/ballistics';
const V = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);

describe('Audit: fixed-step ownership and timer invariants', () => {
  test('equal simulation time executes identical steps at 30, 60 and 120 render FPS', () => {
    for (const fps of [30, 60, 120])
      for (const scale of [0.1, 1, 10]) {
        const clock = new SimulationClock();
        const driver = new FixedStepDriver(clock);
        let position = 0,
          velocity = 0,
          fired = 0;
        clock.schedule(0.1, () => {
          fired++;
        });
        for (let frame = 0; frame < fps; frame++)
          driver.advance(1 / fps, scale, false, dt => {
            velocity += 10 * dt;
            position += velocity * dt;
          });
        const n = 60 * scale;
        expect(velocity).toBeCloseTo(10 * scale, 8);
        expect(position).toBeCloseTo((10 * (1 / 60) ** 2 * n * (n + 1)) / 2, 8);
        expect(clock.seconds).toBeCloseTo(scale, 8);
        expect(driver.diagnostics.droppedSeconds).toBe(0);
        expect(fired).toBe(1);
      }
  });
  test('suspension cannot age scheduled callbacks or accumulate a resume backlog', () => {
    const clock = new SimulationClock(),
      driver = new FixedStepDriver(clock);
    let fired = 0;
    clock.schedule(0.5, () => {
      fired++;
    });
    for (let i = 0; i < 120; i++) driver.advance(1, 10, true, () => {});
    expect(clock.seconds).toBe(0);
    expect(fired).toBe(0);
    driver.advance(1 / 60, 1, false, () => {});
    expect(clock.seconds).toBeCloseTo(1 / 60, 10);
  });
  test('overload is bounded and all dropped debt is reported', () => {
    const driver = new FixedStepDriver(new SimulationClock());
    expect(driver.advance(1, 10, false, () => {})).toBe(32);
    const d = driver.diagnostics;
    expect(d.requestedSeconds).toBe(10);
    expect(d.executedSeconds + d.droppedSeconds).toBeCloseTo(10, 10);
  });
  test('same-deadline events preserve order and cancellation, recursive timers defer one tick', () => {
    const clock = new SimulationClock();
    const calls: string[] = [];
    clock.schedule(1, () => {
      calls.push('a');
      clock.cancel(cancelled);
      clock.schedule(0, () => calls.push('c'));
    });
    const cancelled = clock.schedule(1, () => calls.push('cancelled'));
    clock.schedule(1, () => calls.push('b'));
    clock.advance(1);
    expect(calls).toEqual(['a', 'b']);
    clock.advance(1 / 60);
    expect(calls).toEqual(['a', 'b', 'c']);
  });
});

class WaveThreats extends EventEmitter {
  active: { waveId: number | null }[] = [];
  mixes: string[] = [];
  clearAll() {
    this.active = [];
  }
  stopSpawning() {}
  setSalvoChance() {}
  setThreatMix(type: string) {
    this.mixes.push(type);
  }
  spawnSingleThreat(_delay: number, waveId: number) {
    this.active.push({ waveId });
  }
  getActiveThreats() {
    return this.active;
  }
  resolve(reason: string) {
    for (const threat of this.active) this.emit('threatTerminated', { threat, reason });
    this.active = [];
  }
}
test('real WaveManager pauses all phases, waits for survivors and uses all configured wave categories', () => {
  const threats = new WaveThreats();
  let credits = 0,
    completions = 0;
  const state = {
    setCurrentWave() {},
    addCredits(n: number) {
      credits += n;
    },
    addScore() {},
    recordPerfectWave() {},
  };
  const wave = new WaveManager(threats as unknown as ThreatManager, state as unknown as GameState);
  wave.on('waveCompleted', () => {
    completions++;
  });
  wave.startGame();
  wave.pauseWave();
  wave.update(100);
  expect(wave.getCurrentWaveInfo().isActive).toBe(false);
  expect(wave.getCurrentWaveInfo().preparationRemaining).toBe(15);
  wave.resumeWave();
  wave.skipPreparation();
  wave.update(100); // Much longer than the old duration deadline, with every threat still alive.
  expect(completions).toBe(0);
  expect(credits).toBe(0);
  expect(wave.getCurrentWaveInfo().isActive).toBe(true);
  threats.resolve('intercepted');
  wave.update(1 / 60);
  expect(completions).toBe(1);
  expect(credits).toBe(250);
  wave.pauseWave();
  wave.update(100);
  expect(wave.getCurrentWaveInfo().waveNumber).toBe(1);
  wave.resumeWave();
  wave.update(3);
  expect(wave.getCurrentWaveInfo().waveNumber).toBe(2);
  for (let n = 2; n <= 3; n++) {
    wave.skipPreparation();
    wave.update(100);
    threats.resolve('impact');
    wave.update(1 / 60);
    wave.update(3);
  }
  threats.mixes = [];
  wave.skipPreparation();
  wave.update(100);
  expect(new Set(threats.mixes)).toEqual(new Set(['rockets', 'mortars', 'drones']));
  threats.active.push({ waveId: 4 }); // Payload child membership must hold the wave open.
  const child = threats.active.pop()!;
  threats.resolve('intercepted');
  threats.active.push(child);
  wave.update(1);
  expect(wave.getCurrentWaveInfo().isActive).toBe(true);
  threats.resolve('impact');
  wave.update(1 / 60);
  expect(wave.getCurrentWaveInfo().isActive).toBe(false);
  wave.destroy();
  expect(threats.listenerCount('threatTerminated')).toBe(0);
});

describe('Audit: swept fuse and bounded game blast', () => {
  test('off-grid stationary and moving crossings trigger at the first sphere entry', () => {
    const fuse = new ProximityFuse(V(-10, 10), { armingDistance: 0 });
    const result = fuse.update(V(10, 10), V(0, 10), 1 / 60, 0)!;
    expect(result.shouldDetonate).toBe(true);
    expect(result.fraction).toBeCloseTo(0.1, 10);
    expect(result.position!.x).toBeCloseTo(-8, 10);
    expect(fuse.update(V(20, 10), V(0, 10), 1 / 60, 10).shouldDetonate).toBe(false);
    const moving = new ProximityFuse(V(-20, 10), { armingDistance: 0 });
    const crossing = moving.update(V(20, 10), V(-10, 10), 1 / 60, 0, V(10, 10));
    expect(crossing.fraction).toBeCloseTo(22 / 60, 10);
    expect(crossing.position!.distanceTo(crossing.targetPosition!)).toBeCloseTo(8, 9);
  });
  test('arming and end-of-flight restrict the contact interval', () => {
    const late = new ProximityFuse(V(-10, 10), { armingDistance: 19 });
    expect(late.update(V(10, 10), V(0, 10), 1 / 60, 0).shouldDetonate).toBe(false);
    const inside = new ProximityFuse(V(-10, 10), { armingDistance: 10 });
    expect(inside.update(V(10, 10), V(0, 10), 1 / 60, 0).fraction).toBeCloseTo(0.5, 10);
    const expires = new ProximityFuse(V(-10, 10), { armingDistance: 0 });
    expect(expires.update(V(10, 10), V(0, 10), 1 / 60, 0, V(0, 10), 0.05).shouldDetonate).toBe(
      false
    );
  });
  test('damage probability has no randomness and sampling uses the supplied draw exactly once', () => {
    expect(BlastPhysics.evaluateDamage(V(), V(6), V()).killProbability).toBeCloseTo(0.8, 10);
    let draws = 0;
    const hit = BlastPhysics.calculateDamage(V(), V(6), V(), undefined, undefined, () => {
      draws++;
      return 0.79;
    });
    expect(hit.hit).toBe(true);
    expect(draws).toBe(1);
    expect(BlastPhysics.calculateDamage(V(), V(6), V(), undefined, undefined, () => 0.8).hit).toBe(
      false
    );
    const headOn = BlastPhysics.evaluateDamage(V(), V(1), V(-10), undefined, V(10));
    expect(headOn.damage).toBe(1);
    expect(headOn.killProbability).toBe(1);
    expect(
      BlastPhysics.evaluateDamage(V(), V(3), V(1000), undefined, V(1000)).killProbability
    ).toBe(0.95);
    const equal = BlastPhysics.calculateOptimalDetonationPoint(V(), V(100), V(10), V(100), {
      detonationRadius: 8,
      optimalRadius: 4,
    });
    expect(equal.timeToDetonation).toBe(0);
    expect(equal.predictedDistance).toBe(10);
  });
  test('launch state reaches moving targets with gravity from an offset tube exit', () => {
    for (const gravity of [0, 9.82]) {
      const origin = V(3, 7, -2),
        target = V(180, 100, 30),
        velocity = V(-20, 2, -3);
      const result = calculateVacuumLaunch(target, velocity, origin, 100, gravity)!;
      const actual = calculateBallisticPosition(
        origin,
        result.launchVelocity,
        result.timeToIntercept
      );
      const expected = calculateBallisticPosition(
        target,
        velocity,
        result.timeToIntercept,
        gravity
      );
      expect(actual.distanceTo(expected)).toBeLessThan(1e-7);
      expect(result.launchVelocity.length()).toBeCloseTo(100, 7);
    }
  });
});
