/**
 * Ultra-precise pronunciation scorer.
 *
 * The Web Speech API gives us the *recognized transcript* of what the user
 * said, not raw phonemes. The engineering insight that makes strict scoring
 * possible anyway: the recognizer itself is trained on native speech, so when
 * a word is mispronounced it is either transcribed as a *different* word,
 * mangled, or dropped entirely. Therefore a rigorous word-level alignment
 * between target text and transcript is a strong proxy for pronunciation
 * accuracy.
 *
 * Algorithm:
 *  1. Normalize both texts (case, punctuation, digit/word equivalences) so we
 *     never punish the user for "2" vs "two".
 *  2. Align target words to spoken words with a dynamic-programming edit
 *     alignment (Needleman-Wunsch style) where substitution cost is
 *     1 - characterSimilarity, so near-misses align to the right slot.
 *  3. Grade each target word by its character-level similarity to the spoken
 *     word it aligned with, using thresholds controlled by the user's
 *     strictness setting.
 */
import type { Strictness } from "../../types";

export type WordVerdict = "correct" | "partial" | "wrong" | "missing";

export interface WordResult {
  /** The word from the target sentence, in its original (display) form. */
  target: string;
  /** The spoken word this target aligned to, or null if it was never said. */
  spoken: string | null;
  /** 0..1 character-level similarity between target and spoken. */
  similarity: number;
  verdict: WordVerdict;
}

export interface PronunciationReport {
  words: WordResult[];
  /** Words the user said that match nothing in the target ("insertions"). */
  extraWords: string[];
  /** Final 0-100 accuracy score, after extra-word penalties. */
  accuracy: number;
  correctCount: number;
  targetCount: number;
}

/**
 * Spoken-form equivalences. Speech recognizers frequently emit digits and
 * symbols; the target text usually spells them out (or vice versa). Without
 * this table, a perfect utterance of "I have two cats" could be scored red
 * because the recognizer wrote "2".
 */
const EQUIVALENCES: Record<string, string> = {
  "0": "zero",
  "1": "one",
  "2": "two",
  "3": "three",
  "4": "four",
  "5": "five",
  "6": "six",
  "7": "seven",
  "8": "eight",
  "9": "nine",
  "10": "ten",
  "11": "eleven",
  "12": "twelve",
  "20": "twenty",
  "30": "thirty",
  "50": "fifty",
  "100": "hundred",
  "&": "and",
  ok: "okay",
  mr: "mister",
  mrs: "missus",
  dr: "doctor",
  st: "street",
  "%": "percent",
  "$": "dollars",
};

/** Thresholds per strictness level. Strict mode demands near-exact matches. */
const THRESHOLDS: Record<Strictness, { correct: number; partial: number }> = {
  standard: { correct: 0.84, partial: 0.55 },
  strict: { correct: 0.92, partial: 0.65 },
};

/**
 * Gap costs for the alignment. They are < 1 so that aligning a near-miss word
 * (substitution cost ≈ 0.2) is always preferred over declaring it missing,
 * but high enough that unrelated words don't get force-paired.
 */
const DELETION_COST = 0.7; // target word not spoken
const INSERTION_COST = 0.7; // spoken word not in target

/** Lowercase, unify apostrophes, strip punctuation, apply equivalences. */
export function normalizeWord(word: string): string {
  const cleaned = word
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[^a-z0-9'&$%]/g, "");
  return EQUIVALENCES[cleaned] ?? cleaned;
}

/** Split display text into words, keeping the original forms for rendering. */
export function tokenize(text: string): string[] {
  return text
    .trim()
    .split(/\s+/)
    .filter((w) => normalizeWord(w).length > 0);
}

/** Classic iterative Levenshtein distance (O(n*m), tiny inputs here). */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = new Array<number>(b.length + 1);
  let current = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) previous[j] = j;

  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, substitution);
    }
    [previous, current] = [current, previous];
  }
  return previous[b.length];
}

/** 1 = identical, 0 = nothing in common (character level, normalized forms). */
export function wordSimilarity(targetWord: string, spokenWord: string): number {
  const a = normalizeWord(targetWord);
  const b = normalizeWord(spokenWord);
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

type AlignmentOp =
  | { op: "match"; targetIndex: number; spokenIndex: number; similarity: number }
  | { op: "delete"; targetIndex: number }
  | { op: "insert"; spokenIndex: number };

/**
 * Global alignment of target words vs spoken words. Returns one operation per
 * consumed word, in sentence order. This is the step that lets us say *which*
 * exact word was mispronounced instead of only producing a global percentage.
 */
function alignWords(targetWords: string[], spokenWords: string[]): AlignmentOp[] {
  const n = targetWords.length;
  const m = spokenWords.length;

  // Pre-compute pairwise similarities once; the DP consults them repeatedly.
  const sim: number[][] = [];
  for (let i = 0; i < n; i++) {
    sim[i] = [];
    for (let j = 0; j < m; j++) {
      sim[i][j] = wordSimilarity(targetWords[i], spokenWords[j]);
    }
  }

  // dp[i][j] = minimal cost of aligning first i target words with first j spoken words.
  const dp: number[][] = [];
  for (let i = 0; i <= n; i++) {
    dp[i] = [];
    for (let j = 0; j <= m; j++) {
      if (i === 0 && j === 0) {
        dp[i][j] = 0;
      } else if (i === 0) {
        dp[i][j] = j * INSERTION_COST;
      } else if (j === 0) {
        dp[i][j] = i * DELETION_COST;
      } else {
        const substitutionCost = 1 - sim[i - 1][j - 1];
        dp[i][j] = Math.min(
          dp[i - 1][j - 1] + substitutionCost,
          dp[i - 1][j] + DELETION_COST,
          dp[i][j - 1] + INSERTION_COST
        );
      }
    }
  }

  // Backtrack from dp[n][m] to recover the operation sequence.
  const ops: AlignmentOp[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const substitutionCost = 1 - sim[i - 1][j - 1];
      if (Math.abs(dp[i][j] - (dp[i - 1][j - 1] + substitutionCost)) < 1e-9) {
        ops.push({ op: "match", targetIndex: i - 1, spokenIndex: j - 1, similarity: sim[i - 1][j - 1] });
        i--;
        j--;
        continue;
      }
    }
    if (i > 0 && Math.abs(dp[i][j] - (dp[i - 1][j] + DELETION_COST)) < 1e-9) {
      ops.push({ op: "delete", targetIndex: i - 1 });
      i--;
      continue;
    }
    ops.push({ op: "insert", spokenIndex: j - 1 });
    j--;
  }
  ops.reverse();
  return ops;
}

/**
 * Produce the full report the UI renders: per-word verdicts, extra words, and
 * the overall accuracy percentage.
 */
export function scorePronunciation(
  targetText: string,
  spokenText: string,
  strictness: Strictness = "standard"
): PronunciationReport {
  const targetWords = tokenize(targetText);
  const spokenWords = tokenize(spokenText);
  const thresholds = THRESHOLDS[strictness];

  const words: WordResult[] = targetWords.map((target) => ({
    target,
    spoken: null,
    similarity: 0,
    verdict: "missing" as WordVerdict,
  }));
  const extraWords: string[] = [];

  for (const op of alignWords(targetWords, spokenWords)) {
    if (op.op === "match") {
      const result = words[op.targetIndex];
      result.spoken = spokenWords[op.spokenIndex];
      result.similarity = op.similarity;
      result.verdict =
        op.similarity >= thresholds.correct
          ? "correct"
          : op.similarity >= thresholds.partial
            ? "partial"
            : "wrong";
    } else if (op.op === "insert") {
      extraWords.push(spokenWords[op.spokenIndex]);
    }
    // "delete" ops need no work: those words keep their "missing" default.
  }

  // Scoring: each target word contributes its similarity; badly-wrong matches
  // are discounted further so strict mode genuinely punishes them. Extra words
  // apply a small penalty each — rambling around the sentence is not shadowing.
  const targetCount = targetWords.length;
  let credit = 0;
  let correctCount = 0;
  for (const w of words) {
    if (w.verdict === "correct") {
      credit += 1;
      correctCount++;
    } else if (w.verdict === "partial") {
      credit += w.similarity;
    } else if (w.verdict === "wrong") {
      credit += w.similarity * 0.5;
    }
  }
  const base = targetCount > 0 ? credit / targetCount : 0;
  const extraPenalty = extraWords.length * 0.03;
  const accuracy = Math.max(0, Math.round((base - extraPenalty) * 100));

  return { words, extraWords, accuracy, correctCount, targetCount };
}
