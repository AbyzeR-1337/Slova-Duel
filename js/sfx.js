// Короткие звуки на WebAudio — без файлов. iOS разрешает звук только
// после касания экрана, поэтому контекст создаётся при первом тапе.

let ctx = null;
let muted = false;
try {
  muted = localStorage.getItem('sd-muted') === '1';
} catch {}

export function unlockAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (AC) ctx = new AC();
}

export function isMuted() {
  return muted;
}

export function setMuted(v) {
  muted = v;
  try {
    localStorage.setItem('sd-muted', v ? '1' : '0');
  } catch {}
}

function tone(freq, start, dur, { type = 'sine', vol = 0.18, to } = {}) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

export const sfx = {
  tap: () => tone(660, 0, 0.06, { type: 'triangle', vol: 0.12 }),
  back: () => tone(420, 0, 0.06, { type: 'triangle', vol: 0.1 }),
  wrong: () => tone(220, 0, 0.25, { type: 'sawtooth', vol: 0.08, to: 140 }),
  tick: () => tone(1100, 0, 0.04, { type: 'square', vol: 0.05 }),
  win: () => [523, 659, 784].forEach((f, i) => tone(f, i * 0.08, 0.18)),
  lose: () => [392, 330].forEach((f, i) => tone(f, i * 0.12, 0.2, { type: 'triangle' })),
  timeout: () => tone(300, 0, 0.35, { type: 'triangle', to: 200 }),
  go: () => tone(880, 0, 0.2, { vol: 0.15 }),
  fanfare: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 0.3)),
};
