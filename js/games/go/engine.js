import { DuelGame } from '../duel.js';
import { newGame, play, pass, score, botMove } from './rules.js';

export async function createGame(ctx) {
  return new GoGame(ctx);
}

export class GoGame extends DuelGame {
  constructor(ctx, opts = {}) {
    super(ctx, { ...opts, colors: ['b', 'w'] });
    const n = [9, 13, 19].includes(Number(ctx.settings.size)) ? Number(ctx.settings.size) : 9;
    this.komi = n === 9 ? 5.5 : 6.5;
    this.s = newGame(n);
    this.maxMoves = n * n * 3;
  }

  turn() {
    return this.s.turn === 1 ? 'b' : 'w';
  }

  outcome() {
    if (this.s.passes >= 2 || this.s.moves >= this.maxMoves) {
      const sc = score(this.s, this.komi);
      this.final = sc;
      return { over: 'score', winner: sc.winner, extra: { score: { b: sc.black, w: sc.white } } };
    }
    return { over: null };
  }

  apply(c, a) {
    if (a.t === 'pass') {
      this.s = pass(this.s);
      return true;
    }
    if (a.t !== 'play') return false;
    const ns = play(this.s, Number(a.i));
    if (!ns) return false;
    this.s = ns;
    return true;
  }

  botMove() {
    return botMove(this.s, this.rng, this.level);
  }

  view() {
    return {
      n: this.s.n,
      board: this.s.b.join(''),
      turn: this.turn(),
      last: this.s.last,
      ko: this.s.ko,
      passes: this.s.passes,
      caps: { b: this.s.caps[1], w: this.s.caps[2] },
      komi: this.komi,
      moves: this.s.moves,
      territory: this.final ? this.final.owner.map((o) => o || '.').join('') : null,
    };
  }
}
