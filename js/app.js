import { $, $$, esc, session as sstore, store, cleanName } from './core/util.js';
import { t, tn, setLang, getLang, applyStatic, LANGS } from './core/i18n.js';
import { profile, updateProfile, publicMe, recordGame } from './core/profile.js';
import { applyTheme } from './core/theme.js';
import { playFx } from './core/fx.js';
import { sfx, unlockAudio, setSound } from './core/sfx.js';
import { Session } from './room/session.js';
import { newRoomCode } from './net/transport.js';
import { GAMES, GAME_IDS } from './games/registry.js';
import { renderLobby, gameBlock, gameName } from './ui/lobby.js';
import { renderProfile } from './ui/profile.js';
import { renderResults } from './ui/results.js';
import { avatar, toast, modal, confirmBox } from './ui/common.js';
import qrcode from '../vendor/qrcode.js';

let S = null; // текущая комната
let screen = 'home';
const ui = { net: null, qr: false, qrSvg: '', view: null, viewKey: null, pending: [], results: null, back: 'home', mountSeq: 0, startedAt: 0 };

function show(id) {
  $$('.screen').forEach((s) => (s.hidden = s.id !== id));
  screen = id;
  window.scrollTo(0, 0);
}

/* ---------- главный экран ---------- */

function renderMe() {
  $$('.me-ava').forEach((el) => (el.innerHTML = avatar(profile, 34)));
  $$('.me-name').forEach((el) => (el.textContent = profile.name || t('profile.noName')));
  $('#sound-btn').textContent = profile.sound ? '🔊' : '🔇';
  $('#lang-btn').textContent = LANGS.find((l) => l.id === getLang())?.flag || '🌐';
}

function renderHome() {
  const brand = [...t('brand').toUpperCase()];
  const half = Math.ceil(brand.length / 2);
  const row = (letters, cls) => `<div class="logo-row ${cls}">${letters.map((ch) => `<i>${esc(ch)}</i>`).join('')}</div>`;
  $('#logo').innerHTML = row(brand.slice(0, half), '') + row(brand.slice(half), 'alt');
  $('#logo').setAttribute('aria-label', t('brand'));
  $('#games-row').innerHTML = GAME_IDS.map((id) => `<div class="gbadge"><span class="gc-icon gi-${id}">${GAMES[id].icon}</span><small>${gameName(id)}</small></div>`).join('');
  renderMe();
}

function relocalize() {
  setLang(profile.lang);
  applyStatic();
  document.title = t('brand');
  renderHome();
  if (screen === 'profile') renderProfileScreen();
  if (screen === 'room' && S?.room) renderRoom();
}

/* ---------- профиль ---------- */

function renderProfileScreen() {
  $('#profile-body').innerHTML = renderProfile(profile);
  $('#prof-name').addEventListener('change', (e) => setProfile({ name: e.target.value }));
}

function setProfile(patch) {
  updateProfile(patch);
  applyTheme(profile);
  setSound(profile.sound);
  if ('lang' in patch) relocalize();
  else renderMe();
  if (S && !S.closed) {
    S.profile = publicMe();
    S.send({ t: 'profile', p: S.profile });
  }
}

async function askName() {
  if (cleanName(profile.name)) return true;
  const id = await modal({
    title: t('profile.askName'),
    html: `<input class="modal-input" id="ask-name" maxlength="16" autocomplete="nickname" placeholder="${t('profile.namePh')}">`,
    buttons: [{ id: 'ok', label: t('common.ok'), primary: true }],
  });
  const v = cleanName(modal.values?.['ask-name']);
  if (id === 'ok' && v) {
    setProfile({ name: v });
    return true;
  }
  return false;
}

/* ---------- комнаты ---------- */

function keepParams() {
  const b = new URLSearchParams(location.search).get('broker');
  return b ? `broker=${encodeURIComponent(b)}` : '';
}

function setUrl(room) {
  const q = [room ? `room=${room}` : '', keepParams()].filter(Boolean).join('&');
  history.replaceState(null, '', location.pathname + (q ? '?' + q : ''));
}

function endSession() {
  unmountGame();
  closeResults();
  if (S) S.leave();
  S = null;
  ui.net = null;
  ui.qr = false;
  sstore.set('igroteka-room', '');
  $('#banner').hidden = true;
  releaseWake();
}

async function startSession(mode, { code, hint } = {}) {
  endSession();
  const second =
    mode === 'split'
      ? { id: 'local2', name: cleanName(store.get('igroteka-p2', '')) || t('lobby.player2'), avatar: '🐼', color: '#ff922b', shape: 'circle', fx: 'confetti' }
      : null;
  S = new Session({
    mode,
    code: mode === 'online' ? newRoomCode() : code || null,
    me: publicMe(),
    lang: getLang(),
    hint,
    second,
    botName: (n) => t('bot.name', { n }),
    onEvent,
  });
  ui.startedAt = Date.now();
  S.start();
  if (mode === 'guest') {
    $('#join-status').textContent = t('join.connecting');
    sstore.set('igroteka-room', code);
    setUrl(code);
  } else {
    setUrl(null);
    show('room');
  }
  startHeartbeat();
}

function onEvent(type, data) {
  switch (type) {
    case 'room':
      if (screen === 'room') renderRoom();
      break;
    case 'joined':
      if (screen === 'join') {
        sfx.join();
        if (!S.game) show('room');
        renderRoom();
      }
      break;
    case 'net':
      onNet(data);
      break;
    case 'gstart':
      mountGame(data);
      break;
    case 'g':
      deliver(data);
      break;
    case 'gend':
      showResults(data);
      break;
    case 'gabort':
      unmountGame();
      show('room');
      renderRoom();
      break;
    case 'full':
      $('#join-status').textContent = t('join.full');
      S = null;
      break;
    case 'kicked':
      endSession();
      show('home');
      modal({ text: t('lobby.kicked') });
      break;
    case 'closed':
      endSession();
      show('home');
      modal({ text: t('lobby.closed') });
      break;
  }
}

function onNet(st) {
  if (!S) return;
  if (S.mode === 'online') {
    if (st.open > 0) ui.net = { text: '🟢 ' + t('net.open'), cls: 'ok' };
    else if (Date.now() - ui.startedAt > 12000) ui.net = { text: '🔴 ' + t('net.noInternet'), cls: 'bad' };
    else ui.net = { text: '🟡 ' + t('net.opening'), cls: '' };
    const el = $('#room .net-status');
    if (el) {
      el.textContent = ui.net.text;
      el.className = 'net-status ' + ui.net.cls;
    }
  } else if (S.mode === 'guest' && !st.joined) {
    $('#join-status').textContent = st.attempt >= 6 ? t('join.notFound', { code: S.code }) : st.state === 'open' ? t('join.searching', { code: S.code }) : t('join.connecting');
  }
}

function startHeartbeat() {
  clearInterval(ui.hb);
  ui.hb = setInterval(() => {
    if (!S || S.closed) return;
    if (S.mode === 'online' && !ui.net) onNet({ open: 0 });
    const banner = $('#banner');
    if (S.mode === 'guest' && S.room) {
      const lost = Date.now() - S.lastHostMsg > 10000;
      banner.hidden = !lost;
      if (lost) banner.textContent = '⚠️ ' + t('net.hostLost');
    }
  }, 2000);
}

function renderRoom() {
  if (!S?.room) return;
  $('#room').innerHTML = renderLobby(S, ui);
}

/* ---------- приглашение ---------- */

function inviteUrl() {
  const u = new URL(location.pathname, location.origin);
  u.searchParams.set('room', S.code);
  const first = S.transport?.firstOpen ?? -1;
  if (first > 0) u.searchParams.set('b', first);
  const broker = new URLSearchParams(location.search).get('broker');
  if (broker) u.searchParams.set('broker', broker);
  return u.toString();
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.append(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

async function copyLink() {
  toast((await copyText(inviteUrl())) ? t('lobby.copied') : t('lobby.copyFail'));
}

async function shareInvite() {
  const url = inviteUrl();
  const text = t('lobby.shareText', { name: profile.name, code: S.code });
  if (navigator.share) {
    try {
      await navigator.share({ title: t('brand'), text, url });
    } catch (e) {
      if (e.name !== 'AbortError') copyLink();
    }
  } else copyLink();
}

function toggleQr() {
  ui.qr = !ui.qr;
  if (ui.qr) {
    const qr = qrcode(0, 'M');
    qr.addData(inviteUrl());
    qr.make();
    ui.qrSvg = qr.createSvgTag(6, 3);
  }
  renderRoom();
}

/* ---------- игра ---------- */

function unmountGame() {
  ui.mountSeq++;
  try {
    ui.view?.destroy();
  } catch {}
  ui.view = null;
  ui.viewKey = null;
  ui.pending = [];
  $('#gview').innerHTML = '';
}

async function mountGame(gs) {
  const key = gs.gameId + ':' + gs.seats.map((s) => s.id).join(',');
  // Переподключились к той же партии — экран не пересоздаём.
  if (ui.viewKey === key && !ui.results && screen === 'game') return;
  closeResults();
  unmountGame();
  const seq = ui.mountSeq;
  ui.viewKey = key;
  show('game');
  $('#game .gicon').textContent = GAMES[gs.gameId].icon;
  $('#game .gicon').className = `gicon gi-${gs.gameId}`;
  $('#game .gname').textContent = gameName(gs.gameId);
  $('#game .ginfo').textContent = '';
  const mod = await GAMES[gs.gameId].view();
  if (seq !== ui.mountSeq) return;
  const seats = gs.seats;
  const api = {
    me: S.me,
    localSeats: S.localSeats,
    seats,
    seat: (id) => seats.find((s) => s.id === id),
    settings: gs.settings,
    lang: gs.lang,
    isHost: S.isHost,
    act: (d, asId) => S?.act(d, asId),
    t,
    tn,
    setInfo: (text) => ($('#game .ginfo').textContent = text ? ' · ' + text : ''),
  };
  ui.view = mod.mount($('#gview'), api);
  const pending = ui.pending;
  ui.pending = [];
  for (const d of pending) ui.view.msg(d);
  keepAwake();
}

function deliver(d) {
  if (ui.view) ui.view.msg(d);
  else ui.pending.push(d);
}

function showResults(m) {
  ui.results = m;
  const box = $('#results');
  box.innerHTML = renderResults(m, S.me);
  box.hidden = false;
  const me = m.ranking.find((r) => r.id === S.me);
  if (me) recordGame(m.gameId, me.place, m.ranking.length);
  const winner = m.ranking.find((r) => r.place === 1);
  if (winner && m.ranking.length > 1) {
    playFx(winner.fx, { emoji: winner.avatar, color: winner.color });
    sfx.fanfare();
  }
  releaseWake();
}

function closeResults() {
  ui.results = null;
  $('#results').hidden = true;
  $('#results').innerHTML = '';
}

/* ---------- мелочи ---------- */

let wakeLock = null;
async function keepAwake() {
  try {
    if ('wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => (wakeLock = null));
    }
  } catch {}
}
function releaseWake() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

function isIos() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
function isStandalone() {
  return navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
}

function openJoin(code, invited) {
  $('#join-code').value = code || '';
  $('#join-name').value = profile.name;
  $('#join-invite').hidden = !invited;
  $('#join-status').textContent = '';
  renderMe();
  show('join');
}

async function joinGo() {
  const code = $('#join-code').value.replace(/\D/g, '');
  const name = cleanName($('#join-name').value);
  if (code.length !== 6) {
    $('#join-status').textContent = t('join.badCode');
    return;
  }
  if (!name) {
    $('#join-name').focus();
    $('#join-status').textContent = t('join.needName');
    return;
  }
  setProfile({ name });
  const hint = Number(new URLSearchParams(location.search).get('b')) || 0;
  await startSession('guest', { code, hint });
}

async function pickLang() {
  const id = await modal({
    title: t('profile.language'),
    html: `<div class="lang-list">${LANGS.map((l) => `<button class="lang-opt ${l.id === getLang() ? 'sel' : ''}" data-id="${l.id}">${l.flag} ${l.name}</button>`).join('')}</div>`,
    buttons: [{ id: 'cancel', label: t('common.cancel') }],
  });
  if (id && id !== 'cancel') setProfile({ lang: id });
}

/* ---------- действия ---------- */

const ACTIONS = {
  profile: () => {
    ui.back = screen === 'profile' ? ui.back : screen;
    renderProfileScreen();
    show('profile');
  },
  home: () => {
    if (screen === 'profile' && ui.back && ui.back !== 'profile') {
      const back = ui.back;
      if (back === 'room') renderRoom();
      if (back === 'join') renderMe();
      return show(back);
    }
    if (S && screen === 'join') endSession();
    show('home');
  },
  lang: pickLang,
  sound: () => setProfile({ sound: !profile.sound }),
  create: async () => (await askName()) && startSession('online'),
  join: () => openJoin('', false),
  offline: async () => {
    if (!cleanName(profile.name)) setProfile({ name: t('profile.defaultName') });
    startSession('local');
  },
  split: async () => {
    if (!cleanName(profile.name)) setProfile({ name: t('lobby.player1') });
    startSession('split');
  },
  'a2hs-close': () => {
    $('#a2hs').hidden = true;
    store.set('igroteka-a2hs', '1');
  },
  leave: async () => {
    const guests = S?.room?.players.some((p) => !p.host && !p.bot && !p.local);
    if (S?.mode === 'online' && guests && !(await confirmBox(t('lobby.closeConfirm'), t('lobby.closeRoom')))) return;
    endSession();
    setUrl(null);
    show('home');
  },
  share: shareInvite,
  copy: copyLink,
  qr: toggleQr,
  pick: (el) => S?.send({ t: 'pick', game: el.dataset.game }),
  set: (el) => S?.send({ t: 'set', key: el.dataset.key, value: JSON.parse(el.dataset.value) }),
  'room-lang': (el) => S?.send({ t: 'lang', lang: el.dataset.lang }),
  addBot: () => S?.send({ t: 'addBot' }),
  kick: async (el) => {
    const p = S?.room?.players.find((x) => x.id === el.dataset.id);
    if (p && (await confirmBox(t('lobby.kickConfirm', { name: p.name }), t('lobby.kick')))) S.send({ t: 'kick', id: p.id });
  },
  start: () => {
    if (S && !gameBlock(S, S.room.gameId)) S.send({ t: 'start' });
  },
  quit: async () => {
    if (!S) return show('home');
    if (S.isHost) {
      const r = await modal({
        text: t('game.endConfirm'),
        buttons: [
          { id: 'no', label: t('game.continue') },
          { id: 'end', label: t('game.endForAll'), primary: true, danger: true },
        ],
      });
      if (r === 'end') S.send({ t: 'end' });
    } else if (await confirmBox(t('game.leaveConfirm'), t('game.leave'))) {
      endSession();
      setUrl(null);
      show('home');
    }
  },
  'results-close': () => {
    closeResults();
    if (S?.game) return;
    unmountGame();
    show(S ? 'room' : 'home');
    renderRoom();
  },
  'p-avatar': (el) => setProfile({ avatar: el.dataset.v }) || renderProfileScreen(),
  'p-color': (el) => setProfile({ color: el.dataset.v }) || renderProfileScreen(),
  'p-shape': (el) => setProfile({ shape: el.dataset.v }) || renderProfileScreen(),
  'p-fx': (el) => {
    setProfile({ fx: el.dataset.v });
    renderProfileScreen();
    playFx(el.dataset.v, { emoji: profile.avatar, color: profile.color, duration: 2600 });
  },
  'fx-preview': (el) => playFx(el.dataset.v, { emoji: profile.avatar, color: profile.color, duration: 2600 }),
  'p-bg': (el) => setProfile({ bg: el.dataset.v }) || renderProfileScreen(),
  'p-accent': (el) => setProfile({ accent: el.dataset.v }) || renderProfileScreen(),
  'p-style': (el) => setProfile({ style: el.dataset.v }) || renderProfileScreen(),
  'p-lang': (el) => setProfile({ lang: el.dataset.v }),
  'p-sound': (el) => setProfile({ sound: el.dataset.v === '1' }) || renderProfileScreen(),
};

function init() {
  setLang(profile.lang);
  applyTheme(profile);
  setSound(profile.sound);
  applyStatic();
  document.title = t('brand');
  renderHome();

  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-action]');
    if (!a || a.disabled) return;
    const fn = ACTIONS[a.dataset.action];
    if (fn) fn(a, e);
  });
  document.addEventListener('pointerdown', unlockAudio, { capture: true });
  $('#join-form').addEventListener('submit', (e) => {
    e.preventDefault();
    joinGo();
  });
  $('#join-code').addEventListener('input', (e) => (e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6)));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !S) return;
    S.wake();
    if (screen === 'game') keepAwake();
  });

  if (isIos() && !isStandalone() && !store.get('igroteka-a2hs')) $('#a2hs').hidden = false;

  const room = new URLSearchParams(location.search).get('room');
  if (room && /^\d{6}$/.test(room)) {
    openJoin(room, true);
    // Страница перезагрузилась посреди игры — возвращаемся в ту же комнату сами.
    if (sstore.get('igroteka-room') === room && cleanName(profile.name)) joinGo();
  } else {
    show('home');
  }
}

init();
