// Маджонг-пасьянс: раскладка, правила «свободной» кости и генерация
// заведомо решаемой раздачи. Общий код для хоста и экрана игрока.
//
// Кость занимает 2×2 клетки сетки: позиция {x, y, z}, x и y — в полуклетках
// кости, z — слой. Слои — центрированные прямоугольники, поэтому верхние
// слои могут сдвигаться на полкости, как в классической «черепахе».

export const SUITS = {
  c: ['1', '2', '3', '4', '5', '6', '7', '8', '9'], // символы
  b: ['1', '2', '3', '4', '5', '6', '7', '8', '9'], // бамбук
  p: ['1', '2', '3', '4', '5', '6', '7', '8', '9'], // точки
  w: ['E', 'S', 'W', 'N'], // ветра
  D: ['r', 'g', 'w'], // драконы
};
export const KINDS = Object.entries(SUITS).flatMap(([s, vs]) => vs.map((v) => s + v));
export const FLOWERS = ['f1', 'f2', 'f3', 'f4'];
export const SEASONS = ['s1', 's2', 's3', 's4'];

export const LAYOUTS = {
  small: [
    [8, 4],
    [6, 2],
    [2, 2],
  ],
  medium: [
    [10, 6],
    [8, 4],
    [6, 2],
    [2, 1],
  ],
  large: [
    [12, 6],
    [10, 4],
    [8, 2],
    [4, 2],
    [2, 1],
  ],
};

export function positions(size = 'small') {
  const layers = LAYOUTS[size] || LAYOUTS.small;
  const [W, H] = layers[0];
  const out = [];
  layers.forEach(([w, h], z) => {
    const ox = W - w;
    const oy = H - h;
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) out.push({ x: ox + c * 2, y: oy + r * 2, z });
  });
  return out;
}

// Совпадают одинаковые кости, а также любые два цветка или любые два сезона.
export const group = (k) => (k[0] === 'f' || k[0] === 's' ? k[0] : k);
export const matches = (a, b) => !!a && !!b && group(a) === group(b);

// Кость свободна, если на ней ничего не лежит и свободен левый или правый край.
export function isFree(pos, present, i) {
  const p = pos[i];
  let left = false;
  let right = false;
  for (let j = 0; j < pos.length; j++) {
    if (j === i || !present[j]) continue;
    const q = pos[j];
    if (Math.abs(q.y - p.y) >= 2) continue;
    if (q.z === p.z + 1 && Math.abs(q.x - p.x) < 2) return false;
    if (q.z === p.z) {
      if (q.x === p.x - 2) left = true;
      else if (q.x === p.x + 2) right = true;
    }
  }
  return !left || !right;
}

export function freeTiles(pos, present) {
  const out = [];
  for (let i = 0; i < pos.length; i++) if (present[i] && isFree(pos, present, i)) out.push(i);
  return out;
}

// Возможные ходы: пары свободных совпадающих костей.
export function moves(pos, kinds) {
  const present = kinds.map(Boolean);
  const free = freeTiles(pos, present);
  const out = [];
  for (let a = 0; a < free.length; a++) for (let b = a + 1; b < free.length; b++) if (matches(kinds[free[a]], kinds[free[b]])) out.push([free[a], free[b]]);
  return out;
}

// Раскладываем пары по позициям, снимая с поля случайные пары свободных
// мест: последовательность снятий — готовое решение, значит раздача решаема.
function place(pos, slots, pairs, rng) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const present = pos.map((_, i) => slots.includes(i));
    const kinds = pos.map(() => null);
    const order = pairs.slice();
    let ok = true;
    for (const [ka, kb] of order) {
      const free = freeTiles(pos, present);
      if (free.length < 2) {
        ok = false;
        break;
      }
      // Чаще берём верхние кости, чтобы не «закапывать» решение.
      const pickOne = () => {
        const z = Math.max(...free.map((i) => pos[i].z));
        const pool = rng() < 0.6 ? free.filter((i) => pos[i].z === z) : free;
        const src = pool.length ? pool : free;
        const i = src[Math.floor(rng() * src.length)];
        free.splice(free.indexOf(i), 1);
        return i;
      };
      const a = pickOne();
      if (!free.length) {
        ok = false;
        break;
      }
      const b = pickOne();
      kinds[a] = ka;
      kinds[b] = kb;
      present[a] = present[b] = false;
    }
    if (ok) return kinds;
  }
  return null;
}

function makePairs(n, rng) {
  const pairs = [];
  const kinds = [...KINDS, 'f', 's'];
  const bag = [];
  while (bag.length < n) bag.push(...shuffled(kinds, rng));
  for (const k of bag.slice(0, n)) {
    if (k === 'f' || k === 's') {
      const set = shuffled(k === 'f' ? FLOWERS : SEASONS, rng);
      pairs.push([set[0], set[1]]);
    } else pairs.push([k, k]);
  }
  return shuffled(pairs, rng);
}

function shuffled(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function deal(pos, rng = Math.random) {
  const slots = pos.map((_, i) => i);
  for (;;) {
    const kinds = place(pos, slots, makePairs(pos.length / 2, rng), rng);
    if (kinds) return kinds;
  }
}

// Перемешивание оставшихся костей — тоже с гарантией решения.
export function reshuffle(pos, kinds, rng = Math.random) {
  const slots = [];
  const byGroup = {};
  kinds.forEach((k, i) => {
    if (!k) return;
    slots.push(i);
    (byGroup[group(k)] ||= []).push(k);
  });
  const pairs = [];
  for (const list of Object.values(byGroup)) for (let i = 0; i + 1 < list.length; i += 2) pairs.push([list[i], list[i + 1]]);
  const placed = place(pos, slots, shuffled(pairs, rng), rng);
  if (!placed) return kinds.slice();
  return kinds.map((k, i) => (k ? placed[i] : null));
}
