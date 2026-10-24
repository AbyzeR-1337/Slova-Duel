import test from 'node:test';
import assert from 'node:assert/strict';
import { CrocGame, norm, loadCroc } from '../js/games/croc/engine.js';
import { fakeCtx, until, wait } from './helpers.js';

test('ответы сравниваются без регистра, ё и ударений', () => {
  assert.equal(norm('  Ёлка! '), 'елка');
  assert.equal(norm('Árbol'), 'arbol');
  assert.equal(norm('Воздушный   шар'), 'воздушныи шар');
});

test('слова для всех языков загружаются', async () => {
  for (const l of ['ru', 'en', 'uk', 'es', 'de']) {
    const w = await loadCroc(l);
    for (const k of ['easy', 'medium', 'hard']) assert.ok(w[k].length >= 40, `${l}/${k}`);
    const all = [...w.easy, ...w.medium, ...w.hard];
    assert.equal(new Set(all).size, all.length, `${l}: повторы`);
  }
});

test('ход: выбор слова, рисунок, «почти», угадал — очки обоим', async () => {
  const words = { easy: ['кошка', 'собака', 'самолёт'], medium: [], hard: [] };
  const { ctx, log, priv, state } = fakeCtx(['a', 'b', 'c'], { rounds: 1, time: 60, diff: 'easy' });
  const g = new CrocGame(ctx, words, { timeScale: 0.01 });
  g.start();
  const drawer = g.drawer;
  const [g1, g2] = ['a', 'b', 'c'].filter((x) => x !== drawer);
  const opts = priv[drawer].find((m) => m.t === 'options').words;
  assert.equal(opts.length, 3);
  g.action(g1, { t: 'choose', i: 0 }); // выбирает только рисующий
  assert.equal(g.phase, 'choose');
  g.action(drawer, { t: 'choose', i: 0 });
  assert.equal(g.phase, 'draw');
  const word = priv[drawer].find((m) => m.t === 'word').word;
  g.action(drawer, { t: 'stroke', id: 's1', c: '#ff0000', w: 6, p: [10, 10, 20, 20], n: true });
  g.action(drawer, { t: 'stroke', id: 's1', c: '#ff0000', w: 6, p: [30, 30] });
  g.action(g1, { t: 'stroke', id: 'x', c: '#000000', w: 6, p: [1, 1], n: true }); // не рисующий — игнор
  assert.equal(g.strokes.length, 1);
  assert.deepEqual(g.strokes[0].p, [10, 10, 20, 20, 30, 30]);
  const almost = word.slice(0, -1) + 'ы';
  g.action(g1, { t: 'guess', text: almost });
  assert.ok(priv[g1].some((m) => m.t === 'close'));
  assert.ok(log.some((m) => m.t === 'chat' && m.text === almost));
  g.action(g1, { t: 'guess', text: word.toUpperCase() });
  assert.ok(g.scores[g1] > 0 && g.scores[drawer] > 0);
  assert.ok(!log.some((m) => m.t === 'chat' && norm(m.text) === norm(word)), 'правильный ответ не показывается в чате');
  g.action(g2, { t: 'guess', text: word });
  // Все угадали — ход закончился раньше времени.
  assert.equal(g.phase, 'reveal');
  await until(() => state.ended, 10000);
  assert.equal(state.ended.ranking.length, 3);
  g.stop();
});

test('никто не угадал — время вышло, ходы идут по кругу', async () => {
  const words = { easy: ['дом', 'кот', 'сыр', 'лес'], medium: [], hard: [] };
  const { ctx, log, state } = fakeCtx(['a', 'b'], { rounds: 2, time: 60, diff: 'easy' });
  const g = new CrocGame(ctx, words, { timeScale: 0.001 });
  g.start();
  await until(() => state.ended, 10000);
  const drawers = log.filter((m) => m.t === 'reveal').map((m) => m.drawer);
  assert.deepEqual(drawers, ['a', 'b', 'a', 'b']);
  g.stop();
});
