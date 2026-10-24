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
};

export const GAME_IDS = Object.keys(GAMES);

export function defaultSettings() {
  const out = {};
  for (const g of Object.values(GAMES)) {
    out[g.id] = Object.fromEntries(g.options.map((o) => [o.key, o.def]));
  }
  return out;
}
