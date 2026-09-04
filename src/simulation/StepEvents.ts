interface StepEvent {
  fraction: number;
  priority: number;
  order: number;
  resolve: () => void;
}

/** Resolve contacts across systems in time order. At exact ties, solid contact precedes fuse,
 * then expiry, then payload deployment. Direct laser damage occurs before motion (fraction 0). */
export class StepEvents {
  private events: StepEvent[] = [];
  private collecting = false;
  begin(): void {
    this.events = [];
    this.collecting = true;
  }
  add(fraction: number, priority: number, resolve: () => void): void {
    if (!this.collecting) {
      resolve();
      return;
    }
    this.events.push({
      fraction: Math.max(0, Math.min(1, fraction)),
      priority,
      order: this.events.length,
      resolve,
    });
  }
  resolve(): void {
    this.collecting = false;
    const events = this.events;
    this.events = [];
    events.sort((a, b) => a.fraction - b.fraction || a.priority - b.priority || a.order - b.order);
    for (const event of events) event.resolve();
  }
}
export const stepEvents = new StepEvents();
