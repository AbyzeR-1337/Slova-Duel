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

// Топики комнаты: /h — хозяину, /a — всем гостям, /p/<id> — лично гостю.
const PREFIX = 'igroteka/v2/';

export function brokerList() {
  const custom = typeof location !== 'undefined' && new URLSearchParams(location.search).get('broker');
  return custom ? [{ url: custom }] : BROKERS;
}

export function newRoomCode() {
  return String(100000 + Math.floor(Math.random() * 900000));
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

export class HostTransport {
  constructor(code, { id, onMessage, onStatus = () => {} }) {
    this.code = code;
    this.id = id;
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.base = PREFIX + code;
    this.clients = brokerList().map(client);
    this.guests = new Map(); // id гостя → индекс брокера, через который он ходит
    this.firstOpen = -1;
  }

  start() {
    this.clients.forEach((c, idx) => {
      c.subscribe(this.base + '/h');
      c.onmessage = (topic, text) => {
        const msg = parse(text);
        if (!msg || msg.f === this.id) return;
        this.guests.set(msg.f, idx);
        this.onMessage(msg.f, msg);
      };
      c.onstate = (s) => {
        if (s === 'open' && this.firstOpen < 0) this.firstOpen = idx;
        this.status();
      };
      c.connect({ persistent: true });
    });
  }

  status() {
    this.onStatus({ open: this.clients.filter((c) => c.state === 'open').length, total: this.clients.length });
  }

  publish(idx, topic, msg) {
    return this.clients[idx]?.publish(topic, JSON.stringify({ ...msg, f: this.id }));
  }

  sendTo(guestId, msg) {
    const topic = `${this.base}/p/${guestId}`;
    const idx = this.guests.get(guestId);
    if (idx != null && this.clients[idx].state === 'open') this.publish(idx, topic, msg);
    else this.clients.forEach((c, i) => this.publish(i, topic, msg));
  }

  broadcast(msg) {
    // Публикуем один раз в каждый брокер, где есть хотя бы один гость.
    const used = new Set([...this.guests.values()].filter((i) => this.clients[i].state === 'open'));
    const lost = [...this.guests.values()].some((i) => this.clients[i].state !== 'open');
    const targets = used.size && !lost ? used : this.clients.map((_, i) => i);
    for (const i of targets) this.publish(i, this.base + '/a', msg);
  }

  forget(guestId) {
    this.guests.delete(guestId);
  }

  wake() {
    this.clients.forEach((c) => c.wake());
  }

  close() {
    this.clients.forEach((c) => c.close());
  }
}

export class GuestTransport {
  constructor(code, { id, hint = 0, onMessage, onStatus = () => {}, hello }) {
    this.code = code;
    this.id = id;
    this.base = PREFIX + code;
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.helloMsg = hello; // () => сообщение-приветствие
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
    c.subscribe(this.base + '/a');
    c.subscribe(`${this.base}/p/${this.id}`);
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
    this.send(this.helloMsg());
  }

  receive(text) {
    const msg = parse(text);
    if (!msg) return;
    if (msg.t === 'welcome' || msg.t === 'full' || msg.t === 'kicked') {
      if (msg.to !== this.id) return;
      if (msg.t === 'welcome') {
        this.hostId = msg.f;
        clearInterval(this.helloTimer);
      }
    } else if (msg.f !== this.hostId) {
      return;
    }
    this.onMessage(msg);
  }

  send(msg) {
    this.client?.publish(this.base + '/h', JSON.stringify({ ...msg, f: this.id }));
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
