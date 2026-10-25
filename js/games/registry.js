// Список игр Игротеки: сколько игроков, можно ли ботов и какие настройки.

export const GAMES = {
  words: {
    id: 'words',
    icon: '🔤',
    min: 1,
    max: 10,
    bots: false,
    content: true, // слова зависят от языка комнаты
    options: [
      { key: 'start', values: Array.from({ length: 25 }, (_, i) => i + 1), def: 1 },
      { key: 'count', values: [1, 3, 5, 10, 25], def: 5 },
    ],
    engine: () => import('./words/engine.js'),
    view: () => import('./words/view.js'),
  },
  croc: {
    id: 'croc',
    icon: '🎨',
    min: 2,
    max: 10,
    bots: false,
    content: true,
    options: [
      { key: 'rounds', values: [1, 2, 3], def: 1 },
      { key: 'time', values: [60, 80, 100, 120], def: 80 },
      { key: 'diff', values: ['easy', 'medium', 'hard', 'mix'], def: 'easy' },
    ],
    engine: () => import('./croc/engine.js'),
    view: () => import('./croc/view.js'),
  },
  poker: {
    id: 'poker',
    icon: '♠️',
    min: 2,
    max: 10,
    bots: true,
    options: [
      { key: 'chips', values: [500, 1000, 2000, 5000], def: 1000 },
      { key: 'bb', values: [10, 20, 50, 100], def: 20 },
      { key: 'hands', values: [10, 20, 30, 50, 0], def: 20 },
    ],
    engine: () => import('./poker/engine.js'),
    view: () => import('./poker/view.js'),
  },
  durak: {
    id: 'durak',
    icon: '🃏',
    min: 2,
    max: 6,
    bots: true,
    options: [{ key: 'throw', values: ['all', 'neighbors'], def: 'all' }],
    engine: () => import('./durak/engine.js'),
    view: () => import('./durak/view.js'),
  },
  bj: {
    id: 'bj',
    icon: '21',
    min: 1,
    max: 8,
    bots: true,
    options: [
      { key: 'chips', values: [500, 1000, 2000], def: 1000 },
      { key: 'rounds', values: [5, 10, 15, 20], def: 10 },
      { key: 'minBet', values: [10, 25, 50], def: 10 },
    ],
    engine: () => import('./blackjack/engine.js'),
    view: () => import('./blackjack/view.js'),
  },
  uno: {
    id: 'uno',
    icon: '🎴',
    min: 2,
    max: 10,
    bots: true,
    options: [{ key: 'stack', values: ['off', 'on'], def: 'off' }],
    engine: () => import('./uno/engine.js'),
    view: () => import('./uno/view.js'),
  },
  roulette: {
    id: 'roulette',
    icon: '🔫',
    min: 2,
    max: 6,
    bots: true,
    options: [
      { key: 'hp', values: [2, 3, 4, 5, 6], def: 4 },
      { key: 'items', values: ['on', 'off'], def: 'on' },
    ],
    engine: () => import('./roulette/engine.js'),
    view: () => import('./roulette/view.js'),
  },
  mafia: {
    id: 'mafia',
    icon: '🕵️',
    min: 4,
    max: 10,
    bots: true,
    options: [
      { key: 'day', values: [60, 90, 120, 180], def: 90 },
      { key: 'roles', values: ['classic', 'simple'], def: 'classic' },
      { key: 'mafia', values: ['auto', 1, 2, 3], def: 'auto' },
    ],
    engine: () => import('./mafia/engine.js'),
    view: () => import('./mafia/view.js'),
  },
  bunker: {
    id: 'bunker',
    icon: '☢️',
    min: 4,
    max: 10,
    bots: true,
    content: true,
    options: [{ key: 'talk', values: [60, 90, 120, 180], def: 90 }],
    engine: () => import('./bunker/engine.js'),
    view: () => import('./bunker/view.js'),
  },
  chess: {
    id: 'chess',
    icon: '♟️',
    min: 2,
    max: 2,
    bots: true,
    options: [
      { key: 'level', values: ['easy', 'medium', 'hard'], def: 'medium' },
      { key: 'clock', values: [0, 180, 300, 600], def: 0 },
    ],
    engine: () => import('./chess/engine.js'),
    view: () => import('./chess/view.js'),
  },
  checkers: {
    id: 'checkers',
    icon: '⛀',
    min: 2,
    max: 2,
    bots: true,
    options: [{ key: 'level', values: ['easy', 'medium', 'hard'], def: 'medium' }],
    engine: () => import('./checkers/engine.js'),
    view: () => import('./checkers/view.js'),
  },
  go: {
    id: 'go',
    icon: '⚫',
    min: 2,
    max: 2,
    bots: true,
    options: [
      { key: 'size', values: [9, 13, 19], def: 9 },
      { key: 'level', values: ['easy', 'medium'], def: 'medium' },
    ],
    engine: () => import('./go/engine.js'),
    view: () => import('./go/view.js'),
  },
  mahjong: {
    id: 'mahjong',
    icon: '🀄',
    min: 1,
    max: 10,
    bots: true,
    options: [
      { key: 'size', values: ['small', 'medium', 'large'], def: 'small' },
      { key: 'time', values: [3, 5, 10], def: 5 },
    ],
    engine: () => import('./mahjong/engine.js'),
    view: () => import('./mahjong/view.js'),
  },
  empires: {
    id: 'empires',
    icon: '🌍',
    min: 1,
    max: 10,
    bots: true,
    content: true, // названия стран — латиницей или кириллицей
    options: [
      { key: 'map', values: ['small', 'medium', 'large'], def: 'medium' },
      { key: 'time', values: [10, 20, 30, 45], def: 20 },
      { key: 'speed', values: ['slow', 'normal', 'fast'], def: 'normal' },
      { key: 'ai', values: ['calm', 'normal', 'war'], def: 'normal' },
    ],
    engine: () => import('./empires/engine.js'),
    view: () => import('./empires/view.js'),
  },
};

export const GAME_IDS = Object.keys(GAMES);

export function defaultSettings() {
  const out = {};
  for (const g of Object.values(GAMES)) {
    out[g.id] = Object.fromEntries(g.options.map((o) => [o.key, o.def]));
  }
  return out;
}
