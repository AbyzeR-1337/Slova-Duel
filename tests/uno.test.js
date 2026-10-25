import test from 'node:test';
import assert from 'node:assert/strict';
import { UnoGame, makeDeck } from '../js/games/uno/engine.js';
import { fakeCtx, until } from './helpers.js';

test('колода уно — 108 карт', () => {
  const d = makeDeck();
  assert.equal(d.length, 108);
  assert.equal(d.filter((c) => c[0] === 'w').length, 8);
  assert.equal(d.filter((c) => c === 'r0').length, 1);
});

for (const stack of [false, true]) {
  test(`партия ботов доигрывается (стопка: ${stack}), карты не теряются`, async () => {
    const seats = Array.from({ length: 5 }, (_, i) => ({ id: 'b' + i, bot: true }));
    const { ctx, log, state } = fakeCtx(seats, { stack });
    const g = new UnoGame(ctx, { timeScale: 0.002 });
    g.start();
    await until(() => state.ended, 60000);
    for (const m of log.filter((x) => x.t === 'state')) {
      const inHands = m.players.reduce((s, p) => s + p.count, 0);
      assert.equal(inHands + m.pile + m.discard + 1, 108);
    }
    const total = g.players.reduce((s, p) => s + p.hand.length, 0) + g.pile.length + g.discard.length + 1;
    assert.equal(total, 108);
    assert.equal(state.ended.ranking[0].score, 0);
    g.stop();
  });
}

test('правила: цвет/значение, +2, разворот вдвоём, «уно» и «поймал»', () => {
  const { ctx, priv } = fakeCtx(['a', 'b', 'c'], {});
  const g = new UnoGame(ctx, { rng: () => 0 });
  g.start();
  Object.assign(g, { top: 'r5', color: 'r', turn: 0, dir: 1 });
  g.players[0].hand = ['g7', 'r9', 'gD', 'b5'];
  g.players[1].hand = ['y1', 'y2'];
  g.players[2].hand = ['g1'];
  g.action('a', { t: 'play', card: 'g7' }); // не тот цвет и не та цифра
  assert.equal(g.top, 'r5');
  g.action('a', { t: 'play', card: 'b5' }); // та же цифра
  assert.equal(g.top, 'b5');
  assert.equal(g.turn, 1);
  Object.assign(g, { top: 'g3', color: 'g', turn: 0 });
  g.action('a', { t: 'play', card: 'gD' }); // +2: следующий берёт и пропускает ход
  assert.equal(g.players[1].hand.length, 4);
  assert.equal(g.turn, 2);
  // Осталась одна карта без «уно» — соседи могут поймать.
  Object.assign(g, { top: 'r1', color: 'r', turn: 0 });
  g.players[0].hand = ['r2', 'r3'];
  g.action('a', { t: 'play', card: 'r2' });
  assert.equal(g.vulnerable, 'a');
  g.action('c', { t: 'catch' });
  assert.equal(g.players[0].hand.length, 3);
  g.stop();
});
