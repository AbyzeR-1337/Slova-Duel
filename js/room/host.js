import { GAMES, defaultSettings } from '../games/registry.js';

export const MAX_PLAYERS = 10;
const PLACE_POINTS = [10, 6, 4, 3, 2];
const OFFLINE_AFTER = 12000;

const AVATAR_BOTS = ['🤖', '👾', '🦾', '🛸', '🎲', '🧠', '⚙️', '💾'];
const BOT_COLORS = ['#868e96', '#5c7cfa', '#20c997', '#fab005', '#e64980', '#7950f2'];

// Публичная часть профиля игрока — то, что видят остальные.
export function publicProfile(p) {
  return {
    id: p.id,
    name: String(p.name || '').slice(0, 16) || '?',
    avatar: String(p.avatar || '🙂').slice(0, 8),
    color: /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : '#888888',
    shape: ['circle', 'square', 'hex', 'star', 'drop'].includes(p.shape) ? p.shape : 'circle',
    fx: String(p.fx || 'confetti').slice(0, 16),
  };
}

// Комната живёт на телефоне хозяина: принимает игроков, запускает игры,
// ведёт таблицу лидеров. Гостям уходят только сообщения.
export class RoomHost {
  constructor({ me, lang = 'ru', net = null, local, botName = (n) => `Bot ${n}` }) {
    this.hostId = me.id;
    this.net = net; // { sendTo(id, msg), broadcast(msg) } или null без интернета
    this.local = local; // (msg) => доставка своему экрану
    this.botName = botName;
    this.lang = lang;
    this.players = [{ ...publicProfile(me), host: true, online: true, lastSeen: Date.now() }];
    this.localIds = new Set([me.id]);
    this.gameId = 'words';
    this.settings = defaultSettings();
    this.board = {};
    this.phase = 'lobby';
    this.game = null;
    this.seats = [];
    this.botCount = 0;
    this.seq = 0;
  }

  /* ---------- доставка ---------- */

  out(toId, msg) {
    msg.seq = ++this.seq;
    if (toId == null) {
      this.local({ ...msg });
      this.net?.broadcast(msg);
      return;
    }
    if (this.localIds.has(toId)) this.local({ ...msg, to: toId });
    else if (!this.player(toId)?.bot) this.net?.sendTo(toId, { ...msg, to: toId });
  }

  player(id) {
    return this.players.find((p) => p.id === id);
  }

  roomState() {
    return {
      host: this.hostId,
      players: this.players.map((p) => ({
        ...publicProfile(p),
        host: !!p.host,
        bot: !!p.bot,
        online: !!p.online,
        local: this.localIds.has(p.id),
      })),
      gameId: this.gameId,
      settings: this.settings,
      lang: this.lang,
      phase: this.phase,
      seats: this.seats.map((s) => s.id),
      board: this.boardList(),
    };
  }

  boardList() {
    return Object.entries(this.board)
      .map(([id, b]) => ({ id, ...b }))
      .sort((a, b) => b.points - a.points || b.winsTotal - a.winsTotal);
  }

  pushRoom() {
    this.out(null, { t: 'room', room: this.roomState() });
  }

  /* ---------- игроки ---------- */

  addLocal(profile) {
    // Второй игрок на этом же телефоне (режим «вдвоём на одном экране»).
    this.localIds.add(profile.id);
    this.players.push({ ...publicProfile(profile), online: true, lastSeen: Date.now() });
    this.pushRoom();
  }

  handle(fromId, msg) {
    if (!msg || typeof msg.t !== 'string') return;
    if (msg.t === 'hello') return this.join(fromId, msg.p || {});
    const p = this.player(fromId);
    if (!p) return;
    p.lastSeen = Date.now();
    if (!p.online) {
      p.online = true;
      this.pushRoom();
    }
    const isHost = fromId === this.hostId;
    switch (msg.t) {
      case 'ping':
        return;
      case 'profile':
        Object.assign(p, publicProfile({ ...msg.p, id: p.id }));
        if (this.board[p.id]) Object.assign(this.board[p.id], { name: p.name, avatar: p.avatar, color: p.color });
        return this.pushRoom();
      case 'bye':
        return this.leave(fromId);
      case 'ga':
        if (this.game && this.seats.some((s) => s.id === fromId)) this.game.action(fromId, msg.d || {});
        return;
    }
    if (!isHost) return;
    switch (msg.t) {
      case 'pick':
        if (GAMES[msg.game] && this.phase === 'lobby') {
          this.gameId = msg.game;
          this.pushRoom();
        }
        return;
      case 'set': {
        const g = GAMES[this.gameId];
        const opt = g.options.find((o) => o.key === msg.key);
        if (opt && opt.values.includes(msg.value)) {
          this.settings[this.gameId][msg.key] = msg.value;
          this.pushRoom();
        }
        return;
      }
      case 'lang':
        if (typeof msg.lang === 'string' && msg.lang.length <= 5) {
          this.lang = msg.lang;
          this.pushRoom();
        }
        return;
      case 'addBot':
        return this.addBot();
      case 'kick':
        return this.kick(msg.id);
      case 'start':
        return this.start();
      case 'end':
        return this.abortGame();
    }
  }

  join(id, profile) {
    let p = this.player(id);
    if (!p) {
      if (this.players.length >= MAX_PLAYERS) {
        this.net?.sendTo(id, { t: 'full', to: id });
        return;
      }
      p = { ...publicProfile({ ...profile, id }), online: true, lastSeen: Date.now() };
      this.players.push(p);
    } else {
      Object.assign(p, publicProfile({ ...profile, id }), { online: true, lastSeen: Date.now() });
    }
    const welcome = { t: 'welcome', you: id, room: this.roomState() };
    if (this.phase === 'game' && this.game) {
      welcome.game = this.gameStartMsg();
      welcome.snap = this.game.snapshot(id);
    }
    this.out(id, welcome);
    this.pushRoom();
  }

  leave(id) {
    const p = this.player(id);
    if (!p || p.host) return;
    this.net?.forget?.(id);
    const seated = this.seats.some((s) => s.id === id);
    if (seated && this.phase === 'game') {
      p.online = false;
      this.game?.playerLeft?.(id);
    } else {
      this.players = this.players.filter((x) => x.id !== id);
    }
    this.pushRoom();
  }

  kick(id) {
    const p = this.player(id);
    if (!p || p.host) return;
    if (!p.bot) this.out(id, { t: 'kicked' });
    this.leave(id);
    if (p.bot && this.phase === 'lobby') this.players = this.players.filter((x) => x.id !== id);
    this.pushRoom();
  }

  addBot() {
    if (this.players.length >= MAX_PLAYERS || this.phase !== 'lobby') return;
    const n = ++this.botCount;
    this.players.push({
      ...publicProfile({
        id: 'bot' + n,
        name: this.botName(n),
        avatar: AVATAR_BOTS[(n - 1) % AVATAR_BOTS.length],
        color: BOT_COLORS[(n - 1) % BOT_COLORS.length],
        shape: 'square',
        fx: 'stars',
      }),
      bot: true,
      online: true,
      lastSeen: Infinity,
    });
    this.pushRoom();
  }

  // Вызывается раз в несколько секунд: кто давно молчит — не в сети.
  tick() {
    const now = Date.now();
    let changed = false;
    for (const p of this.players) {
      if (p.host || p.bot || this.localIds.has(p.id)) continue;
      const online = now - p.lastSeen < OFFLINE_AFTER;
      if (online !== p.online) {
        p.online = online;
        changed = true;
      }
    }
    if (changed) this.pushRoom();
    if (this.net) this.out(null, { t: 'ping' });
  }

  /* ---------- игры ---------- */

  // Кто сядет за стол: сначала люди в сети (хозяин первым), потом боты.
  pickSeats() {
    const g = GAMES[this.gameId];
    const humans = this.players.filter((p) => !p.bot && p.online);
    const bots = g.bots ? this.players.filter((p) => p.bot) : [];
    return [...humans, ...bots].slice(0, g.max);
  }

  canStart() {
    const g = GAMES[this.gameId];
    const n = this.pickSeats().length;
    return this.phase === 'lobby' && n >= g.min;
  }

  gameStartMsg() {
    return {
      t: 'gstart',
      gameId: this.gameId,
      settings: this.settings[this.gameId],
      lang: this.lang,
      seats: this.seats.map((s) => publicProfile(s)).map((s, i) => ({ ...s, bot: !!this.seats[i].bot })),
    };
  }

  async start() {
    if (!this.canStart() || this.starting) return;
    this.starting = true;
    try {
      const g = GAMES[this.gameId];
      const mod = await g.engine();
      this.seats = this.pickSeats().map((p) => ({ ...p }));
      const gameId = this.gameId;
      // Метка текущей партии: сообщения от завершённой игры никуда не уйдут.
      const token = {};
      this.token = token;
      const ctx = {
        seats: this.seats.map((s) => ({ ...publicProfile(s), bot: !!s.bot })),
        settings: { ...this.settings[gameId] },
        lang: this.lang,
        hostId: this.hostId,
        humans: this.seats.filter((s) => !s.bot).length,
        // Есть ли игроки на других телефонах — тогда нужен запас на задержку сети.
        remote: this.seats.some((s) => !s.bot && !this.localIds.has(s.id)),
        isOnline: (id) => !!this.player(id)?.online,
        broadcast: (d) => this.token === token && this.out(null, { t: 'g', d }),
        sendTo: (id, d) => this.token === token && this.out(id, { t: 'g', d }),
        end: (result) => this.token === token && this.endGame(result),
      };
      this.game = await mod.createGame(ctx);
      const game = this.game;
      this.phase = 'game';
      this.out(null, this.gameStartMsg());
      this.pushRoom();
      game.start();
    } finally {
      this.starting = false;
    }
  }

  abortGame() {
    if (!this.game) return;
    const result = this.game.finish?.() || { ranking: [] };
    this.endGame(result);
  }

  endGame(result) {
    const game = this.game;
    this.game = null;
    this.token = null;
    game?.stop();
    const ranking = (result.ranking || []).map((r, i) => {
      const s = this.seats.find((x) => x.id === r.id) || this.player(r.id) || { id: r.id };
      return { ...publicProfile(s), bot: !!s.bot, place: r.place ?? i + 1, score: r.score ?? null, label: r.label ?? null };
    });
    // Очки в таблицу лидеров комнаты — только людям и только если были соперники.
    if (ranking.length >= 2) {
      for (const r of ranking) {
        if (r.bot) continue;
        const b = (this.board[r.id] ||= { name: r.name, avatar: r.avatar, color: r.color, points: 0, played: 0, wins: {}, winsTotal: 0 });
        Object.assign(b, { name: r.name, avatar: r.avatar, color: r.color });
        b.played++;
        b.points += PLACE_POINTS[r.place - 1] ?? 1;
        if (r.place === 1) {
          b.wins[this.gameId] = (b.wins[this.gameId] || 0) + 1;
          b.winsTotal++;
        }
      }
    }
    this.phase = 'lobby';
    this.seats = [];
    // Те, кто вышел посреди игры, теперь покидают комнату.
    this.players = this.players.filter((p) => p.online || p.host || p.bot);
    this.out(null, { t: 'gend', gameId: this.gameId, ranking, extra: result.extra ?? null });
    this.pushRoom();
  }

  close() {
    this.game?.stop();
    this.game = null;
  }
}
