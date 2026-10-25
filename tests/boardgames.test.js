import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFen, legalMoves, makeMove, outcome, START, sqIndex } from '../js/games/chess/rules.js';
import { bestMove } from '../js/games/chess/ai.js';
import { ChessGame } from '../js/games/chess/engine.js';
import * as ck from '../js/games/checkers/rules.js';
import { CheckersGame } from '../js/games/checkers/engine.js';
import * as go from '../js/games/go/rules.js';
import { GoGame } from '../js/games/go/engine.js';
import { fakeCtx, until } from './helpers.js';

function perft(s, d) {
  if (d === 0) return 1;
  let n = 0;
  for (const m of legalMoves(s)) n += perft(makeMove(s, m), d - 1);
  return n;
}

test('шахматы: perft — число ходов совпадает с эталоном', () => {
  assert.equal(perft(parseFen(START), 3), 8902);
  assert.equal(perft(parseFen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1'), 2), 2039);
  assert.equal(perft(parseFen('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1'), 3), 2812);
});

test('шахматы: мат, пат, взятие на проходе, рокировка', () => {
  let s = parseFen(START);
  for (const [f, t] of [['f2', 'f3'], ['e7', 'e5'], ['g2', 'g4'], ['d8', 'h4']]) s = makeMove(s, legalMoves(s).find((m) => m.from === sqIndex(f) && m.to === sqIndex(t)));
  assert.equal(outcome(s).over, 'mate');
  assert.equal(outcome(s).winner, 'b');
  assert.equal(outcome(parseFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')).over, 'stalemate');
  const ep = parseFen('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
  assert.ok(legalMoves(ep).some((m) => m.ep && m.to === sqIndex('d6')));
  const castle = parseFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  assert.equal(legalMoves(castle).filter((m) => m.castle).length, 2);
  assert.equal(outcome(parseFen('4k3/8/8/8/8/8/8/4KB2 w - - 0 1')).over, 'material');
});

test('шахматы: бот находит мат в один ход', () => {
  const s = parseFen('6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1');
  const m = bestMove(s, { level: 'medium' });
  assert.equal(outcome(makeMove(s, m)).over, 'mate');
});

test('шахматы: партия ботов доходит до конца и даёт итог', async () => {
  const { ctx, log, state } = fakeCtx([{ id: 'a', bot: true }, { id: 'b', bot: true }], { level: 'easy' });
  const g = new ChessGame(ctx, { timeScale: 0.001 });
  g.start();
  await until(() => state.ended || log.filter((m) => m.t === 'state').length > 60, 60000);
  assert.ok(log.at(-1).fen);
  g.stop();
});

test('шахматы: человек ходит только своими и только по правилам', () => {
  const { ctx, log } = fakeCtx(['me', 'you'], {});
  const g = new ChessGame(ctx, { rng: () => 0.9 });
  g.start();
  const white = g.side.w.id;
  const black = g.side.b.id;
  g.action(black, { t: 'move', from: sqIndex('e7'), to: sqIndex('e5') });
  assert.equal(g.log.length, 0);
  g.action(white, { t: 'move', from: sqIndex('e2'), to: sqIndex('e5') });
  assert.equal(g.log.length, 0);
  g.action(white, { t: 'move', from: sqIndex('e2'), to: sqIndex('e4') });
  assert.equal(g.log.length, 1);
  g.action(black, { t: 'resign' });
  assert.equal(log.at(-1).result.winner, 'w');
  g.stop();
});

const ckBoard = (pieces, turn = 'w') => {
  const b = Array(64).fill('');
  for (const [sq, p] of Object.entries(pieces)) b[sqIndex(sq)] = p;
  return { b, turn, quiet: 0 };
};

test('шашки: начало, обязательный бой, цепочка, дамка бьёт издалека', () => {
  assert.equal(ck.legalMoves(ck.initial()).length, 7);
  // Бить обязательно: есть ход вперёд, но доступен бой.
  let s = ckBoard({ c3: 'w', d4: 'b', a3: 'w' });
  let ms = ck.legalMoves(s);
  assert.ok(ms.every((m) => m.taken.length === 1));
  // Шашка бьёт назад и цепочкой.
  s = ckBoard({ e5: 'w', d4: 'b', d2: 'b' });
  ms = ck.legalMoves(s);
  assert.equal(Math.max(...ms.map((m) => m.taken.length)), 2);
  // Дамка бьёт с расстояния и встаёт на любое поле за шашкой.
  s = ckBoard({ a1: 'W', d4: 'b' });
  ms = ck.legalMoves(s);
  assert.equal(ms.length, 4);
  assert.ok(ms.every((m) => m.taken[0] === sqIndex('d4')));
  // Дошла до последнего ряда во время боя — бьёт дальше как дамка.
  s = ckBoard({ c6: 'w', d7: 'b', g6: 'b' });
  ms = ck.legalMoves(s);
  const best = ms.sort((a, b) => b.taken.length - a.taken.length)[0];
  assert.equal(best.taken.length, 2);
  const after = ck.makeMove(s, best);
  assert.equal(after.b[best.path.at(-1)], 'W');
});

test('шашки: партия ботов заканчивается', async () => {
  const { ctx, state } = fakeCtx([{ id: 'a', bot: true }, { id: 'b', bot: true }], { level: 'easy' });
  const g = new CheckersGame(ctx, { timeScale: 0.001 });
  g.start();
  await until(() => state.ended, 60000);
  assert.equal(state.ended.ranking.length, 2);
});

test('го: взятие, запрет самоубийства, ко, подсчёт', () => {
  let s = go.newGame(5);
  const P = (x, y) => y * 5 + x;
  // Чёрные окружают белый камень в центре и снимают его.
  for (const [mv, color] of [[P(2, 1), 1], [P(2, 2), 2], [P(1, 2), 1], [P(0, 0), 2], [P(3, 2), 1], [P(4, 4), 2], [P(2, 3), 1]]) {
    s.turn = color;
    s = go.play(s, mv);
    assert.ok(s);
  }
  assert.equal(s.b[P(2, 2)], 0);
  assert.equal(s.caps[1], 1);
  // Белым нельзя ставить в точку без дамэ (самоубийство).
  s.turn = 2;
  assert.equal(go.play(s, P(2, 2)), null);
  // Ко: сразу отбить нельзя.
  let k = go.newGame(5);
  const setup = { [P(1, 0)]: 1, [P(0, 1)]: 1, [P(1, 2)]: 1, [P(2, 0)]: 2, [P(3, 1)]: 2, [P(2, 2)]: 2, [P(1, 1)]: 2 };
  for (const [i, c] of Object.entries(setup)) k.b[i] = c;
  k.turn = 1;
  k = go.play(k, P(2, 1));
  assert.equal(k.b[P(1, 1)], 0);
  assert.equal(k.ko, P(1, 1));
  assert.equal(go.play(k, P(1, 1)), null);
  // Подсчёт: вся доска чёрных.
  const sc = go.score({ ...go.newGame(3), b: [1, 1, 1, 1, 0, 1, 1, 1, 1] }, 0.5);
  assert.equal(sc.black, 9);
  assert.equal(sc.winner, 'b');
});

test('го: партия ботов 9×9 заканчивается подсчётом', async () => {
  const { ctx, log, state } = fakeCtx([{ id: 'a', bot: true }, { id: 'b', bot: true }], { size: 9, level: 'medium' });
  const g = new GoGame(ctx, { timeScale: 0.0005 });
  g.start();
  await until(() => state.ended, 60000);
  const last = log.at(-1);
  assert.equal(last.result.reason, 'score');
  assert.ok(last.territory);
});
