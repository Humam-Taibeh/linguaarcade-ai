/**
 * Anti-repetition engine: a classic "shuffle bag".
 *
 * Why a bag instead of plain Math.random() per draw: pure random sampling
 * repeats items surprisingly often (the birthday paradox in miniature) and
 * can starve some sentences for a long time. A shuffle bag deals the entire
 * deck in random order before reshuffling, which guarantees two properties
 * the learning experience needs:
 *   1. Every sentence appears exactly once per cycle (full coverage).
 *   2. The same sentence never appears twice consecutively — enforced even
 *      across the reshuffle boundary by nudging the new bag's first card.
 */

/** Unbiased Fisher–Yates shuffle (in place). */
function fisherYates(values: number[]): void {
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
}

export class ShuffleBag {
  private queue: number[] = [];
  private lastLength = 0;

  /** Discard the current cycle (call when the underlying list changes). */
  reset(): void {
    this.queue = [];
    this.lastLength = 0;
  }

  /**
   * Draw the next index for a list of `length` items, guaranteeing the result
   * differs from `avoid` (the index currently on screen) whenever length > 1.
   */
  draw(length: number, avoid: number): number {
    if (length <= 0) return 0;
    if (length === 1) return 0;

    // If the list was resized since the last draw, the old cycle's indices
    // may be stale/out of range — start a fresh cycle.
    if (length !== this.lastLength) {
      this.reset();
      this.lastLength = length;
    }

    if (this.queue.length === 0) {
      this.refill(length, avoid);
    }

    const next = this.queue.shift();
    return next ?? 0;
  }

  private refill(length: number, avoid: number): void {
    const indices = Array.from({ length }, (_, i) => i);
    fisherYates(indices);
    // Cross-cycle guard: if the freshly shuffled bag would immediately repeat
    // the sentence on screen, swap its first card with a random later one.
    if (indices[0] === avoid && length > 1) {
      const swapWith = 1 + Math.floor(Math.random() * (length - 1));
      [indices[0], indices[swapWith]] = [indices[swapWith], indices[0]];
    }
    this.queue = indices;
  }
}
