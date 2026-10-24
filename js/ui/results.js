import { esc } from '../core/util.js';
import { t } from '../core/i18n.js';
import { GAMES } from '../games/registry.js';
import { avatar } from './common.js';

function scoreLabel(gameId, r) {
  if (gameId === 'durak') {
    if (r.label === 'durak') return `🤡 ${t('durak.durak')}`;
    if (r.label === 'out') return `🏁 ${t('durak.notDurak')}`;
    return r.label != null ? `🃏 ${r.label}` : '';
  }
  if (r.score == null) return '';
  if (gameId === 'poker' || gameId === 'bj') return `🪙 ${r.score}`;
  return t('results.points', { n: r.score });
}

export function renderResults(m, me) {
  const r = m.ranking;
  const g = GAMES[m.gameId];
  const winner = r.find((x) => x.place === 1);
  const myRow = r.find((x) => x.id === me);
  const podium = [r[1], r[0], r[2]]
    .map((p, i) => {
      if (!p) return '<div class="pod empty"></div>';
      const h = [70, 100, 50][i];
      return `<div class="pod p${p.place}" style="--pc:${p.color}">
        ${avatar(p, i === 1 ? 64 : 48)}
        <b>${esc(p.name)}</b><small>${scoreLabel(m.gameId, p)}</small>
        <div class="pod-step" style="height:${h}px">${['🥈', '🥇', '🥉'][i]}</div>
      </div>`;
    })
    .join('');
  const rest = r
    .slice(3)
    .map((p) => `<li class="${p.id === me ? 'me' : ''}"><span>${p.place}.</span>${avatar(p, 26)}<b>${esc(p.name)}</b><small>${scoreLabel(m.gameId, p)}</small></li>`)
    .join('');
  let title = t('results.over');
  if (winner && winner.id === me) title = t('results.youWin');
  else if (winner) title = t('results.winner', { name: esc(winner.name) });
  if (m.gameId === 'durak' && m.extra?.durak === me) title = t('durak.youDurak');
  return `<div class="results card">
    <div class="res-game">${g?.icon || ''} ${t('game.' + m.gameId)}</div>
    <h2>${title}</h2>
    ${r.length ? `<div class="podium">${podium}</div>` : ''}
    ${rest ? `<ol class="res-rest">${rest}</ol>` : ''}
    ${myRow && r.length > 1 ? `<p class="muted small">${t('results.leaderboardNote')}</p>` : ''}
    <button class="btn big primary" data-action="results-close">${t('results.toLobby')}</button>
  </div>`;
}
