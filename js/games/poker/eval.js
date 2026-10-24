import { rankValue } from '../cards/deck.js';

// Категории комбинаций: 0 старшая карта … 8 стрит-флеш.
export const CATS = ['high', 'pair', 'twoPair', 'trips', 'straight', 'flush', 'fullHouse', 'quads', 'straightFlush'];
const BASE = 15 ** 5;

// Оценка ровно пяти карт: чем больше число, тем сильнее рука.
export function eval5(cards) {
  const vals = cards.map((c) => rankValue(c[0])).sort((a, b) => b - a);
  const flush = cards.every((c) => c[1] === cards[0][1]);
  const counts = new Map();
  for (const v of vals) counts.set(v, (counts.get(v) || 0) + 1);
  const groups = [...counts].map(([v, n]) => [n, v]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  let straight = 0;
  if (counts.size === 5) {
    if (vals[0] - vals[4] === 4) straight = vals[0];
    else if (vals[0] === 14 && vals[1] === 5) straight = 5; // A-2-3-4-5
  }
  let cat;
  let tb;
  if (straight && flush) [cat, tb] = [8, [straight]];
  else if (groups[0][0] === 4) [cat, tb] = [7, [groups[0][1], groups[1][1]]];
  else if (groups[0][0] === 3 && groups[1][0] === 2) [cat, tb] = [6, [groups[0][1], groups[1][1]]];
  else if (flush) [cat, tb] = [5, vals];
  else if (straight) [cat, tb] = [4, [straight]];
  else if (groups[0][0] === 3) [cat, tb] = [3, groups.map((g) => g[1])];
  else if (groups[0][0] === 2 && groups[1][0] === 2) [cat, tb] = [2, groups.map((g) => g[1])];
  else if (groups[0][0] === 2) [cat, tb] = [1, groups.map((g) => g[1])];
  else [cat, tb] = [0, vals];
  let score = 0;
  for (let i = 0; i < 5; i++) score = score * 15 + (tb[i] || 0);
  return cat * BASE + score;
}

const COMBOS = {};
function combos(n) {
  if (COMBOS[n]) return COMBOS[n];
  const out = [];
  const rec = (start, acc) => {
    if (acc.length === 5) return out.push(acc.slice());
    for (let i = start; i < n; i++) {
      acc.push(i);
      rec(i + 1, acc);
      acc.pop();
    }
  };
  rec(0, []);
  return (COMBOS[n] = out);
}

// Лучшая пятёрка из 5–7 карт.
export function bestHand(cards) {
  let best = -1;
  let bestIdx = null;
  for (const idx of combos(cards.length)) {
    const s = eval5(idx.map((i) => cards[i]));
    if (s > best) {
      best = s;
      bestIdx = idx;
    }
  }
  return { score: best, cat: Math.floor(best / BASE), best: bestIdx.map((i) => cards[i]) };
}
