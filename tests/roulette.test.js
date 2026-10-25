import test from 'node:test';
import assert from 'node:assert/strict';
import { RouletteGame } from '../js/games/roulette/engine.js';
import { fakeCtx, until } from './helpers.js';

for (const n of [2, 4, 6]) {
  test(`рулетка: партия ${n} ботов доигрывается`, async () => {
    const seats = Array.from({ length: n }, (_, i) => ({ id: 'b' + i, bot: true }));
    const { ctx, log, state } = fakeCtx(seats, { hp: 3 });
    const g = new RouletteGame(ctx, { timeScale: 0.002 });
    g.start();
    await until(() => state.ended, 60000);
    const r = state.ended.ranking;
    assert.equal(r.length, n);
    assert.equal(r.filter((x) => x.label !== '💀').length, 1);
    assert.deepEqual(r.map((x) => x.place), Array.from({ length: n }, (_, i) => i + 1));
    for (const m of log.filter((x) => x.t === 'state')) {
      assert.equal(m.shells + m.fired.length, m.loaded.live + m.loaded.blank);
      for (const p of m.players) assert.ok(p.items.length <= 8 && p.hp >= 0);
    }
    g.stop();
  });
}

test('рулетка: холостой в себя оставляет ход, боевой — отнимает жизнь', () => {
  const { ctx } = fakeCtx(['a', 'b', 'c'], { hp: 2 });
  const g = new RouletteGame(ctx, { rng: () => 0 });
  g.start();
  g.stop();
  Object.assign(g, { turn: 0, shells: ['B', 'L', 'L', 'B'], fired: [], loadInfo: { live: 2, blank: 2 } });
  g.action('b', { t: 'shoot', target: 'a' }); // не его ход
  assert.equal(g.shells.length, 4);
  g.action('a', { t: 'shoot', target: 'a' });
  assert.equal(g.turn, 0);
  g.action('a', { t: 'shoot', target: 'b' });
  assert.equal(g.players[1].hp, 1);
  assert.equal(g.turn, 1);
  // Пила: двойной урон, боевой в себя — ход уходит.
  g.players[1].items = ['saw'];
  g.action('b', { t: 'use', item: 'saw' });
  assert.equal(g.saw, true);
  g.action('b', { t: 'shoot', target: 'c' });
  assert.equal(g.players[2].hp, 0);
  assert.equal(g.players[2].out, true);
  assert.equal(g.saw, false);
  assert.equal(g.turn, 0); // c выбыл, ход переходит к a
  g.stop();
});

test('рулетка: наручники, лупа, инвертор, газировка', () => {
  const { ctx, priv } = fakeCtx(['a', 'b'], { hp: 3 });
  const g = new RouletteGame(ctx, { rng: () => 0 });
  g.start();
  g.stop();
  Object.assign(g, { turn: 0, shells: ['L', 'B', 'L', 'B'], fired: [], loadInfo: { live: 2, blank: 2 } });
  g.players[0].items = ['glass', 'invert', 'cuffs', 'soda'];
  g.action('a', { t: 'use', item: 'glass' });
  const known = priv.a.filter((m) => m.t === 'known').at(-1);
  assert.deepEqual(known.known, { 0: 'L' });
  g.action('a', { t: 'use', item: 'invert' });
  assert.equal(g.shells[0], 'B');
  assert.deepEqual(priv.a.at(-1).known, { 0: 'B' });
  g.action('a', { t: 'use', item: 'cuffs', target: 'b' });
  assert.equal(g.players[1].cuffed, true);
  g.action('a', { t: 'use', item: 'soda' }); // выбрасывает текущий (холостой)
  assert.deepEqual(g.fired, ['B']);
  assert.equal(g.shells.length, 3);
  g.action('a', { t: 'shoot', target: 'b' }); // холостой; b в наручниках — снова ход a
  assert.equal(g.players[1].hp, 3);
  assert.equal(g.turn, 0);
  assert.equal(g.players[1].cuffed, false);
  assert.equal(g.players[0].items.length, 0);
  g.stop();
});

test('рулетка: бот с подсмотренным холостым стреляет в себя', () => {
  const { ctx } = fakeCtx([{ id: 'bot', bot: true }, 'h'], { hp: 3, items: 'off' });
  const g = new RouletteGame(ctx, { rng: () => 0.99 });
  g.start();
  g.stop();
  Object.assign(g, { turn: 0, shells: ['B', 'L', 'L'], fired: [], loadInfo: { live: 2, blank: 1 } });
  g.known.set('bot', { 0: 'B' });
  g.botStep();
  assert.deepEqual(g.fired, ['B']);
  assert.equal(g.turn, 0);
  assert.equal(g.chance(g.players[0]), 1);
  g.stop();
});
