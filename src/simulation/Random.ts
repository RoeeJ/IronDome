export class SeededRandom {
  constructor(private state: number) {}
  reset(seed: number): void {
    this.state = seed >>> 0;
  }
  next(): number {
    let value = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }
}

export const gameplayRandom = new SeededRandom(0x1d0e2026);
export const cosmeticRandom = new SeededRandom(0xc05e71c);

export const worldRandom = new SeededRandom(0xc17f2026);
