interface ScheduledEvent {
  id: number;
  due: number;
  callback: () => void;
}

/** Gameplay clock. Only the fixed-step driver advances time; pause needs no timer rewriting. */
export class SimulationClock {
  private elapsed = 0;
  private nextId = 1;
  private events = new Map<number, ScheduledEvent>();

  get seconds(): number {
    return this.elapsed;
  }
  get nowMs(): number {
    return this.elapsed * 1000;
  }

  schedule(delaySeconds: number, callback: () => void): number {
    if (!Number.isFinite(delaySeconds) || delaySeconds < 0)
      throw new RangeError('Invalid simulation delay');
    const id = this.nextId++;
    this.events.set(id, { id, due: this.elapsed + delaySeconds, callback });
    return id;
  }

  cancel(id: number | null): void {
    if (id !== null) this.events.delete(id);
  }

  /** Millisecond adapter for existing game-effect and salvo scheduling APIs. */
  setTimeout(callback: () => void, delayMs: number): number {
    return this.schedule(delayMs / 1000, callback);
  }

  advance(deltaTime: number): void {
    if (!Number.isFinite(deltaTime) || deltaTime < 0)
      throw new RangeError('Invalid simulation delta');
    this.elapsed += deltaTime;
    // Snapshot prevents zero-delay recursive callbacks from monopolizing a tick.
    const due = [...this.events.values()]
      .filter(event => event.due <= this.elapsed + 1e-10)
      .sort((a, b) => a.due - b.due || a.id - b.id);
    for (const event of due) {
      if (!this.events.delete(event.id)) continue;
      event.callback();
    }
  }

  reset(): void {
    this.elapsed = 0;
    this.events.clear();
    this.nextId = 1;
  }
}

export const simulationClock = new SimulationClock();
