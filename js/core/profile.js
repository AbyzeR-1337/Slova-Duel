import { store, uid, cleanName } from './util.js';
import { detectLang } from './i18n.js';

export const AVATARS = [
  '🦊', '🐼', '🐯', '🦁', '🐸', '🐵', '🐧', '🦄', '🐙', '🐲',
  '🐱', '🐶', '🐻', '🐨', '🐰', '🦉', '🦋', '🐬', '🦖', '🐝',
  '👽', '🤖', '👻', '🎃', '😎', '🥷', '🧙', '🧛', '🧜', '🦸',
  '🍕', '🌵', '⚡', '🔥', '🌈', '⭐', '🎸', '🎮', '👑', '🐳',
];
export const COLORS = ['#ff6b6b', '#ff922b', '#ffd43b', '#69db7c', '#38d9a9', '#4dabf7', '#748ffc', '#9775fa', '#f783ac', '#e599f7', '#adb5bd', '#f8f9fa'];
export const SHAPES = ['circle', 'square', 'hex', 'star', 'drop'];
export const FXS = ['confetti', 'fireworks', 'emoji', 'stars', 'balloons', 'hearts', 'crown', 'lasers'];

const KEY = 'igroteka-profile';
const STATS = 'igroteka-stats';

function defaults() {
  return {
    id: uid() + uid().slice(0, 4),
    name: '',
    avatar: AVATARS[Math.floor(Math.random() * 20)],
    color: COLORS[Math.floor(Math.random() * 10)],
    shape: 'circle',
    fx: 'confetti',
    bg: 'night',
    accent: 'yellow',
    style: 'cartoon',
    lang: detectLang(),
    sound: true,
  };
}

// Профиль хранится на телефоне: имя, аватар, оформление и язык.
export const profile = { ...defaults(), ...store.json(KEY, {}) };

// Со старой версии (Слова-Дуэль) переносим имя и выключенный звук.
if (!profile.name) profile.name = cleanName(store.get('sd-name', ''));
if (store.get('sd-muted') === '1' && store.json(KEY, null) == null) profile.sound = false;
saveProfile();

export function saveProfile() {
  store.setJson(KEY, profile);
}

export function updateProfile(patch) {
  Object.assign(profile, patch);
  if ('name' in patch) profile.name = cleanName(patch.name);
  saveProfile();
}

export function publicMe() {
  return { id: profile.id, name: profile.name || '?', avatar: profile.avatar, color: profile.color, shape: profile.shape, fx: profile.fx };
}

/* ---------- личная статистика ---------- */

export function getStats() {
  return store.json(STATS, { games: {}, played: 0, wins: 0 });
}

export function recordGame(gameId, place, players) {
  if (players < 2) return;
  const s = getStats();
  const g = (s.games[gameId] ||= { played: 0, wins: 0 });
  g.played++;
  s.played++;
  if (place === 1) {
    g.wins++;
    s.wins++;
  }
  store.setJson(STATS, s);
}
