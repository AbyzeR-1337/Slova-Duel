import { MqttLite } from './mqtt-lite.js';

// Бесплатные публичные MQTT-брокеры. Хозяин комнаты слушает все сразу,
// гость подключается к первому доступному — так игра переживёт,
// если какой-то из брокеров лежит или заблокирован в сети.
export const BROKERS = [
  { url: 'wss://broker.emqx.io:8084/mqtt' },
  { url: 'wss://broker.hivemq.com:8884/mqtt' },
  { url: 'wss://public.cloud.shiftr.io', username: 'public', password: 'public' },
  { url: 'wss://test.mosquitto.org:8081/mqtt' },
];

const PREFIX = 'slovaduel/v1/';

export function brokerList() {
  const custom = new URLSearchParams(location.search).get('broker');
  return custom ? [{ url: custom }] : BROKERS;
}

export function newRoomCode() {
  return String(100000 + Math.floor(Math.random() * 900000));
}

export function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

function client(b) {
  return new MqttLite(b.url, { username: b.username, password: b.password });
}

function parse(text) {
  try {
    const msg = JSON.parse(text);
    return msg && typeof msg.f === 'string' ? msg : null;
  } catch {
    return null;
  }
}

export class HostRoom {
  // canReplaceGuest(): можно ли пустить нового гостя вместо прежнего
  // (например, прежний давно пропал со связи).
  constructor(code, { id, onMessage, onStatus, canReplaceGuest = () => false }) {
    this.code = code;
    this.id = id;
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.canReplaceGuest = canReplaceGuest;
    this.guestId = null;
    this.guestBroker = -1;
    this.clients = brokerList().map(client);
    this.firstOpen = -1;
  }

  start() {
    const inbox = PREFIX + this.code + '/h';
    this.clients.forEach((c, idx) => {
      c.subscribe(inbox);
      c.onmessage = (topic, text) => this.receive(idx, text);
      c.onstate = (s) => {
        if (s === 'open' && this.firstOpen < 0) this.firstOpen = idx;
        this.status();
      };
      c.connect({ persistent: true });
    });
  }

  status() {
    const open = this.clients.filter((c) => c.state === 'open').length;
    this.onStatus({ open, total: this.clients.length });
  }

  receive(idx, text) {
    const msg = parse(text);
    if (!msg) return;
    if (msg.t === 'hello' && msg.f !== this.guestId) {
      if (this.guestId && !this.canReplaceGuest()) {
        this.publishTo(idx, { t: 'full', to: msg.f });
        return;
      }
      this.guestId = msg.f;
    } else if (msg.f !== this.guestId) {
      return;
    }
    this.guestBroker = idx;
    this.onMessage(msg);
  }

  publishTo(idx, msg) {
    this.clients[idx]?.publish(PREFIX + this.code + '/g', JSON.stringify({ ...msg, f: this.id }));
  }

  send(msg) {
    if (!this.guestId) return;
    const out = { ...msg, to: this.guestId };
    if (this.clients[this.guestBroker]?.state === 'open') this.publishTo(this.guestBroker, out);
    else this.clients.forEach((c, idx) => this.publishTo(idx, out));
  }

  wake() {
    this.clients.forEach((c) => c.wake());
  }

  close() {
    this.clients.forEach((c) => c.close());
  }
}

export class GuestRoom {
  constructor(code, { id, name, hint = 0, onMessage, onStatus }) {
    this.code = code;
    this.id = id;
    this.name = name;
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.brokers = brokerList();
    this.idx = Math.max(0, Math.min(this.brokers.length - 1, hint | 0));
    this.hostId = null;
    this.closed = false;
    this.attempt = 0;
  }

  start() {
    this.tryBroker();
  }

  // Подключаемся к брокеру и стучимся к хозяину. Если за несколько секунд
  // никто не ответил — пробуем следующий брокер, и так по кругу.
  tryBroker() {
    if (this.closed) return;
    const c = client(this.brokers[this.idx]);
    this.client = c;
    c.subscribe(PREFIX + this.code + '/g');
    c.onmessage = (topic, text) => this.receive(text);
    c.onstate = (s) => {
      // После переподключения просим хозяина прислать актуальное состояние.
      if (s === 'open' && this.hostId) this.hello();
      this.status();
    };
    this.status();
    const next = () => {
      if (this.closed || this.hostId) return;
      clearInterval(this.helloTimer);
      c.close();
      this.idx = (this.idx + 1) % this.brokers.length;
      this.attempt++;
      setTimeout(() => this.tryBroker(), 300);
    };
    c.connect()
      .then(() => {
        this.hello();
        let tries = 0;
        clearInterval(this.helloTimer);
        this.helloTimer = setInterval(() => {
          if (this.hostId) return clearInterval(this.helloTimer);
          if (++tries >= 5) next();
          else this.hello();
        }, 1500);
      })
      .catch(next);
  }

  status() {
    this.onStatus({ state: this.client?.state, joined: !!this.hostId, attempt: this.attempt });
  }

  hello() {
    this.send({ t: 'hello', name: this.name });
  }

  receive(text) {
    const msg = parse(text);
    if (!msg || msg.to !== this.id) return;
    if (msg.t === 'welcome') {
      this.hostId = msg.f;
      clearInterval(this.helloTimer);
    } else if (msg.f !== this.hostId && msg.t !== 'full') {
      return;
    }
    this.onMessage(msg);
  }

  send(msg) {
    this.client?.publish(PREFIX + this.code + '/h', JSON.stringify({ ...msg, f: this.id }));
  }

  wake() {
    this.client?.wake();
  }

  close() {
    this.closed = true;
    clearInterval(this.helloTimer);
    this.client?.close();
  }
}
