import test from 'node:test';
import assert from 'node:assert/strict';
import { BunkerGame, loadBunker, CATS } from '../js/games/bunker/engine.js';
import { fakeCtx, until } from './helpers.js';

const LANGS = ['ru', 'en', 'uk', 'es', 'de'];

test('бункер: карты есть на всех языках и в одинаковом объёме', async () => {
  const ru = await loadBunker('ru');
  for (const lang of LANGS) {
    const c = await loadBunker(lang);
    for (const cat of ['cat', 'bunker', ...CATS.slice(1)]) {
      assert.equal(c[cat].length, ru[cat].length, `${lang}.${cat}`);
      if (cat !== 'cat') {
        // Пометки «полезно/вредно» совпадают по позициям во всех языках.
        assert.deepEqual(c[cat].map((s) => s[0] === '+' || s[0] === '!' ? s[0] : ''), ru[cat].map((s) => s[0] === '+' || s[0] === '!' ? s[0] : ''), `${lang}.${cat}`);
        assert.equal(new Set(c[cat]).size >= c[cat].length - 2, true, `${lang}.${cat} дубли`);
      }
    }
    for (const n of [1, 2, 5, 11, 21, 34]) {
      assert.ok(c.age(n).includes(String(n)));
      assert.ok(c.exp(n).includes(String(n)));
      assert.ok(c.stay(n).includes(String(n)));
    }
    assert.ok(c.exp(0) && !c.exp(0).includes('0'));
  }
  assert.equal(ru.age(21), '21 год');
  assert.equal(ru.age(24), '24 года');
  assert.equal(ru.age(25), '25 лет');
});

for (const n of [4, 7, 10]) {
  test(`бункер: партия ${n} ботов — спасаются ровно floor(n/2)`, async () => {
    const seats = Array.from({ length: n }, (_, i) => ({ id: 'b' + i, bot: true }));
    const { ctx, log, state } = fakeCtx(seats, { talk: 60 });
    const g = new BunkerGame(ctx, await loadBunker('ru'), { timeScale: 0.003 });
    g.start();
    await until(() => state.ended, 60000);
    const r = state.ended.ranking;
    assert.equal(r.filter((x) => x.place === 1).length, Math.floor(n / 2));
    assert.equal(new Set(r.map((x) => x.place)).size, n - Math.floor(n / 2) + 1);
    const last = log.filter((m) => m.t === 'state').at(-1);
    assert.equal(last.phase, 'over');
    for (const p of last.players) assert.equal(Object.keys(p.open).length, CATS.length);
    // Пометки для ботов не утекают на экран.
    for (const m of log.filter((x) => x.t === 'state')) for (const p of m.players) for (const v of Object.values(p.open)) assert.ok(!/^[+!]/.test(v));
    assert.ok(log.some((m) => m.t === 'chat' && m.key));
    g.stop();
  });
}

test('бункер: раунд 1 открывает био и профессию, затем по карте, голосование', async () => {
  const { ctx, log, priv } = fakeCtx(['a', 'b', 'c', 'd'], { talk: 60 });
  const g = new BunkerGame(ctx, await loadBunker('en'), { rng: () => 0.3 });
  g.start();
  assert.equal(g.rounds, 3);
  assert.equal(g.eliminations, 2);
  const me = priv.a.at(-1);
  assert.deepEqual(Object.keys(me.cards), CATS);
  assert.ok(!Object.values(me.cards).some((v) => /^[+!]/.test(v)));
  g.advance(); // intro → раунд 1, обсуждение
  assert.equal(g.phase, 'talk');
  assert.deepEqual(Object.keys(log.at(-1).players[0].open).sort(), ['bio', 'prof']);
  assert.equal(g.votesThisRound(), false);
  g.advance(); // раунд 2: открываем карту
  assert.equal(g.phase, 'reveal');
  g.action('a', { t: 'reveal', cat: 'prof' }); // уже открыта
  assert.equal(g.player('a').open.size, 2);
  g.action('a', { t: 'reveal', cat: 'health' });
  g.action('a', { t: 'reveal', cat: 'hobby' }); // вторая за раунд — нельзя
  assert.equal(g.player('a').open.size, 3);
  g.advance(); // остальным открывается случайная
  assert.ok(g.players.every((p) => p.open.size === 3));
  assert.equal(g.phase, 'talk');
  assert.equal(g.votesThisRound(), true);
  g.advance();
  assert.equal(g.phase, 'vote');
  g.action('a', { t: 'vote', target: 'a' }); // за себя нельзя
  assert.equal(g.player('a').vote, undefined);
  for (const id of ['a', 'b', 'c']) g.action(id, { t: 'vote', target: 'd' });
  g.action('d', { t: 'vote', target: 'a' });
  g.advance();
  assert.equal(g.player('d').alive, false);
  assert.equal(g.phase, 'verdict');
  g.stop();
});
