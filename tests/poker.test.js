import test from 'node:test';
import assert from 'node:assert/strict';
import { eval5, bestHand, CATS } from '../js/games/poker/eval.js';
import { PokerGame } from '../js/games/poker/engine.js';
import { fakeCtx, until } from './helpers.js';

const cat = (cards) => CATS[bestHand(cards).cat];

test('комбинации распознаются правильно', () => {
  assert.equal(cat(['AS', 'KS', 'QS', 'JS', 'TS', '2D', '3C']), 'straightFlush');
  assert.equal(cat(['9C', '9D', '9H', '9S', '2D']), 'quads');
  assert.equal(cat(['9C', '9D', '9H', '2S', '2D']), 'fullHouse');
  assert.equal(cat(['AH', '9H', '7H', '4H', '2H']), 'flush');
  assert.equal(cat(['AH', '2D', '3C', '4S', '5H']), 'straight');
  assert.equal(cat(['7H', '7D', '7C', 'KS', '2H']), 'trips');
  assert.equal(cat(['7H', '7D', 'KC', 'KS', '2H']), 'twoPair');
  assert.equal(cat(['7H', '7D', 'QC', 'KS', '2H']), 'pair');
  assert.equal(cat(['7H', '3D', 'QC', 'KS', '2H']), 'high');
});

test('сравнение рук: кикеры, стрит с туза, флеш против стрита', () => {
  assert.ok(eval5(['AH', 'AD', 'KC', '5S', '2H']) > eval5(['AH', 'AD', 'QC', 'JS', 'TH']));
  assert.ok(eval5(['6H', '2D', '3C', '4S', '5H']) > eval5(['AH', '2D', '3C', '4S', '5H']));
  assert.ok(eval5(['2H', '7H', '9H', 'JH', 'KH']) > eval5(['TH', 'JD', 'QC', 'KS', 'AH']));
  assert.equal(eval5(['AH', 'KD', 'QC', 'JS', '9H']), eval5(['AD', 'KH', 'QS', 'JC', '9D']));
  assert.equal(bestHand(['2C', '3C', 'AS', 'AH', 'KD', 'KC', 'QS']).best.length, 5);
});

test('партия ботов: фишки сохраняются, игра заканчивается рейтингом', async () => {
  const seats = ['b1', 'b2', 'b3', 'b4'].map((id) => ({ id, bot: true }));
  const { ctx, log, state } = fakeCtx(seats, { chips: 300, bb: 20, hands: 12 });
  const g = new PokerGame(ctx, { timeScale: 0.002 });
  g.start();
  await until(() => state.ended, 60000);
  for (const m of log.filter((x) => x.t === 'state')) {
    const total = m.players.reduce((s, p) => s + p.chips, 0) + m.pot;
    assert.equal(total, 1200, `фишки потерялись в раздаче ${m.hand} (${m.street})`);
  }
  assert.ok(log.some((m) => m.t === 'show'));
  assert.equal(state.ended.ranking.length, 4);
  assert.equal(state.ended.ranking[0].place, 1);
  g.stop();
});

test('побочный банк: короткий олл-ин не выигрывает больше, чем поставил', () => {
  const { ctx } = fakeCtx(['a', 'b', 'c'], { chips: 1000, bb: 20 });
  const g = new PokerGame(ctx);
  g.players.forEach((p, i) => Object.assign(p, { total: [100, 500, 500][i], folded: false, out: false }));
  const pots = g.pots();
  assert.deepEqual(pots.map((p) => p.amount), [300, 800]);
  assert.deepEqual(pots[1].eligible.map((p) => p.id), ['b', 'c']);
});

test('человек ходит сам: чек, колл, рейз и фолд', async () => {
  const { ctx, log, priv } = fakeCtx(['me', 'you'], { chips: 1000, bb: 20, hands: 1 });
  const g = new PokerGame(ctx, { timeScale: 0.01 });
  g.start();
  assert.equal(priv.me[0].cards.length, 2);
  let st = log.filter((m) => m.t === 'state').at(-1);
  // В игре вдвоём первым до флопа ходит баттон (он же малый блайнд).
  const first = st.toAct;
  g.action(first === 'me' ? 'you' : 'me', { t: 'call' }); // не его ход — игнор
  g.action(first, { t: 'raise', to: 60 });
  st = log.filter((m) => m.t === 'state').at(-1);
  assert.equal(st.currentBet, 60);
  const second = st.toAct;
  assert.notEqual(second, first);
  g.action(second, { t: 'raise', to: 70 }); // меньше минимального рейза — игнор
  g.action(second, { t: 'call' });
  st = log.filter((m) => m.t === 'state').at(-1);
  assert.equal(st.street, 'flop');
  assert.equal(st.board.length, 3);
  assert.equal(st.pot, 120);
  g.action(st.toAct, { t: 'fold' });
  const show = log.find((m) => m.t === 'show');
  assert.equal(show.wins[0].amount, 120);
  g.stop();
});
