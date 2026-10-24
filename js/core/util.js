// Мелкие общие помощники.

export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const pick = (arr, rng = Math.random) => arr[Math.floor(rng() * arr.length)];

export const uid = () => Math.random().toString(36).slice(2, 10);

export const cleanName = (s) =>
  String(s || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 16);

function storage(kind) {
  return {
    get(k, d = null) {
      try {
        const v = globalThis[kind]?.getItem(k);
        return v == null ? d : v;
      } catch {
        return d;
      }
    },
    set(k, v) {
      try {
        globalThis[kind]?.setItem(k, v);
      } catch {}
    },
    json(k, d) {
      try {
        const v = globalThis[kind]?.getItem(k);
        return v ? JSON.parse(v) : d;
      } catch {
        return d;
      }
    },
    setJson(k, v) {
      try {
        globalThis[kind]?.setItem(k, JSON.stringify(v));
      } catch {}
    },
  };
}

export const store = storage('localStorage');
export const session = storage('sessionStorage');

// Таймеры, которые можно разом отменить (игра закончилась — всё стоп).
export class Timers {
  constructor() {
    this.set = new Set();
  }
  later(fn, ms) {
    const id = setTimeout(() => {
      this.set.delete(id);
      fn();
    }, ms);
    this.set.add(id);
    return id;
  }
  cancel(id) {
    if (id == null) return;
    clearTimeout(id);
    this.set.delete(id);
  }
  clear() {
    for (const id of this.set) clearTimeout(id);
    this.set.clear();
  }
}

// Расстояние Левенштейна — для «почти угадал» в Крокодиле.
export function lev(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}
