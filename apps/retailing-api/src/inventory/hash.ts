/**
 * Deterministic pseudo-randomness. Every "random" property of the inventory
 * (load factors, demand, cancellations) is a pure function of the seed and a
 * stable key, so the same seed and reference date always give the same data.
 */
export function hashToUnit(seed: string, key: string): number {
  // FNV-1a, 32-bit.
  let hash = 0x811c9dc5;
  const input = `${seed}|${key}`;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  // Final avalanche so similar keys spread across [0, 1).
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  return (hash >>> 0) / 0x1_0000_0000;
}
