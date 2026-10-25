// Русские шашки: бить обязательно (назад тоже), дамка ходит и бьёт на любое
// расстояние, шашка, дошедшая до последнего ряда во время боя, бьёт дальше уже как дамка.
// Доска — 64 клетки, индекс = ряд * 8 + вертикаль; белые внизу (ряды 0–2) и ходят первыми.
// w/b — шашки, W/B — дамки.

export const colorOf = (p) => (p === 'w' || p === 'W' ? 'w' : p === 'b' || p === 'B' ? 'b' : null);
const isKing = (p) => p === 'W' || p === 'B';
const DIRS = [[1, 1], [-1, 1], [1, -1], [-1, -1]];
const at = (f, r) => (f >= 0 && f < 8 && r >= 0 && r < 8 ? r * 8 + f : -1);

export function initial() {
  const b = Array(64).fill('');
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      if ((r + f) % 2 !== 0) continue; // тёмные поля: a1 — тёмное
      if (r < 3) b[r * 8 + f] = 'w';
      if (r > 4) b[r * 8 + f] = 'b';
    }
  }
  return { b, turn: 'w', quiet: 0 };
}

// Все варианты боя из клетки from (полные цепочки до конца). Сбитые шашки
// снимаются только после хода, поэтому перепрыгнуть их второй раз нельзя.
function captures(b, from, piece, turn) {
  const lastRow = turn === 'w' ? 7 : 0;
  const rec = (sq, king, path, taken) => {
    const f = sq % 8;
    const r = Math.floor(sq / 8);
    const results = [];
    for (const [df, dr] of DIRS) {
      if (king) {
        let ff = f + df;
        let rr = r + dr;
        while (at(ff, rr) >= 0 && !b[at(ff, rr)]) {
          ff += df;
          rr += dr;
        }
        const enemy = at(ff, rr);
        if (enemy < 0 || !b[enemy] || colorOf(b[enemy]) === turn || taken.includes(enemy)) continue;
        const branches = [];
        let lf = ff + df;
        let lr = rr + dr;
        while (at(lf, lr) >= 0 && !b[at(lf, lr)]) {
          const land = at(lf, lr);
          branches.push(rec(land, true, [...path, land], [...taken, enemy]));
          lf += df;
          lr += dr;
        }
        // Если с какого-то поля можно бить дальше — встать нужно именно туда.
        const goOn = branches.filter((arr) => arr.some((x) => x.taken.length > taken.length + 1));
        results.push(...(goOn.length ? goOn : branches).flat());
      } else {
        const enemy = at(f + df, r + dr);
        const land = at(f + 2 * df, r + 2 * dr);
        if (enemy < 0 || land < 0) continue;
        if (!b[enemy] || colorOf(b[enemy]) === turn || taken.includes(enemy) || b[land]) continue;
        const promote = Math.floor(land / 8) === lastRow;
        results.push(...rec(land, promote, [...path, land], [...taken, enemy]));
      }
    }
    if (!results.length && taken.length) return [{ path, taken, promote: king && !isKing(piece) }];
    return results;
  };
  // Пока идёт бой, исходная клетка считается пустой — сквозь неё можно пролетать.
  const saved = b[from];
  b[from] = '';
  const out = rec(from, isKing(piece), [from], []);
  b[from] = saved;
  return out;
}

export function legalMoves(s) {
  const { b, turn } = s;
  const caps = [];
  const quiet = [];
  for (let i = 0; i < 64; i++) {
    const p = b[i];
    if (colorOf(p) !== turn) continue;
    caps.push(...captures(b, i, p, turn));
    if (caps.length) continue;
    const f = i % 8;
    const r = Math.floor(i / 8);
    const fwd = turn === 'w' ? 1 : -1;
    for (const [df, dr] of DIRS) {
      if (isKing(p)) {
        let ff = f + df;
        let rr = r + dr;
        while (at(ff, rr) >= 0 && !b[at(ff, rr)]) {
          quiet.push({ path: [i, at(ff, rr)], taken: [] });
          ff += df;
          rr += dr;
        }
      } else if (dr === fwd) {
        const to = at(f + df, r + dr);
        if (to >= 0 && !b[to]) quiet.push({ path: [i, to], taken: [], promote: Math.floor(to / 8) === (turn === 'w' ? 7 : 0) });
      }
    }
  }
  return caps.length ? caps : quiet;
}

export function makeMove(s, m) {
  const b = s.b.slice();
  const from = m.path[0];
  const to = m.path[m.path.length - 1];
  let p = b[from];
  b[from] = '';
  for (const t of m.taken) b[t] = '';
  const lastRow = s.turn === 'w' ? 7 : 0;
  if (m.promote || Math.floor(to / 8) === lastRow) p = p.toUpperCase();
  b[to] = p;
  const manMoved = s.b[from] === 'w' || s.b[from] === 'b';
  return { b, turn: s.turn === 'w' ? 'b' : 'w', quiet: m.taken.length || manMoved ? 0 : s.quiet + 1 };
}

// Победа — у соперника нет ходов. Ничья — 30 ходов дамками без взятий.
export function outcome(s) {
  const moves = legalMoves(s);
  if (!moves.length) return { over: 'nomoves', winner: s.turn === 'w' ? 'b' : 'w', moves };
  if (s.quiet >= 30) return { over: 'draw', winner: null, moves };
  return { over: null, winner: null, moves };
}

export function evaluate(s) {
  let score = 0;
  for (let i = 0; i < 64; i++) {
    const p = s.b[i];
    if (!p) continue;
    const r = Math.floor(i / 8);
    const f = i % 8;
    const center = f >= 2 && f <= 5 && r >= 2 && r <= 5 ? 6 : 0;
    let v;
    if (isKing(p)) v = 320;
    else v = 100 + (colorOf(p) === 'w' ? r : 7 - r) * 6 + center;
    score += colorOf(p) === 'w' ? v : -v;
  }
  return s.turn === 'w' ? score : -score;
}

class Timeout extends Error {}

export function bestMove(s, { level = 'medium', timeMs = 600, rng = Math.random } = {}) {
  const maxDepth = { easy: 2, medium: 4, hard: 7 }[level] ?? 4;
  const deadline = Date.now() + timeMs;
  let nodes = 0;
  const search = (st, depth, alpha, beta) => {
    if (++nodes % 256 === 0 && Date.now() > deadline) throw new Timeout();
    const moves = legalMoves(st);
    if (!moves.length) return -10000 - depth;
    if (depth === 0) return evaluate(st);
    moves.sort((a, b) => b.taken.length - a.taken.length);
    for (const m of moves) {
      const v = -search(makeMove(st, m), depth - 1, -beta, -alpha);
      if (v >= beta) return beta;
      if (v > alpha) alpha = v;
    }
    return alpha;
  };
  const root = legalMoves(s);
  if (!root.length) return null;
  let scored = root.map((m) => ({ m, score: 0 }));
  for (let d = 1; d <= maxDepth; d++) {
    try {
      scored = scored.map(({ m }) => ({ m, score: -search(makeMove(s, m), d - 1, -Infinity, Infinity) })).sort((a, b) => b.score - a.score);
    } catch (e) {
      if (!(e instanceof Timeout)) throw e;
      break;
    }
  }
  const tol = level === 'easy' ? 60 : 4;
  const near = scored.filter((x) => x.score >= scored[0].score - tol);
  return near[Math.floor(rng() * near.length)].m;
}
