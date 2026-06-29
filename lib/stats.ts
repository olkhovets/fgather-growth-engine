/**
 * Binomial confidence helpers for the optimizer. At a ~0.05% positive-reply rate the raw
 * "this variant's rate is higher" comparison is almost all noise — six positives across twelve
 * thousand sends cannot distinguish anything by point estimate alone. Wilson score intervals give
 * us an honest confidence band so the loop only PROMOTES when a variant's lower bound clears the
 * baseline, only KILLS when its upper bound is below the baseline, and otherwise correctly says
 * "not enough data yet" instead of chasing noise. All rates here are fractions (0-1), not percents.
 */

const Z_95 = 1.96; // 95% two-sided

/** Wilson score interval for a binomial proportion. Returns [lower, upper] as fractions (0-1). */
export function wilsonInterval(successes: number, n: number, z: number = Z_95): [number, number] {
  if (n <= 0) return [0, 1];
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

export function wilsonLower(successes: number, n: number, z: number = Z_95): number {
  return wilsonInterval(successes, n, z)[0];
}

export function wilsonUpper(successes: number, n: number, z: number = Z_95): number {
  return wilsonInterval(successes, n, z)[1];
}

/**
 * Compare two binomial arms with confidence. Returns which arm is the confident leader, or null
 * when their Wilson intervals overlap (too close to call). Use this before switching strategy so
 * the engine doesn't flip on a one-reply swing.
 */
export function confidentLeader(
  a: { successes: number; n: number },
  b: { successes: number; n: number },
  z: number = Z_95
): "a" | "b" | null {
  if (a.n <= 0 || b.n <= 0) return null;
  const [aLo, aHi] = wilsonInterval(a.successes, a.n, z);
  const [bLo, bHi] = wilsonInterval(b.successes, b.n, z);
  if (aLo > bHi) return "a";
  if (bLo > aHi) return "b";
  return null;
}
