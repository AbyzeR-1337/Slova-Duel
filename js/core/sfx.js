// Короткие звуки на WebAudio — без файлов. iOS разрешает звук только
// после касания экрана, поэтому контекст создаётся при первом тапе.

let ctx = null;
let enabled = true;

export function unlockAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (AC) ctx = new AC();
}

export function setSound(on) {
  enabled = !!on;
}

function tone(freq, start, dur, { type = 'sine', vol = 0.18, to } = {}) {
  if (!ctx || !enabled) return;
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

function noise(dur = 0.08, vol = 0.12) {
  if (!ctx || !enabled) return;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 1800;
  gain.gain.value = vol;
  src.buffer = buf;
  src.connect(filter).connect(gain).connect(ctx.destination);
  src.start();
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
  join: () => [660, 880].forEach((f, i) => tone(f, i * 0.09, 0.14, { vol: 0.12 })),
  card: () => noise(0.07, 0.14),
  chip: () => [2200, 2900].forEach((f, i) => tone(f, i * 0.03, 0.05, { type: 'square', vol: 0.04 })),
  turn: () => tone(740, 0, 0.12, { type: 'triangle', vol: 0.14 }),
  fanfare: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 0.3)),
};
