import { esc } from '../../core/util.js';
import { sfx } from '../../core/sfx.js';
import { avatar, modal, toast, confirmBox } from '../../ui/common.js';
import { getLang } from '../../core/i18n.js';
import { hexCenter, neighbors, findPath, TERRAINS, MOVE_DAYS } from './world.js';
import { UNITS, UNIT_TYPES, TECHS, MAX_TECH, MAX_DEV, MAX_FORT, MARKET_COST, VASSAL_INTEGRATE_DAYS, techCost, techDays, devCost, fortCost } from './sim.js';
import { SPEED_MS } from './engine.js';

// Карта «Империй» на canvas: подложка (страны, рельеф, реки, границы, крепости)
// рисуется в отдельный холст и обновляется при изменениях; названия стран,
// армии и пути — поверх, каждый кадр, с плавным движением между днями.
// Один палец — двигать карту, два — масштаб; тап — выбрать армию или провинцию.

const SQ3 = Math.sqrt(3);
const TERRAIN_COLOR = ['#1f4e79', '#a9c97c', '#5f9150', '#b9a173', '#9a9a9a', '#e3cd86', '#dfe8ec'];
const SEA = '#1f4e79';
const REG = 1000;
const MODES = ['political', 'diplomacy', 'economy', 'terrain'];
const REL_COLOR = { self: '#ffd23f', ally: '#51cf66', vassal: '#94d82d', overlord: '#74c0fc', war: '#ff6b6b', truce: '#91a7ff', peace: '#9aa3ad' };
const UNIT_ICON = { inf: '🪖', cav: '🐎', art: '💣' };
const TECH_ICON = { eco: '💰', mil: '⚔️', log: '🚚', eng: '🏗️' };
const EVENT_ICON = { gold: '⛏️', plague: '🦠', harvest: '🌾', reform: '🎖️', scholar: '🎓', riots: '🔥', volunteers: '🙋', merchants: '🐪', flood: '🌊', festival: '🎉', deserters: '🏃', discovery: '💡' };

const fmt = (n) => (n >= 1000 ? (n / 1000).toFixed(n < 10000 ? 1 : 0).replace(/\.0$/, '') + 'k' : String(Math.round(n)));

export function mount(root, api) {
  const { t } = api;
  root.innerHTML = `
    <div class="em">
      <div class="em-hud"></div>
      <div class="em-map">
        <canvas class="em-cv"></canvas>
        <div class="em-ticker"></div>
        <div class="em-zoom">
          <button class="icon-btn" data-a="zin" aria-label="+">＋</button>
          <button class="icon-btn" data-a="zout" aria-label="−">－</button>
          <button class="icon-btn" data-a="home" aria-label="◎">◎</button>
          <button class="icon-btn em-modebtn" data-a="mode">🗺️</button>
        </div>
        <div class="em-legend"></div>
      </div>
      <div class="em-sheet"></div>
      <div class="em-bar"></div>
    </div>`;
  const $ = (s) => root.querySelector(s);
  const mapEl = $('.em-map');
  const cv = $('.em-cv');
  const g = cv.getContext('2d');
  const base = document.createElement('canvas');

  let W = 0;
  let H = 0;
  let N = 0;
  let terrain = [];
  let river = [];
  let rivers = [];
  let countries = [];
  let centers = [];
  let edges = [];
  let nb = [];
  let worldW = 0;
  let worldH = 0;
  let owner = [];
  let dev = [];
  let flags = [];
  let core = [];
  let pop = [];
  let armies = [];
  let tickAt = 0;
  let cs = [];
  let sieges = [];
  let dip = { wars: [], allies: [], truces: [], vassals: [], offers: [] };
  let picks = {};
  let phase = 'pick';
  let day = 0;
  let left = null;
  let leftAt = 0;
  let speed = 2;
  let goal = 0.5;
  let result = null;
  let mode = 'political';
  let panel = null; // 'recruit' | 'tech' | null — открытая вкладка снизу
  let selArmy = null;
  let selPath = null;
  let selHex = -1;
  let baseDirty = true;
  let baseScale = 0;
  let labels = [];
  let labelsDirty = true;
  let raf = 0;
  let shownChart = false;
  const cam = { s: 10, x: 0, y: 0, fit: 10 };
  const seenOffers = new Set();
  const seenEvents = new Set();
  const eventQueue = [];
  const ticker = [];
  const journal = [];

  // Панели перерисовываются каждый день. Пока палец на кнопке — ждём, иначе
  // кнопка подменится под пальцем и нажатие потеряется.
  let busy = false;
  const deferred = new Map();
  function setHtml(sel, html) {
    const el = $(sel);
    if (busy) return deferred.set(sel, html);
    if (el._html === html) return;
    el._html = html;
    el.innerHTML = html;
  }
  for (const sel of ['.em-hud', '.em-sheet', '.em-bar']) {
    const el = $(sel);
    el.addEventListener('pointerdown', () => (busy = true));
    const release = () =>
      setTimeout(() => {
        busy = false;
        for (const [k, html] of deferred) setHtml(k, html);
        deferred.clear();
      }, 60);
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
  }

  const myC = () => (picks[api.me] != null ? picks[api.me] : null);
  const alive = (c) => cs[c]?.[4] === 1;
  const cname = (c) => (c >= 0 && countries[c] ? esc(countries[c].name) : '—');
  const pairKey = (a, b) => `${Math.min(a, b)}-${Math.max(a, b)}`;
  const overlordOf = (c) => (cs[c] ? cs[c][10] : -1);
  const isWar = (a, b) => dip.wars.some(([x, y]) => pairKey(x, y) === pairKey(a, b));
  const isAlly = (a, b) => dip.allies.some(([x, y]) => pairKey(x, y) === pairKey(a, b));
  const isHost = () => api.isHost;
  function friendly(a, b) {
    if (a === b) return true;
    if (a < 0 || b < 0) return false;
    if (isAlly(a, b)) return true;
    const oa = overlordOf(a);
    const ob = overlordOf(b);
    return oa === b || ob === a || (oa >= 0 && oa === ob);
  }
  function relation(a, b) {
    if (a == null || b == null || b < 0) return 'peace';
    if (a === b) return 'self';
    if (isWar(a, b)) return 'war';
    if (overlordOf(b) === a) return 'vassal';
    if (overlordOf(a) === b) return 'overlord';
    if (isAlly(a, b)) return 'ally';
    if (dip.truces.some(([x, y]) => pairKey(x, y) === pairKey(a, b))) return 'truce';
    return 'peace';
  }
  const seatOf = (c) => Object.entries(picks).find(([, v]) => v === c)?.[0];
  const moveCost = (h) => MOVE_DAYS[terrain[h]] + (river[h] ? 1 : 0);
  const canEnter = (c, h) => terrain[h] && (friendly(c, owner[h]) || isWar(c, owner[h]));
  const unitsOf = (a) => ({ inf: a[3] * 100, cav: a[4] * 100, art: a[5] * 100 });
  const armySize = (a) => (a[3] + a[4] + a[5]) * 100;

  /* ---------- геометрия ---------- */

  function setupWorld(d) {
    W = d.w;
    H = d.h;
    N = W * H;
    terrain = d.terrain.split('').map(Number);
    river = (d.river || '').split('').map(Number);
    rivers = d.rivers || [];
    countries = d.countries;
    centers = Array.from({ length: N }, (_, i) => hexCenter(W, i));
    nb = Array.from({ length: N }, (_, i) => neighbors(W, H, i));
    worldW = SQ3 * (W + 0.5);
    worldH = 1.5 * H + 0.5;
    owner = Array(N).fill(-1);
    dev = Array(N).fill(0);
    flags = Array(N).fill(0);
    core = Array(N).fill(-1);
    pop = Array(N).fill(0);
    // Для каждой грани шестиугольника — сосед за ней (или -1).
    edges = centers.map(([cx, cy], i) => {
      const e = [-1, -1, -1, -1, -1, -1];
      for (const j of nb[i]) {
        const [x, y] = centers[j];
        const ang = (Math.atan2(y - cy, x - cx) * 180) / Math.PI;
        e[(((Math.round((ang + 60) / 60) % 6) + 6) % 6)] = j;
      }
      return e;
    });
    baseDirty = true;
    labelsDirty = true;
    fitCamera();
  }

  function corner(cx, cy, k, r = 1) {
    const a = ((-90 + 60 * k) * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  }

  function landBounds(filter = (i) => terrain[i]) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < N; i++) {
      if (!filter(i)) continue;
      const [x, y] = centers[i];
      x0 = Math.min(x0, x - 1);
      y0 = Math.min(y0, y - 1);
      x1 = Math.max(x1, x + 1);
      y1 = Math.max(y1, y + 1);
    }
    return x0 === Infinity ? [0, 0, worldW, worldH] : [x0, y0, x1, y1];
  }

  function fitCamera(filter) {
    const rect = mapEl.getBoundingClientRect();
    if (!rect.width || !W) return;
    let [x0, y0, x1, y1] = landBounds(filter);
    // Вокруг своей страны оставляем видимыми соседей.
    if (filter) [x0, y0, x1, y1] = [x0 - 4, y0 - 3, x1 + 4, y1 + 3];
    const s = Math.min(rect.width / (x1 - x0), rect.height / (y1 - y0)) * 0.96;
    if (!filter) cam.fit = s;
    cam.s = filter ? Math.min(Math.max(s, cam.fit * 1.5), cam.fit * 3.5) : s;
    cam.x = rect.width / 2 - ((x0 + x1) / 2) * cam.s;
    cam.y = rect.height / 2 - ((y0 + y1) / 2) * cam.s;
  }

  let fitted = false;
  function resize() {
    const rect = mapEl.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(rect.width * dpr);
    cv.height = Math.round(rect.height * dpr);
    cv.style.width = rect.width + 'px';
    cv.style.height = rect.height + 'px';
    if (!fitted && W && rect.width > 0) {
      fitCamera();
      fitted = true;
    }
  }

  /* ---------- подложка ---------- */

  // Разрешение подложки — под текущий масштаб, но не больше 4096 точек в ширину.
  const baseRes = () => Math.min(Math.max(cam.s * Math.min(window.devicePixelRatio || 1, 2), 12), 4096 / worldW, 60);

  function fillColor(i) {
    const me = myC();
    if (mode === 'terrain' || owner[i] < 0) return null;
    if (mode === 'political') return countries[owner[i]].color;
    if (mode === 'diplomacy') return me == null ? countries[owner[i]].color : REL_COLOR[relation(me, owner[i])];
    const d = dev[i];
    return `hsl(${10 + d * 13} 70% ${28 + d * 5}%)`;
  }

  function renderBase() {
    const res = baseRes();
    baseScale = res;
    base.width = Math.ceil(worldW * res);
    base.height = Math.ceil(worldH * res);
    const b = base.getContext('2d');
    b.setTransform(res, 0, 0, res, 0, 0);
    b.fillStyle = SEA;
    b.fillRect(0, 0, worldW, worldH);
    const hexPath = (i, r = 1.02) => {
      const [cx, cy] = centers[i];
      b.beginPath();
      for (let k = 0; k < 6; k++) {
        const [x, y] = corner(cx, cy, k, r);
        k ? b.lineTo(x, y) : b.moveTo(x, y);
      }
      b.closePath();
    };
    const me = myC();
    for (let i = 0; i < N; i++) {
      if (!terrain[i]) continue;
      hexPath(i);
      b.fillStyle = TERRAIN_COLOR[terrain[i]];
      b.fill();
      const col = fillColor(i);
      if (col) {
        b.globalAlpha = mode === 'economy' ? 0.9 : 0.78;
        b.fillStyle = col;
        b.fill();
        b.globalAlpha = 1;
      }
      // Завоёванные, но ещё не свои земли — в косую полоску цвета родной страны.
      if ((mode === 'political' || mode === 'diplomacy') && owner[i] >= 0 && !(flags[i] & 8) && core[i] >= 0) {
        b.save();
        hexPath(i, 0.98);
        b.clip();
        b.strokeStyle = countries[core[i]].color;
        b.globalAlpha = 0.75;
        b.lineWidth = 0.16;
        const [cx, cy] = centers[i];
        for (let k = -2; k <= 2; k++) {
          b.beginPath();
          b.moveTo(cx - 1.2 + k * 0.5, cy + 1.2);
          b.lineTo(cx + 1.2 + k * 0.5, cy - 1.2);
          b.stroke();
        }
        b.restore();
      }
    }
    // Рельеф: горы — треугольники, холмы — дуги, лес — кружки.
    b.lineWidth = 0.07;
    for (let i = 0; i < N; i++) {
      const tt = terrain[i];
      if (!tt) continue;
      const [cx, cy] = centers[i];
      b.strokeStyle = 'rgba(0,0,0,0.35)';
      b.fillStyle = 'rgba(0,0,0,0.22)';
      if (tt === 4) {
        b.beginPath();
        b.moveTo(cx - 0.45, cy + 0.3);
        b.lineTo(cx - 0.1, cy - 0.35);
        b.lineTo(cx + 0.2, cy + 0.3);
        b.moveTo(cx, cy + 0.3);
        b.lineTo(cx + 0.25, cy - 0.12);
        b.lineTo(cx + 0.5, cy + 0.3);
        b.stroke();
      } else if (tt === 3) {
        b.beginPath();
        b.arc(cx - 0.18, cy + 0.2, 0.28, Math.PI, 0);
        b.arc(cx + 0.25, cy + 0.25, 0.22, Math.PI, 0);
        b.stroke();
      } else if (tt === 2) {
        for (const [dx, dy] of [[-0.3, 0.1], [0.05, -0.2], [0.3, 0.15]]) {
          b.beginPath();
          b.arc(cx + dx, cy + dy, 0.15, 0, Math.PI * 2);
          b.fill();
        }
      } else if (tt === 5) {
        for (const [dx, dy] of [[-0.3, 0.2], [0.2, -0.15], [0.35, 0.3], [-0.05, -0.3]]) b.fillRect(cx + dx, cy + dy, 0.07, 0.07);
      } else if (tt === 6) {
        b.strokeStyle = 'rgba(255,255,255,0.6)';
        b.beginPath();
        b.moveTo(cx - 0.3, cy);
        b.lineTo(cx + 0.3, cy);
        b.stroke();
      }
    }
    // Реки — от истока к устью.
    b.strokeStyle = '#3b8ed8';
    b.lineCap = 'round';
    b.lineJoin = 'round';
    for (const r of rivers) {
      b.beginPath();
      r.path.forEach((h, k) => {
        const [x, y] = centers[h];
        k ? b.lineTo(x, y) : b.moveTo(x, y);
      });
      if (r.mouth >= 0) {
        const [x0, y0] = centers[r.path.at(-1)];
        const [x1, y1] = centers[r.mouth];
        b.lineTo((x0 + x1) / 2, (y0 + y1) / 2);
      }
      b.lineWidth = 0.2;
      b.stroke();
    }
    // Побережье и границы стран.
    for (let i = 0; i < N; i++) {
      if (!terrain[i]) continue;
      const [cx, cy] = centers[i];
      for (let k = 0; k < 6; k++) {
        const j = edges[i][k];
        const coast = j < 0 || !terrain[j];
        const border = !coast && owner[j] !== owner[i];
        if (!coast && (!border || j < i)) continue;
        const [x1, y1] = corner(cx, cy, k);
        const [x2, y2] = corner(cx, cy, (k + 1) % 6);
        b.beginPath();
        b.moveTo(x1, y1);
        b.lineTo(x2, y2);
        if (coast) {
          b.strokeStyle = 'rgba(10,30,60,0.75)';
          b.lineWidth = 0.12;
        } else {
          const mine = me != null && (owner[i] === me || owner[j] === me);
          b.strokeStyle = mine ? '#ffffff' : 'rgba(20,20,30,0.75)';
          b.lineWidth = mine ? 0.16 : 0.11;
        }
        b.stroke();
      }
    }
    // Крепости и рынки.
    for (let i = 0; i < N; i++) {
      if (!terrain[i]) continue;
      const [cx, cy] = centers[i];
      const fort = (flags[i] >> 1) & 3;
      if (fort) {
        b.fillStyle = 'rgba(40,40,40,0.85)';
        b.fillRect(cx - 0.62, cy + 0.18, 0.36, 0.34);
        for (let k = 0; k < fort; k++) b.fillRect(cx - 0.62 + k * 0.13, cy + 0.08, 0.08, 0.1);
      }
      if (flags[i] & 1) {
        b.beginPath();
        b.arc(cx + 0.45, cy + 0.36, 0.15, 0, Math.PI * 2);
        b.fillStyle = '#f5c542';
        b.fill();
        b.strokeStyle = 'rgba(0,0,0,0.6)';
        b.lineWidth = 0.05;
        b.stroke();
      }
    }
    // Столицы.
    for (let c = 0; c < cs.length; c++) {
      if (!alive(c)) continue;
      const [cx, cy] = centers[cs[c][5]];
      star(b, cx, cy, 0.42, '#ffd23f', 'rgba(0,0,0,0.7)', 0.06);
    }
    baseDirty = false;
  }

  function star(ctx, cx, cy, r, fill, stroke, lw) {
    ctx.beginPath();
    for (let k = 0; k < 10; k++) {
      const a = (-90 + k * 36) * (Math.PI / 180);
      const rr = k % 2 ? r * 0.45 : r;
      const x = cx + rr * Math.cos(a);
      const y = cy + rr * Math.sin(a);
      k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.stroke();
  }

  // Названия стран: в провинции, ближайшей к «центру тяжести» территории.
  function computeLabels() {
    const sum = new Map();
    for (let i = 0; i < N; i++) {
      const o = owner[i];
      if (o < 0) continue;
      const s = sum.get(o) || { x: 0, y: 0, n: 0, x0: Infinity, x1: -Infinity };
      s.x += centers[i][0];
      s.y += centers[i][1];
      s.x0 = Math.min(s.x0, centers[i][0]);
      s.x1 = Math.max(s.x1, centers[i][0]);
      s.n++;
      sum.set(o, s);
    }
    labels = [];
    for (const [c, s] of sum) {
      const mx = s.x / s.n;
      const my = s.y / s.n;
      let best = -1;
      let bd = Infinity;
      for (let i = 0; i < N; i++) {
        if (owner[i] !== c) continue;
        const d = (centers[i][0] - mx) ** 2 + (centers[i][1] - my) ** 2;
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      labels.push({ c, x: centers[best][0], y: centers[best][1] + 0.5, n: s.n, w: s.x1 - s.x0 + 1.4 });
    }
    labels.sort((a, b) => b.n - a.n);
    labelsDirty = false;
  }

  /* ---------- кадр ---------- */

  const toScreen = (x, y) => [x * cam.s + cam.x, y * cam.s + cam.y];
  const toWorld = (x, y) => [(x - cam.x) / cam.s, (y - cam.y) / cam.s];

  // Позиция армии с плавным движением между днями.
  function armyPos(a, now = performance.now()) {
    const hex = a[2];
    const next = a[6];
    const [x0, y0] = centers[hex];
    if (next < 0) return [x0, y0];
    let p = a[7] / 100;
    const moving = !(a[8] & 1) || a[8] & 2;
    if (moving && speed && phase === 'play') {
      const days = (now - tickAt) / SPEED_MS[speed];
      p += (days * (a[11] / 100) * (a[8] & 2 ? 1.2 : 1)) / moveCost(next);
    }
    p = Math.max(0, Math.min(0.98, p));
    const [x1, y1] = centers[next];
    return [x0 + (x1 - x0) * p, y0 + (y1 - y0) * p];
  }

  function draw() {
    raf = 0;
    if (!W) return;
    if (baseDirty || Math.abs(baseScale / baseRes() - 1) > 0.35) renderBase();
    if (labelsDirty) computeLabels();
    const now = performance.now();
    const dpr = cv.width / (cv.clientWidth || 1);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = SEA;
    g.fillRect(0, 0, cv.width, cv.height);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.imageSmoothingEnabled = true;
    g.drawImage(base, cam.x, cam.y, worldW * cam.s, worldH * cam.s);
    const s = cam.s;
    // Названия стран: по ширине территории, не крупнее 26 px и без наложений.
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    const taken = [];
    for (const l of labels) {
      if (!alive(l.c) || (l.n < 3 && s < cam.fit * 1.8)) continue;
      const text = countries[l.c].name.toUpperCase();
      g.font = '900 10px system-ui, sans-serif';
      const w10 = g.measureText(text).width || 1;
      const px = Math.min(26, Math.sqrt(l.n) * 0.5 * s, ((l.w * s * 0.95) / w10) * 10);
      if (px < 8) continue;
      const [x, y] = toScreen(l.x, l.y);
      const hw = (w10 * px) / 20;
      const box = [x - hw, y - px / 2, x + hw, y + px / 2];
      if (taken.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
      taken.push(box);
      g.font = `900 ${Math.round(px)}px system-ui, sans-serif`;
      g.lineWidth = Math.max(2, px / 5);
      g.strokeStyle = 'rgba(0,0,0,0.5)';
      g.fillStyle = 'rgba(255,255,255,0.88)';
      g.strokeText(text, x, y);
      g.fillText(text, x, y);
    }
    // Выбранная провинция.
    if (selHex >= 0) {
      const [cx, cy] = toScreen(...centers[selHex]);
      g.beginPath();
      for (let k = 0; k < 6; k++) {
        const [x, y] = corner(cx, cy, k, s);
        k ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.closePath();
      g.strokeStyle = '#ffd23f';
      g.lineWidth = 3;
      g.stroke();
    }
    // Осады.
    for (const [hex, c, pct] of sieges) {
      const [cx, cy] = toScreen(...centers[hex]);
      g.beginPath();
      g.arc(cx, cy, s * 0.8, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * Math.min(100, pct)) / 100);
      g.strokeStyle = countries[c]?.color || '#fff';
      g.lineWidth = Math.max(2, s * 0.14);
      g.stroke();
    }
    // Путь выбранной армии.
    const sel = armies.find((a) => a[0] === selArmy);
    if (sel && selPath?.length) {
      g.setLineDash([6, 5]);
      g.beginPath();
      g.moveTo(...toScreen(...armyPos(sel, now)));
      for (const h of selPath) g.lineTo(...toScreen(...centers[h]));
      g.strokeStyle = '#ffd23f';
      g.lineWidth = 2.5;
      g.stroke();
      g.setLineDash([]);
      const [dx, dy] = toScreen(...centers[selPath.at(-1)]);
      g.beginPath();
      g.arc(dx, dy, 5, 0, Math.PI * 2);
      g.fillStyle = '#ffd23f';
      g.fill();
    }
    // Армии: кружок с числом и полоской боевого духа. Несколько на клетке — веером.
    const byHex = new Map();
    for (const a of armies) (byHex.get(a[2]) || byHex.set(a[2], []).get(a[2])).push(a);
    const me = myC();
    const r = Math.max(9, Math.min(22, s * 0.55));
    for (const list of byHex.values()) {
      list.forEach((a, k) => {
        let [x, y] = toScreen(...armyPos(a, now));
        if (list.length > 1) {
          const ang = (k / list.length) * Math.PI * 2;
          x += Math.cos(ang) * r * 0.9;
          y += Math.sin(ang) * r * 0.9;
        }
        const isSel = a[0] === selArmy;
        const fighting = a[8] & 1;
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fillStyle = countries[a[1]]?.color || '#888';
        g.fill();
        g.lineWidth = isSel ? 4 : a[1] === me ? 2.5 : 1.5;
        g.strokeStyle = isSel ? '#ffd23f' : a[1] === me ? '#fff' : 'rgba(0,0,0,0.75)';
        g.stroke();
        g.font = `800 ${Math.round(r * 0.85)}px system-ui, sans-serif`;
        g.fillStyle = '#fff';
        g.strokeStyle = 'rgba(0,0,0,0.8)';
        g.lineWidth = 3;
        const label = fmt(armySize(a));
        g.strokeText(label, x, y + 1);
        g.fillText(label, x, y + 1);
        // Полоска боевого духа.
        const m = a[10] / 100;
        g.fillStyle = 'rgba(0,0,0,0.6)';
        g.fillRect(x - r, y + r + 2, r * 2, 4);
        g.fillStyle = m > 0.6 ? '#51cf66' : m > 0.3 ? '#fcc419' : '#ff6b6b';
        g.fillRect(x - r, y + r + 2, r * 2 * m, 4);
        if (fighting) {
          g.font = `${Math.round(r)}px system-ui, sans-serif`;
          g.fillText('⚔️', x + r * 0.9, y - r * 0.9);
        }
        if (a[8] & 2) {
          g.font = `${Math.round(r * 0.8)}px system-ui, sans-serif`;
          g.fillText('🏳️', x - r * 0.9, y - r * 0.9);
        }
      });
    }
    // Флажки игроков на столицах.
    for (const [sid, c] of Object.entries(picks)) {
      if (!alive(c) && phase !== 'pick') continue;
      const seat = api.seat(sid);
      const [x, y] = toScreen(...centers[cs[c]?.[5] ?? 0]);
      g.font = `${Math.round(Math.max(14, s * 0.8))}px system-ui, sans-serif`;
      g.fillText(seat?.avatar || '🙂', x, y - Math.max(16, s * 0.9));
    }
    if (animating()) raf = requestAnimationFrame(draw);
  }

  const animating = () => phase === 'play' && speed > 0 && armies.some((a) => a[6] >= 0) && document.visibilityState !== 'hidden';

  function redraw() {
    if (!raf) raf = requestAnimationFrame(draw);
  }

  /* ---------- жесты ---------- */

  const pointers = new Map();
  let tap = null;
  let pinch = null;

  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.size === 1) tap = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
    else {
      tap = null;
      pinch = null;
    }
  });
  cv.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId);
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.size === 1) {
      if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 8) tap.moved = true;
      if (!tap || tap.moved) {
        cam.x += e.clientX - prev[0];
        cam.y += e.clientY - prev[1];
        redraw();
      }
    } else if (pointers.size === 2) {
      const [[ax, ay], [bx, by]] = [...pointers.values()];
      const d = Math.hypot(ax - bx, ay - by);
      const rect = cv.getBoundingClientRect();
      const mx = (ax + bx) / 2 - rect.left;
      const my = (ay + by) / 2 - rect.top;
      if (pinch) {
        zoomAt(mx, my, d / pinch.d);
        cam.x += mx - pinch.mx;
        cam.y += my - pinch.my;
      }
      pinch = { d, mx, my };
      redraw();
    }
  });
  const up = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (tap && !tap.moved && pointers.size === 0 && performance.now() - tap.t < 600) {
      const rect = cv.getBoundingClientRect();
      onTap(e.clientX - rect.left, e.clientY - rect.top);
    }
    if (pointers.size === 0) tap = null;
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  cv.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const rect = cv.getBoundingClientRect();
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.15 : 1 / 1.15);
      redraw();
    },
    { passive: false },
  );

  function zoomAt(mx, my, f) {
    const ns = Math.max(cam.fit * 0.7, Math.min(cam.fit * 7, cam.s * f));
    const k = ns / cam.s;
    cam.x = mx - (mx - cam.x) * k;
    cam.y = my - (my - cam.y) * k;
    cam.s = ns;
  }

  function hexAt(sx, sy) {
    const [wx, wy] = toWorld(sx, sy);
    const r0 = Math.round((wy - 1) / 1.5);
    let best = -1;
    let bd = Infinity;
    for (let r = r0 - 1; r <= r0 + 1; r++) {
      if (r < 0 || r >= H) continue;
      const c0 = Math.round((wx - SQ3 / 2) / SQ3 - 0.5 * (r & 1));
      for (let c = c0 - 1; c <= c0 + 1; c++) {
        if (c < 0 || c >= W) continue;
        const i = r * W + c;
        const [x, y] = centers[i];
        const d = (x - wx) ** 2 + (y - wy) ** 2;
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
    }
    return bd <= 1.1 ? best : -1;
  }

  function armyAtScreen(sx, sy) {
    const r = Math.max(9, Math.min(22, cam.s * 0.55)) + 6;
    let best = null;
    let bd = Infinity;
    for (const a of armies) {
      const [x, y] = toScreen(...armyPos(a));
      const d = Math.hypot(x - sx, y - sy);
      if (d < r && d < bd && a[1] === myC()) {
        bd = d;
        best = a;
      }
    }
    return best;
  }

  function selectArmy(id) {
    selArmy = id;
    selHex = -1;
    panel = null;
    updatePath();
  }

  function updatePath() {
    const a = armies.find((x) => x[0] === selArmy);
    const me = myC();
    if (!a || a[9] < 0 || me == null) {
      selPath = null;
      return;
    }
    const from = a[6] >= 0 ? a[6] : a[2];
    const rest = from === a[9] ? [] : findPath(nb, from, a[9], (h) => canEnter(me, h), moveCost) || [];
    selPath = a[6] >= 0 ? [a[6], ...rest] : rest;
  }

  function onTap(sx, sy) {
    const hex = hexAt(sx, sy);
    if (phase === 'pick') {
      if (hex >= 0 && terrain[hex] && owner[hex] >= 0) {
        selHex = hex;
        sfx.tap();
        renderSheet();
        redraw();
      }
      return;
    }
    if (phase !== 'play') return;
    const a = armyAtScreen(sx, sy);
    if (a && a[0] !== selArmy) {
      selectArmy(a[0]);
      sfx.tap();
    } else if (selArmy != null && hex >= 0 && terrain[hex]) {
      const army = armies.find((x) => x[0] === selArmy);
      if (army && hex !== army[2]) {
        const me = myC();
        const path = findPath(nb, army[2], hex, (h) => canEnter(me, h), moveCost);
        if (path) {
          api.act({ t: 'move', army: selArmy, to: hex });
          sfx.card();
          selPath = path;
        } else {
          toast(t('empires.nope.move'));
          sfx.wrong();
        }
      } else if (army && hex === army[2]) {
        selArmy = null;
        selHex = hex;
      }
    } else {
      selArmy = null;
      selPath = null;
      selHex = hex >= 0 && terrain[hex] ? hex : -1;
      if (selHex >= 0) {
        panel = null;
        sfx.tap();
      }
    }
    renderSheet();
    redraw();
  }

  /* ---------- интерфейс ---------- */

  function date(d = day) {
    const dt = new Date(Date.UTC(1900, 0, 1) + d * 86400000);
    try {
      return dt.toLocaleDateString(getLang(), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    } catch {
      return `${t('empires.day')} ${d}`;
    }
  }

  function clock() {
    if (left == null) return '';
    const run = phase === 'pick' || (phase === 'play' && speed > 0);
    const ms = Math.max(0, left - (run ? performance.now() - leftAt : 0));
    const sec = Math.ceil(ms / 1000);
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  }

  function speedControls() {
    if (phase !== 'play') return '';
    if (!isHost()) return speed ? '' : `<span class="em-paused">⏸ ${t('empires.paused')}</span>`;
    return `<span class="em-speed">${[0, 1, 2, 3]
      .map((v) => `<button class="${speed === v ? 'sel' : ''}" data-a="speed" data-v="${v}" aria-label="${v ? v + '×' : t('empires.pause')}">${v ? '▶'.repeat(v) : '⏸'}</button>`)
      .join('')}</span>`;
  }

  function renderHud() {
    const me = myC();
    if (phase === 'pick') {
      return setHtml('.em-hud', `<div class="em-pick">🗺️ <b>${t('empires.pickTitle')}</b> <span class="em-clock"></span></div>`);
    }
    const tail = `<div class="em-stat em-date">📅 ${date()} ${speedControls()} <span class="em-clock"></span></div>`;
    if (me == null || !cs[me]) return setHtml('.em-hud', tail);
    const [gold, income, troops, , al, , mp, mpMax, exh, , over, , research] = cs[me];
    const res = research ? `<span class="em-res" title="${t('empires.tech.' + research[0])}">${TECH_ICON[research[0]]}<i style="--p:${Math.round((1 - research[1] / research[2]) * 100)}%"></i></span>` : '';
    setHtml('.em-hud', `<div class="em-me"><i class="em-flag" style="background:${countries[me].color}"></i><b>${cname(me)}</b>${al ? '' : ' 💀'}${over >= 0 ? ` <small class="muted">(${t('empires.vassalOf', { name: cname(over) })})</small>` : ''}</div>
      <div class="em-stat"><span>💰 <b>${gold}</b> <small>${income >= 0 ? '+' : ''}${income}/${t('empires.mo')}</small></span><span>👥 <b>${fmt(mp)}</b><small>/${fmt(mpMax)}</small></span><span>🪖 <b>${fmt(troops)}</b></span>${exh > 0 ? `<span class="${exh > 40 ? 'bad' : ''}">😩 ${exh}%</span>` : ''}${res}</div>
      ${tail}`);
  }

  function relBadge(rel) {
    return `<span class="em-rel ${rel}">${t('empires.rel.' + rel)}</span>`;
  }

  function moraleBar(m) {
    return `<span class="em-morale"><i style="width:${m}%;background:${m > 60 ? '#51cf66' : m > 30 ? '#fcc419' : '#ff6b6b'}"></i></span>`;
  }

  function sheetArmy(a) {
    const u = unitsOf(a);
    const st = a[8] & 2 ? '🏳️ ' + t('empires.retreating') : a[8] & 1 ? '⚔️ ' + t('empires.fighting') : a[9] >= 0 ? t('empires.marching') : t('empires.standing');
    const mates = armies.filter((x) => x[0] !== a[0] && x[1] === a[1] && x[2] === a[2]).length;
    return `<div class="em-row"><b>🪖 ${t('empires.army')} · ${armySize(a).toLocaleString(getLang())}</b><span class="muted">${st}</span></div>
      <div class="em-units">${UNIT_TYPES.map((k) => `<span>${UNIT_ICON[k]} ${fmt(u[k])}</span>`).join('')}<span>${t('empires.morale')} ${moraleBar(a[10])} ${a[10]}%</span><span>🚚 ×${(a[11] / 100).toFixed(1)}</span></div>
      <p class="muted small">${t('empires.moveHint')}</p>
      <div class="em-btns">
        <button class="btn small" data-a="split" ${armySize(a) >= 2 * REG && !(a[8] & 1) ? '' : 'disabled'}>✂️ ${t('empires.split')}</button>
        ${mates ? `<button class="btn small" data-a="merge">🔗 ${t('empires.merge')}</button>` : ''}
        ${a[9] >= 0 ? `<button class="btn small" data-a="stop">✋ ${t('empires.stop')}</button>` : ''}
        <button class="btn small" data-a="armies">📋 ${t('empires.myArmies')}</button>
        <button class="btn small" data-a="unsel">✖</button>
      </div>`;
  }

  function sheetRecruit() {
    const me = myC();
    const [gold, , , , , cap, mp] = cs[me];
    const here = selHex >= 0 && owner[selHex] === me ? selHex : cap;
    const where = here === cap ? t('empires.atCapital') : t('empires.atProvince');
    return `<div class="em-row"><b>🪖 ${t('empires.recruit')}</b><span class="muted">📍 ${where} · 👥 ${fmt(mp)}</span></div>
      <div class="em-recruit">${UNIT_TYPES.map((k) => {
        const u = UNITS[k];
        const ok = gold >= u.cost && mp >= REG;
        return `<button class="em-unit" data-a="recruit" data-unit="${k}" data-hex="${here}" ${ok ? '' : 'disabled'}>
          <b>${UNIT_ICON[k]} ${t('empires.unit.' + k)}</b><small>${t('empires.unitDesc.' + k)}</small><span>${u.cost}💰 · 1k 👥</span></button>`;
      }).join('')}</div>
      <div class="em-btns"><button class="btn small" data-a="armies">📋 ${t('empires.myArmies')}</button><button class="btn small" data-a="close">✖</button></div>`;
  }

  function sheetTech() {
    const me = myC();
    const [gold, , , , , , , , , , , techStr, research] = cs[me];
    const lv = Object.fromEntries(TECHS.map((k, i) => [k, Number(techStr[i])]));
    return `<div class="em-row"><b>🔬 ${t('empires.science')}</b><span class="muted small">${t('empires.scienceHint')}</span></div>
      <div class="em-techs">${TECHS.map((k) => {
        const l = lv[k];
        const dots = Array.from({ length: MAX_TECH }, (_, i) => `<i class="${i < l ? 'on' : ''}"></i>`).join('');
        let act;
        if (research && research[0] === k) act = `<span class="em-prog"><i style="width:${Math.round((1 - research[1] / research[2]) * 100)}%"></i></span><small>${t('empires.daysLeft', { n: research[1] })}</small>`;
        else if (l >= MAX_TECH) act = `<small>✓ ${t('empires.maxed')}</small>`;
        else {
          const cost = techCost(l + 1);
          act = `<button class="btn small" data-a="research" data-tech="${k}" ${research || gold < cost ? 'disabled' : ''}>${cost}💰 · ${techDays(l + 1)} ${t('empires.days')}</button>`;
        }
        return `<div class="em-tech"><b>${TECH_ICON[k]} ${t('empires.tech.' + k)}</b><span class="em-dots">${dots}</span><small class="muted">${t('empires.techDesc.' + k)}</small>${act}</div>`;
      }).join('')}</div>
      <div class="em-btns"><button class="btn small" data-a="close">✖</button></div>`;
  }

  function sheetOwnProvince(h) {
    const me = myC();
    const gold = cs[me][0];
    const fort = (flags[h] >> 1) & 3;
    const unrest = (flags[h] >> 4) & 3;
    const isCore = flags[h] & 8;
    const status = isCore ? `<span class="em-tag good">${t('empires.core')}</span>` : `<span class="em-tag warn">${t('empires.conquered', { name: cname(core[h]) })}</span>`;
    const btns = [];
    if (dev[h] < MAX_DEV) btns.push(`<button class="btn small" data-a="build" data-kind="dev" ${gold >= devCost(dev[h]) ? '' : 'disabled'}>📈 ${t('empires.invest')} · ${devCost(dev[h])}💰</button>`);
    if (!(flags[h] & 1)) btns.push(`<button class="btn small" data-a="build" data-kind="market" ${gold >= MARKET_COST ? '' : 'disabled'}>🏪 ${t('empires.market')} · ${MARKET_COST}💰</button>`);
    if (fort < MAX_FORT) btns.push(`<button class="btn small" data-a="build" data-kind="fort" ${gold >= fortCost(fort) ? '' : 'disabled'}>🏰 ${t('empires.fort')} ${fort + 1} · ${fortCost(fort)}💰</button>`);
    btns.push(`<button class="btn small primary" data-a="recruitHere">🪖 ${t('empires.recruitHere')}</button>`);
    return `<div class="em-row"><i class="em-flag" style="background:${countries[me].color}"></i><b>${cname(me)}</b>${status}${unrest ? `<span class="em-tag ${unrest >= 2 ? 'bad' : 'warn'}">🔥 ${t('empires.unrest.' + unrest)}</span>` : ''}</div>
      <div class="em-units"><span>${t('empires.terrain.' + TERRAINS[terrain[h]])}${river[h] ? ' · 🌊' : ''}</span><span>⭐ ${dev[h]}</span><span>👥 ${fmt(pop[h] * 1000)}</span><span>🏰 ${fort}</span>${flags[h] & 1 ? '<span>🏪</span>' : ''}</div>
      <div class="em-btns">${btns.join('')}</div>`;
  }

  function sheetForeign(c, h) {
    const me = myC();
    const st = cs[c] || [];
    const seat = seatOf(c);
    const head = `<div class="em-row"><i class="em-flag" style="background:${countries[c].color}"></i><b>${cname(c)}</b>${seat ? avatar(api.seat(seat), 20) : ''}
      <span class="muted">🏳️ ${st[3] ?? 0} · 🪖 ${fmt(st[2] || 0)}</span>${(st[9] || 0) > 22 ? `<span class="em-tag bad">⚠️ ${t('empires.threat')}</span>` : ''}</div>`;
    const info = [];
    if (h != null) info.push(`${t('empires.terrain.' + TERRAINS[terrain[h]])}${river[h] ? ' · 🌊' : ''} · ⭐ ${dev[h]} · 🏰 ${(flags[h] >> 1) & 3}`);
    if (st[10] >= 0) info.push(t('empires.vassalOf', { name: cname(st[10]) }));
    if (st[13] >= 0) info.push(t('empires.inCoalition', { name: cname(st[13]) }));
    const siege = h != null ? sieges.find((x) => x[0] === h) : null;
    if (siege) info.push(`🔥 ${t('empires.siege')} ${siege[2]}%`);
    const btns = [];
    if (me != null && alive(me) && alive(c)) {
      const rel = relation(me, c);
      btns.push(relBadge(rel));
      const iAmVassal = overlordOf(me) >= 0;
      if (rel === 'war') {
        btns.push(`<button class="btn small" data-a="peace" data-c="${c}">🕊️ ${t('empires.offerPeace')}</button>`);
        btns.push(`<button class="btn small" data-a="tribute" data-c="${c}">💰 ${t('empires.demandTribute')}</button>`);
        if (!iAmVassal && overlordOf(c) < 0 && !dip.vassals.some(([o]) => o === c)) btns.push(`<button class="btn small" data-a="vassal" data-c="${c}">👑 ${t('empires.demandVassal')}</button>`);
      }
      if (rel === 'peace' && !iAmVassal) {
        btns.push(`<button class="btn small danger" data-a="war" data-c="${c}">⚔️ ${t('empires.declare')}</button>`);
        if (overlordOf(c) < 0) btns.push(`<button class="btn small" data-a="ally" data-c="${c}">🤝 ${t('empires.offerAlly')}</button>`);
      }
      if (rel === 'truce') {
        const tr = dip.truces.find(([x, y]) => pairKey(x, y) === pairKey(me, c));
        btns.push(`<span class="muted small">${t('empires.truceLeft', { n: Math.max(0, tr[2] - day) })}</span>`);
        if (!iAmVassal && overlordOf(c) < 0) btns.push(`<button class="btn small" data-a="ally" data-c="${c}">🤝 ${t('empires.offerAlly')}</button>`);
      }
      if (rel === 'ally') btns.push(`<button class="btn small" data-a="unally" data-c="${c}">💔 ${t('empires.breakAlly')}</button>`);
      if (rel === 'vassal') {
        const since = dip.vassals.find(([o, v]) => o === me && v === c)?.[2] ?? day;
        const ready = day - since >= VASSAL_INTEGRATE_DAYS;
        const cost = 20 * (st[3] || 0);
        btns.push(`<button class="btn small" data-a="integrate" data-c="${c}" ${ready && cs[me][0] >= cost ? '' : 'disabled'}>🧩 ${t('empires.integrate')} · ${cost}💰${ready ? '' : ` · ${t('empires.daysLeft', { n: VASSAL_INTEGRATE_DAYS - (day - since) })}`}</button>`);
        btns.push(`<button class="btn small" data-a="release" data-c="${c}">🕊️ ${t('empires.release')}</button>`);
      }
      if (rel === 'overlord') btns.push(`<button class="btn small danger" data-a="war" data-c="${c}">✊ ${t('empires.independence')}</button>`);
    }
    return head + (info.length ? `<p class="small muted">${info.join(' · ')}</p>` : '') + `<div class="em-btns">${btns.join('')}</div>`;
  }

  function renderSheet() {
    setHtml('.em-sheet', sheetHtml());
    tickClock();
  }

  function sheetHtml() {
    const me = myC();
    if (phase === 'pick') {
      if (selHex < 0) return `<p class="muted small">${t('empires.pickHint')}</p>`;
      const c = owner[selHex];
      const taken = seatOf(c);
      const [, , troops, prov] = cs[c] || [];
      return `<div class="em-row"><i class="em-flag" style="background:${countries[c].color}"></i><b>${cname(c)}</b>
          <span class="muted">🏳️ ${prov} · 🪖 ${fmt(troops || 0)}</span></div>
        ${taken ? `<p>${avatar(api.seat(taken), 22)} ${esc(api.seat(taken)?.name || '')}</p>` : `<button class="btn primary" data-a="pick" data-c="${c}">${t('empires.playAs', { name: cname(c) })}</button>`}`;
    }
    const playing = me != null && alive(me) && phase === 'play';
    if (playing && panel === 'recruit') return sheetRecruit();
    if (playing && panel === 'tech') return sheetTech();
    if (selArmy != null) {
      const a = armies.find((x) => x[0] === selArmy);
      if (a) return sheetArmy(a);
      selArmy = null;
    }
    if (selHex < 0) {
      const wars = me != null ? dip.wars.filter(([a, b]) => a === me || b === me).map(([a, b]) => (a === me ? b : a)) : [];
      return playing ? `<p class="muted small">${wars.length ? `⚔️ ${t('empires.atWarWith')}: ${wars.map(cname).join(', ')}` : t('empires.hint')}</p>` : '';
    }
    const c = owner[selHex];
    if (playing && c === me) return sheetOwnProvince(selHex);
    return c >= 0 ? sheetForeign(c, selHex) : '';
  }

  function renderBar() {
    if (phase === 'pick') return setHtml('.em-bar', `<button class="btn" data-a="list">📜 ${t('empires.countries')}</button>`);
    const me = myC();
    const playing = me != null && alive(me) && phase === 'play';
    const offers = dip.offers.filter(([, , , to]) => to === me).length;
    setHtml('.em-bar', `${playing ? `<button class="btn ${panel === 'recruit' ? 'primary' : ''}" data-a="tab" data-tab="recruit">🪖<small>${t('empires.troops')}</small></button>
      <button class="btn ${panel === 'tech' ? 'primary' : ''}" data-a="tab" data-tab="tech">🔬<small>${t('empires.science')}</small></button>` : ''}
      <button class="btn" data-a="list">🤝<small>${t('empires.diplomacy')}</small>${offers ? `<b class="em-badge">${offers}</b>` : ''}</button>
      <button class="btn" data-a="journal">📜<small>${t('empires.journal')}</small></button>
      <button class="btn" data-a="rank">🏆<small>${t('empires.ranking')}</small></button>`);
  }

  function renderLegend() {
    const me = myC();
    let html = '';
    if (mode === 'diplomacy' && me != null) html = ['self', 'ally', 'vassal', 'war', 'truce', 'peace'].map((r) => `<span><i style="background:${REL_COLOR[r]}"></i>${t('empires.rel.' + r)}</span>`).join('');
    if (mode === 'economy') html = `<span><i style="background:hsl(23 70% 33%)"></i>⭐1</span><span><i style="background:hsl(127 70% 68%)"></i>⭐9</span>`;
    $('.em-legend').innerHTML = html;
    $('.em-legend').hidden = !html;
    $('.em-modebtn').setAttribute('aria-label', t('empires.mode.' + mode));
    $('.em-modebtn').textContent = { political: '🗺️', diplomacy: '🤝', economy: '💰', terrain: '⛰️' }[mode];
  }

  function renderUi() {
    renderHud();
    renderSheet();
    renderBar();
    renderLegend();
  }

  function focusCountry(c) {
    const cap = cs[c]?.[5];
    if (cap == null) return;
    fitCamera((i) => owner[i] === c);
    selHex = cap;
    selArmy = null;
    panel = null;
    renderSheet();
    redraw();
  }

  function focusHex(h) {
    const rect = mapEl.getBoundingClientRect();
    const [x, y] = centers[h];
    cam.s = Math.max(cam.s, cam.fit * 2.2);
    cam.x = rect.width / 2 - x * cam.s;
    cam.y = rect.height / 2 - y * cam.s;
  }

  async function showList() {
    const me = myC();
    const rows = countries
      .map((c, i) => ({ i, c, st: cs[i] }))
      .filter((r) => r.st && r.st[4])
      .sort((a, b) => b.st[3] - a.st[3])
      .map((r) => {
        const rel = me != null ? relation(me, r.i) : 'peace';
        const seat = seatOf(r.i);
        const extra = r.st[10] >= 0 ? ` <small class="muted">👑${cname(r.st[10])}</small>` : '';
        return `<button class="em-li" data-id="c:${r.i}"><i class="em-flag" style="background:${r.c.color}"></i><b>${esc(r.c.name)}</b>${extra}${seat ? avatar(api.seat(seat), 18) : ''}
          <span class="muted small">🏳️${r.st[3]} 🪖${fmt(r.st[2])}${r.st[9] > 22 ? ' ⚠️' : ''}</span>${me != null && r.i !== me ? relBadge(rel) : r.i === me ? relBadge('self') : ''}</button>`;
      })
      .join('');
    const myWars = me != null ? dip.wars.filter(([a, b]) => a === me || b === me) : [];
    const head = myWars.length
      ? `<div class="em-wars">${myWars
          .map(([a, b, , sa, sb]) => {
            const foe = a === me ? b : a;
            const mine = a === me ? sa : sb;
            const theirs = a === me ? sb : sa;
            return `<span>⚔️ ${cname(foe)} <b class="${mine >= theirs ? 'good' : 'bad'}">${mine}:${theirs}</b></span>`;
          })
          .join('')}</div>`
      : '';
    const id = await modal({ title: t('empires.countries'), html: `${head}<div class="em-list">${rows}</div>`, buttons: [{ id: 'close', label: t('common.close') }] });
    if (id?.startsWith('c:')) focusCountry(Number(id.slice(2)));
  }

  async function showArmies() {
    const me = myC();
    const mine = armies.filter((a) => a[1] === me).sort((a, b) => armySize(b) - armySize(a));
    if (!mine.length) return toast(t('empires.noArmies'));
    const rows = mine
      .map((a) => {
        const st = a[8] & 1 ? '⚔️' : a[8] & 2 ? '🏳️' : a[9] >= 0 ? '➡️' : '⏺';
        return `<button class="em-li" data-id="a:${a[0]}"><b>${st} ${fmt(armySize(a))}</b><span class="small">${UNIT_TYPES.map((k) => `${UNIT_ICON[k]}${fmt(unitsOf(a)[k])}`).join(' ')}</span><span class="muted small">${a[10]}%</span></button>`;
      })
      .join('');
    const id = await modal({ title: t('empires.myArmies'), html: `<div class="em-list">${rows}</div>`, buttons: [{ id: 'close', label: t('common.close') }] });
    if (id?.startsWith('a:')) {
      const a = armies.find((x) => x[0] === Number(id.slice(2)));
      if (a) {
        focusHex(a[2]);
        selectArmy(a[0]);
        renderSheet();
        redraw();
      }
    }
  }

  async function showRank() {
    const rows = Object.entries(picks)
      .map(([sid, c]) => ({ sid, c, st: cs[c] }))
      .sort((a, b) => (b.st?.[4] || 0) - (a.st?.[4] || 0) || (b.st?.[3] || 0) - (a.st?.[3] || 0))
      .map(
        (r, k) => `<div class="em-li">${k + 1}. ${avatar(api.seat(r.sid), 20)} <b>${esc(api.seat(r.sid)?.name || '')}</b> <i class="em-flag" style="background:${countries[r.c].color}"></i>${cname(r.c)}
          <span class="muted small">${r.st?.[4] ? `🏳️${r.st[3]} 🪖${fmt(r.st[2])} 💰${r.st[0]}` : '💀'}</span></div>`,
      )
      .join('');
    await modal({ title: t('empires.ranking'), html: `<div class="em-list">${rows}</div><p class="muted small">${t('empires.winRule', { n: Math.round(goal * 100) })}</p>`, buttons: [{ id: 'ok', label: t('common.close') }] });
  }

  async function showJournal() {
    const rows = journal
      .slice()
      .reverse()
      .map((j) => `<div class="em-li ${j.mine ? 'mine' : ''}"><small class="muted">${date(j.day)}</small> ${j.text}</div>`)
      .join('');
    await modal({ title: t('empires.journal'), html: `<div class="em-list">${rows || `<p class="muted">${t('empires.journalEmpty')}</p>`}</div>`, buttons: [{ id: 'ok', label: t('common.close') }] });
  }

  // График: сколько провинций было у главных стран по месяцам.
  function chartSvg(ch) {
    const Wd = 320;
    const Hd = 170;
    const rows = ch.rows;
    const max = Math.max(1, ...rows.flat());
    const xs = (k) => (rows.length < 2 ? 0 : (k / (rows.length - 1)) * Wd);
    const ys = (v) => Hd - (v / max) * (Hd - 6);
    const lines = ch.ids
      .map((id, col) => {
        const pts = rows.map((r, k) => `${xs(k).toFixed(1)},${ys(r[col]).toFixed(1)}`).join(' ');
        const mine = id === myC();
        return `<polyline points="${pts}" fill="none" stroke="${countries[id].color}" stroke-width="${mine ? 3.5 : 2}" stroke-linejoin="round"/>`;
      })
      .join('');
    const legend = ch.ids.map((id) => `<span><i style="background:${countries[id].color}"></i>${cname(id)}</span>`).join('');
    return `<svg class="em-chart" viewBox="0 0 ${Wd} ${Hd}" preserveAspectRatio="none">${lines}</svg><div class="em-chartlegend">${legend}</div>`;
  }

  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const a = b.dataset.a;
    const c = b.dataset.c != null ? Number(b.dataset.c) : null;
    const rect = mapEl.getBoundingClientRect();
    switch (a) {
      case 'zin':
      case 'zout':
        zoomAt(rect.width / 2, rect.height / 2, a === 'zin' ? 1.4 : 1 / 1.4);
        return redraw();
      case 'home':
        if (myC() != null && alive(myC())) focusCountry(myC());
        else fitCamera();
        return redraw();
      case 'mode':
        mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
        baseDirty = true;
        toast(t('empires.mode.' + mode), 1200);
        renderLegend();
        return redraw();
      case 'speed':
        api.act({ t: 'speed', v: Number(b.dataset.v) });
        return sfx.tap();
      case 'pick':
        api.act({ t: 'pick', c });
        sfx.go();
        return;
      case 'tab':
        panel = panel === b.dataset.tab ? null : b.dataset.tab;
        selArmy = null;
        if (panel !== 'recruit') selHex = -1;
        renderSheet();
        renderBar();
        return redraw();
      case 'close':
        panel = null;
        renderSheet();
        return renderBar();
      case 'list':
        return showList();
      case 'armies':
        return showArmies();
      case 'journal':
        return showJournal();
      case 'rank':
        return showRank();
      case 'recruit':
        api.act({ t: 'recruit', unit: b.dataset.unit, hex: Number(b.dataset.hex) });
        sfx.chip();
        return;
      case 'recruitHere':
        panel = 'recruit';
        renderSheet();
        return renderBar();
      case 'research':
        api.act({ t: 'research', tech: b.dataset.tech });
        sfx.go();
        return;
      case 'build':
        api.act({ t: 'build', hex: selHex, kind: b.dataset.kind });
        sfx.chip();
        return;
      case 'split':
      case 'merge':
      case 'stop':
        api.act({ t: a, army: selArmy });
        if (a === 'stop') selPath = null;
        return;
      case 'unsel':
        selArmy = null;
        selPath = null;
        renderSheet();
        return redraw();
      case 'war': {
        const text = relation(myC(), c) === 'overlord' ? t('empires.independenceConfirm', { name: cname(c) }) : t('empires.warConfirm', { name: cname(c) });
        if (await confirmBox(text, t('empires.declare'))) api.act({ t: 'war', c });
        return;
      }
      case 'peace':
      case 'tribute':
      case 'vassal':
      case 'ally':
        api.act({ t: a, c });
        toast(t('empires.sent'));
        return;
      case 'unally':
      case 'release':
        api.act({ t: a, c });
        return;
      case 'integrate':
        if (await confirmBox(t('empires.integrateConfirm', { name: cname(c) }), t('empires.integrate'))) api.act({ t: 'integrate', c });
        return;
    }
  });

  /* ---------- события ---------- */

  function evText(e) {
    const me = myC();
    const inv = (...ids) => ids.includes(me);
    switch (e.t) {
      case 'war':
        return { text: `⚔️ ${t('empires.ev.war', { a: cname(e.a), b: cname(e.b) })}`, mine: inv(e.a, e.b) };
      case 'join':
        return { text: `⚔️ ${t('empires.ev.join', { a: cname(e.a), b: cname(e.b), of: cname(e.of) })}`, mine: inv(e.a, e.b) };
      case 'peace':
        return { text: `🕊️ ${t('empires.ev.peace', { a: cname(e.a), b: cname(e.b) })}`, mine: inv(e.a, e.b) };
      case 'tribute':
        return { text: `💰 ${t('empires.ev.tribute', { a: cname(e.a), b: cname(e.b), n: e.n })}`, mine: inv(e.a, e.b) };
      case 'vassal':
        return { text: `👑 ${t('empires.ev.vassal', { a: cname(e.a), b: cname(e.b) })}`, mine: inv(e.a, e.b) };
      case 'release':
        return { text: `🕊️ ${t('empires.ev.release', { a: cname(e.a), b: cname(e.b) })}`, mine: inv(e.a, e.b) };
      case 'integrate':
        return { text: `🧩 ${t('empires.ev.integrate', { a: cname(e.a), b: cname(e.b) })}`, mine: inv(e.a, e.b) };
      case 'independence':
        return { text: `✊ ${t('empires.ev.independence', { a: cname(e.a), b: cname(e.b) })}`, mine: inv(e.a, e.b) };
      case 'ally':
        return { text: `🤝 ${t('empires.ev.ally', { a: cname(e.a), b: cname(e.b) })}`, mine: inv(e.a, e.b) };
      case 'unally':
        return { text: `💔 ${t('empires.ev.unally', { a: cname(e.a), b: cname(e.b) })}`, mine: inv(e.a, e.b) };
      case 'capital':
        return { text: `🏰 ${t('empires.ev.capital', { a: cname(e.c), b: cname(e.by) })}`, mine: inv(e.c, e.by) };
      case 'fallen':
        return { text: `💀 ${t('empires.ev.fallen', { a: cname(e.c), b: cname(e.by) })}`, mine: inv(e.c, e.by) };
      case 'revolt':
        return { text: `🔥 ${t(e.reborn ? 'empires.ev.reborn' : 'empires.ev.revolt', { a: cname(e.c), b: cname(e.from) })}`, mine: inv(e.c, e.from) };
      case 'coalition':
        return { text: `🛡️ ${t('empires.ev.coalition', { a: cname(e.c), n: e.n })}`, mine: inv(e.c) };
      case 'tech':
        return e.c === me ? { text: `🔬 ${t('empires.ev.tech', { tech: t('empires.tech.' + e.tech), n: e.lvl })}`, mine: true } : null;
      case 'declined':
        return e.a === me ? { text: `❌ ${t('empires.ev.declined.' + e.kind, { b: cname(e.b) })}`, mine: true } : null;
      case 'routed':
        return e.c === me ? { text: `🏳️ ${t('empires.ev.routed')}`, mine: true } : null;
      case 'retreat':
        return e.c === me ? { text: `🏳️ ${t('empires.ev.retreat')}`, mine: true, quiet: true } : null;
    }
    return null;
  }

  function handleEvents(list) {
    for (const e of list) {
      const r = evText(e);
      if (!r) continue;
      journal.push({ day, text: r.text, mine: r.mine });
      if (journal.length > 60) journal.shift();
      if (r.quiet) continue;
      ticker.push(r.text);
      if (ticker.length > 2) ticker.shift();
      if (r.mine) {
        toast(r.text, 3000);
        if (e.t === 'war' || e.t === 'join' || e.t === 'revolt' || e.t === 'coalition') sfx.wrong();
        else if (e.t === 'peace' || e.t === 'ally' || e.t === 'tech' || e.t === 'vassal') sfx.win();
      }
    }
    $('.em-ticker').innerHTML = ticker.map((x) => `<div>${x}</div>`).join('');
  }

  // Предложения и события страны — по очереди, в окне с выбором.
  let asking = false;
  async function nextPrompt() {
    if (asking || phase !== 'play') return;
    const me = myC();
    if (me == null) return;
    const o = dip.offers.find(([id, , , to]) => to === me && !seenOffers.has(id));
    if (o) {
      const [id, kind, from] = o;
      seenOffers.add(id);
      asking = true;
      sfx.turn();
      const yes = await confirmBox(t('empires.offer.' + kind, { name: cname(from) }), t('empires.accept'), t('empires.decline'));
      asking = false;
      api.act({ t: 'answer', id, yes });
      return nextPrompt();
    }
    const ev = eventQueue.shift();
    if (ev) {
      asking = true;
      sfx.turn();
      const k = 'empires.event.' + ev.type;
      const choice = await modal({
        title: `${EVENT_ICON[ev.type] || '📜'} ${t(k + '.title')}`,
        text: t(k + '.text'),
        buttons: [
          { id: '0', label: t(k + '.a'), primary: true },
          { id: '1', label: t(k + '.b') },
        ],
      });
      asking = false;
      api.act({ t: 'decide', id: ev.id, choice: choice === '1' ? 1 : 0 });
      if (ev.hex != null) {
        focusHex(ev.hex);
        redraw();
      }
      return nextPrompt();
    }
  }

  function apply(d) {
    if (d.armies) {
      armies = d.armies;
      tickAt = performance.now();
    }
    if (d.cs) {
      const capsChanged = cs.length !== d.cs.length || d.cs.some((x, i) => x[5] !== cs[i]?.[5] || x[4] !== cs[i]?.[4] || x[10] !== cs[i]?.[10]);
      cs = d.cs;
      if (capsChanged) {
        baseDirty = true;
        labelsDirty = true;
      }
    }
    if (d.sieges) sieges = d.sieges;
    if (d.dip) {
      dip = d.dip;
      if (mode === 'diplomacy') baseDirty = true;
    }
    if (d.day != null) day = d.day;
    if (d.speed != null) speed = d.speed;
    if (d.left != null) {
      left = d.left;
      leftAt = performance.now();
    }
  }

  function setProvince([h, o, dv, fl, cr, pp]) {
    if (owner[h] !== o || core[h] !== cr || flags[h] !== fl || dev[h] !== dv) baseDirty = true;
    if (owner[h] !== o) labelsDirty = true;
    owner[h] = o;
    dev[h] = dv;
    flags[h] = fl;
    core[h] = cr;
    pop[h] = pp;
  }

  function tickClock() {
    const el = root.querySelector('.em-clock');
    if (el) el.textContent = (phase === 'pick' ? '' : '⏳ ') + clock();
  }
  const clockTimer = setInterval(tickClock, 1000);

  const ro = new ResizeObserver(() => {
    resize();
    redraw();
  });
  ro.observe(mapEl);
  const onVis = () => redraw();
  document.addEventListener('visibilitychange', onVis);

  return {
    msg(d) {
      if (d.t === 'world') {
        setupWorld(d);
        resize();
        return redraw();
      }
      if (d.t === 'full') {
        const wasPick = phase === 'pick';
        phase = d.phase;
        for (const p of d.provinces) setProvince(p);
        picks = d.picks;
        result = d.result;
        goal = d.goal ?? goal;
        apply(d);
        baseDirty = true;
        labelsDirty = true;
        for (const ev of d.events || []) {
          if (seenEvents.has(ev.id)) continue;
          seenEvents.add(ev.id);
          eventQueue.push(ev);
        }
        if (wasPick && phase === 'play') {
          selHex = -1;
          if (myC() != null) {
            toast(t('empires.started', { name: cname(myC()) }), 3500);
            sfx.fanfare();
            focusCountry(myC());
            selHex = -1;
          }
        }
        if (phase === 'over' && result && !shownChart) {
          shownChart = true;
          const w = result.winner;
          const title = w != null ? t('empires.dominates', { name: cname(w) }) : t('empires.timeUp');
          if (d.chart) modal({ title, html: chartSvg(d.chart), buttons: [{ id: 'ok', label: t('common.ok') }] });
          else toast(title, 5000);
        }
        renderUi();
        nextPrompt();
        return redraw();
      }
      if (d.t === 'tick') {
        if (d.own) for (const p of d.own) setProvince(p);
        apply(d);
        if (d.ev) handleEvents(d.ev);
        if (selArmy != null && !armies.some((a) => a[0] === selArmy)) {
          selArmy = null;
          selPath = null;
        } else if (selArmy != null) updatePath();
        renderHud();
        renderSheet();
        renderBar();
        nextPrompt();
        return redraw();
      }
      if (d.t === 'event') {
        if (!seenEvents.has(d.id)) {
          seenEvents.add(d.id);
          eventQueue.push(d);
          nextPrompt();
        }
        return;
      }
      if (d.t === 'nope') {
        sfx.wrong();
        toast(t('empires.nope.' + d.a));
      }
    },
    destroy() {
      clearInterval(clockTimer);
      ro.disconnect();
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVis);
    },
  };
}
