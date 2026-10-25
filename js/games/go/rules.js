// Го: доска n×n, 1 — чёрные (ходят первыми), 2 — белые. Китайский (площадной)
// подсчёт: камни + окружённая пустая территория, белым — коми.

export function newGame(n = 9) {
  return { n, b: Array(n * n).fill(0), turn: 1, ko: -1, passes: 0, caps: { 1: 0, 2: 0 }, moves: 0, last: -1 };
}

export function neighbors(n, i) {
  const out = [];
  const x = i % n;
  const y = Math.floor(i / n);
  if (x > 0) out.push(i - 1);
  if (x < n - 1) out.push(i + 1);
  if (y > 0) out.push(i - n);
  if (y < n - 1) out.push(i + n);
  return out;
}

export function group(b, n, i) {
  const color = b[i];
  const stones = [i];
  const libs = new Set();
  const seen = new Set([i]);
  for (let k = 0; k < stones.length; k++) {
    for (const j of neighbors(n, stones[k])) {
      if (b[j] === 0) libs.add(j);
      else if (b[j] === color && !seen.has(j)) {
        seen.add(j);
        stones.push(j);
      }
    }
  }
  return { stones, libs };
}

// Ход в точку i. Возвращает новое состояние или null, если ход запрещён.
export function play(s, i) {
  const { n } = s;
  if (i < 0 || i >= n * n || s.b[i] !== 0 || i === s.ko) return null;
  const b = s.b.slice();
  const me = s.turn;
  const opp = 3 - me;
  b[i] = me;
  let captured = [];
  for (const j of neighbors(n, i)) {
    if (b[j] !== opp) continue;
    const g = group(b, n, j);
    if (!g.libs.size) {
      for (const st of g.stones) b[st] = 0;
      captured = captured.concat(g.stones);
    }
  }
  const mine = group(b, n, i);
  if (!mine.libs.size) return null; // самоубийство
  const ko = captured.length === 1 && mine.stones.length === 1 && mine.libs.size === 1 ? captured[0] : -1;
  return {
    n,
    b,
    turn: opp,
    ko,
    passes: 0,
    caps: { ...s.caps, [me]: s.caps[me] + captured.length },
    moves: s.moves + 1,
    last: i,
    captured: captured.length,
  };
}

export function pass(s) {
  return { ...s, turn: 3 - s.turn, ko: -1, passes: s.passes + 1, moves: s.moves + 1, last: -1, captured: 0 };
}

// Подсчёт очков. Возвращает очки и карту территории ('b', 'w' или '').
export function score(s, komi = 6.5) {
  const { n, b } = s;
  const owner = Array(n * n).fill('');
  const seen = new Set();
  let black = 0;
  let white = komi;
  for (let i = 0; i < n * n; i++) {
    if (b[i] === 1) black++;
    else if (b[i] === 2) white++;
    if (b[i] !== 0 || seen.has(i)) continue;
    const region = [i];
    const borders = new Set();
    seen.add(i);
    for (let k = 0; k < region.length; k++) {
      for (const j of neighbors(n, region[k])) {
        if (b[j] === 0 && !seen.has(j)) {
          seen.add(j);
          region.push(j);
        } else if (b[j]) borders.add(b[j]);
      }
    }
    if (borders.size === 1) {
      const c = [...borders][0];
      for (const r of region) owner[r] = c === 1 ? 'b' : 'w';
      if (c === 1) black += region.length;
      else white += region.length;
    }
  }
  return { black, white, owner, winner: black > white ? 'b' : 'w' };
}

// Глаз: пустая точка, вокруг только свои камни. Боту туда ходить незачем.
function isEye(s, i, color) {
  return neighbors(s.n, i).every((j) => s.b[j] === color);
}

export function botMove(s, rng = Math.random, level = 'medium') {
  const { n } = s;
  const me = s.turn;
  const opp = 3 - me;
  const atari = (color) => {
    const res = new Set();
    for (let i = 0; i < n * n; i++) if (s.b[i] === color && group(s.b, n, i).libs.size === 1) res.add(i);
    return res;
  };
  const myAtari = atari(me);
  let best = null;
  let bestScore = -Infinity;
  for (let i = 0; i < n * n; i++) {
    if (s.b[i] !== 0 || isEye(s, i, me)) continue;
    const ns = play(s, i);
    if (!ns) continue;
    const g = group(ns.b, n, i);
    let sc = ns.captured * 12;
    if ([...myAtari].some((st) => ns.b[st] === me && group(ns.b, n, st).libs.size >= 2)) sc += 9;
    if (g.libs.size === 1 && !ns.captured) sc -= 14;
    sc += Math.min(g.libs.size, 4) * 0.6;
    for (const j of neighbors(n, i)) {
      if (ns.b[j] === opp && group(ns.b, n, j).libs.size === 1) sc += 4;
      if (ns.b[j] === me) sc += 0.4;
    }
    const x = i % n;
    const y = Math.floor(i / n);
    const line = Math.min(x, y, n - 1 - x, n - 1 - y);
    if (s.moves < n * 1.5) sc += line === 2 || line === 3 ? 2 : line === 0 ? -2 : 0;
    else if (line === 0) sc -= 0.8;
    sc += rng() * (level === 'easy' ? 6 : 1.5);
    if (sc > bestScore) {
      bestScore = sc;
      best = i;
    }
  }
  // Ходов почти не осталось или соперник спасовал, а выгоды нет — пасуем.
  if (best == null || (s.passes > 0 && bestScore < 3) || (s.moves > n * n * 1.4 && bestScore < 2)) return { t: 'pass' };
  return { t: 'play', i: best };
}
