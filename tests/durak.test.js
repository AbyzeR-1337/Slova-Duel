import test from 'node:test';
import assert from 'node:assert/strict';
import { DurakGame, beats } from '../js/games/durak/engine.js';
import { fakeCtx, until } from './helpers.js';

test('кто кого бьёт', () => {
  assert.ok(beats('6H', '9H', 'S'));
  assert.ok(!beats('9H', '6H', 'S'));
  assert.ok(beats('AH', '6S', 'S'));
  assert.ok(!beats('6S', 'AH', 'S'));
  assert.ok(!beats('6D', '7H', 'S'));
});

for (const n of [2, 3, 4, 6]) {
  test(`партия ботов на ${n}: все 36 карт на месте, есть дурак или ничья`, async () => {
    const seats = Array.from({ length: n }, (_, i) => ({ id: 'b' + i, bot: true }));
    const { ctx, log, state } = fakeCtx(seats, { throw: 'all' });
    const g = new DurakGame(ctx, { timeScale: 0.002 });
    g.start();
    await until(() => state.ended, 60000);
    for (const m of log.filter((x) => x.t === 'state')) {
      const onTable = m.table.reduce((s, p) => s + (p.d ? 2 : 1), 0);
      const total = m.players.reduce((s, p) => s + p.count, 0) + m.deck + m.discard + onTable;
      assert.equal(total, 36);
      assert.ok(m.table.length <= 6);
    }
    assert.equal(state.ended.ranking.length, n);
    const last = log.filter((x) => x.t === 'state').at(-1);
    assert.equal(last.phase, 'over');
    g.stop();
  });
}

test('правила: заход, отбой, подкидывание только по рангу, взять', () => {
  const { ctx } = fakeCtx(['a', 'b', 'c'], {});
  const g = new DurakGame(ctx, { timeScale: 0.001 });
  g.deck = Array(10).fill('6C');
  g.trumpCard = '6S';
  g.trump = 'S';
  g.players[0].hand = ['7H', '7D', 'KH', '9C', 'TC', 'JC'];
  g.players[1].hand = ['8H', 'AS', '6D', '9D', 'QC', 'KC'];
  g.players[2].hand = ['7C', 'AD', 'QD', 'JD', 'TD', '8D'];
  g.attacker = 0;
  g.defender = 1;
  g.startBout();
  assert.equal(g.apply(2, { t: 'attack', card: '7C' }), false, 'первым заходит только атакующий');
  assert.equal(g.apply(0, { t: 'attack', card: '7H' }), true);
  assert.equal(g.apply(2, { t: 'attack', card: 'QD' }), false, 'подкидывать можно только по рангу');
  assert.equal(g.apply(2, { t: 'attack', card: '7C' }), true);
  assert.equal(g.apply(1, { t: 'defend', card: '6D', target: 0 }), false, 'шестёркой бубен семёрку червей не побить');
  assert.equal(g.apply(1, { t: 'defend', card: '8H', target: 0 }), true);
  assert.equal(g.apply(1, { t: 'defend', card: 'AS', target: 1 }), true, 'козырь бьёт любую некозырную');
  assert.equal(g.apply(0, { t: 'pass' }), true);
  assert.equal(g.apply(2, { t: 'pass' }), true);
  // Всё побито и все сказали «бито» — карты ушли в отбой, защитник стал атакующим.
  assert.equal(g.discard, 4);
  assert.equal(g.players[g.attacker].id, 'b');
  g.stop();
});
