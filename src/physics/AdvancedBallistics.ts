import * as THREE from 'three';
import { isFiniteVector, polynomialRoots } from '@/physics/numerics';

export interface EnvironmentalFactors {
  windSpeed: THREE.Vector3; // m/s in world coordinates
  temperature: number; // Celsius at the reference altitude
  pressure: number; // local hPa at the reference altitude (not Pa)
  humidity: number; // relative humidity, 0–1
  altitude: number; // reference altitude in metres; position.y is height above it
}

export interface BallisticCoefficients {
  dragCoefficient: number;
  referenceArea: number; // m²
  mass: number; // kg
}

/** Optional game model: altitude-dependent gravity and wind-relative drag.
 * Local ideal-gas density and a bounded lapse/isothermal profile, not a calibrated atmosphere.
 * Spin and Earth rotation are deliberately absent: no spin or world-latitude inputs are supplied.
 */
export class AdvancedBallistics {
  private readonly GRAVITY_SEA_LEVEL = 9.80665;
  private readonly EARTH_RADIUS = 6371000;
  private readonly GAS_CONSTANT = 287.053;

  calculateTrajectory(
    position: THREE.Vector3,
    velocity: THREE.Vector3,
    coefficients: BallisticCoefficients,
    environmental: EnvironmentalFactors,
    deltaTime: number
  ): { position: THREE.Vector3; velocity: THREE.Vector3 } {
    if (
      ![position, velocity, environmental.windSpeed].every(isFiniteVector) ||
      ![
        coefficients.mass,
        coefficients.referenceArea,
        coefficients.dragCoefficient,
        deltaTime,
      ].every(Number.isFinite) ||
      coefficients.mass <= 0 ||
      Math.min(coefficients.referenceArea, coefficients.dragCoefficient, deltaTime) < 0 ||
      deltaTime > 60
    ) {
      throw new RangeError('Invalid advanced trajectory inputs (maximum step 60 seconds)');
    }
    this.calculateAirDensity(
      environmental.altitude,
      environmental.temperature,
      environmental.pressure,
      environmental.humidity
    );
    const p = position.clone();
    let v = velocity.clone();
    const steps = Math.max(1, Math.ceil(deltaTime / 0.02));
    const dt = deltaTime / steps;
    for (let i = 0; i < steps; i++) {
      const previous = v.clone();
      const gravity = this.calculateGravity(p.y + environmental.altitude);
      v.y -= (gravity * dt) / 2;
      const relative = v.clone().sub(environmental.windSpeed);
      const speed = relative.length();
      if (speed > 0) {
        const drag = this.calculateDrag(v, coefficients, environmental, p.y).length();
        // Exact dissipative drag substep, bracketed by gravity kicks.
        relative.multiplyScalar(1 / (1 + (drag * dt) / (coefficients.mass * speed)));
        v = relative.add(environmental.windSpeed);
      }
      v.y -= (gravity * dt) / 2;
      p.addScaledVector(previous.add(v), dt / 2);
    }
    return { position: p, velocity: v };
  }

  private calculateGravity(altitude: number): number {
    if (!Number.isFinite(altitude) || altitude < -1000 || altitude > 50000) {
      throw new RangeError('Supported game atmosphere altitude is -1000 to 50000 metres');
    }
    return this.GRAVITY_SEA_LEVEL * (this.EARTH_RADIUS / (this.EARTH_RADIUS + altitude)) ** 2;
  }

  private calculateDrag(
    velocity: THREE.Vector3,
    coefficients: BallisticCoefficients,
    environmental: EnvironmentalFactors,
    heightAboveReference = 0
  ): THREE.Vector3 {
    const referenceK = environmental.temperature + 273.15;
    const localK = Math.max(216.65, referenceK - 0.0065 * heightAboveReference);
    const pressure =
      environmental.pressure *
      Math.exp(
        (-this.GRAVITY_SEA_LEVEL * heightAboveReference) /
          ((this.GAS_CONSTANT * (referenceK + localK)) / 2)
      );
    const density = this.calculateAirDensity(
      environmental.altitude + heightAboveReference,
      localK - 273.15,
      pressure,
      environmental.humidity
    );
    const relative = velocity.clone().sub(environmental.windSpeed);
    const speed = relative.length();
    if (speed === 0) return relative;
    const mach = speed / (331.3 * Math.sqrt(localK / 273.15));
    const cd = this.adjustDragForMach(coefficients.dragCoefficient, mach);
    return relative.multiplyScalar(-0.5 * density * speed * cd * coefficients.referenceArea);
  }

  /** Inputs are local pressure/temperature at altitude. No second altitude correction is applied. */
  private calculateAirDensity(
    altitude: number,
    temperature: number,
    pressure: number,
    humidity: number
  ): number {
    if (
      ![altitude, temperature, pressure, humidity].every(Number.isFinite) ||
      altitude < -1000 ||
      altitude > 50000 ||
      temperature < -100 ||
      temperature > 100 ||
      pressure < 0 ||
      pressure > 2000 ||
      humidity < 0 ||
      humidity > 1
    ) {
      throw new RangeError('Invalid local atmosphere; pressure must be hPa, temperature Celsius');
    }
    const kelvin = temperature + 273.15;
    const saturation =
      6.1121 * Math.exp(((18.678 - temperature / 234.5) * temperature) / (257.14 + temperature));
    const vapor = Math.min(pressure, humidity * saturation);
    return (
      ((pressure - vapor) * 100) / (this.GAS_CONSTANT * kelvin) + (vapor * 100) / (461.495 * kelvin)
    );
  }

  private adjustDragForMach(baseCd: number, mach: number): number {
    if (mach < 0.8) return baseCd;
    if (mach < 1.2) return baseCd * (1 + 0.5 * (mach - 0.8));
    return baseCd * Math.max(0.2, 1.2 - 0.1 * (mach - 1.2));
  }

  /** Bounded shooting solve against a constant-velocity target, including supplied wind/drag.
   * Radians: azimuth from +X toward +Z. Null means invalid, unreachable or not converged.
   * A returned solution has a simulated residual <= 0.05 m within a 30 s horizon.
   */
  calculateFiringSolution(
    launchPos: THREE.Vector3,
    targetPos: THREE.Vector3,
    targetVel: THREE.Vector3,
    muzzleVelocity: number,
    coefficients: BallisticCoefficients,
    environmental: EnvironmentalFactors
  ): { azimuth: number; elevation: number; timeOfFlight: number } | null {
    if (
      ![launchPos, targetPos, targetVel].every(isFiniteVector) ||
      launchPos.y < 0 ||
      targetPos.y < 0 ||
      !Number.isFinite(muzzleVelocity) ||
      muzzleVelocity <= 0
    )
      return null;
    try {
      const offset = targetPos.clone().sub(launchPos);
      const g = this.calculateGravity(launchPos.y + environmental.altitude);
      const roots = polynomialRoots(
        [
          offset.lengthSq(),
          2 * offset.dot(targetVel),
          targetVel.lengthSq() + g * offset.y - muzzleVelocity ** 2,
          g * targetVel.y,
          (g * g) / 4,
        ],
        1e-6,
        30
      );
      for (const root of roots) {
        const initial = offset.clone().addScaledVector(targetVel, root).divideScalar(root);
        initial.y += (g * root) / 2;
        let azimuth = Math.atan2(initial.z, initial.x);
        let elevation = Math.atan2(initial.y, Math.hypot(initial.x, initial.z));
        let time = root;
        const residual = (az: number, el: number, t: number) =>
          this.positionAt(launchPos, muzzleVelocity, az, el, coefficients, environmental, t)
            .sub(targetPos)
            .addScaledVector(targetVel, -t);
        for (let iteration = 0; iteration < 15; iteration++) {
          if (time <= 0 || time > 30 || targetPos.y + targetVel.y * time < 0) break;
          const error = residual(azimuth, elevation, time);
          if (error.length() <= 0.05) {
            const impact = this.simulateTrajectory(
              launchPos,
              muzzleVelocity,
              azimuth,
              elevation,
              coefficients,
              environmental,
              time
            );
            if (impact.impactPoint && impact.timeOfFlight < time - 0.001) break;
            return { azimuth, elevation, timeOfFlight: time };
          }
          const h = 1e-4;
          const da = residual(azimuth + h, elevation, time)
            .sub(error)
            .divideScalar(h);
          const de = residual(azimuth, elevation + h, time)
            .sub(error)
            .divideScalar(h);
          const dt = residual(azimuth, elevation, time + h)
            .sub(error)
            .divideScalar(h);
          const jacobian = new THREE.Matrix3().set(
            da.x,
            de.x,
            dt.x,
            da.y,
            de.y,
            dt.y,
            da.z,
            de.z,
            dt.z
          );
          if (Math.abs(jacobian.determinant()) < 1e-10) break;
          const change = error.applyMatrix3(jacobian.invert());
          azimuth -= THREE.MathUtils.clamp(change.x, -0.25, 0.25);
          elevation -= THREE.MathUtils.clamp(change.y, -0.25, 0.25);
          time -= THREE.MathUtils.clamp(change.z, -2, 2);
        }
      }
      return null;
    } catch (error) {
      if (error instanceof RangeError) return null;
      throw error;
    }
  }

  private launchVelocity(speed: number, azimuth: number, elevation: number): THREE.Vector3 {
    return new THREE.Vector3(
      Math.cos(elevation) * Math.cos(azimuth),
      Math.sin(elevation),
      Math.cos(elevation) * Math.sin(azimuth)
    ).multiplyScalar(speed);
  }

  private positionAt(
    launch: THREE.Vector3,
    speed: number,
    azimuth: number,
    elevation: number,
    coefficients: BallisticCoefficients,
    environmental: EnvironmentalFactors,
    time: number
  ): THREE.Vector3 {
    return this.calculateTrajectory(
      launch,
      this.launchVelocity(speed, azimuth, elevation),
      coefficients,
      environmental,
      time
    ).position;
  }

  private simulateTrajectory(
    launch: THREE.Vector3,
    speed: number,
    azimuth: number,
    elevation: number,
    coefficients: BallisticCoefficients,
    environmental: EnvironmentalFactors,
    maxTime: number
  ): { impactPoint: THREE.Vector3 | null; timeOfFlight: number } {
    let position = launch.clone();
    let velocity = this.launchVelocity(speed, azimuth, elevation);
    let time = 0;
    while (time < maxTime) {
      if (position.y < 0 || (position.y === 0 && velocity.y <= 0))
        return { impactPoint: position, timeOfFlight: time };
      const dt = Math.min(0.02, maxTime - time);
      const next = this.calculateTrajectory(position, velocity, coefficients, environmental, dt);
      if (next.position.y < 0) {
        const fraction = position.y / (position.y - next.position.y);
        return {
          impactPoint: position.lerp(next.position, fraction),
          timeOfFlight: time + dt * fraction,
        };
      }
      position = next.position;
      velocity = next.velocity;
      time += dt;
    }
    return { impactPoint: null, timeOfFlight: time };
  }
}
