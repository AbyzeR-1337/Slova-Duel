import { shuffle } from '../../core/util.js';

// Карта — строка из двух символов: достоинство (2–9, T, J, Q, K, A) и масть (S, H, D, C).
export const SUITS = ['S', 'H', 'D', 'C'];
export const RANKS_52 = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
export const RANKS_36 = ['6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

export const rankOf = (c) => c[0];
export const suitOf = (c) => c[1];
export const rankValue = (r) => '23456789TJQKA'.indexOf(r) + 2;

export function makeDeck(ranks = RANKS_52, copies = 1) {
  const out = [];
  for (let k = 0; k < copies; k++) for (const s of SUITS) for (const r of ranks) out.push(r + s);
  return out;
}

export const shuffled = (cards, rng) => shuffle(cards, rng);

export const isRed = (c) => c[1] === 'H' || c[1] === 'D';
export const SUIT_SYMBOL = { S: '♠', H: '♥', D: '♦', C: '♣' };
