import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DICTS } from '../js/core/i18n.js';
import { GAMES } from '../js/games/registry.js';
import { CATS } from '../js/games/poker/eval.js';
import { BACKGROUNDS, ACCENTS, STYLES } from '../js/core/theme.js';
import { SHAPES, FXS } from '../js/core/profile.js';

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(path.join(dir, d.name)) : [path.join(dir, d.name)]));
}

// Ключи, которые собираются в коде из частей.
function dynamicKeys() {
  const keys = [];
  for (const g of Object.values(GAMES)) {
    keys.push(`game.${g.id}`, `lobby.rules.${g.id}`);
    for (const o of g.options) keys.push(`opt.${g.id}.${o.key}`);
  }
  ['easy', 'medium', 'hard', 'mix'].forEach((v) => keys.push(`opt.diff.${v}`));
  ['all', 'neighbors'].forEach((v) => keys.push(`opt.throw.${v}`));
  // Подписи значений настроек новых игр.
  for (const g of Object.values(GAMES)) {
    for (const o of g.options) {
      if (['level', 'speed', 'ai', 'roles'].includes(o.key)) o.values.forEach((v) => keys.push(`opt.${o.key}.${v}`));
      if ((o.key === 'size' || o.key === 'map') && typeof o.values[0] === 'string') o.values.forEach((v) => keys.push(`opt.size.${v}`));
    }
  }
  keys.push(...extraGameKeys());
  CATS.forEach((c) => keys.push(`poker.cat.${c}`));
  ['sb', 'bb', 'fold', 'check', 'call', 'bet', 'raise', 'allin'].forEach((a) => keys.push(`poker.act.${a}`));
  ['min', 'half', 'pot', 'allin'].forEach((a) => keys.push(`poker.preset.${a}`));
  ['win', 'lose', 'push', 'bj'].forEach((r) => keys.push(`bj.res.${r}`));
  ['J', 'Q', 'K', 'A'].forEach((r) => keys.push(`rank.${r}`));
  [0, 1, 2, 3, 4].forEach((n) => keys.push(`words.tier${n}`));
  BACKGROUNDS.forEach((b) => keys.push(`bg.${b.id}`));
  ACCENTS.forEach((a) => keys.push(`accent.${a.id}`));
  STYLES.forEach((s) => keys.push(`style.${s}`));
  SHAPES.forEach((s) => keys.push(`shape.${s}`));
  FXS.forEach((f) => keys.push(`fx.${f}`));
  return keys;
}

// Ключи новых игр, которые собираются из частей прямо в экранах игр.
function extraGameKeys() {
  const k = [];
  const add = (prefix, list) => list.forEach((x) => k.push(`${prefix}.${x}`));
  add('chess.draw', ['stalemate', 'fifty', 'material', 'repetition']);
  add('chess.why', ['mate', 'resign', 'time']);
  add('uno.color', ['r', 'y', 'g', 'b']);
  add('roulette.item', ['glass', 'soda', 'cuffs', 'saw', 'medkit', 'phone', 'invert']);
  add('roulette.desc', ['glass', 'soda', 'cuffs', 'saw', 'medkit', 'phone', 'invert']);
  add('mafia.role', ['mafia', 'doctor', 'detective', 'civilian']);
  add('mafia.phase', ['intro', 'night', 'morning', 'day', 'vote', 'verdict', 'over']);
  add('mafia.say', ['hmm', 'civil', 'quiet', 'suspect', 'vote', 'found']);
  add('bunker.cat', ['bio', 'prof', 'health', 'hobby', 'phobia', 'bag', 'fact']);
  add('bunker.say', ['useful', 'against', 'doubt', 'hmm']);
  add('mahjong.size', ['small', 'medium', 'large']);
  add('empires.terrain', ['sea', 'plains', 'forest', 'hills', 'mountains', 'desert', 'tundra']);
  add('empires.rel', ['self', 'war', 'ally', 'truce', 'peace']);
  add('empires.mode', ['political', 'terrain']);
  add('empires.ev.declined', ['peace', 'ally']);
  add('empires.offer', ['peace', 'ally']);
  add('empires.nope', ['recruit', 'move', 'split', 'invest', 'war', 'peace', 'ally', 'unally', 'answer']);
  return k;
}

test('все ключи из кода есть в русском словаре', () => {
  const src = files('js').concat(['index.html']).filter((f) => /\.(js|html)$/.test(f) && !f.includes('/lang/') && !f.includes('/i18n/') && !f.endsWith('core/i18n.js'));
  const used = new Set(dynamicKeys());
  for (const f of src) {
    const text = fs.readFileSync(f, 'utf8');
    for (const m of text.matchAll(/\btn?\('([a-zA-Z0-9_.]+)'[,)]/g)) used.add(m[1]);
    for (const m of text.matchAll(/data-i18n(?:-ph|-aria)?="([^"]+)"/g)) used.add(m[1]);
  }
  const missing = [...used].filter((k) => !(k in DICTS.ru));
  assert.deepEqual(missing, []);
});

test('во всех языках одинаковый набор ключей и плейсхолдеров', () => {
  const ruKeys = Object.keys(DICTS.ru).sort();
  for (const [lang, d] of Object.entries(DICTS)) {
    assert.deepEqual(Object.keys(d).sort(), ruKeys, lang);
    for (const k of ruKeys) {
      const vars = (v) => [...JSON.stringify(v).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
      assert.equal(vars(d[k]).replace(/(\w+)(,\1)+/g, '$1'), vars(DICTS.ru[k]).replace(/(\w+)(,\1)+/g, '$1'), `${lang}: ${k}`);
    }
  }
});
