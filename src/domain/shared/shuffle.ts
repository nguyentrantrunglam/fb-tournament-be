/**
 * Fisher-Yates shuffle — returns a NEW shuffled array, input is not mutated.
 * Accepts an optional rng function (default Math.random) to allow deterministic
 * testing without depending on global random state.
 */
export function shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = result[i] as T;
    result[i] = result[j] as T;
    result[j] = tmp;
  }
  return result;
}
