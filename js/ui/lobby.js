import { esc } from '../core/util.js';
import { t, LANGS } from '../core/i18n.js';
import { GAMES, GAME_IDS } from '../games/registry.js';
import { MAX_PLAYERS } from '../room/host.js';
import { avatar } from './common.js';

// Подписи вариантов настроек.
function optLabel(gameId, key, v) {
  if (key === 'hands' && v === 0) return t('opt.untilEnd');
  if (key === 'time') return t('common.secShort', { n: v });
  if (key === 'diff' || key === 'throw') return t(`opt.${key}.${v}`);
  if (key === 'start') return String(v);
  if (key === 'count') return v === 25 ? t('opt.allLevels') : String(v);
  if (key === 'bb') return `${Math.floor(v / 2)}/${v}`;
  return String(v);
}

export function gameName(id) {
  return t('game.' + id);
}

// Почему эту игру сейчас нельзя запустить (или null, если можно).
export function gameBlock(s, id) {
  const g = GAMES[id];
  const room = s.room;
  if (s.mode === 'split' && id !== 'words') return t('lobby.splitOnlyWords');
  const humans = room.players.filter((p) => !p.bot && p.online).length;
  const bots = room.players.filter((p) => p.bot).length;
  const seats = Math.min(g.max, humans + (g.bots ? bots : 0));
  if (id === 'croc' && humans < 2) return t('lobby.needPeople', { n: 2 });
  if (seats < g.min) return g.bots ? t('lobby.addBots') : t('lobby.needPeople', { n: g.min });
  return null;
}

export function renderLobby(s, ui) {
  const room = s.room;
  const isHost = s.isHost;
  const g = GAMES[room.gameId];
  const settings = room.settings[room.gameId];
  const title = s.mode === 'online' || s.mode === 'guest' ? t('lobby.room', { code: s.code.replace(/(\d{3})(\d{3})/, '$1 $2') }) : s.mode === 'split' ? t('home.split') : t('home.offline');

  const invite =
    s.mode === 'online'
      ? `<div class="card invite">
          <div class="inv-row">
            <div><div class="muted small">${t('lobby.code')}</div><div class="code">${s.code.replace(/(\d{3})(\d{3})/, '$1 $2')}</div></div>
            <div class="net-status ${ui.net?.cls || ''}">${ui.net?.text || ''}</div>
          </div>
          <button class="btn big primary" data-action="share">📤 ${t('lobby.invite')}</button>
          <div class="row">
            <button class="btn" data-action="copy">📋 ${t('lobby.copy')}</button>
            <button class="btn" data-action="qr">▦ ${t('lobby.qr')}</button>
          </div>
          <div class="qr" ${ui.qr ? '' : 'hidden'}>${ui.qrSvg || ''}<p>${t('lobby.qrHint')}</p></div>
          <p class="muted small">${t('lobby.inviteHint')}</p>
        </div>`
      : '';

  const players = room.players
    .map((p) => {
      const badges = [p.host ? '👑' : '', p.bot ? '🤖' : '', !p.online ? '⚠️' : ''].join('');
      const canKick = isHost && !p.host && !p.local;
      return `<div class="pl ${p.id === s.me ? 'me' : ''} ${p.online ? '' : 'off'}" style="--pc:${p.color}" ${canKick ? `data-action="kick" data-id="${p.id}"` : ''}>
        ${avatar(p, 44)}<span class="pl-name">${esc(p.name)}</span><span class="pl-badges">${badges}</span>
      </div>`;
    })
    .join('');
  const slots = s.online ? Array.from({ length: MAX_PLAYERS - room.players.length }, () => '<div class="pl slot"><span class="pl-plus">+</span></div>').join('') : '';

  const gamesHtml = GAME_IDS.map((id) => {
    const block = gameBlock(s, id);
    const sel = id === room.gameId;
    const gg = GAMES[id];
    return `<button class="game-card ${sel ? 'sel' : ''} ${block && !sel ? 'dim' : ''}" data-action="pick" data-game="${id}" ${isHost && room.phase === 'lobby' ? '' : 'disabled'}>
      <span class="gc-icon gi-${id}">${gg.icon}</span><b>${gameName(id)}</b><small>${gg.min === gg.max ? gg.max : `${gg.min}–${gg.max}`} ${t('lobby.players')}</small>
    </button>`;
  }).join('');

  const opts = g.options
    .map(
      (o) => `<div class="opt"><span class="opt-label">${t(`opt.${room.gameId}.${o.key}`)}</span>
        <div class="seg ${o.values.length > 6 ? 'scroll' : ''}">${o.values
          .map((v) => `<button class="${settings[o.key] === v ? 'sel' : ''}" data-action="set" data-key="${o.key}" data-value='${JSON.stringify(v)}' ${isHost ? '' : 'disabled'}>${optLabel(room.gameId, o.key, v)}</button>`)
          .join('')}</div></div>`,
    )
    .join('');
  const langOpt = g.content
    ? `<div class="opt"><span class="opt-label">${t('lobby.wordsLang')}</span><div class="seg">${LANGS.map(
        (l) => `<button class="${room.lang === l.id ? 'sel' : ''}" data-action="room-lang" data-lang="${l.id}" ${isHost ? '' : 'disabled'}>${l.flag}</button>`,
      ).join('')}</div></div>`
    : '';

  const block = gameBlock(s, room.gameId);
  const seated = Math.min(g.max, room.players.filter((p) => (!p.bot || g.bots) && p.online).length);
  const total = room.players.filter((p) => p.online).length;
  const seatNote = !block && total > seated ? t('lobby.seatsNote', { n: seated, max: g.max }) : '';
  const startArea = isHost
    ? `<button class="btn big primary start-btn" data-action="start" ${block || room.phase !== 'lobby' ? 'disabled' : ''}>▶️ ${t('lobby.start', { game: gameName(room.gameId) })}</button>
       <p class="muted center small">${block || seatNote || t('lobby.rules.' + room.gameId)}</p>`
    : `<p class="wait-host">⏳ ${t('lobby.waitHost', { name: esc(room.players.find((p) => p.host)?.name || '') })}</p>
       <p class="muted center small">${t('lobby.rules.' + room.gameId)}</p>`;

  const board = room.board.length
    ? `<div class="card">
        <h3>🏆 ${t('lobby.leaders')}</h3>
        <table class="tbl leaders"><thead><tr><th></th><th></th><th>${t('lobby.points')}</th><th>${t('lobby.wins')}</th><th>${t('lobby.games')}</th></tr></thead><tbody>
        ${room.board
          .map(
            (b, i) => `<tr class="${b.id === s.me ? 'me' : ''}"><td>${['🥇', '🥈', '🥉'][i] || i + 1}</td><td class="ld-name">${avatar(b, 26)} ${esc(b.name)}</td>
              <td><b>${b.points}</b></td><td><b>${b.winsTotal}</b>${Object.entries(b.wins).map(([gid, n]) => ` <span class="ld-g gi-${gid}" title="${gameName(gid)}">${GAMES[gid]?.icon || ''}×${n}</span>`).join('')}</td><td>${b.played}</td></tr>`,
          )
          .join('')}
        </tbody></table>
        <p class="muted small">${t('lobby.leadersHint')}</p>
      </div>`
    : `<div class="card leaders-empty"><h3>🏆 ${t('lobby.leaders')}</h3><p class="muted small">${t('lobby.leadersEmpty')}</p></div>`;

  return `
    <div class="topbar">
      <button class="btn ghost" data-action="leave">← ${t('common.menu')}</button>
      <h2>${title}</h2>
      ${s.mode === 'online' ? `<button class="icon-btn" data-action="share" aria-label="${t('lobby.invite')}">📤</button>` : ''}
    </div>
    ${invite}
    <div class="card">
      <div class="card-head"><h3>${t('lobby.playersTitle')} <span class="muted">${room.players.length}/${MAX_PLAYERS}</span></h3>
        ${isHost && s.mode !== 'split' ? `<button class="btn small" data-action="addBot" ${room.players.length >= MAX_PLAYERS ? 'disabled' : ''}>🤖 + ${t('lobby.bot')}</button>` : ''}</div>
      <div class="players">${players}${slots}</div>
      ${isHost && room.players.some((p) => !p.host && !p.local) ? `<p class="muted small">${t('lobby.kickHint')}</p>` : ''}
    </div>
    <div class="card">
      <h3>${t('lobby.chooseGame')}</h3>
      <div class="games">${gamesHtml}</div>
      <div class="opts">${opts}${langOpt}</div>
    </div>
    ${startArea}
    ${board}`;
}
