import { esc } from '../../core/util.js';
import { sfx } from '../../core/sfx.js';
import { avatar, modal, toast, confirmBox } from '../../ui/common.js';
import { getLang } from '../../core/i18n.js';
import { hexCenter, neighbors, TERRAINS } from './world.js';

// Карта «Империй» на canvas: подложка (страны, рельеф, границы) рисуется
// в отдельный холст и обновляется при захватах; армии — поверх каждый кадр.
// Один палец — двигать карту, два — масштаб; тап — выбрать армию или провинцию.

const SQ3 = Math.sqrt(3);
const TERRAIN_COLOR = ['#1f4e79', '#a9c97c', '#5f9150', '#b9a173', '#9a9a9a', '#e3cd86', '#dfe8ec'];
const SEA = '#1f4e79';
const REG_COST = 12;
const REG = 1000;

const fmt = (n) => (n >= 1000 ? (n / 1000).toFixed(n < 10000 ? 1 : 0).replace(/\.0$/, '') + 'k' : String(n));

export function mount(root, api) {
  const { t } = api;
  root.innerHTML = `
    <div class="em">
      <div class="em-hud"></div>
      <div class="em-map">
        <canvas class="em-cv"></canvas>
        <div class="em-ticker"></div>
        <div class="em-zoom"><button class="icon-btn" data-a="zin">＋</button><button class="icon-btn" data-a="zout">－</button><button class="icon-btn" data-a="home">◎</button></div>
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
  let terrain = [];
  let countries = [];
  let centers = [];
  let edges = [];
  let worldW = 0;
  let worldH = 0;
  let owner = [];
  let dev = [];
  let armies = [];
  let cs = [];
  let sieges = [];
  let dip = { wars: [], allies: [], truces: [], offers: [] };
  let picks = {};
  let phase = 'pick';
  let day = 0;
  let left = null;
  let leftAt = 0;
  let result = null;
  let mode = 'political';
  let selArmy = null;
  let selHex = -1;
  let baseDirty = true;
  let baseScale = 0;
  let raf = 0;
  const cam = { s: 10, x: 0, y: 0, fit: 10 };
  const seenOffers = new Set();
  const ticker = [];

  const myC = () => (picks[api.me] != null ? picks[api.me] : null);
  const alive = (c) => cs[c]?.[4] === 1;
  const cname = (c) => (c >= 0 && countries[c] ? esc(countries[c].name) : '—');
  const pairKey = (a, b) => `${Math.min(a, b)}-${Math.max(a, b)}`;
  function relation(a, b) {
    if (a == null || b == null || a === b) return 'self';
    const k = pairKey(a, b);
    if (dip.wars.some(([x, y]) => pairKey(x, y) === k)) return 'war';
    if (dip.allies.some(([x, y]) => pairKey(x, y) === k)) return 'ally';
    if (dip.truces.some(([x, y]) => pairKey(x, y) === k)) return 'truce';
    return 'peace';
  }
  const seatOf = (c) => Object.entries(picks).find(([, v]) => v === c)?.[0];

  /* ---------- геометрия ---------- */

  function setupWorld(d) {
    W = d.w;
    H = d.h;
    terrain = d.terrain.split('').map(Number);
    countries = d.countries;
    centers = Array.from({ length: W * H }, (_, i) => hexCenter(W, i));
    worldW = SQ3 * (W + 0.5);
    worldH = 1.5 * H + 0.5;
    // Для каждой грани шестиугольника — сосед за ней (или -1).
    edges = centers.map(([cx, cy], i) => {
      const e = [-1, -1, -1, -1, -1, -1];
      for (const j of neighbors(W, H, i)) {
        const [x, y] = centers[j];
        const ang = (Math.atan2(y - cy, x - cx) * 180) / Math.PI;
        const k = (((Math.round((ang + 60) / 60) % 6) + 6) % 6);
        e[k] = j;
      }
      return e;
    });
    baseDirty = true;
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
    for (let i = 0; i < centers.length; i++) {
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

  function resize() {
    const rect = mapEl.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(rect.width * dpr);
    cv.height = Math.round(rect.height * dpr);
    cv.style.width = rect.width + 'px';
    cv.style.height = rect.height + 'px';
    if (!fitted) fitted = (fitCamera(), !!W && rect.width > 0);
  }
  let fitted = false;

  /* ---------- подложка ---------- */

  // Разрешение подложки — под текущий масштаб, но не больше 4096 точек в ширину.
  const baseRes = () => Math.min(Math.max(cam.s * Math.min(window.devicePixelRatio || 1, 2), 12), 4096 / worldW, 60);

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
    for (let i = 0; i < centers.length; i++) {
      if (!terrain[i]) continue;
      hexPath(i);
      b.fillStyle = TERRAIN_COLOR[terrain[i]];
      b.fill();
      if (mode === 'political' && owner[i] >= 0) {
        b.globalAlpha = 0.78;
        b.fillStyle = countries[owner[i]].color;
        b.fill();
        b.globalAlpha = 1;
      }
    }
    // Рельеф: горы — треугольники, холмы — дуги, лес — кружки.
    b.lineWidth = 0.07;
    for (let i = 0; i < centers.length; i++) {
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
    // Побережье и границы стран.
    b.lineCap = 'round';
    for (let i = 0; i < centers.length; i++) {
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

  /* ---------- кадр ---------- */

  const toScreen = (x, y) => [x * cam.s + cam.x, y * cam.s + cam.y];
  const toWorld = (x, y) => [(x - cam.x) / cam.s, (y - cam.y) / cam.s];

  function armyPos(a) {
    const [, , hex, , next, prog] = a;
    const [x0, y0] = centers[hex];
    if (next < 0) return [x0, y0];
    const [x1, y1] = centers[next];
    const p = prog / 100;
    return [x0 + (x1 - x0) * p, y0 + (y1 - y0) * p];
  }

  function draw() {
    raf = 0;
    if (!W) return;
    if (baseDirty || Math.abs(baseScale / baseRes() - 1) > 0.35) renderBase();
    const dpr = cv.width / (cv.clientWidth || 1);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = SEA;
    g.fillRect(0, 0, cv.width, cv.height);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.imageSmoothingEnabled = true;
    g.drawImage(base, cam.x, cam.y, worldW * cam.s, worldH * cam.s);
    const s = cam.s;
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
      g.arc(cx, cy, s * 0.8, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * pct) / 100);
      g.strokeStyle = countries[c]?.color || '#fff';
      g.lineWidth = Math.max(2, s * 0.14);
      g.stroke();
    }
    // Армии: кружок с числом. Несколько на одной клетке — веером.
    const byHex = new Map();
    for (const a of armies) (byHex.get(a[2]) || byHex.set(a[2], []).get(a[2])).push(a);
    const me = myC();
    const r = Math.max(9, Math.min(22, s * 0.55));
    g.font = `800 ${Math.round(r * 0.85)}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const list of byHex.values()) {
      list.forEach((a, k) => {
        let [x, y] = toScreen(...armyPos(a));
        if (list.length > 1) {
          const ang = (k / list.length) * Math.PI * 2;
          x += Math.cos(ang) * r * 0.9;
          y += Math.sin(ang) * r * 0.9;
        }
        const sel = a[0] === selArmy;
        if (sel && a[7] >= 0) {
          const [dx, dy] = toScreen(...centers[a[7]]);
          g.setLineDash([6, 5]);
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(dx, dy);
          g.strokeStyle = '#ffd23f';
          g.lineWidth = 2.5;
          g.stroke();
          g.setLineDash([]);
        }
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fillStyle = countries[a[1]]?.color || '#888';
        g.fill();
        g.lineWidth = sel ? 4 : a[1] === me ? 2.5 : 1.5;
        g.strokeStyle = sel ? '#ffd23f' : a[1] === me ? '#fff' : 'rgba(0,0,0,0.75)';
        g.stroke();
        g.fillStyle = '#fff';
        g.strokeStyle = 'rgba(0,0,0,0.8)';
        g.lineWidth = 3;
        const label = fmt(a[3]);
        g.strokeText(label, x, y + 1);
        g.fillText(label, x, y + 1);
        if (a[6]) {
          g.font = `${Math.round(r)}px system-ui, sans-serif`;
          g.fillText('⚔️', x + r * 0.9, y - r * 0.9);
          g.font = `800 ${Math.round(r * 0.85)}px system-ui, sans-serif`;
        }
      });
    }
    // Флажки игроков на столицах (во время выбора и в игре).
    for (const [sid, c] of Object.entries(picks)) {
      if (!alive(c) && phase !== 'pick') continue;
      const seat = api.seat(sid);
      const [x, y] = toScreen(...centers[cs[c]?.[5] ?? 0]);
      g.font = `${Math.round(Math.max(14, s * 0.8))}px system-ui, sans-serif`;
      g.fillText(seat?.avatar || '🙂', x, y - Math.max(16, s * 0.9));
    }
  }

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
      const dx = e.clientX - prev[0];
      const dy = e.clientY - prev[1];
      if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 8) tap.moved = true;
      if (!tap || tap.moved) {
        cam.x += dx;
        cam.y += dy;
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
      selArmy = a[0];
      selHex = -1;
      sfx.tap();
    } else if (selArmy != null && hex >= 0 && terrain[hex]) {
      const army = armies.find((x) => x[0] === selArmy);
      if (army && hex !== army[2]) {
        api.act({ t: 'move', army: selArmy, to: hex });
        sfx.card();
      }
      selArmy = null;
    } else {
      selArmy = null;
      selHex = hex >= 0 && terrain[hex] ? hex : -1;
      if (selHex >= 0) sfx.tap();
    }
    renderSheet();
    redraw();
  }

  /* ---------- интерфейс ---------- */

  function date() {
    const d = new Date(Date.UTC(1900, 0, 1) + day * 86400000);
    try {
      return d.toLocaleDateString(getLang(), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    } catch {
      return `${t('empires.day')} ${day}`;
    }
  }

  function clock() {
    if (left == null) return '';
    const ms = Math.max(0, left - (performance.now() - leftAt));
    const sec = Math.ceil(ms / 1000);
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  }

  function renderHud() {
    const me = myC();
    if (phase === 'pick') {
      $('.em-hud').innerHTML = `<div class="em-pick">🗺️ <b>${t('empires.pickTitle')}</b> <span class="em-clock">${clock()}</span></div>`;
      return;
    }
    if (me == null) {
      $('.em-hud').innerHTML = `<div class="em-stat">📅 ${date()} <span class="em-clock">⏳ ${clock()}</span></div>`;
      return;
    }
    const [gold, income, troops, prov, al] = cs[me] || [0, 0, 0, 0, 0];
    const cap = (8 + prov) * REG;
    $('.em-hud').innerHTML = `<div class="em-me"><i class="em-flag" style="background:${countries[me].color}"></i><b>${cname(me)}</b>${al ? '' : ' 💀'}</div>
      <div class="em-stat"><span>💰 <b>${gold}</b> <small>${income >= 0 ? '+' : ''}${income}/${t('empires.mo')}</small></span><span>🪖 <b>${fmt(troops)}</b><small>/${fmt(cap)}</small></span><span>🏳️ <b>${prov}</b></span></div>
      <div class="em-stat em-date">📅 ${date()} <span class="em-clock">⏳ ${clock()}</span></div>`;
  }

  function relBadge(rel) {
    return `<span class="em-rel ${rel}">${t('empires.rel.' + rel)}</span>`;
  }

  function renderSheet() {
    const el = $('.em-sheet');
    const me = myC();
    if (phase === 'pick') {
      if (selHex < 0) {
        el.innerHTML = `<p class="muted small">${t('empires.pickHint')}</p>`;
        return;
      }
      const c = owner[selHex];
      const taken = seatOf(c);
      const [, , troops, prov] = cs[c] || [];
      el.innerHTML = `<div class="em-row"><i class="em-flag" style="background:${countries[c].color}"></i><b>${cname(c)}</b>
          <span class="muted">🏳️ ${prov} · 🪖 ${fmt(troops || 0)}</span></div>
        ${taken ? `<p>${avatar(api.seat(taken), 22)} ${esc(api.seat(taken)?.name || '')}</p>` : `<button class="btn primary" data-a="pick" data-c="${c}">${t('empires.playAs', { name: cname(c) })}</button>`}`;
      return;
    }
    if (selArmy != null) {
      const a = armies.find((x) => x[0] === selArmy);
      if (!a) {
        selArmy = null;
        return renderSheet();
      }
      el.innerHTML = `<div class="em-row"><b>🪖 ${t('empires.army')} · ${a[3].toLocaleString(getLang())}</b><span class="muted">${a[6] ? '⚔️ ' + t('empires.fighting') : a[7] >= 0 ? t('empires.marching') : t('empires.standing')}</span></div>
        <p class="muted small">${t('empires.moveHint')}</p>
        <div class="em-btns"><button class="btn small" data-a="split" ${a[3] >= 2 * REG && !a[6] ? '' : 'disabled'}>✂️ ${t('empires.split')}</button><button class="btn small" data-a="unsel">✖</button></div>`;
      return;
    }
    if (selHex < 0) {
      el.innerHTML = me != null ? `<p class="muted small">${t('empires.hint')}</p>` : '';
      return;
    }
    const c = owner[selHex];
    const tt = TERRAINS[terrain[selHex]];
    const siege = sieges.find((s) => s[0] === selHex);
    const head = `<div class="em-row"><i class="em-flag" style="background:${countries[c]?.color}"></i><b>${cname(c)}</b>
      <span class="muted">${t('empires.terrain.' + tt)} · ⭐ ${dev[selHex]}${siege ? ` · 🔥 ${siege[2]}%` : ''}</span></div>`;
    const btns = [];
    if (me != null && alive(me)) {
      if (c === me) {
        const cost = 10 + dev[selHex] * 6;
        btns.push(`<button class="btn small" data-a="invest" ${dev[selHex] >= 9 ? 'disabled' : ''}>📈 ${t('empires.invest')} · ${cost}💰</button>`);
        btns.push(`<button class="btn small" data-a="recruitHere">🪖 ${t('empires.recruitHere')} · ${REG_COST}💰</button>`);
      } else if (c >= 0) {
        const rel = relation(me, c);
        btns.push(relBadge(rel));
        if (rel === 'war') btns.push(`<button class="btn small" data-a="peace" data-c="${c}">🕊️ ${t('empires.offerPeace')}</button>`);
        if (rel === 'peace') {
          btns.push(`<button class="btn small danger" data-a="war" data-c="${c}">⚔️ ${t('empires.declare')}</button>`);
          btns.push(`<button class="btn small" data-a="ally" data-c="${c}">🤝 ${t('empires.offerAlly')}</button>`);
        }
        if (rel === 'truce') {
          const tr = dip.truces.find(([x, y]) => pairKey(x, y) === pairKey(me, c));
          btns.push(`<span class="muted small">${t('empires.truceLeft', { n: Math.max(0, tr[2] - day) })}</span>`);
          btns.push(`<button class="btn small" data-a="ally" data-c="${c}">🤝 ${t('empires.offerAlly')}</button>`);
        }
        if (rel === 'ally') btns.push(`<button class="btn small" data-a="unally" data-c="${c}">💔 ${t('empires.breakAlly')}</button>`);
      }
    }
    const seat = seatOf(c);
    el.innerHTML = head + (seat ? `<p class="small">${avatar(api.seat(seat), 20)} ${esc(api.seat(seat)?.name || '')}</p>` : '') + `<div class="em-btns">${btns.join('')}</div>`;
  }

  function renderBar() {
    const me = myC();
    if (phase === 'pick') {
      $('.em-bar').innerHTML = `<button class="btn" data-a="list">📜 ${t('empires.countries')}</button><button class="btn" data-a="mode">🗺️ ${t('empires.mode.' + (mode === 'political' ? 'terrain' : 'political'))}</button>`;
      return;
    }
    const canRecruit = me != null && alive(me) && (cs[me]?.[0] ?? 0) >= REG_COST;
    $('.em-bar').innerHTML = `${me != null && alive(me) ? `<button class="btn primary" data-a="recruit" ${canRecruit ? '' : 'disabled'}>🪖 +1000 · ${REG_COST}💰</button>` : ''}
      <button class="btn" data-a="list">🤝 ${t('empires.diplomacy')}</button>
      <button class="btn" data-a="mode" aria-label="${t('empires.mode.' + (mode === 'political' ? 'terrain' : 'political'))}">${mode === 'political' ? '⛰️' : '🗺️'}</button>
      <button class="btn" data-a="rank" aria-label="${t('empires.ranking')}">🏆</button>`;
  }

  function renderUi() {
    renderHud();
    renderSheet();
    renderBar();
  }

  function focusCountry(c) {
    const cap = cs[c]?.[5];
    if (cap == null) return;
    fitCamera((i) => owner[i] === c);
    selHex = cap;
    selArmy = null;
    renderSheet();
    redraw();
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
        return `<button class="em-li" data-id="c:${r.i}"><i class="em-flag" style="background:${r.c.color}"></i><b>${esc(r.c.name)}</b>${seat ? avatar(api.seat(seat), 18) : ''}
          <span class="muted small">🏳️${r.st[3]} 🪖${fmt(r.st[2])}</span>${me != null && r.i !== me ? relBadge(rel) : r.i === me ? `<span class="em-rel self">${t('empires.you')}</span>` : ''}</button>`;
      })
      .join('');
    const myWars = me != null ? dip.wars.filter(([a, b]) => a === me || b === me).map(([a, b]) => (a === me ? b : a)) : [];
    const head = myWars.length ? `<p class="small">⚔️ ${t('empires.atWarWith')}: ${myWars.map(cname).join(', ')}</p>` : '';
    const id = await modal({ title: t('empires.countries'), html: `${head}<div class="em-list">${rows}</div>`, buttons: [{ id: 'close', label: t('common.close') }] });
    if (id?.startsWith('c:')) focusCountry(Number(id.slice(2)));
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
    await modal({ title: t('empires.ranking'), html: `<div class="em-list">${rows}</div><p class="muted small">${t('empires.winRule')}</p>`, buttons: [{ id: 'ok', label: t('common.close') }] });
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
      case 'pick':
        api.act({ t: 'pick', c });
        sfx.go();
        return;
      case 'mode':
        mode = mode === 'political' ? 'terrain' : 'political';
        baseDirty = true;
        renderBar();
        return redraw();
      case 'list':
        return showList();
      case 'rank':
        return showRank();
      case 'recruit':
        api.act({ t: 'recruit' });
        sfx.chip();
        return;
      case 'recruitHere':
        api.act({ t: 'recruit', hex: selHex });
        sfx.chip();
        return;
      case 'invest':
        api.act({ t: 'invest', hex: selHex });
        sfx.chip();
        return;
      case 'split':
        api.act({ t: 'split', army: selArmy });
        return;
      case 'unsel':
        selArmy = null;
        renderSheet();
        return redraw();
      case 'war':
        if (await confirmBox(t('empires.warConfirm', { name: cname(c) }), t('empires.declare'))) api.act({ t: 'war', c });
        return;
      case 'peace':
      case 'ally':
      case 'unally':
        api.act({ t: a, c });
        if (a !== 'unally') toast(t('empires.sent'));
        return;
    }
  });

  /* ---------- события ---------- */

  function evText(e) {
    const me = myC();
    switch (e.t) {
      case 'war':
        return { text: `⚔️ ${t('empires.ev.war', { a: cname(e.a), b: cname(e.b) })}`, mine: e.a === me || e.b === me };
      case 'join':
        return { text: `⚔️ ${t('empires.ev.join', { a: cname(e.a), b: cname(e.b), of: cname(e.of) })}`, mine: e.a === me || e.b === me };
      case 'peace':
        return { text: `🕊️ ${t('empires.ev.peace', { a: cname(e.a), b: cname(e.b) })}`, mine: e.a === me || e.b === me };
      case 'ally':
        return { text: `🤝 ${t('empires.ev.ally', { a: cname(e.a), b: cname(e.b) })}`, mine: e.a === me || e.b === me };
      case 'unally':
        return { text: `💔 ${t('empires.ev.unally', { a: cname(e.a), b: cname(e.b) })}`, mine: e.a === me || e.b === me };
      case 'capital':
        return { text: `🏰 ${t('empires.ev.capital', { a: cname(e.c), b: cname(e.by) })}`, mine: e.c === me || e.by === me };
      case 'fallen':
        return { text: `💀 ${t('empires.ev.fallen', { a: cname(e.c), b: cname(e.by) })}`, mine: true };
      case 'declined':
        return e.a === me ? { text: `❌ ${t('empires.ev.declined.' + e.kind, { b: cname(e.b) })}`, mine: true } : null;
      case 'routed':
        return e.c === me ? { text: `🏳️ ${t('empires.ev.routed')}`, mine: true } : null;
    }
    return null;
  }

  function handleEvents(list) {
    for (const e of list) {
      const r = evText(e);
      if (!r) continue;
      ticker.push(r.text);
      if (ticker.length > 2) ticker.shift();
      if (r.mine) {
        toast(r.text, 3000);
        if (e.t === 'war' || e.t === 'join') sfx.wrong();
        else if (e.t === 'peace' || e.t === 'ally') sfx.win();
      }
    }
    $('.em-ticker').innerHTML = ticker.map((x) => `<div>${x}</div>`).join('');
  }

  let asking = false;
  async function checkOffers() {
    const me = myC();
    if (asking || me == null) return;
    const o = dip.offers.find(([id, , , to]) => to === me && !seenOffers.has(id));
    if (!o) return;
    const [id, kind, from] = o;
    seenOffers.add(id);
    asking = true;
    sfx.turn();
    const yes = await confirmBox(t('empires.offer.' + kind, { name: cname(from) }), t('empires.accept'), t('empires.decline'));
    asking = false;
    api.act({ t: 'answer', id, yes });
    checkOffers();
  }

  function apply(d) {
    if (d.armies) armies = d.armies;
    if (d.cs) {
      const capsChanged = cs.length !== d.cs.length || d.cs.some((x, i) => x[5] !== cs[i]?.[5] || x[4] !== cs[i]?.[4]);
      cs = d.cs;
      if (capsChanged) baseDirty = true;
    }
    if (d.sieges) sieges = d.sieges;
    if (d.dip) dip = d.dip;
    if (d.day != null) day = d.day;
    if (d.left != null) {
      left = d.left;
      leftAt = performance.now();
    }
  }

  const clockTimer = setInterval(() => {
    const el = root.querySelector('.em-clock');
    if (el) el.textContent = (phase === 'pick' ? '' : '⏳ ') + clock();
  }, 1000);

  const ro = new ResizeObserver(() => {
    resize();
    redraw();
  });
  ro.observe(mapEl);

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
        owner = d.owner;
        dev = d.dev.split('').map(Number);
        picks = d.picks;
        result = d.result;
        apply(d);
        baseDirty = true;
        if (wasPick && phase === 'play') {
          selHex = -1;
          if (myC() != null) {
            toast(t('empires.started', { name: cname(myC()) }), 3500);
            sfx.fanfare();
            focusCountry(myC());
            selHex = -1;
          }
        }
        if (phase === 'over' && result) {
          const w = result.winner;
          toast(w != null ? t('empires.dominates', { name: cname(w) }) : t('empires.timeUp'), 5000);
        }
        renderUi();
        checkOffers();
        return redraw();
      }
      if (d.t === 'tick') {
        if (d.own) {
          for (const [hex, o, dv] of d.own) {
            if (owner[hex] !== o) baseDirty = true;
            owner[hex] = o;
            dev[hex] = dv;
          }
        }
        apply(d);
        if (d.ev) handleEvents(d.ev);
        if (selArmy != null && !armies.some((a) => a[0] === selArmy)) selArmy = null;
        renderHud();
        if (selHex >= 0 || selArmy != null) renderSheet();
        renderBar();
        checkOffers();
        return redraw();
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
    },
  };
}
