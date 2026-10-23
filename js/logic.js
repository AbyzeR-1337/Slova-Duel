import { WORDS } from './words.js';

// С каждым уровнем слова длиннее, их больше, а времени на слово меньше.
export const LEVELS = [
  { n: 1, name: 'Разминка', words: 10, time: 30, pause: 2200, mult: 1 },
  { n: 2, name: 'Лёгкий', words: 12, time: 25, pause: 2000, mult: 1.5 },
  { n: 3, name: 'Средний', words: 14, time: 22, pause: 1800, mult: 2 },
  { n: 4, name: 'Быстрый', words: 16, time: 20, pause: 1600, mult: 2.5 },
  { n: 5, name: 'Мастер', words: 18, time: 18, pause: 1400, mult: 3 },
];

export const MAX_LEVEL = LEVELS.length;
export const MAX_HINTS = 2;
const HINT_FACTOR = [1, 0.6, 0.3];

export function levelInfo(n) {
  const cfg = LEVELS[n - 1];
  const len = WORDS[n][0].word.length;
  return { ...cfg, letters: len };
}

export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function pickWords(level, rng = Math.random) {
  return shuffle(WORDS[level], rng).slice(0, LEVELS[level - 1].words);
}

// Перемешивает буквы так, чтобы слово не читалось сразу:
// хотя бы половина букв должна стоять не на своём месте.
export function scramble(word, rng = Math.random) {
  const letters = [...word];
  const need = Math.ceil(letters.length / 2);
  let best = null;
  let bestMoved = -1;
  for (let attempt = 0; attempt < 60; attempt++) {
    const s = shuffle(letters, rng);
    const moved = s.filter((ch, i) => ch !== letters[i]).length;
    if (moved > bestMoved) {
      best = s;
      bestMoved = moved;
    }
    if (moved >= need) break;
  }
  return best;
}

export function wordPoints(level, ms, durMs, hints = 0) {
  const { mult } = LEVELS[level - 1];
  const left = Math.max(0, Math.min(1, 1 - ms / durMs));
  const raw = (100 + 100 * left) * mult * HINT_FACTOR[Math.min(hints, MAX_HINTS)];
  return Math.round(raw / 5) * 5;
}

// Кто из заявивших решение был быстрее. claims: { p1: {ms, hints}, ... }
export function pickWinner(claims) {
  let winner = null;
  for (const [pid, c] of Object.entries(claims)) {
    if (!winner || c.ms < claims[winner].ms) winner = pid;
  }
  return winner;
}

export function leader(scores) {
  const ids = Object.keys(scores);
  if (ids.length < 2) return ids[0] ?? null;
  const [a, b] = ids;
  if (scores[a] === scores[b]) return null;
  return scores[a] > scores[b] ? a : b;
}
