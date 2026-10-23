import { LEVELS, levelInfo } from './logic.js';
import { Match } from './engine.js';
import { HostRoom, GuestRoom, newRoomCode, randomId } from './net.js';
import { Board } from './board.js';
import { sfx, unlockAudio, isMuted, setMuted } from './sfx.js';
import qrcode from '../vendor/qrcode.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const store = {
  get(k, d = '') {
    try {
      return localStorage.getItem(k) ?? d;
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
};

const session = {
  get(k) {
    try {
      return sessionStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      sessionStorage.setItem(k, v);
    } catch {}
  },
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const cleanName = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 14);
const other = (p) => (p === 'p1' ? 'p2' : 'p1');

function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function levelLine(n) {
  const l = levelInfo(n);
  return `${l.words} ${plural(l.words, 'слово', 'слова', 'слов')} · ${l.letters} ${plural(l.letters, 'буква', 'буквы', 'букв')} · ${l.time} с`;
}

const PEER_TIMEOUT = 9000;

// Всё состояние текущей игры.
let S = null;

function freshState(mode) {
  return {
    mode, // 'host' | 'guest' | 'local' | 'solo'
    me: mode === 'guest' ? 'p2' : 'p1',
    players: mode === 'solo' ? ['p1'] : ['p1', 'p2'],
    names: { p1: '', p2: '' },
    scores: { p1: 0, p2: 0 },
    level: 1,
    lobbyLevel: 1,
    total: 0,
    round: null,
    match: null,
    room: null,
    code: null,
    boards: {},
    lastSeq: 0,
    peerHere: false,
    peerSeen: 0,
    myReady: false,
    timers: [],
  };
}

/* ---------- экраны ---------- */

function show(id) {
  $$('.screen').forEach((s) => (s.hidden = s.id !== id));
  window.scrollTo(0, 0);
}

function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.hidden = false;
  t.classList.remove('show');
  void t.offsetWidth;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2200);
}

function myName() {
  return cleanName($('#name').value) || cleanName(store.get('sd-name'));
}

function nameOf(pid) {
  return S.names[pid] || (pid === 'p1' ? 'Игрок 1' : 'Игрок 2');
}

/* ---------- запуск режимов ---------- */

function leave() {
  if (!S) return;
  if (S.room) {
    S.room.send({ t: 'bye' });
    const room = S.room;
    setTimeout(() => room.close(), 150);
  }
  S.match?.stop();
  Object.values(S.boards).forEach((b) => b.destroy());
  S.timers.forEach(clearInterval);
  S = null;
  $('#banner').hidden = true;
  $('#countdown').hidden = true;
  releaseWake();
}

function goHome() {
  leave();
  history.replaceState(null, '', location.pathname + keepParams());
  show('home');
}

// Служебный параметр ?broker= (для локальной проверки) сохраняем в ссылках.
function keepParams() {
  const b = new URLSearchParams(location.search).get('broker');
  return b ? `?broker=${encodeURIComponent(b)}` : '';
}

function makeMatch(opts) {
  S.match = new Match({
    players: S.players,
    names: S.names,
    send: (msg) => {
      onGame(msg);
      if (S?.mode === 'host') S.room?.send(msg);
    },
    ...opts,
  });
}

function startHost() {
  leave();
  S = freshState('host');
  S.names.p1 = myName() || 'Игрок 1';
  S.code = newRoomCode();
  S.myId = randomId();
  makeMatch({ grace: 600, lateMs: 1000 });
  S.room = new HostRoom(S.code, {
    id: S.myId,
    onMessage: onHostNet,
    onStatus: hostStatus,
    canReplaceGuest: () => !S.peerHere || S.peerLeft || Date.now() - S.peerSeen > PEER_TIMEOUT,
  });
  S.room.start();
  S.startedAt = Date.now();
  history.replaceState(null, '', location.pathname + keepParams());
  openLobby();
  S.match.lobby(1);
  startHeartbeat();
  // Если ни один сервер не ответил — подскажем, что дело в интернете.
  S.timers.push(setInterval(() => hostStatus(S.lastStatus), 3000));
}

function startGuest(code) {
  leave();
  S = freshState('guest');
  S.code = code;
  S.names.p2 = cleanName($('#join-name').value) || 'Игрок 2';
  store.set('sd-name', S.names.p2);
  $('#name').value = S.names.p2;
  let id = session.get('sd-guest-' + code);
  if (!id) {
    id = randomId();
    session.set('sd-guest-' + code, id);
  }
  S.myId = id;
  const hint = Number(new URLSearchParams(location.search).get('b')) || 0;
  S.room = new GuestRoom(code, {
    id,
    name: S.names.p2,
    hint,
    onMessage: onGuestNet,
    onStatus: guestStatus,
  });
  S.room.start();
  $('#join-status').textContent = 'Подключаемся…';
  startHeartbeat();
}

function startLocal(mode) {
  leave();
  S = freshState(mode);
  if (mode === 'solo') S.names.p1 = myName() || 'Ты';
  else {
    S.names.p1 = myName() || 'Игрок 1';
    S.names.p2 = cleanName(store.get('sd-name2')) || 'Игрок 2';
  }
  makeMatch({});
  openLobby();
  S.match.lobby(1);
}

/* ---------- сеть ---------- */

function startHeartbeat() {
  S.timers.push(
    setInterval(() => {
      if (!S?.room) return;
      S.room.send({ t: 'ping' });
      checkPeer();
    }, 2500),
  );
}

function checkPeer() {
  if (!S || !S.peerHere) return;
  const lost = Date.now() - S.peerSeen > PEER_TIMEOUT;
  const banner = $('#banner');
  const opp = nameOf(other(S.me));
  if (S.peerLeft) {
    banner.innerHTML = `${esc(opp)} вышел(а) из игры. <button class="btn small" data-action="menu">В меню</button>`;
    banner.hidden = false;
  } else if (lost) {
    banner.textContent = `⚠️ ${opp} не на связи… ждём`;
    banner.hidden = false;
  } else {
    banner.hidden = true;
  }
  if (!$('#lobby').hidden) renderLobby();
}

function hostStatus(st) {
  if (!S || S.mode !== 'host' || !st) return;
  S.lastStatus = st;
  const el = $('#net-status');
  if (st.open > 0) {
    el.textContent = '🟢 Комната открыта';
    el.className = 'net-status ok';
  } else if (Date.now() - S.startedAt > 12000) {
    el.textContent = '🔴 Нет связи с игровым сервером. Проверь интернет.';
    el.className = 'net-status bad';
  } else {
    el.textContent = '🟡 Открываем комнату…';
    el.className = 'net-status';
  }
}

function guestStatus(st) {
  if (!S || S.mode !== 'guest' || S.joined || S.full) return;
  const el = $('#join-status');
  if (st.attempt >= 6) el.textContent = `Не находим комнату ${S.code}. Проверь код или попроси друга создать новую — продолжаем искать…`;
  else if (st.state === 'open') el.textContent = `Ищем комнату ${S.code}…`;
  else el.textContent = 'Подключаемся…';
}

function onHostNet(msg) {
  if (!S) return;
  const wasGone = !S.peerHere || S.peerLeft;
  S.peerSeen = Date.now();
  S.peerLeft = false;
  switch (msg.t) {
    case 'hello': {
      const fresh = wasGone;
      S.peerHere = true;
      S.names.p2 = cleanName(msg.name) || 'Игрок 2';
      S.match.names.p2 = S.names.p2;
      S.room.send({ t: 'welcome', names: { ...S.match.names }, snap: S.match.snapshot() });
      if (S.match.phase === 'lobby') S.match.lobby();
      if (fresh) {
        sfx.go();
        toast(`${S.names.p2} в игре!`);
      }
      checkPeer();
      break;
    }
    case 'solve':
      S.match.claim('p2', msg);
      break;
    case 'ready':
      S.match.setReady('p2');
      break;
    case 'prog':
      onGame({ t: 'prog', p: 'p2', n: msg.n, i: msg.i });
      break;
    case 'bye':
      S.peerLeft = true;
      checkPeer();
      break;
  }
}

function onGuestNet(msg) {
  if (!S) return;
  S.peerSeen = Date.now();
  switch (msg.t) {
    case 'welcome':
      S.joined = true;
      S.peerHere = true;
      S.peerLeft = false;
      Object.assign(S.names, msg.names);
      store.set('sd-name', S.names.p2);
      history.replaceState(null, '', location.pathname + `?room=${S.code}` + keepParams().replace('?', '&'));
      (msg.snap || []).forEach((m) => m && onGame(m));
      checkPeer();
      break;
    case 'full': {
      S.full = true;
      $('#join-status').textContent = 'В этой комнате уже играют двое. Попроси друга создать новую комнату.';
      const room = S.room;
      S.room = null;
      room.close();
      break;
    }
    case 'bye':
      S.peerLeft = true;
      checkPeer();
      break;
    case 'ping':
      break;
    default:
      onGame(msg);
  }
}

/* ---------- действия игрока ---------- */

function act(pid, action) {
  if (!S) return;
  if (S.mode === 'guest') {
    S.room?.send(action);
    return;
  }
  if (action.t === 'solve') S.match.claim(pid, action);
  else if (action.t === 'ready') S.match.setReady(pid);
  else if (action.t === 'prog' && S.mode === 'host') S.room?.send({ t: 'prog', p: pid, n: action.n, i: action.i });
}

/* ---------- лобби ---------- */

function openLobby() {
  const m = S.mode;
  $('#lobby-title').textContent =
    m === 'host' ? 'Игра с другом' : m === 'guest' ? `Комната ${S.code}` : m === 'local' ? 'Вдвоём на одном телефоне' : 'Тренировка';
  $('#invite').hidden = m !== 'host';
  $('#qr').hidden = true;
  if (m === 'host') {
    $('#room-code').textContent = S.code.replace(/(\d{3})(\d{3})/, '$1 $2');
    $('#net-status').textContent = '🟡 Открываем комнату…';
  }
  const players = $('#players');
  players.hidden = m === 'solo';
  if (m === 'local') {
    players.innerHTML = `
      <h3>Игроки</h3>
      <label class="field p1"><span>Снизу</span><input id="local-p1" maxlength="14" value="${esc(S.names.p1)}"></label>
      <label class="field p2"><span>Сверху (экран перевёрнут)</span><input id="local-p2" maxlength="14" value="${esc(S.names.p2)}"></label>`;
  }
  show('lobby');
  renderLobby();
}

function renderLobby() {
  if (!S) return;
  const m = S.mode;
  const editable = m !== 'guest';
  $('#levels').innerHTML = LEVELS.map(
    (l) => `<button type="button" class="level ${l.n === S.lobbyLevel ? 'sel' : ''}" data-level="${l.n}" ${editable ? '' : 'disabled'}>
      <b>${l.n}</b><span class="lv-name">${l.name}</span><span class="lv-info">${levelLine(l.n)}</span></button>`,
  ).join('');
  if (m === 'host' || m === 'guest') {
    const lost = S.peerHere && Date.now() - S.peerSeen > PEER_TIMEOUT;
    const friend =
      m === 'host'
        ? S.peerHere
          ? `<li class="p2">${lost ? '⚠️' : '✅'} ${esc(nameOf('p2'))}</li>`
          : `<li class="wait"><span class="dots"></span> Ждём друга…</li>`
        : `<li class="p2">✅ ${esc(nameOf('p2'))} <small>(ты)</small></li>`;
    $('#players').innerHTML = `<h3>Игроки</h3><ul class="plist">
      <li class="p1">👑 ${esc(nameOf('p1'))} ${m === 'host' ? '<small>(ты)</small>' : ''}</li>${friend}</ul>`;
  }
  const start = $('#start');
  start.hidden = m === 'guest';
  start.disabled = m === 'host' && !S.peerHere;
  const hint = $('#lobby-hint');
  if (m === 'host') hint.textContent = S.peerHere ? 'Выбери уровень и жми «Начать»!' : 'Отправь другу приглашение — «Начать» включится, когда друг зайдёт.';
  else if (m === 'guest') hint.textContent = `Ждём, когда ${nameOf('p1')} начнёт игру…`;
  else if (m === 'local') hint.textContent = 'Положите телефон между собой: верхний игрок играет «вверх ногами».';
  else hint.textContent = 'Собирай слова на время и набирай очки.';
}

function pickLevel(n) {
  if (!S || S.mode === 'guest') return;
  S.lobbyLevel = n;
  S.match.lobby(n);
}

function startGame() {
  if (!S || S.mode === 'guest') return;
  if (S.mode === 'local') {
    S.names.p1 = cleanName($('#local-p1').value) || 'Игрок 1';
    S.names.p2 = cleanName($('#local-p2').value) || 'Игрок 2';
    store.set('sd-name2', S.names.p2);
    S.match.names = { ...S.names };
  }
  S.match.start(S.lobbyLevel);
}

/* ---------- игра ---------- */

function buildBoards() {
  const wrap = $('#boards');
  Object.values(S.boards).forEach((b) => b.destroy());
  wrap.innerHTML = '';
  S.boards = {};
  const split = S.mode === 'local';
  $('#game').classList.toggle('split', split);
  $('#game').classList.toggle('solo', S.mode === 'solo');
  const mk = (pid, cls) => {
    const el = document.createElement('div');
    el.className = `board ${pid} ${cls}`;
    wrap.append(el);
    S.boards[pid] = new Board(el, {
      ticks: pid === S.me,
      onSolve: ({ ms, hints }) => act(pid, { t: 'solve', i: S.round?.i, ms, hints }),
      onProgress: (n) => act(pid, { t: 'prog', i: S.round?.i, n }),
    });
  };
  if (split) {
    mk('p2', 'flipped');
    const mid = document.createElement('div');
    mid.className = 'midstrip';
    mid.innerHTML = `<button class="icon-btn" data-action="quit" aria-label="Выйти">✕</button>
      <span class="sb-level"></span><span class="sb-count"></span>`;
    wrap.append(mid);
    mk('p1', '');
  } else {
    mk(S.me, '');
  }
  S.boardsMode = S.mode;
}

function renderScores() {
  const me = S.me;
  const opp = other(me);
  $('.sb-player.me').dataset.p = me;
  $('.sb-player.opp').dataset.p = opp;
  $('.sb-player.me .sb-name').textContent = nameOf(me);
  $('.sb-player.me .sb-score').textContent = S.scores[me] ?? 0;
  $('.sb-player.opp .sb-name').textContent = nameOf(opp);
  $('.sb-player.opp .sb-score').textContent = S.scores[opp] ?? 0;
  for (const [pid, b] of Object.entries(S.boards)) b.setHead(nameOf(pid), S.scores[pid] ?? 0);
}

function setLabels(level, count) {
  $$('#game .sb-level').forEach((el) => (el.textContent = level));
  $$('#game .sb-count').forEach((el) => (el.textContent = count));
}

function onGame(msg) {
  if (!S) return;
  if (msg.seq) {
    if (msg.seq <= S.lastSeq) return;
    S.lastSeq = msg.seq;
  }
  switch (msg.t) {
    case 'lobby':
      S.lobbyLevel = msg.level;
      Object.assign(S.names, msg.names);
      $('#countdown').hidden = true;
      if ($('#lobby').hidden) openLobby();
      else renderLobby();
      break;
    case 'level':
      onLevel(msg);
      break;
    case 'round':
      onRound(msg);
      break;
    case 'result':
      onResult(msg);
      break;
    case 'levelEnd':
      onLevelEnd(msg);
      break;
    case 'ready':
      onReady(msg.ready);
      break;
    case 'prog':
      if (msg.p !== S.me && S.round && msg.i === S.round.i) S.boards[S.me]?.setOpponent(msg.n);
      break;
  }
}

function onLevel(msg) {
  S.level = msg.level;
  S.total = msg.total;
  Object.assign(S.names, msg.names);
  S.scores = { ...msg.scores };
  S.round = null;
  S.myReady = false;
  if (S.boardsMode !== S.mode || !$('#boards').children.length) buildBoards();
  Object.values(S.boards).forEach((b) => b.idle());
  show('game');
  keepAwake();
  renderScores();
  setLabels(`Уровень ${msg.level} · ${msg.name}`, `${msg.total} ${plural(msg.total, 'слово', 'слова', 'слов')}`);
  if (msg.countdown > 0) countdown(msg);
}

function countdown(msg) {
  const box = $('#countdown');
  const copies = S.mode === 'local' ? 2 : 1;
  const info = `${levelLine(msg.level)} на слово`;
  const draw = (n) => {
    box.innerHTML = Array.from(
      { length: copies },
      (_, k) => `<div class="cd-copy ${k === 1 ? 'flipped' : ''}">
        <div class="cd-level">Уровень ${msg.level} · ${esc(msg.name)}</div>
        <div class="cd-info">${info}</div>
        <div class="cd-num">${n}</div></div>`,
    ).join('');
  };
  box.hidden = false;
  const step = msg.countdown / 3;
  let n = 3;
  draw(n);
  sfx.tick();
  clearInterval(S.cdTimer);
  const timer = setInterval(() => {
    n--;
    if (n <= 0 || !S) {
      clearInterval(timer);
      return;
    }
    draw(n);
    sfx.tick();
  }, step);
  S.cdTimer = timer;
}

function onRound(msg) {
  clearInterval(S.cdTimer);
  $('#countdown').hidden = true;
  if (S.boardsMode !== S.mode || !$('#boards').children.length) buildBoards();
  if ($('#game').hidden) show('game');
  S.round = msg;
  S.scores = { ...msg.scores };
  renderScores();
  setLabels(`Уровень ${S.level}`, `Слово ${msg.i + 1} из ${msg.total}`);
  const online = S.mode === 'host' || S.mode === 'guest';
  Object.values(S.boards).forEach((b) => b.setRound(msg, { showOpponent: online }));
  if (!msg.elapsed) sfx.go();
}

function secs(ms) {
  return (ms / 1000).toFixed(1).replace('.', ',');
}

function onResult(msg) {
  S.scores = { ...msg.scores };
  renderScores();
  const solo = S.mode === 'solo';
  for (const [pid, board] of Object.entries(S.boards)) {
    let outcome;
    let text;
    const word = `<span class="word">${msg.word}</span>`;
    if (msg.winner === pid) {
      outcome = 'win';
      text = `${solo ? '✅' : '🎉'} <b>+${msg.points}</b> за ${secs(msg.ms)} с`;
    } else if (msg.winner) {
      outcome = 'lose';
      const by = msg.solved.includes(pid) && msg.margin != null ? ` на ${secs(msg.margin)} с` : '';
      text = `⚡ ${esc(nameOf(msg.winner))} быстрее${by}<br>${word}`;
    } else {
      outcome = 'timeout';
      text = `⏰ Время вышло<br>${word}`;
    }
    board.showResult(msg, { outcome, text });
  }
  if (S.mode === 'local') msg.winner ? sfx.win() : sfx.timeout();
  else if (msg.winner === S.me) sfx.win();
  else if (msg.winner) sfx.lose();
  else sfx.timeout();
}

function onLevelEnd(msg) {
  clearInterval(S.cdTimer);
  $('#countdown').hidden = true;
  Object.values(S.boards).forEach((b) => b.stopTimer());
  S.scores = { ...msg.scores };
  S.myReady = false;
  S.lastLevelEnd = msg;
  const solo = S.mode === 'solo';
  const winner = msg.final ? msg.matchWinner : msg.levelWinner;
  let emoji;
  let title;
  let sub;
  if (msg.final) {
    title = 'Матч окончен!';
    if (solo) {
      emoji = '🏆';
      sub = `Твой итог: <b>${msg.scores.p1}</b> очков`;
    } else if (winner) {
      emoji = S.mode === 'local' || winner === S.me ? '🏆' : '🥈';
      sub = `Победитель матча: <b>${esc(nameOf(winner))}</b>!`;
    } else {
      emoji = '🤝';
      sub = 'Ничья — вы достойные соперники!';
    }
  } else {
    title = `Уровень ${msg.level} пройден`;
    if (solo) {
      emoji = '⭐';
      sub = `За уровень: <b>${msg.levelScores.p1}</b> очков`;
    } else if (winner) {
      emoji = S.mode === 'local' || winner === S.me ? '🥇' : '💪';
      sub = `Победитель уровня: <b>${esc(nameOf(winner))}</b>`;
    } else {
      emoji = '🤝';
      sub = 'Уровень вничью';
    }
  }
  $('#res-emoji').textContent = emoji;
  $('#res-title').textContent = title;
  $('#res-sub').innerHTML = sub;
  const ids = S.players;
  $('#res-scores').innerHTML = `<table><thead><tr><th></th><th>Уровень</th><th>Всего</th></tr></thead><tbody>${ids
    .map(
      (p) => `<tr class="${p}"><td>${esc(nameOf(p))}${p === S.me && S.mode !== 'local' && !solo ? ' <small>(ты)</small>' : ''}</td>
      <td>${msg.levelScores[p]}</td><td><b>${msg.scores[p]}</b></td></tr>`,
    )
    .join('')}</tbody></table>`;
  $('#res-words').innerHTML = msg.history
    .map((h) => {
      const who = h.winner ? (solo ? `+${h.points}` : esc(nameOf(h.winner))) : '—';
      return `<li class="${h.winner || 'none'}"><span>${h.word}</span><span>${who}</span></li>`;
    })
    .join('');
  const next = $('#res-next');
  next.disabled = false;
  next.textContent = msg.final ? '🔁 Сыграть ещё' : `Дальше: уровень ${msg.level + 1} →`;
  $('#res-nextinfo').textContent = msg.final ? '' : `${LEVELS[msg.level].name}: ${levelLine(msg.level + 1)} на слово`;
  $('#res-ready').textContent = '';
  show('results');
  releaseWake();
  if (msg.final && (solo || S.mode === 'local' || winner === S.me)) {
    sfx.fanfare();
    confetti();
  }
}

function onReady(ready) {
  if (!S || S.mode === 'local' || S.mode === 'solo') return;
  const opp = other(S.me);
  const parts = [];
  if (ready[S.me]) parts.push('Ты готов(а) ✓');
  parts.push(ready[opp] ? `${nameOf(opp)} готов(а) ✓` : `Ждём: ${nameOf(opp)}…`);
  $('#res-ready').textContent = parts.join(' · ');
  if (ready[S.me]) {
    $('#res-next').disabled = true;
  }
}

function pressNext() {
  if (!S || S.myReady) return;
  S.myReady = true;
  if (S.mode === 'local') {
    S.match.setReady('p1');
    S.match.setReady('p2');
  } else {
    act(S.me, { t: 'ready' });
    $('#res-next').disabled = true;
    if (S.mode === 'guest') $('#res-ready').textContent = `Ждём: ${nameOf('p1')}…`;
  }
}

/* ---------- приглашение ---------- */

function inviteUrl() {
  const u = new URL(location.pathname, location.origin);
  u.searchParams.set('room', S.code);
  const first = S.room?.firstOpen ?? -1;
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
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

async function copyLink() {
  const ok = await copyText(inviteUrl());
  toast(ok ? 'Ссылка скопирована — вставь её в чат другу' : 'Не получилось скопировать');
}

async function shareInvite() {
  const url = inviteUrl();
  const text = `${nameOf('p1')} зовёт тебя в «Слова-Дуэль»! Кто быстрее соберёт слово? Код комнаты: ${S.code}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Слова-Дуэль', text, url });
    } catch (e) {
      if (e.name !== 'AbortError') copyLink();
    }
  } else {
    copyLink();
  }
}

function toggleQr() {
  const box = $('#qr');
  if (!box.hidden) {
    box.hidden = true;
    return;
  }
  const qr = qrcode(0, 'M');
  qr.addData(inviteUrl());
  qr.make();
  box.innerHTML = qr.createSvgTag(6, 3) + '<p>Друг наводит камеру iPhone на код — и сразу попадает в игру</p>';
  box.hidden = false;
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

function confetti() {
  const box = document.createElement('div');
  box.className = 'confetti';
  const colors = ['#ffd23f', '#ff6b6b', '#4dabf7', '#69db7c', '#da77f2'];
  for (let i = 0; i < 70; i++) {
    const s = document.createElement('i');
    s.style.left = Math.random() * 100 + '%';
    s.style.background = colors[i % colors.length];
    s.style.animationDelay = Math.random() * 0.8 + 's';
    s.style.animationDuration = 2 + Math.random() * 1.5 + 's';
    s.style.transform = `rotate(${Math.random() * 360}deg)`;
    box.append(s);
  }
  document.body.append(box);
  setTimeout(() => box.remove(), 4500);
}

function isIos() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
}

function renderSound() {
  $('#sound').textContent = isMuted() ? '🔇' : '🔊';
}

function openJoin(code, invited) {
  leave();
  $('#join-code').value = code || '';
  $('#join-name').value = myName();
  $('#join-invite').hidden = !invited;
  $('#join-status').textContent = '';
  show('join');
  if (!invited) $('#join-code').focus();
}

function joinGo() {
  const code = $('#join-code').value.replace(/\D/g, '');
  if (code.length !== 6) {
    $('#join-status').textContent = 'Код — это 6 цифр. Его видно у друга на экране.';
    return;
  }
  if (!cleanName($('#join-name').value)) {
    $('#join-name').focus();
    $('#join-status').textContent = 'Напиши своё имя, чтобы друг знал, кто пришёл.';
    return;
  }
  startGuest(code);
}

/* ---------- события ---------- */

const ACTIONS = {
  host: startHost,
  join: () => openJoin('', false),
  local: () => startLocal('local'),
  solo: () => startLocal('solo'),
  menu: goHome,
  quit: () => {
    if (S && (S.mode === 'local' || S.mode === 'solo' || confirm('Выйти из игры?'))) goHome();
  },
  share: shareInvite,
  copy: copyLink,
  qr: toggleQr,
  start: startGame,
  next: pressNext,
  'a2hs-close': () => {
    $('#a2hs').hidden = true;
    store.set('sd-a2hs', '1');
  },
};

function init() {
  $('#name').value = store.get('sd-name');
  $('#level-table').innerHTML = LEVELS.map((l) => `<li><b>${l.n}. ${l.name}</b> — ${levelLine(l.n)} на слово</li>`).join('');
  $('#name').addEventListener('input', () => store.set('sd-name', cleanName($('#name').value)));
  renderSound();

  document.addEventListener('click', (e) => {
    const lv = e.target.closest('[data-level]');
    if (lv && !lv.disabled) return pickLevel(Number(lv.dataset.level));
    const a = e.target.closest('[data-action]');
    if (a && ACTIONS[a.dataset.action]) ACTIONS[a.dataset.action]();
  });
  document.addEventListener('pointerdown', unlockAudio, { capture: true });
  $('#sound').addEventListener('click', () => {
    setMuted(!isMuted());
    renderSound();
  });
  $('#join-form').addEventListener('submit', (e) => {
    e.preventDefault();
    joinGo();
  });
  $('#join-code').addEventListener('input', (e) => (e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6)));

  document.addEventListener('keydown', (e) => {
    if (!S || $('#game').hidden || e.metaKey || e.ctrlKey || e.altKey) return;
    const b = S.boards[S.me];
    if (b) {
      if (e.key === 'Backspace') e.preventDefault();
      b.handleKey(e);
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !S) return;
    S.room?.wake();
    if (!$('#game').hidden) keepAwake();
  });

  if (isIos() && !isStandalone() && !store.get('sd-a2hs')) $('#a2hs').hidden = false;

  const room = new URLSearchParams(location.search).get('room');
  if (room && /^\d{6}$/.test(room)) {
    openJoin(room, true);
    // Страница перезагрузилась посреди игры — возвращаемся в ту же комнату сами.
    if (session.get('sd-guest-' + room) && cleanName($('#join-name').value)) startGuest(room);
  } else {
    show('home');
  }
}

init();
