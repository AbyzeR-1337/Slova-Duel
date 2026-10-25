import { Timers, shuffle } from '../../core/util.js';

// Мафия: ночью мафия выбирает жертву, доктор лечит, комиссар проверяет;
// днём все обсуждают в чате и голосуют. Роль выбывшего открывается.
// Мирные побеждают, когда мафии не осталось; мафия — когда её не меньше,
// чем остальных.

export const ROLE_ICON = { mafia: '🔪', doctor: '💉', detective: '🔍', civilian: '🙂' };
const MS = { intro: 7000, night: 35000, nightMin: 8000, morning: 7000, vote: 30000, verdict: 7000 };
const MAX_DAYS = 12;
const BOT_LINES = ['hmm', 'civil', 'quiet', 'suspect', 'suspect', 'vote'];

export async function createGame(ctx) {
  return new MafiaGame(ctx);
}

export function mafiaCount(n, setting = 'auto') {
  const want = setting === 'auto' || !setting ? (n <= 5 ? 1 : n <= 8 ? 2 : 3) : Number(setting);
  return Math.max(1, Math.min(want, Math.ceil(n / 2) - 1));
}

export class MafiaGame {
  constructor(ctx, { rng = Math.random, timeScale = 1 } = {}) {
    this.ctx = ctx;
    this.rng = rng;
    this.timeScale = timeScale;
    this.timers = new Timers();
    this.dayMs = (Number(ctx.settings.day) || 90) * 1000;
    this.players = ctx.seats.map((s) => ({ id: s.id, bot: !!s.bot, role: 'civilian', alive: true, checks: {}, pick: null, lastHeal: null, ready: false, vote: undefined }));
    this.day = 0;
    this.phase = 'intro';
    this.chat = [];
    this.nightChat = [];
    this.dead = [];
    this.last = null;
    this.claims = {}; // кто публично назван мафией (заявления комиссара)
    this.k = 0;
  }

  ms(x) {
    return Math.round(x * this.timeScale);
  }

  start() {
    const n = this.players.length;
    const order = shuffle(this.players, this.rng);
    const m = mafiaCount(n, this.ctx.settings.mafia);
    order.slice(0, m).forEach((p) => (p.role = 'mafia'));
    if (this.ctx.settings.roles !== 'simple') {
      if (order[m]) order[m].role = 'doctor';
      if (order[m + 1] && n >= 5) order[m + 1].role = 'detective';
    }
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

  // Когда живых людей не осталось, боты доигрывают быстро.
  scale(ms) {
    const humansAlive = this.players.some((p) => p.alive && !p.bot && this.ctx.isOnline(p.id));
    return this.ms(humansAlive ? ms : Math.min(ms, 2500));
  }

  setPhase(phase, ms) {
    this.phase = phase;
    this.timers.cancel(this.phaseTimer);
    const d = this.scale(ms);
    this.deadline = Date.now() + d;
    this.phaseStarted = Date.now();
    this.phaseTimer = this.timers.later(() => this.advance(), d);
    this.broadcast();
  }

  advance() {
    if (this.over) return;
    switch (this.phase) {
      case 'intro':
      case 'verdict':
        if (this.phase === 'verdict' && this.checkWin()) return;
        return this.startNight();
      case 'night':
        return this.resolveNight();
      case 'morning':
        if (this.checkWin()) return;
        return this.startDay();
      case 'day':
        return this.startVote();
      case 'vote':
        return this.resolveVote();
    }
  }

  startNight() {
    this.day++;
    for (const p of this.players) p.pick = null;
    this.nightChat = [];
    this.setPhase('night', MS.night);
    for (const p of this.alive()) if (p.bot && p.role !== 'civilian') this.timers.later(() => this.botNight(p), this.scale(2000 + this.rng() * 5000));
  }

  actors() {
    return this.alive().filter((p) => p.role !== 'civilian' && !(p.role === 'detective' && !this.checkTargets(p).length));
  }

  checkTargets(p) {
    return this.alive().filter((q) => q !== p && !(q.id in p.checks));
  }

  validNight(p, target) {
    const q = this.player(target);
    if (!q || !q.alive) return false;
    if (p.role === 'mafia') return q.role !== 'mafia';
    if (p.role === 'doctor') return q.id !== p.lastHeal;
    if (p.role === 'detective') return q !== p && !(q.id in p.checks);
    return false;
  }

  nightAction(p, target) {
    if (this.phase !== 'night' || !p.alive || !this.validNight(p, target)) return;
    if (p.role === 'detective' && p.pick) return; // проверка одна за ночь
    p.pick = target;
    if (p.role === 'detective') {
      p.checks[target] = this.player(target).role === 'mafia';
    }
    this.sendMe(p);
    if (p.role === 'mafia') for (const q of this.team()) if (q !== p) this.sendMe(q);
    if (this.actors().every((q) => q.pick)) {
      const rest = Math.max(this.ms(1500), this.phaseStarted + this.scale(MS.nightMin) - Date.now());
      this.timers.cancel(this.phaseTimer);
      this.phaseTimer = this.timers.later(() => this.advance(), rest);
    }
  }

  team() {
    return this.players.filter((p) => p.role === 'mafia');
  }

  botNight(p) {
    if (this.phase !== 'night' || !p.alive || p.pick) return;
    const town = this.alive().filter((q) => q.role !== 'mafia');
    if (p.role === 'mafia') {
      // Сначала тех, кто вслух назвал мафию, иначе соглашаемся с напарником.
      const partner = this.team().find((q) => q !== p && q.alive && q.pick);
      const loud = town.filter((q) => this.claims[q.id]);
      const target = partner && this.rng() < 0.7 ? this.player(partner.pick) : loud.length ? loud[0] : town[Math.floor(this.rng() * town.length)];
      if (target) this.nightAction(p, target.id);
    } else if (p.role === 'doctor') {
      const opts = this.alive().filter((q) => q.id !== p.lastHeal);
      const self = opts.includes(p) && this.rng() < 0.3;
      const loud = opts.filter((q) => this.claims[q.id]);
      const target = self ? p : loud.length && this.rng() < 0.6 ? loud[0] : opts[Math.floor(this.rng() * opts.length)];
      if (target) this.nightAction(p, target.id);
    } else if (p.role === 'detective') {
      const opts = this.checkTargets(p);
      if (opts.length) this.nightAction(p, opts[Math.floor(this.rng() * opts.length)].id);
    }
  }

  resolveNight() {
    const picks = this.team()
      .filter((p) => p.alive && p.pick)
      .map((p) => p.pick);
    let victim = null;
    if (picks.length) {
      const count = {};
      for (const id of picks) count[id] = (count[id] || 0) + 1;
      const max = Math.max(...Object.values(count));
      const top = Object.keys(count).filter((id) => count[id] === max);
      victim = top[Math.floor(this.rng() * top.length)];
    }
    const doctor = this.alive().find((p) => p.role === 'doctor');
    const healed = doctor?.pick || null;
    if (doctor) doctor.lastHeal = healed;
    const saved = victim && victim === healed;
    if (victim && !saved) this.kill(this.player(victim), 'night');
    this.last = { t: 'night', killed: saved ? null : victim, saved: !!saved, day: this.day };
    this.setPhase('morning', MS.morning);
  }

  kill(p, how) {
    p.alive = false;
    this.dead.push({ id: p.id, role: p.role, how, day: this.day });
  }

  startDay() {
    for (const p of this.players) p.ready = false;
    this.setPhase('day', this.dayMs);
    // Боты немного разговаривают.
    const bots = shuffle(
      this.alive().filter((p) => p.bot),
      this.rng,
    );
    let at = 3000;
    for (const p of bots.slice(0, 4)) {
      at += 2500 + this.rng() * 7000;
      if (at > this.dayMs - 4000) break;
      this.timers.later(() => this.botTalk(p), this.scale(at));
    }
    this.checkReady();
  }

  suspectFor(p) {
    // Комиссар знает наверняка, остальные верят заявлениям или гадают.
    const known = Object.entries(p.checks).find(([id, m]) => m && this.player(id).alive);
    if (known) return known[0];
    const others = this.alive().filter((q) => q !== p && (p.role !== 'mafia' || q.role !== 'mafia'));
    const claimed = others.filter((q) => Object.values(this.claims).includes(q.id));
    if (p.role === 'mafia') {
      // Мафия давит на тех, кто её разоблачает.
      const accuser = others.find((q) => this.claims[q.id] && this.player(this.claims[q.id])?.role === 'mafia');
      if (accuser) return accuser.id;
    } else if (claimed.length && this.rng() < 0.8) return claimed[0].id;
    if (!others.length) return null;
    if (!p.suspect || !this.player(p.suspect)?.alive || this.rng() < 0.25) p.suspect = others[Math.floor(this.rng() * others.length)].id;
    return p.suspect;
  }

  botTalk(p) {
    if (this.phase !== 'day' || !p.alive) return;
    const found = Object.entries(p.checks).find(([id, m]) => m && this.player(id).alive && this.claims[p.id] !== id);
    if (p.role === 'detective' && found) {
      this.claims[p.id] = found[0];
      return this.say(p, 'found', found[0]);
    }
    const line = BOT_LINES[Math.floor(this.rng() * BOT_LINES.length)];
    if (line === 'suspect' || line === 'vote') {
      const s = this.suspectFor(p);
      if (s) return this.say(p, line, s);
    }
    this.say(p, line === 'suspect' || line === 'vote' ? 'hmm' : line);
  }

  say(p, key, who = null) {
    this.pushChat({ id: p.id, key, who });
  }

  pushChat(msg) {
    msg.t = 'chat';
    msg.k = ++this.k;
    this.chat.push(msg);
    if (this.chat.length > 40) this.chat.shift();
    this.ctx.broadcast(msg);
  }

  chatAction(p, text) {
    text = String(text || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160);
    if (!text || !p.alive) return;
    if (this.phase === 'night') {
      if (p.role !== 'mafia') return;
      const msg = { t: 'chat', id: p.id, text, night: true, k: ++this.k };
      this.nightChat.push(msg);
      for (const q of this.team()) if (!q.bot) this.ctx.sendTo(q.id, msg);
      return;
    }
    if (this.phase === 'intro') return;
    this.pushChat({ id: p.id, text });
  }

  checkReady() {
    if (this.phase !== 'day') return;
    const humans = this.alive().filter((p) => !p.bot && this.ctx.isOnline(p.id));
    if (humans.every((p) => p.ready)) {
      this.timers.cancel(this.phaseTimer);
      this.phaseTimer = this.timers.later(() => this.advance(), this.ms(humans.length ? 1500 : 4000));
    }
  }

  startVote() {
    for (const p of this.players) p.vote = undefined;
    this.setPhase('vote', MS.vote);
    for (const p of this.alive()) if (p.bot) this.timers.later(() => this.botVote(p), this.scale(2500 + this.rng() * 12000));
  }

  botVote(p) {
    if (this.phase !== 'vote' || !p.alive || p.vote !== undefined) return;
    let target = this.suspectFor(p);
    // Иногда идём за большинством.
    const tally = this.tally();
    const leader = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
    if (leader && leader[0] !== p.id && this.rng() < 0.45 && !(p.role === 'mafia' && this.player(leader[0]).role === 'mafia')) target = leader[0];
    this.voteAction(p, target);
  }

  tally() {
    const count = {};
    for (const p of this.alive()) if (p.vote) count[p.vote] = (count[p.vote] || 0) + 1;
    return count;
  }

  voteAction(p, target) {
    if (this.phase !== 'vote' || !p.alive || p.vote !== undefined) return;
    const q = target ? this.player(target) : null;
    if (target && (!q || !q.alive || q === p)) return;
    p.vote = q ? q.id : null;
    this.broadcast();
    if (this.alive().every((x) => x.vote !== undefined)) {
      this.timers.cancel(this.phaseTimer);
      this.phaseTimer = this.timers.later(() => this.advance(), this.ms(1500));
    }
  }

  resolveVote() {
    const count = this.tally();
    const max = Math.max(0, ...Object.values(count));
    const top = Object.keys(count).filter((id) => count[id] === max);
    let out = null;
    if (max > 0 && top.length === 1) {
      out = top[0];
      this.kill(this.player(out), 'vote');
    }
    this.last = { t: 'vote', out, tie: max > 0 && top.length > 1, day: this.day };
    this.setPhase('verdict', MS.verdict);
  }

  checkWin() {
    const alive = this.alive();
    const mafia = alive.filter((p) => p.role === 'mafia').length;
    let winner = null;
    if (!mafia) winner = 'town';
    else if (mafia >= alive.length - mafia || this.day >= MAX_DAYS) winner = 'mafia';
    if (!winner) return false;
    this.over = winner;
    this.timers.clear();
    this.phase = 'over';
    this.deadline = null;
    this.broadcast();
    this.timers.later(() => this.ctx.end(this.finish()), this.ms(6000));
    return true;
  }

  finish() {
    const won = (p) => (this.over === 'mafia') === (p.role === 'mafia');
    const list = this.players.slice().sort((a, b) => won(b) - won(a) || b.alive - a.alive);
    return {
      ranking: list.map((p) => ({ id: p.id, place: won(p) ? 1 : 2, score: p.alive ? 1 : 0, label: ROLE_ICON[p.role] })),
      extra: { winner: this.over },
    };
  }

  action(pid, a) {
    const p = this.player(pid);
    if (!p || this.over || !a) return;
    if (a.t === 'chat') return this.chatAction(p, a.text);
    if (a.t === 'night') return this.nightAction(p, a.target);
    if (a.t === 'vote') return this.voteAction(p, a.target || null);
    if (a.t === 'ready' && this.phase === 'day' && p.alive) {
      p.ready = !p.ready;
      this.broadcast();
      this.checkReady();
    }
  }

  publicState() {
    const voting = this.phase === 'vote' || this.phase === 'verdict';
    return {
      t: 'state',
      phase: this.phase,
      day: this.day,
      left: this.deadline ? Math.max(0, this.deadline - Date.now()) : null,
      alive: this.alive().map((p) => p.id),
      dead: this.dead.slice(),
      ready: this.phase === 'day' ? this.alive().filter((p) => p.ready || p.bot).map((p) => p.id) : [],
      votes: voting ? Object.fromEntries(this.alive().concat(this.players.filter((p) => !p.alive && p.vote !== undefined)).filter((p) => p.vote !== undefined).map((p) => [p.id, p.vote])) : {},
      last: this.last,
      mafia: this.team().length,
      roleSet: [...new Set(this.players.map((p) => p.role))],
      winner: this.over || null,
      roles: this.over ? Object.fromEntries(this.players.map((p) => [p.id, p.role])) : null,
    };
  }

  meState(p) {
    const mafia = p.role === 'mafia';
    return {
      t: 'me',
      role: p.role,
      team: mafia ? this.team().map((q) => q.id) : [],
      picks: mafia ? Object.fromEntries(this.team().filter((q) => q.pick).map((q) => [q.id, q.pick])) : {},
      pick: p.pick,
      checks: { ...p.checks },
      lastHeal: p.lastHeal,
    };
  }

  sendMe(p) {
    if (!p.bot) this.ctx.sendTo(p.id, this.meState(p));
  }

  broadcast() {
    this.ctx.broadcast(this.publicState());
    for (const p of this.players) this.sendMe(p);
  }

  snapshot(pid) {
    const p = this.player(pid);
    const out = [this.publicState(), ...this.chat];
    if (p) {
      out.push(this.meState(p));
      if (p.role === 'mafia' && this.phase === 'night') out.push(...this.nightChat);
    }
    return out;
  }

  playerLeft() {
    this.checkReady();
  }
}
