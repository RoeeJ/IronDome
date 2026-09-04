import { UnifiedTrajectorySystem } from '@/systems/UnifiedTrajectorySystem';
import { calculateBallisticPosition } from '@/physics/ballistics';
import { simulationClock } from '@/simulation/SimulationClock';
import { ThreatManager } from '@/scene/ThreatManager';
import { ThreatType } from '@/entities/Threat';
import { ProximityFuse } from '@/systems/ProximityFuse';
import { stepEvents } from '@/simulation/StepEvents';
import { SoundSystem } from '@/systems/SoundSystem';
import { ExplosionManager, ExplosionType } from '@/systems/ExplosionManager';
import { expect, test } from 'bun:test';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { LaserBattery } from '@/entities/LaserBattery';
import { IronDomeBattery } from '@/entities/IronDomeBattery';
import { Projectile } from '@/entities/Projectile';
import { Threat } from '@/entities/Threat';
import { runSimulationStep } from '@/simulation/runSimulationStep';
import { FixedStepDriver } from '@/simulation/FixedStepDriver';
import { SimulationClock } from '@/simulation/SimulationClock';
import { StepEvents } from '@/simulation/StepEvents';
import { SeededRandom } from '@/simulation/Random';
import { MaterialCache } from '@/utils/MaterialCache';
import { DeviceCapabilities, PerformanceProfile } from '@/utils/DeviceCapabilities';
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
function fixture<T>(prototype: object, fields: object): T {
  return Object.assign(Object.create(prototype), fields) as T;
}

function scenario(fps: number, cosmeticDraws = 0) {
  const random = new SeededRandom(37),
    cosmetic = new SeededRandom(41);
  const world = new CANNON.World({ gravity: new CANNON.Vec3() });
  const body = new CANNON.Body({ mass: 1, linearDamping: 0 });
  world.addBody(body);
  let damage = 0,
    clockedEffects = 0;
  const target = fixture<Threat>(Threat.prototype, {
    id: 'target',
    isActive: true,
    getPosition: () => V(100, 100),
    getVelocity: () => V(),
    isDestroyed: () => false,
    preparePhysics() {},
    takeDamage: (amount: number) => {
      damage += amount;
    },
  });
  const laser = fixture<LaserBattery>(LaserBattery.prototype, {
    operational: true,
    currentHealth: 100,
    maxHealth: 100,
    autoRepairRate: 0,
    turret: undefined,
    firing: true,
    resourceManagementEnabled: true,
    currentTarget: { threat: target },
    position: V(),
    maxRange: 500,
    laserBeam: null,
    damagePerSecond: 20,
    currentEnergy: 100,
    maxEnergy: 100,
    energyPerSecond: 10,
    energyRechargeRate: 5,
  });
  const projectile = fixture<Projectile>(Projectile.prototype, {
    isActive: true,
    body,
    preparePhysics: () => {
      body.applyForce(new CANNON.Vec3(10 + random.next(), 0, 0));
    },
    update() {},
  });
  const driver = new FixedStepDriver(new SimulationClock());
  const events: number[] = [];
  driver.clock.schedule(0.5, () => events.push(body.velocity.x));
  for (let frame = 0; frame < fps; frame++) {
    for (let n = 0; n < cosmeticDraws; n++) cosmetic.next();
    driver.advance(1 / fps, 1, false, dt =>
      runSimulationStep(dt, {
        gameMode: true,
        autoIntercept: true,
        repairRate: 0,
        wave: { update() {} },
        batteries: [laser],
        radar: { update() {} },
        threats: { getActiveThreats: () => [target], update() {}, finalizeTerminations() {} },
        interceptions: {
          prepareStep(threats, _manual, delta) {
            laser.update(delta, threats);
          },
          getActiveInterceptors: () => [],
          update() {},
        },
        world,
        projectiles: [projectile],
        destroyProjectile() {},
        dayNight: {
          update(delta) {
            clockedEffects += delta;
          },
        },
        debris: { update() {} },
      })
    );
  }
  return {
    position: body.position.toArray(),
    velocity: body.velocity.toArray(),
    damage,
    energy: laser.getEnergyLevel(),
    clockedEffects,
    events,
  };
}

test('production step preserves seeded motion, laser energy/damage and timers across render schedules', () => {
  const reference = scenario(60);
  expect(reference.damage).toBeCloseTo(20, 10);
  expect(reference.energy).toBeCloseTo(0.9, 10);
  expect(reference.clockedEffects).toBeCloseTo(1, 10);
  expect(scenario(30)).toEqual(reference);
  expect(scenario(120, 100)).toEqual(reference);
});

test('battery repair integrates simulation duration even when rate is assigned every tick', () => {
  const battery = fixture<IronDomeBattery>(IronDomeBattery.prototype, {
    currentHealth: 50,
    maxHealth: 100,
    isDestroyed: false,
    healthBar: null,
    radarDome: null,
    pendingLaunches: new Map(),
    launchEffects: { update() {} },
    launcherTubes: [],
    calculateReloadMultiplier: () => 1,
    repair(amount: number) {
      (this as unknown as { currentHealth: number }).currentHealth += amount;
    },
  });
  for (let i = 0; i < 600; i++) {
    battery.setAutoRepairRate(2);
    battery.update(1 / 60, []);
  }
  expect(battery.getHealth().current).toBeCloseTo(70, 8);
});

test('global contact resolution uses time, solid-contact tie precedence and terminal guards', () => {
  const queue = new StepEvents();
  let active = true;
  const events: string[] = [];
  queue.begin();
  queue.add(0.8, 0, () => {
    if (active) {
      active = false;
      events.push('building');
    }
  });
  queue.add(0.2, 1, () => {
    if (active) {
      active = false;
      events.push('fuse');
    }
  });
  queue.resolve();
  expect(events).toEqual(['fuse']);
  events.length = 0;
  active = true;
  queue.begin();
  queue.add(0.5, 1, () => {
    if (active) {
      active = false;
      events.push('fuse');
    }
  });
  queue.add(0.5, 0, () => {
    if (active) {
      active = false;
      events.push('building');
    }
  });
  queue.resolve();
  expect(events).toEqual(['building']);
});

test('material identity includes emissive settings and actual texture identity', () => {
  const cache = MaterialCache.getInstance();
  const a = cache.getMeshStandardMaterial({ color: 0xff, emissive: 0xff, emissiveIntensity: 0.2 });
  const b = cache.getMeshStandardMaterial({ color: 0xff, emissive: 0xff, emissiveIntensity: 0.8 });
  expect(a).not.toBe(b);
  expect(
    cache.getMeshStandardMaterial({ emissiveIntensity: 0.2, color: 0xff, emissive: 0xff })
  ).toBe(a);
  const first = new THREE.Texture(),
    second = new THREE.Texture();
  expect(cache.getMeshBasicMaterial({ map: first })).not.toBe(
    cache.getMeshBasicMaterial({ map: second })
  );
});

test('adaptive quality averages samples and recovers after sustained healthy performance', () => {
  const profile: PerformanceProfile = {
    particleCount: 100,
    maxInterceptors: 8,
    shadowQuality: 'high',
    textureQuality: 'high',
    effectsQuality: 'high',
    targetFPS: 60,
    renderScale: 1,
  };
  const caps = fixture<DeviceCapabilities>(DeviceCapabilities.prototype, {
    performanceProfile: { ...profile },
    initialProfile: { ...profile },
    qualityWindow: [],
    qualityWindowsHealthy: 0,
  });
  expect(caps.adjustQualityForFPS(10)).toBe(false);
  expect(caps.getRenderScale()).toBe(1);
  for (let i = 0; i < 120; i++) caps.adjustQualityForFPS(10);
  expect(caps.getRenderScale()).toBeCloseTo(0.5, 8);
  for (let i = 0; i < 2400; i++) caps.adjustQualityForFPS(60);
  expect(caps.getRenderScale()).toBeCloseTo(1, 8);
});

test('real laser battery health, repair and destruction follow the shared lifecycle contract', () => {
  const laser = new LaserBattery(new THREE.Scene(), new CANNON.World(), V());
  let destroyed = 0;
  laser.on('destroyed', () => {
    destroyed++;
  });
  laser.takeDamage(25);
  expect(laser.getHealth().current).toBe(75);
  laser.repair(10);
  expect(laser.getStats().health.current).toBe(85);
  laser.setAutoRepairRate(2);
  laser.update(1, []);
  expect(laser.getHealth().current).toBe(87);
  laser.takeDamage(1000);
  laser.takeDamage(1000);
  expect(destroyed).toBe(1);
  expect(laser.isOperational()).toBe(false);
  expect(laser.getHealth().current).toBe(0);
  laser.destroy();
});

test('projectile physics queries cannot depend on an interpolated or hidden mesh', () => {
  const scene = new THREE.Scene(),
    world = new CANNON.World({ gravity: new CANNON.Vec3() });
  const projectile = new Projectile(scene, world, {
    position: V(3, 100),
    velocity: V(10),
    useInstancing: true,
    useExhaustTrail: false,
  });
  projectile.mesh.position.set(999, 999, 999);
  expect(projectile.getPosition().toArray()).toEqual([3, 100, 0]);
  projectile.preparePhysics(1 / 60);
  world.step(1 / 60);
  expect(projectile.getPosition().x).toBeCloseTo(3 + 10 / 60, 10);
  projectile.destroy(scene, world);
});

test('real projectile fuse and threat-manager ground contact resolve in swept time order', () => {
  for (const entry of [0.2, 0.8]) {
    const scene = new THREE.Scene(),
      world = new CANNON.World();
    const manager = new ThreatManager(scene, world);
    // Only presentation dependencies are replaced; both gameplay updates and the event queue run.
    Object.assign(manager, {
      explosionManager: { update() {}, createExplosion() {} },
      launchEffects: { update() {} },
      createCraterDecal() {},
    });
    const target = new Threat(scene, world, {
      type: ThreatType.SHORT_RANGE,
      position: V(0, 1),
      velocity: V(0, -60),
      targetPosition: V(),
      useInstancing: true,
    });
    (manager as unknown as { threats: Threat[] }).threats.push(target);
    target.previousPosition.copy(V(0, 1));
    target.body.position.y = 0;
    const start = V(-8 - 20 * entry, 1),
      end = start.clone().add(V(20, -1));
    const interceptor = new Projectile(scene, world, {
      position: start,
      velocity: V(1200, -60),
      isInterceptor: true,
      useInstancing: true,
      useExhaustTrail: false,
    });
    Object.assign(interceptor, {
      target,
      proximityFuse: new ProximityFuse(start, { armingDistance: 0 }),
    });
    interceptor.body.position.set(end.x, end.y, end.z);
    interceptor.detonationCallback = (_position, _quality, contact) => {
      if (contact && target.isActive) target.terminate('intercepted');
    };
    const sound = SoundSystem.getInstance;
    SoundSystem.getInstance = (() => ({ playExplosion() {} })) as typeof sound;
    try {
      stepEvents.begin();
      manager.update(1 / 60);
      interceptor.update(1 / 60);
      stepEvents.resolve();
      manager.finalizeTerminations();
    } finally {
      SoundSystem.getInstance = sound;
    }
    expect(target.terminationReason).toBe(entry < 0.5 ? 'intercepted' : 'impact');
    expect(manager.getActiveThreats()).toHaveLength(0);
    interceptor.destroy(scene, world);
    manager.clearAll();
  }
});

test('visual explosions do not independently damage nearby gameplay objects', () => {
  const effects = ExplosionManager.getInstance(new THREE.Scene());
  let damage = 0;
  const globals = window as unknown as Record<string, unknown>;
  const old = globals.__buildingSystem;
  globals.__buildingSystem = {
    getBuildingAt: () => ({ id: 'city' }),
    damageBuilding: () => damage++,
  };
  const sound = SoundSystem.getInstance;
  SoundSystem.getInstance = (() => ({ playExplosion() {} })) as typeof sound;
  try {
    effects.createExplosion({
      type: ExplosionType.GROUND_IMPACT,
      position: V(),
      radius: 20,
      hasFlash: false,
      hasShockwave: false,
      hasDebris: false,
    });
  } finally {
    SoundSystem.getInstance = sound;
    globals.__buildingSystem = old;
  }
  expect(damage).toBe(0);
});

test('actual tube launch consumes stock once, solves from tube exit and cancels delayed reservations', () => {
  const scene = new THREE.Scene(),
    world = new CANNON.World();
  const threat = new Threat(scene, world, {
    type: ThreatType.SHORT_RANGE,
    position: V(100, 100),
    velocity: V(-10),
    targetPosition: V(),
    useInstancing: true,
  });
  const tubes = [0, 1].map(index => ({
    index,
    isLoaded: true,
    lastFiredTime: -10000,
    position: V(index + 2, 5),
    endPosition: V(index + 2, 2),
    direction: V(0, -1),
  }));
  let stock = 3;
  const battery = fixture<IronDomeBattery>(IronDomeBattery.prototype, {
    scene,
    world,
    pendingLaunches: new Map(),
    launcherTubes: tubes,
    isDestroyed: false,
    currentHealth: 100,
    useResources: true,
    config: { position: V(3), interceptorSpeed: 100, successRate: 1 },
    instanceManager: {},
    canIntercept: () => true,
    assessThreatLevel: () => 0.5,
    emit() {},
    launchEffects: { createLaunchEffect() {} },
    resourceManager: {
      hasInterceptors: () => stock > 0,
      getInterceptorStock: () => stock,
      consumeInterceptor: () => (stock > 0 ? (stock--, true) : false),
    },
  });
  const sound = SoundSystem.getInstance;
  SoundSystem.getInstance = (() => ({ playLaunch() {} })) as typeof sound;
  const launched: Projectile[] = [];
  try {
    battery.fireInterceptors(threat, 2, p => launched.push(p));
    expect(launched).toHaveLength(1);
    expect(stock).toBe(2);
    expect(tubes[1].isLoaded).toBe(false);
    const first = launched[0],
      origin = V(5, 6.5);
    expect(first.getPosition().distanceTo(origin)).toBeLessThan(1e-10);
    // Recover contact time from the independent horizontal relative-motion equation.
    const t = (100 - origin.x) / (first.getVelocity().x + 10);
    const actual = calculateBallisticPosition(origin, first.getVelocity(), t);
    expect(
      actual.distanceTo(calculateBallisticPosition(threat.getPosition(), threat.getVelocity(), t))
    ).toBeLessThan(1e-6);
    battery.cancelPendingLaunches(threat.id);
    simulationClock.advance(3);
    expect(launched).toHaveLength(1);
    expect(stock).toBe(2);
    expect(tubes[1].isLoaded).toBe(true);
  } finally {
    SoundSystem.getInstance = sound;
    battery.cancelPendingLaunches();
    launched.forEach(p => p.destroy(scene, world));
    threat.destroy(scene, world);
  }
});

test('ground impact applies direct and falloff splash damage to actual laser batteries', () => {
  const scene = new THREE.Scene(),
    world = new CANNON.World(),
    manager = new ThreatManager(scene, world);
  const direct = new LaserBattery(scene, world, V()),
    nearby = new LaserBattery(scene, world, V(15));
  manager.registerBattery(direct);
  manager.registerBattery(nearby);
  Object.assign(manager, {
    explosionManager: { update() {}, createExplosion() {} },
    launchEffects: { update() {} },
    createCraterDecal() {},
  });
  const target = new Threat(scene, world, {
    type: ThreatType.SHORT_RANGE,
    position: V(0, 1),
    velocity: V(0, -60),
    targetPosition: V(),
    useInstancing: true,
  });
  (manager as unknown as { threats: Threat[] }).threats.push(target);
  target.previousPosition.copy(V(0, 1));
  target.body.position.y = 0;
  const sound = SoundSystem.getInstance;
  SoundSystem.getInstance = (() => ({ playExplosion() {} })) as typeof sound;
  const hits: { damage: number; isShockwave?: boolean }[] = [];
  manager.on('batteryHit', event => hits.push(event));
  try {
    stepEvents.begin();
    manager.update(1 / 60);
    stepEvents.resolve();
    manager.finalizeTerminations();
  } finally {
    SoundSystem.getInstance = sound;
  }
  expect(hits).toHaveLength(2);
  expect(hits[0].isShockwave).toBeUndefined();
  expect(hits[1].isShockwave).toBe(true);
  expect(direct.getHealth().current).toBe(100 - hits[0].damage);
  expect(nearby.getHealth().current).toBe(100 - hits[1].damage);
  expect(hits[1].damage).toBeGreaterThan(0);
  expect(hits[1].damage).toBeLessThan(hits[0].damage);
  direct.destroy();
  nearby.destroy();
  manager.clearAll();
});

test('actual re-engagement stays planar and only completes with positive relative closing speed', () => {
  for (const side of [-1, 1]) {
    const scene = new THREE.Scene(),
      world = new CANNON.World();
    const target = new Threat(scene, world, {
      type: ThreatType.SHORT_RANGE,
      position: V(100, 100 + side * 20),
      velocity: V(),
      targetPosition: V(),
      useInstancing: true,
    });
    const p = new Projectile(scene, world, {
      position: V(0, 100),
      velocity: V(100),
      mass: 1,
      isInterceptor: true,
      target,
      useInstancing: true,
      useExhaustTrail: false,
    });
    const state = p as unknown as { isReEngaging: boolean };
    state.isReEngaging = true;
    p.preparePhysics(1 / 60);
    expect(p.body.force.z).toBe(0);
    expect(Math.sign(p.body.force.y - 9.82)).toBe(side);
    target.body.position.set(15, 100, 0);
    target.body.velocity.set(200, 0, 0);
    state.isReEngaging = true;
    p.preparePhysics(1 / 60);
    expect(state.isReEngaging).toBe(true); // Target is pulling away despite both facing +x.
    target.body.velocity.set(0, 0, 0);
    p.preparePhysics(1 / 60);
    expect(state.isReEngaging).toBe(false);
    p.body.velocity.set(-100, 0, 0);
    state.isReEngaging = true;
    p.preparePhysics(1 / 60);
    expect(state.isReEngaging).toBe(true);
    p.destroy(scene, world);
    target.destroy(scene, world);
  }
});

test('manual fallback preserves target bearing in all four quadrants', () => {
  const sound = SoundSystem.getInstance;
  SoundSystem.getInstance = (() => ({ playLaunch() {} })) as typeof sound;
  const solve = UnifiedTrajectorySystem.calculateLaunchParameters;
  UnifiedTrajectorySystem.calculateLaunchParameters = () => null; // Exercise the real fallback, not the ordinary solver.
  try {
    for (const x of [-100, 100])
      for (const z of [-100, 100]) {
        const scene = new THREE.Scene(),
          world = new CANNON.World();
        const target = new Threat(scene, world, {
          type: ThreatType.SHORT_RANGE,
          position: V(x, 100, z),
          velocity: V(),
          targetPosition: V(),
          useInstancing: true,
        });
        const battery = fixture<IronDomeBattery>(IronDomeBattery.prototype, {
          scene,
          world,
          isDestroyed: false,
          currentHealth: 100,
          useResources: false,
          launcherTubes: [{ isLoaded: true, position: V(), lastFiredTime: 0 }],
          config: { position: V(), interceptorSpeed: 100 },
          launchOffset: V(),
          launchDirection: V(0, 1),
          instanceManager: {},
          launchEffects: { createLaunchEffect() {} },
          emit() {},
        });
        const projectile = battery.fireInterceptorManual(target)!;
        const velocity = projectile.getVelocity();
        expect(Math.sign(velocity.x)).toBe(Math.sign(x));
        expect(Math.sign(velocity.z)).toBe(Math.sign(z));
        expect(Math.abs(velocity.x)).toBeCloseTo(Math.abs(velocity.z), 10);
        projectile.destroy(scene, world);
        target.destroy(scene, world);
      }
  } finally {
    SoundSystem.getInstance = sound;
    UnifiedTrajectorySystem.calculateLaunchParameters = solve;
  }
});
