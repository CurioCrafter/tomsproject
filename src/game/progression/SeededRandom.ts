/** Stable FNV-1a hash used to make authored reward sources deterministic. */
export function hashSeed(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0 || 0x6d2b79f5;
}

export class SeededRandom {
  private state: number;

  constructor(seed: number | string) {
    this.state = typeof seed === 'string' ? hashSeed(seed) : seed >>> 0 || 0x6d2b79f5;
  }

  next(): number {
    let value = this.state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state = value >>> 0;
    return this.state / 0x1_0000_0000;
  }

  int(minInclusive: number, maxInclusive: number): number {
    const min = Math.ceil(Math.min(minInclusive, maxInclusive));
    const max = Math.floor(Math.max(minInclusive, maxInclusive));
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick<T>(values: readonly T[]): T {
    if (values.length === 0) throw new Error('Cannot choose from an empty collection.');
    return values[Math.min(values.length - 1, Math.floor(this.next() * values.length))];
  }

  weighted<T>(values: readonly Readonly<{ value: T; weight: number }>[]): T {
    if (values.length === 0) throw new Error('Cannot choose from an empty weighted collection.');
    const total = values.reduce((sum, entry) => sum + Math.max(0, entry.weight), 0);
    if (total <= 0) return values[0].value;
    let cursor = this.next() * total;
    for (const entry of values) {
      cursor -= Math.max(0, entry.weight);
      if (cursor <= 0) return entry.value;
    }
    return values[values.length - 1].value;
  }
}
