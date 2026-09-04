import { SimulationClock } from '@/simulation/SimulationClock';

export class FixedStepDriver {
  readonly stepSeconds = 1 / 60;
  readonly maxSteps = 32;
  private accumulator = 0;
  private requested = 0;
  private executed = 0;
  private dropped = 0;

  constructor(readonly clock: SimulationClock) {}

  advance(
    wallDelta: number,
    scale: number,
    suspended: boolean,
    step: (dt: number) => void
  ): number {
    if (!Number.isFinite(wallDelta) || wallDelta < 0 || !Number.isFinite(scale) || scale < 0) {
      throw new RangeError('Invalid frame delta or simulation scale');
    }
    if (suspended) return 0;
    const requested = wallDelta * scale;
    this.requested += requested;
    this.accumulator += requested;
    const limit = this.maxSteps * this.stepSeconds;
    if (this.accumulator > limit) {
      this.dropped += this.accumulator - limit;
      this.accumulator = limit;
    }
    let steps = 0;
    while (this.accumulator + 1e-10 >= this.stepSeconds && steps < this.maxSteps) {
      this.clock.advance(this.stepSeconds);
      step(this.stepSeconds);
      this.accumulator = Math.max(0, this.accumulator - this.stepSeconds);
      this.executed += this.stepSeconds;
      steps++;
    }
    return steps;
  }

  get interpolationAlpha(): number {
    return this.accumulator / this.stepSeconds;
  }
  get diagnostics() {
    return {
      requestedSeconds: this.requested,
      executedSeconds: this.executed,
      droppedSeconds: this.dropped,
    };
  }
}
