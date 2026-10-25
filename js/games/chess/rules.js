// Правила шахмат. Доска — массив из 64 клеток, индекс = ряд * 8 + вертикаль
// (ряд 0 — первая горизонталь белых). Фигуры: PNBRQK — белые, pnbrqk — чёрные.

export const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const FILES = 'abcdefgh';

export const colorOf = (p) => (!p ? null : p === p.toUpperCase() ? 'w' : 'b');
export const sqName = (i) => FILES[i % 8] + (Math.floor(i / 8) + 1);
export const sqIndex = (name) => FILES.indexOf(name[0]) + (Number(name[1]) - 1) * 8;
const at = (f, r) => (f >= 0 && f < 8 && r >= 0 && r < 8 ? r * 8 + f : -1);

export function parseFen(fen) {
  const [placement, turn, castle, ep, half, full] = fen.split(' ');
  const b = Array(64).fill('');
  placement.split('/').forEach((row, k) => {
    const r = 7 - k;
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) f += Number(ch);
      else b[r * 8 + f++] = ch;
    }
  });
  return { b, turn, castle: castle === '-' ? '' : castle, ep: ep === '-' ? -1 : sqIndex(ep), half: Number(half) || 0, full: Number(full) || 1 };
}

export function toFen(s) {
  const rows = [];
  for (let r = 7; r >= 0; r--) {
    let row = '';
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = s.b[r * 8 + f];
      if (!p) empty++;
      else {
        if (empty) row += empty;
        empty = 0;
        row += p;
      }
    }
    rows.push(row + (empty || ''));
  }
  return `${rows.join('/')} ${s.turn} ${s.castle || '-'} ${s.ep >= 0 ? sqName(s.ep) : '-'} ${s.half} ${s.full}`;
}

const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// Бьёт ли сторона by клетку sq.
export function attacked(b, sq, by) {
  const f = sq % 8;
  const r = Math.floor(sq / 8);
  const own = (p, t) => p && colorOf(p) === by && p.toLowerCase() === t;
  const pr = by === 'w' ? r - 1 : r + 1;
  for (const df of [-1, 1]) {
    const i = at(f + df, pr);
    if (i >= 0 && own(b[i], 'p')) return true;
  }
  for (const [df, dr] of KNIGHT) {
    const i = at(f + df, r + dr);
    if (i >= 0 && own(b[i], 'n')) return true;
  }
  for (const [df, dr] of KING) {
    const i = at(f + df, r + dr);
    if (i >= 0 && own(b[i], 'k')) return true;
  }
  for (const [dirs, kinds] of [[DIAG, 'bq'], [ORTH, 'rq']]) {
    for (const [df, dr] of dirs) {
      let ff = f + df;
      let rr = r + dr;
      while (ff >= 0 && ff < 8 && rr >= 0 && rr < 8) {
        const p = b[rr * 8 + ff];
        if (p) {
          if (colorOf(p) === by && kinds.includes(p.toLowerCase())) return true;
          break;
        }
        ff += df;
        rr += dr;
      }
    }
  }
  return false;
}

export function kingSquare(b, c) {
  return b.indexOf(c === 'w' ? 'K' : 'k');
}

export function inCheck(s, c = s.turn) {
  return attacked(s.b, kingSquare(s.b, c), c === 'w' ? 'b' : 'w');
}

// Ходы без проверки, не остаётся ли король под шахом.
export function pseudoMoves(s) {
  const { b, turn } = s;
  const opp = turn === 'w' ? 'b' : 'w';
  const out = [];
  for (let i = 0; i < 64; i++) {
    const p = b[i];
    if (!p || colorOf(p) !== turn) continue;
    const f = i % 8;
    const r = Math.floor(i / 8);
    const t = p.toLowerCase();
    const add = (to, extra) => out.push({ from: i, to, ...extra });
    if (t === 'p') {
      const dir = turn === 'w' ? 1 : -1;
      const startR = turn === 'w' ? 1 : 6;
      const lastR = turn === 'w' ? 7 : 0;
      const push = (to, extra = {}) => {
        if (Math.floor(to / 8) === lastR) for (const pr of 'qrbn') add(to, { ...extra, promo: pr });
        else add(to, extra);
      };
      const one = at(f, r + dir);
      if (one >= 0 && !b[one]) {
        push(one);
        const two = at(f, r + 2 * dir);
        if (r === startR && !b[two]) add(two, { double: true });
      }
      for (const df of [-1, 1]) {
        const to = at(f + df, r + dir);
        if (to < 0) continue;
        if (b[to] && colorOf(b[to]) === opp) push(to, { capture: b[to] });
        else if (to === s.ep) add(to, { ep: true, capture: turn === 'w' ? 'p' : 'P' });
      }
    } else if (t === 'n' || t === 'k') {
      for (const [df, dr] of t === 'n' ? KNIGHT : KING) {
        const to = at(f + df, r + dr);
        if (to < 0 || (b[to] && colorOf(b[to]) === turn)) continue;
        add(to, b[to] ? { capture: b[to] } : {});
      }
      if (t === 'k') {
        const home = turn === 'w' ? 4 : 60;
        const [K, Q] = turn === 'w' ? ['K', 'Q'] : ['k', 'q'];
        if (i === home && !attacked(b, i, opp)) {
          if (s.castle.includes(K) && !b[i + 1] && !b[i + 2] && b[i + 3] === (turn === 'w' ? 'R' : 'r') && !attacked(b, i + 1, opp) && !attacked(b, i + 2, opp))
            add(i + 2, { castle: 'k' });
          if (s.castle.includes(Q) && !b[i - 1] && !b[i - 2] && !b[i - 3] && b[i - 4] === (turn === 'w' ? 'R' : 'r') && !attacked(b, i - 1, opp) && !attacked(b, i - 2, opp))
            add(i - 2, { castle: 'q' });
        }
      }
    } else {
      const dirs = t === 'b' ? DIAG : t === 'r' ? ORTH : [...DIAG, ...ORTH];
      for (const [df, dr] of dirs) {
        let ff = f + df;
        let rr = r + dr;
        while (ff >= 0 && ff < 8 && rr >= 0 && rr < 8) {
          const to = rr * 8 + ff;
          if (b[to]) {
            if (colorOf(b[to]) === opp) add(to, { capture: b[to] });
            break;
          }
          add(to);
          ff += df;
          rr += dr;
        }
      }
    }
  }
  return out;
}

export function makeMove(s, m) {
  const b = s.b.slice();
  const p = b[m.from];
  const white = s.turn === 'w';
  b[m.to] = m.promo ? (white ? m.promo.toUpperCase() : m.promo) : p;
  b[m.from] = '';
  if (m.ep) b[m.to + (white ? -8 : 8)] = '';
  if (m.castle === 'k') {
    b[m.to - 1] = b[m.to + 1];
    b[m.to + 1] = '';
  } else if (m.castle === 'q') {
    b[m.to + 1] = b[m.to - 2];
    b[m.to - 2] = '';
  }
  let castle = s.castle;
  const drop = (chars) => (castle = [...castle].filter((c) => !chars.includes(c)).join(''));
  if (p === 'K') drop('KQ');
  if (p === 'k') drop('kq');
  for (const sq of [m.from, m.to]) {
    if (sq === 0) drop('Q');
    if (sq === 7) drop('K');
    if (sq === 56) drop('q');
    if (sq === 63) drop('k');
  }
  return {
    b,
    turn: white ? 'b' : 'w',
    castle,
    ep: m.double ? (m.from + m.to) / 2 : -1,
    half: p.toLowerCase() === 'p' || m.capture ? 0 : s.half + 1,
    full: s.full + (white ? 0 : 1),
  };
}

export function legalMoves(s) {
  return pseudoMoves(s).filter((m) => !inCheck(makeMove(s, m), s.turn));
}

export const posKey = (s) => s.b.map((p) => p || '.').join('') + s.turn + s.castle + s.ep;

function insufficient(b) {
  const pieces = b.filter((p) => p && p.toLowerCase() !== 'k');
  if (!pieces.length) return true;
  return pieces.length === 1 && 'nb'.includes(pieces[0].toLowerCase());
}

// Итог позиции: продолжается ли игра и почему закончилась.
export function outcome(s, keys = []) {
  const moves = legalMoves(s);
  const check = inCheck(s);
  if (!moves.length) return { over: check ? 'mate' : 'stalemate', winner: check ? (s.turn === 'w' ? 'b' : 'w') : null, check, moves };
  if (s.half >= 100) return { over: 'fifty', winner: null, check, moves };
  if (insufficient(s.b)) return { over: 'material', winner: null, check, moves };
  const k = posKey(s);
  if (keys.filter((x) => x === k).length >= 3) return { over: 'repetition', winner: null, check, moves };
  return { over: null, winner: null, check, moves };
}

const SYMBOL = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '' };
export function notation(s, m) {
  const p = s.b[m.from].toLowerCase();
  if (m.castle) return m.castle === 'k' ? 'O-O' : 'O-O-O';
  return `${SYMBOL[p]}${sqName(m.from)}${m.capture ? '×' : '–'}${sqName(m.to)}${m.promo ? '=' + SYMBOL[m.promo] : ''}`;
}
