import test from 'node:test';
import assert from 'node:assert/strict';
import { BlackjackGame, handValue } from '../js/games/blackjack/engine.js';
import { fakeCtx, until } from './helpers.js';

test('подсчёт очков с тузами', () => {
  assert.deepEqual(handValue(['AS', 'KD']), { total: 21, soft: true });
  assert.equal(handValue(['AS', 'AD', '9C']).total, 21);
  assert.equal(handValue(['AS', 'AD', 'AC', 'AH']).total, 14);
  assert.equal(handValue(['KS', 'QD', '5C']).total, 25);
  assert.equal(handValue(['7S', 'AD']).soft, true);
});

test('партия с ботами доигрывается до конца', async () => {
  const seats = [{ id: 'b1', bot: true }, { id: 'b2', bot: true }, { id: 'b3', bot: true }];
  const { ctx, log, state } = fakeCtx(seats, { chips: 500, rounds: 8, minBet: 25 });
  const g = new BlackjackGame(ctx, { timeScale: 0.002 });
  g.start();
  await until(() => state.ended, 30000);
  const settles = log.filter((m) => m.t === 'state' && m.phase === 'settle');
  assert.ok(settles.length >= 1);
  for (const m of settles) for (const p of m.players) if (!p.out && p.hand.length) assert.ok(['win', 'lose', 'push', 'bj'].includes(p.result));
  assert.equal(state.ended.ranking.length, 3);
  g.stop();
});

test('выплаты: выигрыш 1:1, блэкджек 3:2, ничья — возврат', () => {
  const { ctx } = fakeCtx(['p'], { chips: 1000, rounds: 1, minBet: 10 });
  const g = new BlackjackGame(ctx, { timeScale: 0.001 });
  const p = g.players[0];
  const run = (hand, dealer, bet = 100) => {
    Object.assign(p, { chips: 900, bet, hand, status: 'stand', doubled: false });
    g.dealer = dealer;
    g.settle();
    g.stop();
    return [p.result, p.chips];
  };
  assert.deepEqual(run(['TS', '9D'], ['TC', '7H']), ['win', 1100]);
  assert.deepEqual(run(['AS', 'KD'], ['TC', '7H']), ['bj', 1150]);
  assert.deepEqual(run(['TS', '7D'], ['TC', '7H']), ['push', 1000]);
  assert.deepEqual(run(['TS', '6D'], ['TC', '7H']), ['lose', 900]);
  assert.deepEqual(run(['TS', '6D'], ['TC', '6H', 'KD']), ['win', 1100]);
});
