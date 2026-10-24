// Оформление: фон, цвет акцента и стиль интерфейса. Сами цвета — в css/base.css.

export const BACKGROUNDS = [
  { id: 'night', preview: 'linear-gradient(160deg,#241a5c,#5a2a84)' },
  { id: 'sunset', preview: 'linear-gradient(160deg,#ff7e5f,#c2185b 60%,#3b1d60)' },
  { id: 'ocean', preview: 'linear-gradient(160deg,#0f4c75,#1b9aaa 70%,#a0e7e5)' },
  { id: 'forest', preview: 'linear-gradient(160deg,#0b3d2e,#1e7a46 70%,#9ad18b)' },
  { id: 'candy', preview: 'linear-gradient(160deg,#ffafcc,#cdb4db 55%,#a2d2ff)' },
  { id: 'neon', preview: 'radial-gradient(circle at 30% 20%,#ff00c8 0,transparent 45%),radial-gradient(circle at 80% 80%,#00e5ff 0,transparent 45%),#0a0a1a' },
  { id: 'space', preview: 'radial-gradient(circle at 70% 30%,#3a2b7a 0,transparent 50%),#05040f' },
  { id: 'aurora', preview: 'linear-gradient(120deg,#0b1d3a,#11998e,#38ef7d,#5b247a)' },
  { id: 'snow', preview: 'linear-gradient(180deg,#0f2b4c,#3c6e9f)' },
  { id: 'light', preview: 'linear-gradient(160deg,#f8f9fa,#e7ecff)' },
];

export const ACCENTS = [
  { id: 'yellow', color: '#ffd23f' },
  { id: 'pink', color: '#ff5fa2' },
  { id: 'cyan', color: '#22d3ee' },
  { id: 'lime', color: '#a3e635' },
  { id: 'orange', color: '#ff922b' },
  { id: 'violet', color: '#b197fc' },
  { id: 'red', color: '#ff5252' },
  { id: 'white', color: '#f1f3f5' },
];

export const STYLES = ['cartoon', 'glass', 'minimal', 'retro'];

export function applyTheme(p) {
  const root = document.documentElement;
  root.dataset.bg = BACKGROUNDS.some((b) => b.id === p.bg) ? p.bg : 'night';
  root.dataset.accent = ACCENTS.some((a) => a.id === p.accent) ? p.accent : 'yellow';
  root.dataset.style = STYLES.includes(p.style) ? p.style : 'cartoon';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = p.bg === 'light' ? '#f8f9fa' : '#1b1442';
}
