import { makeDeck } from '../cards/deck.js';
import { bestHand } from './eval.js';
import { shuffle } from '../../core/util.js';

// Шанс выиграть раздачу методом Монте-Карло: раздаём соперникам случайные
// карты и докладываем стол.
export function equity(hole, board, opponents, iters = 160, rng = Math.random) {
  const known = new Set([...hole, ...board]);
  const rest = makeDeck().filter((c) => !known.has(c));
  const opp = Math.max(1, Math.min(opponents, 4));
  let score = 0;
  for (let k = 0; k < iters; k++) {
    const deck = shuffle(rest, rng);
    let p = 0;
    const full = board.concat(deck.slice(p, p + 5 - board.length));
    p += 5 - board.length;
    const mine = bestHand([...hole, ...full]).score;
    let best = 0;
    let ties = 0;
    let lose = false;
    for (let o = 0; o < opp; o++) {
      const s = bestHand([deck[p++], deck[p++], ...full]).score;
      if (s > mine) {
        lose = true;
        break;
      }
      if (s === mine) ties++;
      best = Math.max(best, s);
    }
    if (!lose) score += ties ? 1 / (ties + 1) : 1;
  }
  return score / iters;
}

// Решение бота по публичному состоянию и своим картам.
export function decide({ hole, board, toCall, pot, chips, bet, currentBet, minRaise, bb, opponents }, rng = Math.random) {
  const e = equity(hole, board, opponents, 140, rng);
  const maxTo = bet + chips;
  const raiseTo = (mult) => {
    const want = Math.max(currentBet + minRaise, Math.round((currentBet + Math.max(pot, bb * 2) * mult) / bb) * bb);
    return Math.min(maxTo, want);
  };
  if (toCall === 0) {
    if (e > 0.62 && rng() < 0.75) return { t: 'raise', to: raiseTo(0.6) };
    if (e > 0.45 && rng() < 0.2) return { t: 'raise', to: raiseTo(0.4) };
    return { t: 'check' };
  }
  const odds = toCall / (pot + toCall);
  if (e < odds * 0.85 && rng() > 0.06) return { t: 'fold' };
  if (e > 0.72 && rng() < 0.55 && maxTo > currentBet + minRaise) return { t: 'raise', to: raiseTo(0.8) };
  return { t: 'call' };
}
