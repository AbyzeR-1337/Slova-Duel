import { RoomHost } from './host.js';
import { HostTransport, GuestTransport } from '../net/transport.js';

// Комната глазами этого телефона.
//  online — я хозяин, гости заходят по ссылке;
//  guest  — я зашёл в чужую комнату;
//  local  — без интернета: один игрок и боты;
//  split  — без интернета: двое на одном экране.
export class Session {
  constructor({ mode, code = null, me, lang, hint = 0, botName, second = null, onEvent }) {
    this.mode = mode;
    this.code = code;
    this.me = me.id;
    this.profile = me;
    this.lang = lang;
    this.hint = hint;
    this.botName = botName;
    this.onEvent = onEvent;
    this.localSeats = second ? [me.id, second.id] : [me.id];
    this.second = second;
    this.room = null;
    this.game = null;
    this.timers = [];
    this.lastHostMsg = Date.now();
    this.closed = false;
  }

  get isHost() {
    return this.mode !== 'guest';
  }

  get online() {
    return this.mode === 'online' || this.mode === 'guest';
  }

  emit(type, data, to) {
    if (!this.closed) this.onEvent(type, data, to);
  }

  start() {
    if (this.mode === 'guest') {
      this.transport = new GuestTransport(this.code, {
        id: this.me,
        hint: this.hint,
        hello: () => ({ t: 'hello', p: this.profile }),
        onMessage: (m) => this.receive(m),
        onStatus: (st) => this.emit('net', st),
      });
      this.transport.start();
      this.timers.push(setInterval(() => this.transport.send({ t: 'ping' }), 3000));
      return;
    }
    if (this.mode === 'online') {
      this.transport = new HostTransport(this.code, {
        id: this.me,
        onMessage: (from, m) => this.host.handle(from, m),
        onStatus: (st) => this.emit('net', st),
      });
    }
    this.host = new RoomHost({
      me: this.profile,
      lang: this.lang,
      net: this.transport || null,
      botName: this.botName,
      // Свои сообщения доставляем асинхронно — как будто они пришли по сети.
      local: (m) => queueMicrotask(() => this.receive(m)),
    });
    if (this.second) this.host.addLocal(this.second);
    if (this.mode === 'split') this.host.gameId = 'words';
    this.transport?.start();
    this.timers.push(setInterval(() => this.host.tick(), 3000));
    this.host.pushRoom();
  }

  // Сообщение комнате от моего имени (или от второго игрока на этом телефоне).
  send(msg, asId = this.me) {
    if (this.closed) return;
    if (this.host) queueMicrotask(() => this.host.handle(asId, msg));
    else this.transport?.send(msg);
  }

  act(d, asId = this.me) {
    this.send({ t: 'ga', d }, asId);
  }

  receive(m) {
    if (this.closed) return;
    this.lastHostMsg = Date.now();
    if (m.to && !this.localSeats.includes(m.to)) return;
    switch (m.t) {
      case 'welcome':
        this.room = m.room;
        if (m.game) {
          this.game = m.game;
          this.emit('gstart', m.game);
          for (const d of m.snap || []) this.emit('g', d, m.to);
        } else if (this.game) {
          this.game = null;
          this.emit('gabort');
        }
        this.emit('room', this.room);
        this.emit('joined');
        break;
      case 'room':
        this.room = m.room;
        this.emit('room', this.room);
        break;
      case 'gstart':
        this.game = m;
        this.emit('gstart', m);
        break;
      case 'g':
        this.emit('g', m.d, m.to);
        break;
      case 'gend':
        this.game = null;
        this.emit('gend', m);
        break;
      case 'full':
      case 'kicked':
        this.emit(m.t);
        this.close();
        break;
      case 'bye':
        if (!this.isHost) {
          this.emit('closed');
          this.close();
        }
        break;
    }
  }

  wake() {
    this.transport?.wake();
  }

  leave() {
    if (this.closed) return;
    if (this.mode === 'guest') this.transport?.send({ t: 'bye' });
    else if (this.mode === 'online') this.transport?.broadcast({ t: 'bye' });
    setTimeout(() => this.close(), 200);
    this.closed = true;
  }

  close() {
    this.closed = true;
    this.timers.forEach(clearInterval);
    this.timers = [];
    this.host?.close();
    const tr = this.transport;
    setTimeout(() => tr?.close(), 250);
  }
}
