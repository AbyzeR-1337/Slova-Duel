// Поддельный контекст игры: собирает все сообщения, которые движок рассылает.
export function fakeCtx(seats, settings = {}, extra = {}) {
  const log = [];
  const priv = {};
  const state = { ended: null };
  const ctx = {
    seats: seats.map((s) => (typeof s === 'string' ? { id: s, name: s } : s)),
    settings,
    lang: 'ru',
    remote: false,
    isOnline: () => true,
    broadcast: (d) => log.push(d),
    sendTo: (id, d) => (priv[id] ||= []).push(d),
    end: (r) => (state.ended = r),
    ...extra,
  };
  ctx.hostId = ctx.seats[0].id;
  ctx.humans = ctx.seats.filter((s) => !s.bot).length;
  return { ctx, log, priv, state };
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function until(fn, timeout = 20000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > timeout) throw new Error('timeout');
    await wait(2);
  }
}
