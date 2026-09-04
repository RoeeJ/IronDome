import { describe, expect, test } from 'bun:test';
import { Vector3 } from 'three';
import {
  calculateLaunchAngles,
  calculateTimeToImpact,
  calculateBallisticPosition,
  calculateDragAffectedVelocity,
  calculateTrajectoryPoints,
} from '@/physics/ballistics';
import { calculateConstantVelocityInterception } from '@/physics/interception';
import { TrajectoryCalculator } from '@/utils/TrajectoryCalculator';
import { ImprovedTrajectoryCalculator } from '@/utils/ImprovedTrajectoryCalculator';
import { ProportionalNavigation } from '@/physics/ProportionalNavigation';
import { AdvancedBallistics } from '@/physics/AdvancedBallistics';
import { KalmanFilter } from '@/utils/KalmanFilter';
import { polynomialRoots } from '@/physics/numerics';
const V = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);

describe('Audit: finite launch and interception contracts', () => {
  test('zero range and invalid speed produce no flight solution', () => {
    expect(calculateLaunchAngles(0, 0, 50)).toBeNull();
    expect(calculateLaunchAngles(100, 0, 0)).toBeNull();
    expect(calculateLaunchAngles(100, 0, Number.NaN)).toBeNull();
    expect(TrajectoryCalculator.calculateLaunchParameters(V(), V(), 50, true)).toBeNull();
  });
  test('both selected ballistic arcs reach the requested target', () => {
    for (const lofted of [false, true]) {
      const parameters = TrajectoryCalculator.calculateLaunchParameters(
        V(),
        V(100, 0, 0),
        50,
        lofted
      )!;
      const velocity = TrajectoryCalculator.getVelocityVector(parameters);
      const point = calculateBallisticPosition(V(), velocity, 100 / velocity.x);
      expect(point.distanceTo(V(100, 0, 0))).toBeLessThan(1e-7);
    }
  });
  test('ground roots distinguish already impacted, upward departure and invalid state', () => {
    expect(calculateTimeToImpact(V(), V(0, -10, 0))).toBe(0);
    expect(calculateTimeToImpact(V(0, -1, 0), V())).toBeNull();
    expect(calculateTimeToImpact(V(), V(0, 20, 0))).toBeCloseTo(40 / 9.82, 10);
    const time = calculateTimeToImpact(V(0, 1, 0), V(0, -10, 0))!;
    expect(time).toBeGreaterThan(0);
    expect(time).toBeLessThan(0.1);
    expect(calculateBallisticPosition(V(0, 1, 0), V(0, -10, 0), time).y).toBeCloseTo(0, 10);
  });
  test('constant velocity solves equal speeds and off-grid crossings in every facade', () => {
    for (const range of [100, 101]) {
      const expected = range / 20;
      const pure = calculateConstantVelocityInterception(
        V(range, 10, 0),
        V(-10, 0, 0),
        V(0, 10, 0),
        10
      )!;
      expect(pure.timeToIntercept).toBeCloseTo(expected, 8);
      for (const calculator of [TrajectoryCalculator, ImprovedTrajectoryCalculator]) {
        expect(
          calculator.calculateInterceptionPoint(V(range, 10), V(-10), V(0, 10), 10, true)!.time
        ).toBeCloseTo(expected, 8);
        expect(
          calculator.calculateInterceptionPoint(V(105, 10), V(), V(0, 10), 100, true)!.time
        ).toBeCloseTo(1.05, 8);
      }
    }
  });
  test('all facades reject impact before interception and malformed inputs', () => {
    for (const calculator of [TrajectoryCalculator, ImprovedTrajectoryCalculator]) {
      for (const speed of [50, 250])
        expect(calculator.calculateInterceptionPoint(V(0, 1), V(0, -10), V(100), speed)).toBeNull();
      for (const speed of [0, -1, Infinity, NaN])
        expect(calculator.calculateInterceptionPoint(V(0, 100), V(), V(), speed)).toBeNull();
    }
  });
  test('bounded solver finds tangencies and earliest of multiple roots', () => {
    const roots = polynomialRoots([4, -12, 13, -6, 1], 0, 3); // (t-1)^2 (t-2)^2
    expect(roots.length).toBe(2);
    expect(roots[0]).toBeCloseTo(1, 8);
    expect(roots[1]).toBeCloseTo(2, 8);
  });
  test('invalid sampling step cannot hang the caller', () => {
    for (const step of [0, -1, NaN, Infinity])
      expect(() => calculateTrajectoryPoints(V(), V(), step)).toThrow(RangeError);
  });
  test('exact quadratic drag dissipates without reversing and composes over time', () => {
    const once = calculateDragAffectedVelocity(V(100), 1, 1, 1, 1, 0.1);
    let split = V(100);
    for (let i = 0; i < 10; i++) split = calculateDragAffectedVelocity(split, 1, 1, 1, 1, 0.01);
    expect(once.x).toBeCloseTo(100 / 6, 10);
    expect(once.distanceTo(split)).toBeLessThan(1e-10);
    expect(() => calculateDragAffectedVelocity(V(100), 1, 1, 1, 0, 0.1)).toThrow(RangeError);
  });
});

describe('Audit: optional navigation and tracking', () => {
  test('navigation acceleration has the independent expected direction and magnitude', () => {
    const a = new ProportionalNavigation().calculateGuidanceCommand(
      V(),
      V(10),
      V(100),
      V(0, 1)
    ).acceleration;
    expect(a.distanceTo(V(0, 0.3))).toBeLessThan(1e-10);
  });
  test('coincidence and equal velocity remain finite', () => {
    const pn = new ProportionalNavigation();
    expect(pn.calculateGuidanceCommand(V(), V(10), V(), V()).acceleration.length()).toBe(0);
    expect(pn.calculatePredictedMissDistance(V(), V(10), V(10), V(10), V())).toBe(10);
  });
  test('unrelated prior engagements cannot alter guidance', () => {
    const pn = new ProportionalNavigation();
    const expected = pn.calculateGuidanceCommand(V(), V(100), V(100, 1), V(0, 10));
    pn.calculateGuidanceCommand(V(99), V(-3), V(-200, 70), V(0, -8));
    expect(
      pn
        .calculateGuidanceCommand(V(), V(100), V(100, 1), V(0, 10))
        .acceleration.distanceTo(expected.acceleration)
    ).toBe(0);
  });
  test('drone forecast is level and read-only', () => {
    const k = new KalmanFilter();
    k.initializeFromThreat(V(0, 100), V(10), 'DRONE_FAST');
    const a = k.forecast(1);
    const b = k.forecast(1);
    expect(a.position.toArray()).toEqual([10, 100, 0]);
    expect(a.position.distanceTo(b.position)).toBe(0);
    expect(k.getState().position.toArray()).toEqual([0, 100, 0]);
  });
  test('continuous jerk covariance is invariant to time partition and zero time', () => {
    const one = new KalmanFilter();
    const many = new KalmanFilter();
    for (const k of [one, many]) k.initializeFromThreat(V(0, 100), V(10), 'drone');
    one.predict(1);
    for (let i = 0; i < 10; i++) many.predict(0.1);
    expect(one.getPositionUncertainty()).toBeCloseTo(many.getPositionUncertainty(), 10);
    const before = one.getPositionUncertainty();
    one.predict(0);
    expect(one.getPositionUncertainty()).toBe(before);
  });
  test('Kalman gain agrees with independent continuous-jerk scalar calculation', () => {
    const k = new KalmanFilter();
    k.initializeFromThreat(V(), V(), 'ballistic');
    k.predict(1);
    k.update(V(10));
    // Pxx=225+q/20, Pvx=150+q/8, Pax=50+q/6 for P0=100I, q=1, R=5.
    const denominator = 225.05 + 5;
    expect(k.getState().position.x).toBeCloseTo((10 * 225.05) / denominator, 10);
    expect(k.getState().velocity.x).toBeCloseTo((10 * 150.125) / denominator, 10);
    expect(k.getState().acceleration.x).toBeCloseTo((10 * (50 + 1 / 6)) / denominator, 10);
  });
});

describe('Audit: explicit advanced environmental model', () => {
  const environment = {
    windSpeed: V(),
    temperature: 15,
    pressure: 1013.25,
    humidity: 0,
    altitude: 0,
  };
  const coefficients = { mass: 1, referenceArea: 0, dragCoefficient: 0 };
  test('gravity is independent of mass', () => {
    const model = new AdvancedBallistics();
    const velocities = [1, 10, 100].map(
      mass =>
        model.calculateTrajectory(V(0, 100), V(), { ...coefficients, mass }, environment, 1)
          .velocity.y
    );
    expect(velocities[0]).toBeCloseTo(-9.80635, 4);
    expect(velocities[1]).toBe(velocities[0]);
    expect(velocities[2]).toBe(velocities[0]);
  });
  test('local density uses pressure in hPa and temperature in Celsius exactly once', () => {
    const model = new AdvancedBallistics() as unknown as {
      calculateAirDensity(h: number, t: number, p: number, rh: number): number;
    };
    expect(model.calculateAirDensity(0, 30, 1013.25, 0)).toBeCloseTo(
      101325 / (287.053 * 303.15),
      10
    );
    expect(() => model.calculateAirDensity(0, 30, 101325, 0)).toThrow(RangeError);
    expect(Number.isFinite(model.calculateAirDensity(50000, -50, 1, 0))).toBe(true);
  });
  test('high-speed drag remains dissipative', () => {
    const result = new AdvancedBallistics().calculateTrajectory(
      V(0, 100),
      V(5000),
      { mass: 10, referenceArea: 1, dragCoefficient: 0.3 },
      environment,
      0.1
    );
    expect(result.velocity.x).toBeGreaterThan(0);
    expect(result.velocity.x).toBeLessThan(5000);
    expect(result.velocity.toArray().every(Number.isFinite)).toBe(true);
  });
  test('firing solutions lead a moving target and round-trip through the actual integrator', () => {
    const model = new AdvancedBallistics();
    const target = V(100, 20),
      targetVelocity = V(0, 0, 5);
    const result = model.calculateFiringSolution(
      V(),
      target,
      targetVelocity,
      70,
      coefficients,
      environment
    );
    expect(result).not.toBeNull();
    const { azimuth, elevation, timeOfFlight } = result!;
    const v = V(
      Math.cos(elevation) * Math.cos(azimuth),
      Math.sin(elevation),
      Math.cos(elevation) * Math.sin(azimuth)
    ).multiplyScalar(70);
    const actual = model.calculateTrajectory(
      V(),
      v,
      coefficients,
      environment,
      timeOfFlight
    ).position;
    expect(actual.distanceTo(target.addScaledVector(targetVelocity, timeOfFlight))).toBeLessThan(
      0.05
    );
    expect(azimuth).toBeGreaterThan(0);
  });
});
