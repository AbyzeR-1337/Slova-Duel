import test from 'node:test';
import assert from 'node:assert/strict';
import { MafiaGame, mafiaCount } from '../js/games/mafia/engine.js';
import { fakeCtx, until } from './helpers.js';

test('мафия: число мафиози', () => {
  assert.equal(mafiaCount(4), 1);
  assert.equal(mafiaCount(6), 2);
  assert.equal(mafiaCount(10), 3);
  assert.equal(mafiaCount(4, 3), 1);
});

for (const n of [4, 7, 10]) {
  test(`мафия: партия ${n} ботов доигрывается`, async () => {
    const seats = Array.from({ length: n }, (_, i) => ({ id: 'b' + i, bot: true }));
    const { ctx, log, state } = fakeCtx(seats, { day: 60 });
    const g = new MafiaGame(ctx, { timeScale: 0.003 });
    g.start();
    await until(() => state.ended, 60000);
    const r = state.ended.ranking;
    assert.equal(r.length, n);
    const roles = Object.values(log.filter((m) => m.t === 'state').at(-1).roles);
    assert.equal(roles.filter((x) => x === 'mafia').length, mafiaCount(n));
    assert.ok(['mafia', 'town'].includes(state.ended.extra.winner));
    assert.ok(log.some((m) => m.t === 'chat' && m.key));
    g.stop();
  });
}

test('мафия: ночь, доктор, комиссар, голосование, роли скрыты', () => {
  const seats = ['m', 'd', 'k', 'c1', 'c2', 'c3'];
  const { ctx, log, priv } = fakeCtx(seats, { mafia: 1 });
  const g = new MafiaGame(ctx, { rng: () => 0.5 });
  g.start();
  g.stop();
  const role = { m: 'mafia', d: 'doctor', k: 'detective' };
  for (const p of g.players) p.role = role[p.id] || 'civilian';
  g.startNight();
  g.stop();
  // Публичное состояние не выдаёт роли.
  assert.equal(log.at(-1).roles, null);
  g.action('m', { t: 'night', target: 'm' }); // себя нельзя
  assert.equal(g.player('m').pick, null);
  g.action('m', { t: 'night', target: 'c1' });
  g.action('d', { t: 'night', target: 'c1' });
  g.action('k', { t: 'night', target: 'm' });
  assert.equal(priv.k.at(-1).checks.m, true);
  // Ночной чат видит только мафия.
  g.action('m', { t: 'chat', text: 'тсс' });
  assert.ok(!priv.c1?.some((x) => x.t === 'chat'));
  assert.ok(priv.m.some((x) => x.t === 'chat' && x.night));
  g.resolveNight();
  g.stop();
  assert.equal(g.player('c1').alive, true);
  assert.equal(g.last.saved, true);
  g.startDay();
  g.stop();
  g.action('c2', { t: 'chat', text: 'Это m!' });
  assert.equal(log.filter((x) => x.t === 'chat').at(-1).text, 'Это m!');
  g.startVote();
  g.stop();
  for (const id of ['d', 'k', 'c1', 'c2']) g.action(id, { t: 'vote', target: 'm' });
  g.action('m', { t: 'vote', target: 'k' });
  g.action('c3', { t: 'vote', target: null });
  g.resolveVote();
  g.stop();
  assert.equal(g.player('m').alive, false);
  assert.deepEqual(g.dead.at(-1), { id: 'm', role: 'mafia', how: 'vote', day: 1 });
  assert.equal(g.checkWin(), true);
  assert.equal(g.over, 'town');
  g.stop();
});

test('мафия: доктор не лечит одного и того же две ночи подряд', () => {
  const { ctx } = fakeCtx(['m', 'd', 'c1', 'c2'], { roles: 'classic' });
  const g = new MafiaGame(ctx, { rng: () => 0.1 });
  g.start();
  g.stop();
  for (const p of g.players) p.role = { m: 'mafia', d: 'doctor' }[p.id] || 'civilian';
  g.startNight();
  g.action('d', { t: 'night', target: 'c1' });
  g.resolveNight();
  g.startNight();
  g.action('d', { t: 'night', target: 'c1' });
  assert.equal(g.player('d').pick, null);
  g.action('d', { t: 'night', target: 'd' });
  assert.equal(g.player('d').pick, 'd');
  g.stop();
});
