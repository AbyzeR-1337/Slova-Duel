// Анимации победы на одном холсте поверх экрана. Победитель выбирает
// свою анимацию в профиле — её видят все игроки комнаты.

const PALETTE = ['#ffd23f', '#ff6b6b', '#4dabf7', '#69db7c', '#da77f2', '#ff922b', '#38d9a9', '#f783ac'];
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

let running = null;

export function playFx(type = 'confetti', { emoji = '🎉', color = '#ffd23f', duration = 4200 } = {}) {
  if (typeof document === 'undefined') return;
  running?.stop();
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canvas = document.createElement('canvas');
  canvas.className = 'fx-canvas';
  document.body.append(canvas);
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  let W = 0;
  let H = 0;
  const resize = () => {
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener('resize', resize);

  const parts = [];
  const scale = reduce ? 0.3 : 1;
  const emitters = {
    confetti() {
      for (let i = 0; i < 160 * scale; i++) {
        parts.push({ kind: 'rect', x: rnd(0, W), y: rnd(-H * 0.6, -10), vx: rnd(-40, 40), vy: rnd(120, 260), r: rnd(0, 6.28), vr: rnd(-6, 6), w: rnd(6, 11), h: rnd(9, 16), c: pick(PALETTE) });
      }
    },
    fireworks(t) {
      if (t % 0.45 < 0.017 && t < duration / 1000 - 1.2) burst(rnd(W * 0.15, W * 0.85), rnd(H * 0.12, H * 0.45), pick(PALETTE));
    },
    emoji() {
      for (let i = 0; i < 46 * scale; i++) parts.push({ kind: 'text', s: emoji, x: rnd(0, W), y: rnd(-H, -20), vx: rnd(-15, 15), vy: rnd(120, 240), r: rnd(-0.4, 0.4), vr: rnd(-1, 1), size: rnd(26, 46) });
    },
    stars() {
      for (let i = 0; i < 60 * scale; i++) parts.push({ kind: 'text', s: pick(['⭐', '✨', '🌟', '💫']), x: rnd(0, W), y: rnd(-H, -20), vx: rnd(-20, 20), vy: rnd(90, 200), r: 0, vr: rnd(-3, 3), size: rnd(18, 36) });
    },
    balloons() {
      for (let i = 0; i < 26 * scale; i++) parts.push({ kind: 'balloon', x: rnd(0, W), y: H + rnd(20, H * 0.7), vx: rnd(-10, 10), vy: -rnd(90, 170), c: pick(PALETTE), size: rnd(22, 34), ph: rnd(0, 6.28) });
    },
    hearts() {
      for (let i = 0; i < 40 * scale; i++) parts.push({ kind: 'text', s: pick(['❤️', '💖', '💕', '💗', '💘']), x: rnd(0, W), y: H + rnd(10, H * 0.6), vx: rnd(-20, 20), vy: -rnd(80, 170), r: 0, vr: 0, size: rnd(22, 40), ph: rnd(0, 6.28), wobble: true });
    },
    crown() {
      parts.push({ kind: 'crown', x: W / 2, y: -80, vy: 0, size: Math.min(W, H) * 0.32, settled: false });
    },
    lasers() {
      for (let i = 0; i < 6; i++) parts.push({ kind: 'laser', ox: i % 2 ? W : 0, oy: H, a: rnd(-2.6, -0.5), va: rnd(-1.4, 1.4) * (i % 2 ? -1 : 1), c: pick(['#ff00c8', '#00e5ff', '#a3e635', '#ffd23f']) });
    },
  };

  function burst(x, y, c) {
    for (let i = 0; i < 70 * scale; i++) {
      const a = rnd(0, 6.28);
      const v = rnd(60, 260);
      parts.push({ kind: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rnd(0.8, 1.4), age: 0, c });
    }
  }

  (emitters[type] || emitters.confetti)(0);
  if (type === 'crown' || type === 'lasers') emitters.confetti();

  let last = performance.now();
  const start = last;
  let raf;
  const frame = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = (now - start) / 1000;
    if (type === 'fireworks') emitters.fireworks(t);
    ctx.clearRect(0, 0, W, H);
    const fade = Math.min(1, Math.max(0, (duration / 1000 - t) / 0.8));
    ctx.globalAlpha = fade;
    for (const p of parts) {
      switch (p.kind) {
        case 'rect':
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.r += p.vr * dt;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.r);
          ctx.fillStyle = p.c;
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 1.7)));
          ctx.restore();
          break;
        case 'text':
          p.x += (p.vx + (p.wobble ? Math.sin(t * 3 + p.ph) * 30 : 0)) * dt;
          p.y += p.vy * dt;
          p.r += p.vr * dt;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.r);
          ctx.font = `${p.size}px system-ui, "Apple Color Emoji", sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText(p.s, 0, 0);
          ctx.restore();
          break;
        case 'balloon': {
          p.x += (p.vx + Math.sin(t * 2 + p.ph) * 20) * dt;
          p.y += p.vy * dt;
          ctx.strokeStyle = 'rgba(255,255,255,.6)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y + p.size * 1.2);
          ctx.quadraticCurveTo(p.x - 6, p.y + p.size * 2, p.x + 2, p.y + p.size * 2.6);
          ctx.stroke();
          ctx.fillStyle = p.c;
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, p.size * 0.8, p.size, 0, 0, 6.28);
          ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,.35)';
          ctx.beginPath();
          ctx.ellipse(p.x - p.size * 0.3, p.y - p.size * 0.35, p.size * 0.18, p.size * 0.28, -0.5, 0, 6.28);
          ctx.fill();
          break;
        }
        case 'spark':
          p.age += dt;
          p.vy += 140 * dt;
          p.vx *= 0.985;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          if (p.age < p.life) {
            ctx.globalAlpha = fade * (1 - p.age / p.life);
            ctx.fillStyle = p.c;
            ctx.beginPath();
            ctx.arc(p.x, p.y, 2.4, 0, 6.28);
            ctx.fill();
            ctx.globalAlpha = fade;
          }
          break;
        case 'crown': {
          const target = H * 0.32;
          if (!p.settled) {
            p.vy += 1400 * dt;
            p.y += p.vy * dt;
            if (p.y > target) {
              p.y = target;
              p.vy *= -0.35;
              if (Math.abs(p.vy) < 60) {
                p.settled = true;
                burst(p.x, p.y, '#ffd23f');
                burst(p.x, p.y, '#fff3bf');
              }
            }
          }
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(Math.sin(t * 2) * 0.06);
          ctx.shadowColor = '#ffd23f';
          ctx.shadowBlur = 30;
          ctx.font = `${p.size}px system-ui, "Apple Color Emoji", sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('👑', 0, 0);
          ctx.restore();
          break;
        }
        case 'laser': {
          p.a += p.va * dt;
          if (p.a < -2.9 || p.a > -0.25) p.va *= -1;
          const len = Math.hypot(W, H);
          const g = ctx.createLinearGradient(p.ox, p.oy, p.ox + Math.cos(p.a) * len, p.oy + Math.sin(p.a) * len);
          g.addColorStop(0, p.c);
          g.addColorStop(1, 'transparent');
          ctx.strokeStyle = g;
          ctx.lineWidth = 6;
          ctx.shadowColor = p.c;
          ctx.shadowBlur = 18;
          ctx.beginPath();
          ctx.moveTo(p.ox, p.oy);
          ctx.lineTo(p.ox + Math.cos(p.a) * len, p.oy + Math.sin(p.a) * len);
          ctx.stroke();
          ctx.shadowBlur = 0;
          break;
        }
      }
    }
    if (t * 1000 < duration) raf = requestAnimationFrame(frame);
    else stop();
  };
  const stop = () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
    canvas.remove();
    if (running?.canvas === canvas) running = null;
  };
  raf = requestAnimationFrame(frame);
  running = { stop, canvas };
  return running;
}
