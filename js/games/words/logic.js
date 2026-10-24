import { shuffle } from '../../core/util.js';

// 25 уровней в 5 ступенях. С уровнем растут длина слов и их число,
// а время на слово и пауза между словами уменьшаются.
const LENS = [
  [4, 4], [4, 4], [4, 4], [4, 5], [4, 5],
  [4, 5], [5, 5], [5, 5], [5, 5], [5, 6],
  [5, 6], [5, 6], [6, 6], [6, 6], [6, 6],
  [6, 7], [6, 7], [6, 7], [7, 7], [7, 7],
  [7, 7], [7, 8], [7, 8], [8, 8], [8, 9],
];

export const LEVELS = LENS.map((len, k) => ({
  n: k + 1,
  tier: Math.floor(k / 5), // 0 новичок … 4 мастер
  len,
  words: 10 + Math.floor(k / 3),
  time: Math.round(30 - (k * 16) / 24),
  pause: Math.round(2200 - k * 40),
  mult: 1 + k * 0.25,
}));

export const MAX_LEVEL = LEVELS.length;
export const MAX_HINTS = 2;
const HINT_FACTOR = [1, 0.6, 0.3];
// Первый собравший получает всё, следующие — меньше.
const PLACE_FACTOR = [1, 0.6, 0.4, 0.3, 0.25];

// Разбор списка слов («СЛОВО|подсказка» построчно, одной строкой или
// объектом из строк) → { длина: [{word, clue}], … }
export function parseWords(raw) {
  const text = typeof raw === 'string' ? raw : Object.values(raw).join('\n');
  const out = {};
  for (const line of text.split('\n')) {
    const l = line.trim();
    if (!l) continue;
    const [word, clue] = l.split('|');
    const w = word.trim().toUpperCase();
    (out[[...w].length] ||= []).push({ word: w, clue: (clue || '').trim() });
  }
  return out;
}

export function pickWords(pool, level, used = new Set(), rng = Math.random) {
  const { len, words } = LEVELS[level - 1];
  const all = [];
  for (let l = len[0]; l <= len[1]; l++) all.push(...(pool[l] || []));
  const fresh = shuffle(
    all.filter((w) => !used.has(w.word)),
    rng,
  );
  const stale = shuffle(
    all.filter((w) => used.has(w.word)),
    rng,
  );
  const chosen = [...fresh, ...stale].slice(0, words);
  chosen.forEach((w) => used.add(w.word));
  return chosen;
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

export function wordPoints(level, ms, durMs, hints = 0, place = 0) {
  const { mult } = LEVELS[level - 1];
  const left = Math.max(0, Math.min(1, 1 - ms / durMs));
  const pf = PLACE_FACTOR[Math.min(place, PLACE_FACTOR.length - 1)];
  const raw = (100 + 100 * left) * mult * HINT_FACTOR[Math.min(hints, MAX_HINTS)] * pf;
  return Math.round(raw / 5) * 5;
}

// Места с учётом равных очков: [{id, score}] → [{id, score, place}]
export function rank(scores) {
  const list = Object.entries(scores)
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
  list.forEach((r, i) => (r.place = i > 0 && r.score === list[i - 1].score ? list[i - 1].place : i + 1));
  return list;
}
