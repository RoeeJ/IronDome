import { expect, test } from 'bun:test';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { Threat, ThreatType } from '@/entities/Threat';
import { ThreatManager } from '@/scene/ThreatManager';
import { KalmanFilter } from '@/utils/KalmanFilter';
import { UnifiedTrajectorySystem } from '@/systems/UnifiedTrajectorySystem';
import { AdvancedBallistics } from '@/physics/AdvancedBallistics';
import { SoundSystem } from '@/systems/SoundSystem';
import { simulationClock } from '@/simulation/SimulationClock';
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

test('real threat removal emits one explicit outcome and releases physics and instance slots', () => {
  const scene = new THREE.Scene(),
    world = new CANNON.World();
  const manager = new ThreatManager(scene, world);
  const internal = manager as unknown as {
    threats: Threat[];
    instancedRenderer: import('@/rendering/InstancedThreatRenderer').InstancedThreatRenderer;
  };
  const events: string[] = [];
  manager.on('threatTerminated', ({ reason }) => events.push(reason));
  for (const reason of [
    'intercepted',
    'impact',
    'expired',
    'payload-deployed',
    'reset',
    'capacity-removed',
  ] as const) {
    const threat = new Threat(scene, world, {
      type: ThreatType.SHORT_RANGE,
      position: V(100, 100),
      velocity: V(),
      targetPosition: V(),
      useInstancing: true,
    });
    internal.threats.push(threat);
    internal.instancedRenderer.addThreat(threat);
    threat.terminate(reason);
    manager.finalizeTerminations();
    manager.finalizeTerminations();
    expect(events.at(-1)).toBe(reason);
    expect(manager.getActiveThreats()).toHaveLength(0);
    expect(world.bodies).toHaveLength(0);
  }
  expect(events).toHaveLength(6);
  const slots = internal.instancedRenderer as unknown as { threatToIndex: Map<string, unknown> };
  expect(slots.threatToIndex.size).toBe(0);
  manager.clearAll();
  manager.clearAll();
  expect(events).toHaveLength(6);
});

test('payload children inherit wave membership and reset clears all child slots', () => {
  const scene = new THREE.Scene(),
    world = new CANNON.World(),
    manager = new ThreatManager(scene, world);
  const parent = new Threat(scene, world, {
    type: ThreatType.BALLISTIC_MISSILE,
    position: V(0, 500),
    velocity: V(10, -10),
    targetPosition: V(100),
  });
  parent.waveId = 4;
  const internal = manager as unknown as {
    deployPayload(
      parent: Threat,
      config: { type: ThreatType; count: number; spread: number }
    ): void;
  };
  const managerEffects = manager as unknown as { explosionManager: { createExplosion(): void } };
  managerEffects.explosionManager = { createExplosion() {} };
  const originalSound = SoundSystem.getInstance;
  SoundSystem.getInstance = (() => ({ playExplosion() {} })) as typeof SoundSystem.getInstance;
  try {
    internal.deployPayload(parent, { type: ThreatType.RE_ENTRY_VEHICLE, count: 2, spread: 50 });
  } finally {
    SoundSystem.getInstance = originalSound;
  }
  expect(manager.getActiveThreats().map(threat => threat.waveId)).toEqual([4, 4]);
  manager.clearAll();
  parent.destroy(scene, world);
  expect(world.bodies).toHaveLength(0);
});

test('Joseph covariance remains finite, symmetric and positive definite over 1000 updates', () => {
  const filter = new KalmanFilter();
  filter.initializeFromThreat(V(0, 100), V(10), 'drone');
  for (let i = 1; i <= 1000; i++) {
    filter.predict(1 / 60);
    filter.update(V(i / 6 + Math.sin(i) * 0.01, 100));
    const p = (filter as unknown as { state: { P: number[][] } }).state.P;
    // Independent Cholesky factorization verifies positive definiteness, not just the diagonal.
    const l = Array.from({ length: 9 }, () => Array(9).fill(0));
    for (let row = 0; row < 9; row++)
      for (let col = 0; col <= row; col++) {
        expect(Number.isFinite(p[row][col])).toBe(true);
        expect(Math.abs(p[row][col] - p[col][row])).toBeLessThan(1e-8);
        let value = p[row][col];
        for (let k = 0; k < col; k++) value -= l[row][k] * l[col][k];
        if (row === col) {
          expect(value).toBeGreaterThan(0);
          l[row][col] = Math.sqrt(value);
        } else l[row][col] = value / l[col][col];
      }
  }
});

test('optional facade refuses missing environmental inputs and validates supplied moving-target solutions', () => {
  const system = new UnifiedTrajectorySystem({ mode: 'advanced', useEnvironmental: true });
  const factors = {
    windSpeed: V(3, 0, 1),
    temperature: 15,
    pressure: 1013.25,
    humidity: 0,
    altitude: 0,
  };
  const coefficients = { mass: 10, referenceArea: 0.02, dragCoefficient: 0.3 };
  expect(system.calculateInterceptionPoint(V(100, 50), V(1), V(0, 5), 100, true)).toBeNull();
  expect(
    system.calculateInterceptionPoint(V(100, 50), V(1), V(0, 5), 100, false, undefined, {
      factors,
      coefficients,
    })
  ).toBeNull();
  const result = system.calculateInterceptionPoint(
    V(100, 50),
    V(1),
    V(0, 5),
    100,
    true,
    undefined,
    { factors, coefficients }
  )!;
  expect(result.point.distanceTo(V(100 + result.time, 50))).toBeLessThan(1e-8);
  const points = system.predictTrajectory(V(), V(20, 20), {
    environmental: factors,
    coefficients,
    maxTime: 1,
    timeStep: 0.1,
  });
  expect(points.length).toBeGreaterThan(1);
  expect(points[1].position.y).toBeGreaterThan(0);
  expect(() => system.predictTrajectory(V(), V(), { timeStep: 0 })).toThrow(RangeError);
  const advanced = new AdvancedBallistics();
  expect(
    advanced.calculateFiringSolution(V(), V(100, 50), V(), 100, coefficients, {
      ...factors,
      pressure: 101325,
    })
  ).toBeNull();
});

test('independent crater fades own materials and repeated reset preserves shared assets', () => {
  const scene = new THREE.Scene(),
    manager = new ThreatManager(scene, new CANNON.World());
  manager.createCraterDecal(V());
  manager.createCraterDecal(V(20));
  const entries = [
    ...(
      manager as unknown as {
        activeCraters: Map<string, { mesh: THREE.Mesh; material: THREE.Material }>;
      }
    ).activeCraters.values(),
  ];
  expect(entries).toHaveLength(2);
  expect(entries[0].material).not.toBe(entries[1].material);
  expect(entries[0].mesh.geometry).toBe(entries[1].mesh.geometry);
  entries[0].material.opacity = 0.1;
  expect(entries[1].material.opacity).toBe(0.7);
  let materials = 0,
    geometries = 0;
  entries.forEach(entry => entry.material.addEventListener('dispose', () => materials++));
  entries[0].mesh.geometry.addEventListener('dispose', () => geometries++);
  manager.clearAll();
  manager.clearAll();
  expect(materials).toBe(2);
  expect(geometries).toBe(0);
});

test('drone inverse mass and ballistic forecasts reflect the current physics state', () => {
  const scene = new THREE.Scene(),
    world = new CANNON.World();
  const drone = new Threat(scene, world, {
    type: ThreatType.DRONE_SLOW,
    position: V(0, 100),
    velocity: V(10),
    targetPosition: V(100),
    useInstancing: true,
  });
  expect(drone.body.invMass).toBeCloseTo(1 / drone.body.mass, 12);
  const rocket = new Threat(scene, world, {
    type: ThreatType.SHORT_RANGE,
    position: V(0, 100),
    velocity: V(10),
    targetPosition: V(100),
    useInstancing: true,
  });
  const before = rocket.getTimeToImpact();
  rocket.body.velocity.y = 100;
  expect(rocket.getTimeToImpact()).toBeGreaterThan(before);
  expect(rocket.getImpactPoint()!.x).toBeCloseTo(10 * rocket.getTimeToImpact(), 9);
  drone.destroy(scene, world);
  rocket.destroy(scene, world);
});
