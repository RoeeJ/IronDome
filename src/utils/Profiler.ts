export interface ProfilerSection {
  name: string;
  startTime: number;
  endTime: number;
  duration: number;
  children: ProfilerSection[];
}

export class Profiler {
  private sections: Map<string, ProfilerSection> = new Map();
  private currentSection: ProfilerSection | null = null;
  private sectionStack: ProfilerSection[] = [];
  private frameData: ProfilerSection[] = [];
  private maxFrames: number = 60;

  // Running averages
  private averages: Map<string, number[]> = new Map();
  private readonly averageWindow = 60; // frames

  startSection(name: string): void {
    const section: ProfilerSection = {
      name,
      startTime: performance.now(),
      endTime: 0,
      duration: 0,
      children: [],
    };

    if (this.currentSection) {
      this.currentSection.children.push(section);
      this.sectionStack.push(this.currentSection);
    } else {
      this.frameData.push(section);
    }

    this.currentSection = section;
    this.sections.set(name, section);
  }

  endSection(name: string): void {
    const section = this.sections.get(name);
    if (!section || section !== this.currentSection) {
      console.warn(`Profiler: Mismatched section end for "${name}"`);
      return;
    }

    section.endTime = performance.now();
    section.duration = section.endTime - section.startTime;

    // Update running average
    if (!this.averages.has(name)) {
      this.averages.set(name, []);
    }
    const avg = this.averages.get(name)!;
    avg.push(section.duration);
    if (avg.length > this.averageWindow) {
      avg.shift();
    }

    // Pop the stack
    if (this.sectionStack.length > 0) {
      this.currentSection = this.sectionStack.pop()!;
    } else {
      this.currentSection = null;
    }
  }

  measure<T>(name: string, fn: () => T): T {
    this.startSection(name);
    try {
      return fn();
    } finally {
      this.endSection(name);
    }
  }

  async measureAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
    this.startSection(name);
    try {
      return await fn();
    } finally {
      this.endSection(name);
    }
  }

  endFrame(): void {
    // Clean up any unclosed sections
    this.currentSection = null;
    this.sectionStack = [];
    this.sections.clear();

    // Limit frame history
    if (this.frameData.length > this.maxFrames) {
      this.frameData.shift();
    }
  }

  getFrameData(): ProfilerSection[] {
    return this.frameData;
  }

  getLastFrameData(): ProfilerSection[] {
    return this.frameData.length > 0 ? this.frameData[this.frameData.length - 1].children : [];
  }

  getAverages(): Map<string, number> {
    const result = new Map<string, number>();

    for (const [name, values] of this.averages) {
      if (values.length > 0) {
        const sum = values.reduce((a, b) => a + b, 0);
        result.set(name, sum / values.length);
      }
    }

    return result;
  }

  getHotspots(threshold: number = 5): Array<{ name: string; avgTime: number; percentage: number }> {
    const averages = this.getAverages();
    const totalTime = Array.from(averages.values()).reduce((a, b) => a + b, 0);

    const hotspots = Array.from(averages.entries())
      .filter(([_, time]) => time > threshold)
      .map(([name, time]) => ({
        name,
        avgTime: time,
        percentage: (time / totalTime) * 100,
      }))
      .sort((a, b) => b.avgTime - a.avgTime);

    return hotspots;
  }

  reset(): void {
    this.sections.clear();
    this.currentSection = null;
    this.sectionStack = [];
    this.frameData = [];
    this.averages.clear();
  }
}
