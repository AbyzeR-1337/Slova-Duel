import test from 'node:test';
import assert from 'node:assert/strict';
import { positions, deal, reshuffle, moves, isFree, freeTiles, group, matches } from '../js/games/mahjong/tiles.js';
import { MahjongGame } from '../js/games/mahjong/engine.js';
import { fakeCtx, until } from './helpers.js';

// Детерминированный генератор для повторяемых тестов.
const seeded = (s) => () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);

test('раскладки: число костей чётное, верх свободен, середина низа — нет', () => {
  const sizes = { small: 48, medium: 106, large: 138 };
  for (const [size, n] of Object.entries(sizes)) {
    const pos = positions(size);
    assert.equal(pos.length, n);
    const present = pos.map(() => true);
    const top = Math.max(...pos.map((p) => p.z));
    for (const i of freeTiles(pos, present)) assert.ok(pos[i].z === top || pos[i].x === 0 || pos[i].x === Math.max(...pos.filter((q) => q.z === pos[i].z).map((q) => q.x)) || pos[i].z > 0);
    const mid = pos.findIndex((p) => p.z === 0 && p.x === 4 && p.y === 2);
    assert.equal(isFree(pos, present, mid), false);
  }
});

test('раздача решаема и перемешивание сохраняет кости', () => {
  for (const size of ['small', 'medium', 'large']) {
    for (let seed = 1; seed <= 6; seed++) {
      const rng = seeded(seed * 97 + size.length);
      const pos = positions(size);
      let kinds = deal(pos, rng);
      const count = {};
      for (const k of kinds) count[group(k)] = (count[group(k)] || 0) + 1;
      for (const c of Object.values(count)) assert.equal(c % 2, 0);
      // Случайная игра с перемешиванием при тупике всегда доходит до конца.
      let guard = 0;
      while (kinds.some(Boolean)) {
        assert.ok(++guard < 2000);
        const m = moves(pos, kinds);
        if (!m.length) {
          const before = kinds.filter(Boolean).map(group).sort().join();
          kinds = reshuffle(pos, kinds, rng);
          assert.equal(kinds.filter(Boolean).map(group).sort().join(), before);
          assert.ok(moves(pos, kinds).length > 0);
          continue;
        }
        const [a, b] = m[Math.floor(rng() * m.length)];
        assert.ok(matches(kinds[a], kinds[b]));
        kinds[a] = kinds[b] = null;
      }
    }
  }
});

test('маджонг: хост проверяет пары, первый разобравший побеждает', async () => {
  const { ctx, log, priv, state } = fakeCtx(['h', { id: 'bot', bot: true }], { size: 'small', time: 5 });
  const g = new MahjongGame(ctx, { rng: seeded(5), timeScale: 0.001 });
  g.start();
  const layout = log.find((m) => m.t === 'layout');
  assert.equal(layout.pos.length, 48);
  const me = g.player('h');
  // Неверная пара отклоняется.
  const freeI = freeTiles(g.pos, me.kinds.map(Boolean));
  const wrong = freeI.find((i) => !matches(me.kinds[i], me.kinds[freeI[0]]));
  g.action('h', { t: 'pair', a: freeI[0], b: wrong });
  assert.equal(me.left, 48);
  g.action('h', { t: 'hint' });
  const hint = priv.h.find((m) => m.t === 'hint');
  assert.ok(hint && hint.hints === 2);
  g.action('h', { t: 'pair', a: hint.a, b: hint.b });
  assert.equal(me.left, 46);
  // Человек быстро доигрывает подсказками/ходами.
  while (!g.over) {
    const m = moves(g.pos, me.kinds);
    if (!m.length) g.action('h', { t: 'shuffle' });
    else g.action('h', { t: 'pair', a: m[0][0], b: m[0][1] });
  }
  await until(() => state.ended);
  assert.equal(state.ended.ranking[0].id, 'h');
  assert.equal(state.ended.ranking[0].score, 48);
  g.stop();
});

test('маджонг: время вышло — места по оставшимся костям', async () => {
  const seats = [{ id: 'a', bot: true }, { id: 'b', bot: true }, { id: 'c', bot: true }];
  const { ctx, state } = fakeCtx(seats, { size: 'large', time: 3 });
  const g = new MahjongGame(ctx, { timeScale: 0.0004 });
  g.start();
  await until(() => state.ended, 30000);
  const r = state.ended.ranking;
  assert.equal(r.length, 3);
  for (let i = 1; i < r.length; i++) assert.ok(r[i - 1].score >= r[i].score);
  g.stop();
});
