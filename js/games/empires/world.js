// Генерация мира для «Империй»: шестиугольная карта (острые верхушки,
// нечётные ряды сдвинуты вправо), материк из шума, страны с названиями.

export const T = { sea: 0, plains: 1, forest: 2, hills: 3, mountains: 4, desert: 5, tundra: 6 };
export const TERRAINS = ['sea', 'plains', 'forest', 'hills', 'mountains', 'desert', 'tundra'];
// Сколько дней армия идёт через клетку и насколько там легче обороняться.
export const MOVE_DAYS = [99, 3, 4, 5, 7, 4, 5];
export const DEFENSE = [1, 1, 0.85, 0.8, 0.65, 1, 0.9];

export const SIZES = {
  small: { w: 24, h: 16, countries: 14 },
  medium: { w: 30, h: 20, countries: 22 },
  large: { w: 36, h: 24, countries: 30 },
  huge: { w: 44, h: 28, countries: 40 },
};

// Двоичная куча для поиска пути.
class Heap {
  constructor() {
    this.a = [];
  }
  push(p, v) {
    const a = this.a;
    a.push([p, v]);
    let i = a.length - 1;
    while (i > 0) {
      const j = (i - 1) >> 1;
      if (a[j][0] <= a[i][0]) break;
      [a[i], a[j]] = [a[j], a[i]];
      i = j;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
  get size() {
    return this.a.length;
  }
}

// Кратчайший по времени путь (Дейкстра). nb — списки соседей, cost(x) — цена входа
// в клетку, ok(x) — можно ли в неё войти. Возвращает клетки без стартовой или null.
export function findPath(nb, from, to, ok, cost) {
  if (from === to || !ok(to)) return null;
  const n = nb.length;
  const dist = new Float32Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const heap = new Heap();
  dist[from] = 0;
  heap.push(0, from);
  while (heap.size) {
    const [d, x] = heap.pop();
    if (x === to) break;
    if (d > dist[x]) continue;
    for (const y of nb[x]) {
      if (!ok(y)) continue;
      const nd = d + cost(y);
      if (nd < dist[y]) {
        dist[y] = nd;
        prev[y] = x;
        heap.push(nd, y);
      }
    }
  }
  if (prev[to] < 0) return null;
  const out = [];
  for (let x = to; x !== from; x = prev[x]) out.push(x);
  return out.reverse();
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function neighbors(w, h, i) {
  const c = i % w;
  const r = Math.floor(i / w);
  const odd = r & 1;
  const d = odd
    ? [
        [1, 0],
        [-1, 0],
        [1, -1],
        [0, -1],
        [1, 1],
        [0, 1],
      ]
    : [
        [1, 0],
        [-1, 0],
        [0, -1],
        [-1, -1],
        [0, 1],
        [-1, 1],
      ];
  const out = [];
  for (const [dc, dr] of d) {
    const nc = c + dc;
    const nr = r + dr;
    if (nc >= 0 && nc < w && nr >= 0 && nr < h) out.push(nr * w + nc);
  }
  return out;
}

function cube(w, i) {
  const c = i % w;
  const r = Math.floor(i / w);
  const x = c - (r - (r & 1)) / 2;
  return [x, r, -x - r];
}

export function hexDist(w, a, b) {
  const [ax, ay, az] = cube(w, a);
  const [bx, by, bz] = cube(w, b);
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by), Math.abs(az - bz));
}

// Центр клетки в «единицах шестиугольника» (для отрисовки).
export function hexCenter(w, i) {
  const c = i % w;
  const r = Math.floor(i / w);
  return [Math.sqrt(3) * (c + 0.5 * (r & 1)) + Math.sqrt(3) / 2, 1.5 * r + 1];
}

// Сглаженный шум: случайная сетка + билинейная интерполяция, несколько октав.
function noise(w, h, rng, cell) {
  const gw = Math.ceil(w / cell) + 2;
  const gh = Math.ceil(h / cell) + 2;
  const g = Array.from({ length: gw * gh }, rng);
  const s = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = x / cell;
    const fy = y / cell;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = s(fx - x0);
    const ty = s(fy - y0);
    const v = (a, b) => g[(b % gh) * gw + (a % gw)];
    const top = v(x0, y0) * (1 - tx) + v(x0 + 1, y0) * tx;
    const bot = v(x0, y0 + 1) * (1 - tx) + v(x0 + 1, y0 + 1) * tx;
    return top * (1 - ty) + bot * ty;
  };
}

// Слоги названий: [латиница, кириллица].
const START = [
  ['Ka', 'Ка'], ['Ve', 'Ве'], ['Lo', 'Ло'], ['Ra', 'Ра'], ['Mi', 'Ми'], ['Do', 'До'], ['Sta', 'Ста'], ['Ne', 'Не'],
  ['Be', 'Бе'], ['Gra', 'Гра'], ['To', 'То'], ['Vi', 'Ви'], ['Sa', 'Са'], ['Mo', 'Мо'], ['Ru', 'Ру'], ['Ze', 'Зе'],
  ['Po', 'По'], ['A', 'А'], ['Li', 'Ли'], ['Da', 'Да'], ['Fe', 'Фе'], ['Ga', 'Га'], ['He', 'Хе'], ['O', 'О'],
  ['U', 'У'], ['Ta', 'Та'], ['Kro', 'Кро'], ['No', 'Но'], ['E', 'Э'], ['Bra', 'Бра'], ['Tre', 'Тре'], ['Si', 'Си'],
];
const MIDDLE = [
  ['ran', 'ран'], ['lor', 'лор'], ['ver', 'вер'], ['mar', 'мар'], ['del', 'дел'], ['ton', 'тон'], ['sel', 'сел'], ['bar', 'бар'],
  ['rin', 'рин'], ['dar', 'дар'], ['len', 'лен'], ['mon', 'мон'], ['gor', 'гор'], ['vel', 'вел'], ['nar', 'нар'], ['tal', 'тал'],
  ['', ''], ['', ''], ['', ''], ['', ''],
];
const END = [
  ['ia', 'ия'], ['land', 'ланд'], ['ar', 'ар'], ['ovia', 'овия'], ['en', 'ен'], ['ica', 'ика'], ['stan', 'стан'],
  ['heim', 'хейм'], ['or', 'ор'], ['ania', 'ания'], ['eth', 'ет'], ['is', 'ис'], ['ova', 'ова'], ['um', 'ум'],
  ['ara', 'ара'], ['ond', 'онд'], ['ia', 'ия'], ['ia', 'ия'],
];

export function makeName(rng, cyr) {
  const k = cyr ? 1 : 0;
  const p = (arr) => arr[Math.floor(rng() * arr.length)][k];
  let s = p(START) + p(MIDDLE) + p(END);
  s = s.replace(/([аеиоуэяaeiou])\1/gi, '$1');
  return s[0].toUpperCase() + s.slice(1);
}

// Различимые цвета стран: золотой угол по оттенку + чередование яркости.
export function countryColor(i) {
  const hue = Math.round((i * 137.508) % 360);
  const light = [52, 42, 62][i % 3];
  const sat = [62, 70, 55][Math.floor(i / 3) % 3];
  return `hsl(${hue} ${sat}% ${light}%)`;
}

export function generateWorld({ seed = 1, size = 'medium', lang = 'en' } = {}) {
  const rng = mulberry32(seed);
  const { w, h, countries: nCountries } = SIZES[size] || SIZES.medium;
  const n = w * h;
  const elev = noise(w, h, rng, 6);
  const elev2 = noise(w, h, rng, 2.5);
  const moist = noise(w, h, rng, 5);
  const e = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const c = i % w;
    const r = Math.floor(i / w);
    const dx = (c - w / 2) / (w / 2);
    const dy = (r - h / 2) / (h / 2);
    const fall = Math.max(Math.abs(dx), Math.abs(dy)) ** 3 * 0.55 + (dx * dx + dy * dy) * 0.12;
    e[i] = elev(c, r) * 0.7 + elev2(c, r) * 0.3 - fall;
  }
  // Порог высоты: суши примерно 58% карты.
  const sorted = Array.from(e).sort((a, b) => a - b);
  const sea = sorted[Math.floor(n * 0.42)];
  const terrain = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (e[i] <= sea) continue;
    const r = Math.floor(i / w);
    const lat = Math.abs(r - h / 2) / (h / 2);
    const m = moist(i % w, r);
    const high = (e[i] - sea) / (sorted[n - 1] - sea);
    let t = T.plains;
    if (high > 0.78) t = T.mountains;
    else if (high > 0.58) t = T.hills;
    else if (lat > 0.82) t = T.tundra;
    else if (m < 0.33 && lat < 0.55) t = T.desert;
    else if (m > 0.58) t = T.forest;
    terrain[i] = t;
  }
  // Оставляем крупнейший материк — по нему можно дойти куда угодно.
  const comp = new Int32Array(n).fill(-1);
  let best = -1;
  let bestSize = 0;
  for (let i = 0, id = 0; i < n; i++) {
    if (!terrain[i] || comp[i] >= 0) continue;
    const stack = [i];
    comp[i] = id;
    let cnt = 0;
    while (stack.length) {
      const x = stack.pop();
      cnt++;
      for (const y of neighbors(w, h, x)) {
        if (terrain[y] && comp[y] < 0) {
          comp[y] = id;
          stack.push(y);
        }
      }
    }
    if (cnt > bestSize) {
      bestSize = cnt;
      best = id;
    }
    id++;
  }
  for (let i = 0; i < n; i++) if (terrain[i] && comp[i] !== best) terrain[i] = T.sea;
  const land = [];
  for (let i = 0; i < n; i++) if (terrain[i]) land.push(i);

  // Реки: от гор и холмов вниз по склону до моря. Клетки с рекой плодороднее,
  // а наступать через реку труднее.
  const river = new Uint8Array(n);
  const rivers = [];
  const sources = land.filter((i) => terrain[i] === T.hills || terrain[i] === T.mountains);
  const want = Math.round(land.length / 40);
  for (let tries = 0; tries < want * 6 && rivers.length < want; tries++) {
    const src = sources[Math.floor(rng() * sources.length)];
    if (src == null || river[src]) continue;
    const path = [src];
    let cur = src;
    let mouth = -1;
    for (let step = 0; step < 18; step++) {
      let nx = -1;
      let low = e[cur];
      for (const y of neighbors(w, h, cur)) {
        if (!terrain[y]) {
          mouth = y;
          break;
        }
        if (e[y] < low && !path.includes(y)) {
          low = e[y];
          nx = y;
        }
      }
      if (mouth >= 0 || nx < 0) break;
      path.push(nx);
      if (river[nx]) break; // влились в другую реку
      cur = nx;
    }
    const joined = river[path[path.length - 1]] && path.length > 1;
    if ((mouth < 0 && !joined) || path.length < 3) continue;
    for (const x of path) river[x] = 1;
    rivers.push({ path, mouth });
  }

  const DEV = [0, 3, 2, 2, 1, 1, 1];
  const dev = new Uint8Array(n);
  for (const i of land) dev[i] = Math.max(1, Math.min(6, DEV[terrain[i]] + (rng() < 0.3 ? 1 : 0) - (rng() < 0.15 ? 1 : 0) + river[i]));

  // Столицы: дальние друг от друга точки, лучше на равнинах.
  const good = land.filter((i) => terrain[i] !== T.mountains);
  const capitals = [good[Math.floor(rng() * good.length)]];
  const k = Math.min(nCountries, Math.floor(land.length / 8));
  while (capitals.length < k) {
    let pick = -1;
    let pickScore = -1;
    for (let tries = 0; tries < 60; tries++) {
      const cand = good[Math.floor(rng() * good.length)];
      const d = Math.min(...capitals.map((c) => hexDist(w, c, cand)));
      const sc = d + (terrain[cand] === T.plains ? 0.8 : 0) + rng();
      if (sc > pickScore) {
        pickScore = sc;
        pick = cand;
      }
    }
    if (capitals.includes(pick)) break;
    capitals.push(pick);
  }
  // Территории растут от столиц; у каждой страны своя «сила» — страны разного размера.
  const owner = new Int16Array(n).fill(-1);
  const cost = new Float32Array(n).fill(Infinity);
  const power = capitals.map(() => 0.55 + rng() * 1.1);
  const queue = capitals.map((c, idx) => [0, c, idx]);
  capitals.forEach((c) => (cost[c] = 0));
  while (queue.length) {
    let bi = 0;
    for (let q = 1; q < queue.length; q++) if (queue[q][0] < queue[bi][0]) bi = q;
    const [d, x, idx] = queue[bi];
    queue[bi] = queue[queue.length - 1];
    queue.pop();
    if (owner[x] >= 0) continue;
    owner[x] = idx;
    for (const y of neighbors(w, h, x)) {
      if (!terrain[y] || owner[y] >= 0) continue;
      const nd = d + (MOVE_DAYS[terrain[y]] * (0.7 + rng() * 0.6)) / power[idx];
      if (nd < cost[y]) {
        cost[y] = nd;
        queue.push([nd, y, idx]);
      }
    }
  }
  for (const c of capitals) dev[c] = Math.min(6, dev[c] + 2);
  const cyr = lang === 'ru' || lang === 'uk';
  const names = new Set();
  const countries = capitals.map((capital, i) => {
    let name;
    for (let t = 0; t < 20; t++) {
      name = makeName(rng, cyr);
      if (!names.has(name) && name.length >= 4 && name.length <= 11) break;
    }
    names.add(name);
    return { id: i, name, color: countryColor(i), capital };
  });
  return { seed, size, w, h, terrain: Array.from(terrain), dev: Array.from(dev), owner: Array.from(owner), river: Array.from(river), rivers, countries };
}
