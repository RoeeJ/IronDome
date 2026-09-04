import type { Projectile } from '@/entities/Projectile';
import type { Threat } from '@/entities/Threat';
import type { IBattery } from '@/entities/IBattery';
import { stepEvents } from './StepEvents';

interface StepContext {
  gameMode: boolean;
  autoIntercept: boolean;
  repairRate: number;
  wave: { update(dt: number): void };
  batteries: IBattery[];
  threats: { getActiveThreats(): Threat[]; update(dt: number): void; finalizeTerminations(): void };
  interceptions: {
    prepareStep(threats: Threat[], manual: boolean, dt: number): void;
    getActiveInterceptors(): Projectile[];
    update(threats: Threat[], manual: boolean, dt: number): unknown;
  };
  radar?: { update(threats: Threat[]): void };
  world: { step(dt: number): void };
  projectiles: Projectile[];
  destroyProjectile(projectile: Projectile): void;
  dayNight: { update(dt: number): void };
  debris: { update(dt: number): void };
}

/** The shared production step: forces before integration; one battery owner; contacts after motion. */
export function runSimulationStep(dt: number, context: StepContext): void {
  if (context.gameMode) context.wave.update(dt);
  const threats = context.threats.getActiveThreats();
  for (const battery of context.batteries) battery.setAutoRepairRate(context.repairRate);
  context.radar?.update(threats);
  context.interceptions.prepareStep(threats, !context.autoIntercept, dt);
  for (const threat of threats) if (threat.isActive) threat.preparePhysics(dt);
  const projectiles = new Set([
    ...context.projectiles,
    ...context.interceptions.getActiveInterceptors(),
  ]);
  for (const projectile of projectiles) if (projectile.isActive) projectile.preparePhysics(dt);
  stepEvents.begin();
  context.world.step(dt);
  context.threats.update(dt);
  context.interceptions.update(context.threats.getActiveThreats(), !context.autoIntercept, dt);
  const ownedInterceptors = new Set(context.interceptions.getActiveInterceptors());
  for (let i = context.projectiles.length - 1; i >= 0; i--) {
    const projectile = context.projectiles[i];
    if (!ownedInterceptors.has(projectile)) projectile.update(dt);
    if (!projectile.isActive || projectile.body.position.y < -10) {
      context.destroyProjectile(projectile);
      context.projectiles.splice(i, 1);
    }
  }
  stepEvents.resolve();
  context.threats.finalizeTerminations();
  context.dayNight.update(dt);
  context.debris.update(dt);
}
