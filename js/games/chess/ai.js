import { pseudoMoves, makeMove, inCheck, colorOf } from './rules.js';

const VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

// Таблицы позиционных бонусов (для белых, ряд 0 — первая горизонталь).
const PST = {
  p: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, -20, -20, 10, 10, 5, 5, -5, -10, 0, 0, -10, -5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, 5, 10, 25, 25, 10, 5, 5, 10, 10, 20, 30, 30, 20, 10, 10, 50, 50, 50, 50, 50, 50, 50, 50, 0, 0, 0, 0, 0, 0, 0, 0],
  n: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 5, 5, 0, -20, -40, -30, 5, 10, 15, 15, 10, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 10, 15, 15, 10, 0, -30, -40, -20, 0, 0, 0, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
  b: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 5, 0, 0, 0, 0, 5, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 0, 0, 0, 0, 0, 0, -10, -20, -10, -10, -10, -10, -10, -10, -20],
  r: [0, 0, 0, 5, 5, 0, 0, 0, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 5, 10, 10, 10, 10, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
  q: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 5, 0, 0, 0, 0, -10, -10, 5, 5, 5, 5, 5, 0, -10, 0, 0, 5, 5, 5, 5, 0, -5, -5, 0, 5, 5, 5, 5, 0, -5, -10, 0, 5, 5, 5, 5, 0, -10, -10, 0, 0, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
  k: [20, 30, 10, 0, 0, 10, 30, 20, 20, 20, 0, 0, 0, 0, 20, 20, -10, -20, -20, -20, -20, -20, -20, -10, -20, -30, -30, -40, -40, -30, -30, -20, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30],
};

// Оценка позиции с точки зрения того, чей ход.
export function evaluate(s) {
  let score = 0;
  for (let i = 0; i < 64; i++) {
    const p = s.b[i];
    if (!p) continue;
    const t = p.toLowerCase();
    if (colorOf(p) === 'w') score += VAL[t] + PST[t][i];
    else score -= VAL[t] + PST[t][(7 - Math.floor(i / 8)) * 8 + (i % 8)];
  }
  return s.turn === 'w' ? score : -score;
}

const order = (moves) =>
  moves.sort((a, b) => (b.capture ? VAL[b.capture.toLowerCase()] * 10 : 0) + (b.promo ? 800 : 0) - ((a.capture ? VAL[a.capture.toLowerCase()] * 10 : 0) + (a.promo ? 800 : 0)));

class Timeout extends Error {}

export function bestMove(s, { level = 'medium', timeMs = 700, rng = Math.random } = {}) {
  const maxDepth = { easy: 1, medium: 2, hard: 4 }[level] ?? 2;
  const deadline = Date.now() + timeMs;
  let nodes = 0;

  function quiesce(st, alpha, beta, depth) {
    const stand = evaluate(st);
    if (stand >= beta) return beta;
    if (alpha < stand) alpha = stand;
    if (depth <= 0) return alpha;
    for (const m of order(pseudoMoves(st).filter((x) => x.capture))) {
      const ns = makeMove(st, m);
      if (inCheck(ns, st.turn)) continue;
      const score = -quiesce(ns, -beta, -alpha, depth - 1);
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  function search(st, depth, alpha, beta) {
    if (++nodes % 512 === 0 && Date.now() > deadline) throw new Timeout();
    if (depth === 0) return quiesce(st, alpha, beta, 3);
    let any = false;
    for (const m of order(pseudoMoves(st))) {
      const ns = makeMove(st, m);
      if (inCheck(ns, st.turn)) continue;
      any = true;
      const score = -search(ns, depth - 1, -beta, -alpha);
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    if (!any) return inCheck(st) ? -100000 - depth : 0;
    return alpha;
  }

  const root = order(pseudoMoves(s)).filter((m) => !inCheck(makeMove(s, m), s.turn));
  if (!root.length) return null;
  let best = root[0];
  let scored = root.map((m) => ({ m, score: 0 }));
  for (let depth = 1; depth <= maxDepth; depth++) {
    try {
      const next = [];
      let alpha = -Infinity;
      // Ходы заметно хуже лучшего отсекаются, но всё, что близко к нему,
      // считается точно: среди почти равных ходов бот выбирает случайно.
      const margin = level === 'easy' ? Infinity : 20;
      for (const { m } of scored) {
        const lo = alpha - margin;
        const score = -search(makeMove(s, m), depth - 1, -Infinity, -lo);
        next.push({ m, score });
        if (score > alpha) alpha = score;
      }
      scored = next.sort((a, b) => b.score - a.score);
      best = scored[0].m;
    } catch (e) {
      if (!(e instanceof Timeout)) throw e;
      break;
    }
  }
  // Лёгкий уровень иногда ошибается — так интереснее новичкам.
  if (level === 'easy') {
    const top = scored.slice(0, 4).filter((x) => x.score > scored[0].score - 150);
    return top[Math.floor(rng() * top.length)].m;
  }
  const near = scored.filter((x) => x.score >= scored[0].score - 8);
  return near[Math.floor(rng() * near.length)]?.m || best;
}
