import { esc } from '../core/util.js';
import { t, LANGS } from '../core/i18n.js';
import { AVATARS, COLORS, SHAPES, FXS, getStats } from '../core/profile.js';
import { BACKGROUNDS, ACCENTS, STYLES } from '../core/theme.js';
import { GAMES, GAME_IDS } from '../games/registry.js';
import { avatar } from './common.js';

const FX_ICON = { confetti: '🎊', fireworks: '🎆', emoji: '🌧️', stars: '⭐', balloons: '🎈', hearts: '💖', crown: '👑', lasers: '🪩' };

export function renderProfile(p) {
  const stats = getStats();
  const statRows = GAME_IDS.map((id) => {
    const g = stats.games[id] || { played: 0, wins: 0 };
    return `<tr><td>${GAMES[id].icon} ${t('game.' + id)}</td><td>${g.played}</td><td>${g.wins}</td></tr>`;
  }).join('');
  return `
    <div class="card prof-head" style="--pc:${p.color}">
      ${avatar(p, 84, 'big')}
      <label class="field grow"><span>${t('profile.name')}</span><input id="prof-name" maxlength="16" autocomplete="nickname" value="${esc(p.name)}" placeholder="${t('profile.namePh')}"></label>
    </div>

    <div class="card">
      <h3>${t('profile.avatar')}</h3>
      <div class="pick-grid avatars">${AVATARS.map((a) => `<button class="pick ${a === p.avatar ? 'sel' : ''}" data-action="p-avatar" data-v="${a}">${a}</button>`).join('')}</div>
      <h3>${t('profile.color')}</h3>
      <div class="dots">${COLORS.map((c) => `<button class="dot ${c === p.color ? 'sel' : ''}" style="--c:${c}" data-action="p-color" data-v="${c}" aria-label="${c}"></button>`).join('')}</div>
      <h3>${t('profile.shape')}</h3>
      <div class="shapes">${SHAPES.map((s) => `<button class="shape-opt ${s === p.shape ? 'sel' : ''}" data-action="p-shape" data-v="${s}">${avatar({ ...p, shape: s }, 44)}<small>${t('shape.' + s)}</small></button>`).join('')}</div>
    </div>

    <div class="card">
      <h3>${t('profile.fx')}</h3>
      <p class="muted small">${t('profile.fxHint')}</p>
      <div class="fx-list">${FXS.map(
        (f) => `<div class="fx-item ${f === p.fx ? 'sel' : ''}"><button class="fx-pick" data-action="p-fx" data-v="${f}"><span>${FX_ICON[f]}</span>${t('fx.' + f)}</button><button class="icon-btn small" data-action="fx-preview" data-v="${f}" aria-label="${t('profile.preview')}">▶</button></div>`,
      ).join('')}</div>
    </div>

    <div class="card">
      <h3>${t('profile.background')}</h3>
      <div class="bg-grid">${BACKGROUNDS.map((b) => `<button class="bg-opt ${b.id === p.bg ? 'sel' : ''}" data-action="p-bg" data-v="${b.id}" style="background:${b.preview}"><small>${t('bg.' + b.id)}</small></button>`).join('')}</div>
      <h3>${t('profile.accent')}</h3>
      <div class="dots">${ACCENTS.map((a) => `<button class="dot ${a.id === p.accent ? 'sel' : ''}" style="--c:${a.color}" data-action="p-accent" data-v="${a.id}" aria-label="${t('accent.' + a.id)}"></button>`).join('')}</div>
      <h3>${t('profile.style')}</h3>
      <div class="seg wide">${STYLES.map((s) => `<button class="${s === p.style ? 'sel' : ''}" data-action="p-style" data-v="${s}">${t('style.' + s)}</button>`).join('')}</div>
    </div>

    <div class="card">
      <h3>${t('profile.language')}</h3>
      <div class="lang-list">${LANGS.map((l) => `<button class="lang-opt ${l.id === p.lang ? 'sel' : ''}" data-action="p-lang" data-v="${l.id}">${l.flag} ${l.name}</button>`).join('')}</div>
      <div class="opt"><span class="opt-label">${t('profile.sound')}</span>
        <div class="seg"><button class="${p.sound ? 'sel' : ''}" data-action="p-sound" data-v="1">🔊 ${t('common.on')}</button><button class="${p.sound ? '' : 'sel'}" data-action="p-sound" data-v="0">🔇 ${t('common.off')}</button></div></div>
    </div>

    <div class="card">
      <h3>📊 ${t('profile.stats')}</h3>
      <table class="tbl"><thead><tr><th></th><th>${t('lobby.games')}</th><th>${t('lobby.wins')}</th></tr></thead><tbody>${statRows}</tbody>
      <tfoot><tr><td><b>${t('profile.total')}</b></td><td><b>${stats.played}</b></td><td><b>${stats.wins}</b></td></tr></tfoot></table>
    </div>`;
}
