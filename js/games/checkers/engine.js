import { DuelGame } from '../duel.js';
import { initial, legalMoves, makeMove, outcome, bestMove } from './rules.js';

export async function createGame(ctx) {
  return new CheckersGame(ctx);
}

export class CheckersGame extends DuelGame {
  constructor(ctx, opts) {
    super(ctx, opts);
    this.s = initial();
    this.last = null;
    this.count = 0;
  }

  turn() {
    return this.s.turn;
  }

  outcome() {
    const o = outcome(this.s);
    return { over: o.over, winner: o.winner };
  }

  apply(c, a) {
    const moves = legalMoves(this.s);
    const path = a.path || [];
    // Ход задаётся откуда и куда; если цепочек боя несколько — берём самую длинную.
    const m = a.taken
      ? a
      : moves
          .filter((x) => x.path[0] === path[0] && x.path[x.path.length - 1] === path[path.length - 1])
          .sort((x, y) => y.taken.length - x.taken.length)[0];
    if (!m || !moves.some((x) => x.path.join() === m.path.join() && x.taken.join() === m.taken.join())) return false;
    this.s = makeMove(this.s, m);
    this.last = { path: m.path, taken: m.taken };
    this.count++;
    return true;
  }

  botMove() {
    return bestMove(this.s, { level: this.level, rng: this.rng });
  }

  view() {
    return { board: this.s.b.map((p) => p || '.').join(''), turn: this.s.turn, last: this.last, count: this.count };
  }
}
