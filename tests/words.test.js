import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, scramble, pickWords, wordPoints, rank, parseWords } from '../js/games/words/logic.js';
import { WordsGame, loadWords } from '../js/games/words/engine.js';
import { fakeCtx, until } from './helpers.js';

const LETTERS = {
  ru: /^[А-Я]+$/u,
  uk: /^[А-ЩЬЮЯЄІЇҐ]+$/u,
  en: /^[A-Z]+$/,
  es: /^[A-ZÑ]+$/,
  de: /^[A-ZÄÖÜ]+$/,
};

test('25 уровней: первый — 10 слов, дальше длиннее, больше слов, меньше времени', () => {
  assert.equal(LEVELS.length, 25);
  assert.equal(LEVELS[0].words, 10);
  assert.deepEqual(LEVELS[0].len, [4, 4]);
  for (let i = 1; i < LEVELS.length; i++) {
    assert.ok(LEVELS[i].words >= LEVELS[i - 1].words);
    assert.ok(LEVELS[i].time <= LEVELS[i - 1].time);
    assert.ok(LEVELS[i].len[1] >= LEVELS[i - 1].len[1]);
    assert.ok(LEVELS[i].mult > LEVELS[i - 1].mult);
  }
  assert.ok(LEVELS[24].time >= 12, 'не слишком жёстко');
});

for (const lang of Object.keys(LETTERS)) {
  test(`слова (${lang}): буквы, длины, подсказки без ответа, без повторов`, async () => {
    const pool = await loadWords(lang);
    const all = Object.values(pool).flat();
    assert.ok(all.length >= (lang === 'ru' ? 900 : 280), `${lang}: всего ${all.length}`);
    assert.equal(new Set(all.map((w) => w.word)).size, all.length);
    for (const { word, clue } of all) {
      assert.match(word, LETTERS[lang], word);
      assert.ok(!word.includes('Ё'), word);
      assert.ok(clue.length > 5, word);
      assert.ok(!clue.toUpperCase().includes(word), `${word}: подсказка выдаёт ответ`);
    }
    // Каждый уровень можно собрать без повторов внутри уровня.
    for (const l of LEVELS) {
      const words = pickWords(pool, l.n);
      assert.equal(words.length, l.words, `${lang} уровень ${l.n}`);
      assert.equal(new Set(words.map((w) => w.word)).size, words.length);
      for (const w of words) assert.ok(w.word.length >= l.len[0] && w.word.length <= l.len[1]);
    }
  });
}

test('марафон из 25 уровней по-русски обходится без повторов', async () => {
  const pool = await loadWords('ru');
  const used = new Set();
  let total = 0;
  for (const l of LEVELS) total += pickWords(pool, l.n, used).length;
  assert.equal(used.size, total);
});

test('перемешанное слово — из тех же букв и не совпадает с ответом', () => {
  for (const w of ['КОТЫ', 'АРБУЗ', 'МАМА', 'ВЕЛОСИПЕД']) {
    for (let k = 0; k < 30; k++) {
      const s = scramble(w);
      assert.deepEqual([...s].sort(), [...w].sort());
      assert.notEqual(s.join(''), w);
    }
  }
});

test('очки: быстрее и раньше других — больше; подсказки и место уменьшают', () => {
  assert.equal(wordPoints(1, 0, 30000), 200);
  assert.ok(wordPoints(1, 1000, 30000) > wordPoints(1, 20000, 30000));
  assert.ok(wordPoints(1, 1000, 30000, 1) < wordPoints(1, 1000, 30000));
  assert.ok(wordPoints(1, 1000, 30000, 0, 1) < wordPoints(1, 1000, 30000, 0, 0));
  assert.ok(wordPoints(25, 1000, 30000) > wordPoints(1, 1000, 30000));
  assert.deepEqual(rank({ a: 5, b: 9, c: 5 }).map((r) => [r.id, r.place]), [['b', 1], ['a', 2], ['c', 2]]);
});

test('игра на троих: порядок собравших, окно ожидания, переход уровня, итог', async () => {
  const pool = parseWords(['КОТЫ|а', 'ЛИСА|б', 'СОВА|в', 'ГОРА|г', 'РЕКА|д', 'ЗИМА|е', 'ЛЕТО|ж', 'НЕБО|з', 'ОКНО|и', 'СЫРЫ|к', 'ДОМА|л', 'РОЗА|м'].join('\n'));
  const { ctx, log, state } = fakeCtx(['a', 'b', 'c'], { start: 1, count: 2 });
  const g = new WordsGame(ctx, pool, { timeScale: 0.01 });
  g.start();
  await until(() => log.some((m) => m.t === 'round'));
  const r = log.find((m) => m.t === 'round');
  g.action('b', { t: 'solve', i: r.i, ms: 150, hints: 0 });
  assert.ok(log.some((m) => m.t === 'first' && m.p === 'b'));
  g.action('a', { t: 'solve', i: r.i, ms: 90, hints: 0 }); // пришёл позже, но собрал быстрее
  g.action('a', { t: 'solve', i: r.i, ms: 10, hints: 0 }); // повтор — игнор
  g.action('c', { t: 'solve', i: r.i, ms: 250, hints: 1 });
  const res = log.find((m) => m.t === 'result');
  assert.deepEqual(res.order.map((o) => o.id), ['a', 'b', 'c']);
  assert.ok(res.order[0].pts > res.order[1].pts && res.order[1].pts > res.order[2].pts);
  await until(() => log.some((m) => m.t === 'levelEnd'), 20000);
  g.action('b', { t: 'next' }); // переключает только хозяин
  assert.equal(g.phase, 'levelEnd');
  g.action('a', { t: 'next' });
  assert.equal(g.level, 2);
  await until(() => state.ended, 20000);
  assert.equal(state.ended.ranking[0].id, 'a');
  g.stop();
});
