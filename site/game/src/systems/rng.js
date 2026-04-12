function xmur3(value) {
  let hash = 1779033703 ^ value.length;

  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }

  return function nextSeed() {
    hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
    hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
    return (hash ^= hash >>> 16) >>> 0;
  };
}

export function createSeededRandom(seedInput) {
  const source = xmur3(String(seedInput ?? ""));
  let seed = source();

  return function seededRandom() {
    seed += 0x6d2b79f5;
    let output = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    output ^= output + Math.imul(output ^ (output >>> 7), 61 | output);
    return ((output ^ (output >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomBetween(random, min, max) {
  return min + (max - min) * random();
}

export function randomInt(random, min, max) {
  return Math.floor(randomBetween(random, min, max + 1));
}

export function choose(random, items) {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }

  return items[randomInt(random, 0, items.length - 1)];
}

export function pickWeighted(random, items, getWeight = (item) => item.weight ?? 1) {
  const total = items.reduce(
    (sum, item) => sum + Math.max(0, Number(getWeight(item)) || 0),
    0
  );

  if (total <= 0) {
    return items[0] ?? null;
  }

  let cursor = random() * total;

  for (const item of items) {
    cursor -= Math.max(0, Number(getWeight(item)) || 0);
    if (cursor <= 0) {
      return item;
    }
  }

  return items[items.length - 1] ?? null;
}
