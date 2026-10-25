import { Timers, shuffle } from '../../core/util.js';

// «Бункер»: случилась катастрофа, а мест в убежище — только на половину
// группы. У каждого семь карт (биология, профессия, здоровье, хобби, фобия,
// багаж, факт). Каждый раунд игроки открывают по карте, спорят и голосуют,
// кого не пустить. Кто остался — спасся.
//
// В текстах карт «+» в начале помечает полезную черту, «!» — вредную:
// так боты решают, что открыть и против кого голосовать. На экране значков нет.

export const CATS = ['bio', 'prof', 'health', 'hobby', 'phobia', 'bag', 'fact'];
const MS = { intro: 12000, reveal: 30000, vote: 30000, verdict: 8000, over: 9000 };

const LOADERS = {
  ru: () => import('../../lang/bunker-ru.js'),
  en: () => import('../../lang/bunker-en.js'),
  uk: () => import('../../lang/bunker-uk.js'),
  es: () => import('../../lang/bunker-es.js'),
  de: () => import('../../lang/bunker-de.js'),
};

export async function loadBunker(lang) {
  return (await (LOADERS[lang] || LOADERS.ru)()).default;
}

export async function createGame(ctx) {
  return new BunkerGame(ctx, await loadBunker(ctx.lang));
}

export const mark = (s) => (s[0] === '+' ? 1 : s[0] === '!' ? -1 : 0);

export class BunkerGame {
  constructor(ctx, content, { rng = Math.random, timeScale = 1 } = {}) {
    this.ctx = ctx;
    this.c = content;
    this.rng = rng;
    this.timeScale = timeScale;
    this.timers = new Timers();
    this.talkMs = (Number(ctx.settings.talk) || 90) * 1000;
    this.players = ctx.seats.map((s) => ({ id: s.id, bot: !!s.bot, cards: {}, open: new Set(), alive: true, vote: undefined, ready: false, outAt: 0 }));
    this.capacity = Math.max(1, Math.floor(this.players.length / 2));
    this.eliminations = this.players.length - this.capacity;
    this.rounds = Math.max(this.eliminations, 3);
    this.round = 0;
    this.phase = 'intro';
    this.chat = [];
    this.k = 0;
    this.outCount = 0;
    this.last = null;
  }

  ms(x) {
    return Math.round(x * this.timeScale);
  }

  pick(list, n = 1) {
    return shuffle(list, this.rng).slice(0, n);
  }

  deal() {
    const decks = {};
    for (const cat of CATS.slice(1)) decks[cat] = shuffle(this.c[cat], this.rng);
    for (const p of this.players) {
      const female = this.rng() < 0.5;
      const age = 18 + Math.floor(this.rng() ** 1.3 * 60);
      p.cards.bio = `${age >= 70 ? '!' : ''}${female ? this.c.female : this.c.male}, ${this.c.age(age)}`;
      for (const cat of CATS.slice(1)) {
        const deck = decks[cat];
        let card = deck.pop() ?? this.pick(this.c[cat])[0];
        if (cat === 'prof') {
          const plus = card[0] === '+' || card[0] === '!' ? card[0] : '';
          const exp = Math.max(0, Math.min(age - 18, Math.floor(this.rng() * 25)));
          card = `${plus}${card.slice(plus.length)} (${this.c.exp(exp)})`;
        }
        p.cards[cat] = card;
      }
    }
  }

  start() {
    this.deal();
    const cat = this.pick(this.c.cat)[0];
    this.world = {
      cat,
      size: 40 + Math.floor(this.rng() * 26) * 10,
      stay: 6 + Math.floor(this.rng() * 31) * 2,
      features: this.pick(this.c.bunker, 3),
      capacity: this.capacity,
    };
    this.setPhase('intro', MS.intro);
  }

  stop() {
    this.timers.clear();
  }

  player(id) {
    return this.players.find((p) => p.id === id);
  }

  alive() {
    return this.players.filter((p) => p.alive);
  }

  scale(ms) {
    const humansAlive = this.players.some((p) => p.alive && !p.bot && this.ctx.isOnline(p.id));
    return this.ms(humansAlive ? ms : Math.min(ms, 2500));
  }

  setPhase(phase, ms) {
    this.phase = phase;
    this.timers.cancel(this.phaseTimer);
    const d = this.scale(ms);
    this.deadline = Date.now() + d;
    this.phaseTimer = this.timers.later(() => this.advance(), d);
    this.broadcast();
  }

  // Раунды с голосованием — последние: сначала знакомимся, потом выгоняем.
  votesThisRound() {
    return this.round > this.rounds - this.eliminations;
  }

  advance() {
    if (this.over) return;
    switch (this.phase) {
      case 'intro':
      case 'verdict':
        return this.nextRound();
      case 'reveal':
        for (const p of this.alive()) if (!this.revealedThisRound(p)) this.autoReveal(p);
        return this.startTalk();
      case 'talk':
        if (this.votesThisRound()) return this.startVote();
        return this.nextRound();
      case 'vote':
        return this.resolveVote();
      case 'over':
        return this.ctx.end(this.finish());
    }
  }

  nextRound() {
    if (this.alive().length <= this.capacity) return this.finishGame();
    this.round++;
    for (const p of this.players) {
      p.ready = false;
      p.vote = undefined;
      p.revealRound = 0;
    }
    if (this.round === 1) {
      for (const p of this.alive()) {
        p.open.add('bio');
        p.open.add('prof');
        p.revealRound = 1;
      }
      return this.startTalk();
    }
    this.setPhase('reveal', MS.reveal);
    for (const p of this.alive()) if (p.bot) this.timers.later(() => this.botReveal(p), this.scale(1500 + this.rng() * 6000));
  }

  revealedThisRound(p) {
    return p.revealRound === this.round;
  }

  reveal(p, cat) {
    if (this.phase !== 'reveal' || !p.alive || this.revealedThisRound(p) || !CATS.includes(cat) || p.open.has(cat)) return;
    p.open.add(cat);
    p.revealRound = this.round;
    this.broadcast();
    if (this.alive().every((q) => this.revealedThisRound(q))) {
      this.timers.cancel(this.phaseTimer);
      this.phaseTimer = this.timers.later(() => this.advance(), this.ms(1500));
    }
  }

  hidden(p) {
    return CATS.filter((c) => !p.open.has(c));
  }

  autoReveal(p) {
    const h = this.hidden(p);
    if (h.length) this.reveal(p, h[Math.floor(this.rng() * h.length)]);
    else p.revealRound = this.round;
  }

  // Бот сначала хвастается полезным, вредное придерживает.
  botReveal(p) {
    if (this.phase !== 'reveal' || this.revealedThisRound(p)) return;
    const h = this.hidden(p).sort((a, b) => mark(p.cards[b]) - mark(p.cards[a]) + (this.rng() - 0.5) * 0.8);
    if (h.length) this.reveal(p, h[0]);
    else p.revealRound = this.round;
  }

  startTalk() {
    this.setPhase('talk', this.talkMs);
    const bots = shuffle(
      this.alive().filter((p) => p.bot),
      this.rng,
    );
    let at = 2500;
    for (const p of bots.slice(0, 3)) {
      at += 2000 + this.rng() * 6000;
      if (at > this.talkMs - 3000) break;
      this.timers.later(() => this.botTalk(p), this.scale(at));
    }
    this.checkReady();
  }

  // Насколько игрок плох для бункера по открытым картам (для ботов).
  badness(q) {
    let s = 0;
    for (const c of q.open) s -= mark(q.cards[c]) * (c === 'health' || c === 'prof' ? 3 : 2);
    return s;
  }

  botTarget(p) {
    const others = this.alive().filter((q) => q !== p);
    if (!others.length) return null;
    const grudge = this.players.find((q) => q.lastVote === p.id && q.alive && q !== p);
    let best = null;
    let bestScore = -Infinity;
    for (const q of others) {
      const sc = this.badness(q) + this.rng() * 3 + (q === grudge ? 1.5 : 0);
      if (sc > bestScore) {
        bestScore = sc;
        best = q;
      }
    }
    return best.id;
  }

  botTalk(p) {
    if (this.phase !== 'talk' || !p.alive) return;
    const good = [...p.open].filter((c) => mark(p.cards[c]) > 0);
    const r = this.rng();
    if (good.length && r < 0.45) return this.pushChat({ id: p.id, key: 'useful', card: p.cards[good[Math.floor(this.rng() * good.length)]].replace(/^[+!]/, '') });
    const target = this.botTarget(p);
    if (target && r < 0.8) return this.pushChat({ id: p.id, key: this.votesThisRound() ? 'against' : 'doubt', who: target });
    this.pushChat({ id: p.id, key: 'hmm' });
  }

  pushChat(msg) {
    msg.t = 'chat';
    msg.k = ++this.k;
    this.chat.push(msg);
    if (this.chat.length > 40) this.chat.shift();
    this.ctx.broadcast(msg);
  }

  checkReady() {
    if (this.phase !== 'talk') return;
    const humans = this.alive().filter((p) => !p.bot && this.ctx.isOnline(p.id));
    if (humans.every((p) => p.ready)) {
      this.timers.cancel(this.phaseTimer);
      this.phaseTimer = this.timers.later(() => this.advance(), this.ms(humans.length ? 1500 : 4000));
    }
  }

  startVote() {
    this.setPhase('vote', MS.vote);
    for (const p of this.alive()) if (p.bot) this.timers.later(() => this.vote(p, this.botTarget(p)), this.scale(2000 + this.rng() * 10000));
  }

  vote(p, target) {
    if (this.phase !== 'vote' || !p.alive || p.vote !== undefined) return;
    const q = this.player(target);
    if (!q || !q.alive || q === p) return;
    p.vote = q.id;
    this.broadcast();
    if (this.alive().every((x) => x.vote !== undefined)) {
      this.timers.cancel(this.phaseTimer);
      this.phaseTimer = this.timers.later(() => this.advance(), this.ms(1500));
    }
  }

  resolveVote() {
    // Кто не проголосовал — за него решает жребий среди лидеров.
    const count = {};
    for (const p of this.alive()) if (p.vote) count[p.vote] = (count[p.vote] || 0) + 1;
    const max = Math.max(0, ...Object.values(count));
    let top = Object.keys(count).filter((id) => count[id] === max);
    if (!top.length) top = this.alive().map((p) => p.id);
    const out = this.player(top[Math.floor(this.rng() * top.length)]);
    out.alive = false;
    out.outAt = ++this.outCount;
    for (const c of CATS) out.open.add(c);
    for (const p of this.players) p.lastVote = p.vote;
    this.last = { t: 'out', id: out.id, votes: max, lot: top.length > 1 };
    this.setPhase('verdict', MS.verdict);
  }

  finishGame() {
    this.over = true;
    for (const p of this.players) for (const c of CATS) p.open.add(c);
    this.phase = 'over';
    this.timers.cancel(this.phaseTimer);
    this.deadline = Date.now() + this.ms(MS.over);
    this.broadcast();
    this.timers.later(() => this.ctx.end(this.finish()), this.ms(MS.over));
  }

  finish() {
    const list = this.players.slice().sort((a, b) => (a.alive !== b.alive ? b.alive - a.alive : b.outAt - a.outAt));
    const saved = list.filter((p) => p.alive).length;
    return {
      ranking: list.map((p, i) => ({ id: p.id, place: p.alive ? 1 : i - saved + 2, score: p.alive ? 1 : 0, label: p.alive ? '🛡️' : '☢️' })),
    };
  }

  action(pid, a) {
    const p = this.player(pid);
    if (!p || this.over || !a) return;
    if (a.t === 'reveal') return this.reveal(p, a.cat);
    if (a.t === 'vote') return this.vote(p, a.target);
    if (a.t === 'ready' && this.phase === 'talk' && p.alive) {
      p.ready = !p.ready;
      this.broadcast();
      return this.checkReady();
    }
    if (a.t === 'chat') {
      const text = String(a.text || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 160);
      if (text && p.alive && this.phase !== 'intro') this.pushChat({ id: p.id, text });
    }
  }

  clean(s) {
    return String(s).replace(/^[+!]/, '');
  }

  publicState() {
    return {
      t: 'state',
      phase: this.phase,
      round: this.round,
      rounds: this.rounds,
      voteRound: this.votesThisRound(),
      left: this.deadline ? Math.max(0, this.deadline - Date.now()) : null,
      world: this.world && { ...this.world, features: this.world.features.map((f) => this.clean(f)) },
      capacity: this.capacity,
      last: this.last,
      ready: this.phase === 'talk' ? this.alive().filter((p) => p.ready || p.bot).map((p) => p.id) : [],
      votes: this.phase === 'vote' || this.phase === 'verdict' ? Object.fromEntries(this.players.filter((p) => p.vote !== undefined).map((p) => [p.id, p.vote])) : {},
      players: this.players.map((p) => ({
        id: p.id,
        alive: p.alive,
        done: this.phase === 'reveal' && this.revealedThisRound(p),
        open: Object.fromEntries([...p.open].map((c) => [c, this.clean(p.cards[c])])),
      })),
    };
  }

  meState(p) {
    return { t: 'me', cards: Object.fromEntries(CATS.map((c) => [c, this.clean(p.cards[c])])) };
  }

  broadcast() {
    this.ctx.broadcast(this.publicState());
    for (const p of this.players) if (!p.bot) this.ctx.sendTo(p.id, this.meState(p));
  }

  snapshot(pid) {
    const p = this.player(pid);
    return [this.publicState(), ...this.chat, ...(p ? [this.meState(p)] : [])];
  }

  playerLeft() {
    this.checkReady();
  }
}
