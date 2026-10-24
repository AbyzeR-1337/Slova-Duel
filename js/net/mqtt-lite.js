// Крошечный MQTT 3.1.1 клиент поверх WebSocket (только QoS 0).
// Нужен, чтобы два телефона обменивались сообщениями через бесплатный
// публичный брокер — без своего сервера и без проблем с NAT у мобильных сетей.

const te = new TextEncoder();
const td = new TextDecoder();

function str(s) {
  const b = te.encode(s);
  return [b.length >> 8, b.length & 255, ...b];
}

function remainingLength(n) {
  const out = [];
  do {
    let d = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) d |= 128;
    out.push(d);
  } while (n > 0);
  return out;
}

function packet(header, body) {
  const out = new Uint8Array(1 + 4 + body.length);
  const len = remainingLength(body.length);
  out[0] = header;
  out.set(len, 1);
  out.set(body, 1 + len.length);
  return out.subarray(0, 1 + len.length + body.length);
}

export class MqttLite {
  constructor(url, { username, password, keepalive = 30, connectTimeout = 7000 } = {}) {
    this.url = url;
    this.username = username;
    this.password = password;
    this.keepalive = keepalive;
    this.connectTimeout = connectTimeout;
    this.clientId = 'sd' + Math.random().toString(36).slice(2, 12);
    this.subs = new Set();
    this.state = 'idle';
    this.retry = 0;
    this.closedByUser = false;
    this.onmessage = () => {};
    this.onstate = () => {};
    this.buf = new Uint8Array(0);
    this.packetId = 1;
  }

  // Промис ждёт первого CONNACK, дальше клиент сам переподключается.
  // persistent: не сдаваться и при неудачной первой попытке.
  connect({ persistent = false } = {}) {
    this.persistent = persistent;
    return new Promise((resolve, reject) => {
      this.firstConnect = { resolve, reject };
      this.open();
    });
  }

  open() {
    clearTimeout(this.reconnectTimer);
    this.setState('connecting');
    let ws;
    try {
      ws = new WebSocket(this.url, ['mqtt']);
    } catch (e) {
      this.fail(e);
      return;
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    this.buf = new Uint8Array(0);
    this.timeoutTimer = setTimeout(() => {
      if (this.state !== 'open') ws.close();
    }, this.connectTimeout);
    ws.onopen = () => this.sendConnect();
    ws.onmessage = (e) => this.onData(new Uint8Array(e.data));
    ws.onclose = () => {
      if (this.ws === ws) this.fail(new Error('closed'));
    };
    ws.onerror = () => {};
  }

  setState(s) {
    if (this.state === s) return;
    this.state = s;
    this.onstate(s);
  }

  fail(err) {
    clearTimeout(this.probeTimer);
    clearTimeout(this.timeoutTimer);
    clearInterval(this.pingTimer);
    const ws = this.ws;
    this.ws = null;
    if (ws && ws.readyState <= 1) ws.close();
    this.setState('closed');
    if (this.firstConnect && !this.persistent) {
      this.firstConnect.reject(err);
      this.firstConnect = null;
      return;
    }
    if (this.closedByUser) return;
    const delay = Math.min(8000, 800 * 2 ** this.retry++);
    this.reconnectTimer = setTimeout(() => this.open(), delay);
  }

  // Вызывается, когда вкладка снова видна: iOS рвёт сокеты в фоне.
  wake() {
    if (this.closedByUser || this.state === 'connecting') return;
    if (this.state === 'open') {
      // Сокет мог тихо умереть, пока телефон спал: проверяем пингом.
      const since = Date.now();
      this.raw(new Uint8Array([0xc0, 0]));
      clearTimeout(this.probeTimer);
      this.probeTimer = setTimeout(() => {
        if (this.state === 'open' && !(this.lastRx >= since)) this.fail(new Error('stale'));
      }, 4000);
      return;
    }
    this.retry = 0;
    this.open();
  }

  raw(bytes) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(bytes);
  }

  sendConnect() {
    let flags = 0x02; // clean session
    const payload = [...str(this.clientId)];
    if (this.username != null) {
      flags |= 0x80;
      payload.push(...str(this.username));
    }
    if (this.password != null) {
      flags |= 0x40;
      payload.push(...str(this.password));
    }
    const body = [...str('MQTT'), 4, flags, this.keepalive >> 8, this.keepalive & 255, ...payload];
    this.raw(packet(0x10, body));
  }

  onData(chunk) {
    const joined = new Uint8Array(this.buf.length + chunk.length);
    joined.set(this.buf);
    joined.set(chunk, this.buf.length);
    this.buf = joined;
    this.lastRx = Date.now();
    while (this.buf.length >= 2) {
      let len = 0;
      let mult = 1;
      let i = 1;
      let byte;
      do {
        if (i >= this.buf.length) return;
        byte = this.buf[i++];
        len += (byte & 127) * mult;
        mult *= 128;
        if (i > 5) return this.fail(new Error('bad packet'));
      } while (byte & 128);
      if (this.buf.length < i + len) return;
      const header = this.buf[0];
      const body = this.buf.subarray(i, i + len);
      this.buf = this.buf.slice(i + len);
      this.handle(header >> 4, header & 15, body);
    }
  }

  handle(type, flags, body) {
    if (type === 2) {
      // CONNACK
      if (body[1] !== 0) return this.fail(new Error('refused ' + body[1]));
      clearTimeout(this.timeoutTimer);
      this.retry = 0;
      this.setState('open');
      for (const t of this.subs) this.sendSubscribe(t);
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => {
        if (Date.now() - this.lastRx > this.keepalive * 1500) return this.fail(new Error('timeout'));
        this.raw(new Uint8Array([0xc0, 0]));
      }, this.keepalive * 400);
      if (this.firstConnect) {
        this.firstConnect.resolve();
        this.firstConnect = null;
      }
    } else if (type === 3) {
      // PUBLISH
      const tl = (body[0] << 8) | body[1];
      const topic = td.decode(body.subarray(2, 2 + tl));
      let p = 2 + tl;
      const qos = (flags >> 1) & 3;
      if (qos > 0) {
        const id = [body[p], body[p + 1]];
        p += 2;
        if (qos === 1) this.raw(new Uint8Array([0x40, 2, ...id]));
      }
      this.onmessage(topic, td.decode(body.subarray(p)));
    }
  }

  sendSubscribe(topic) {
    const id = this.packetId++ & 0xffff || 1;
    this.raw(packet(0x82, [id >> 8, id & 255, ...str(topic), 0]));
  }

  subscribe(topic) {
    this.subs.add(topic);
    if (this.state === 'open') this.sendSubscribe(topic);
  }

  publish(topic, text) {
    if (this.state !== 'open') return false;
    this.raw(packet(0x30, [...str(topic), ...te.encode(text)]));
    return true;
  }

  close() {
    this.closedByUser = true;
    clearTimeout(this.probeTimer);
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.timeoutTimer);
    clearInterval(this.pingTimer);
    if (this.ws && this.ws.readyState === 1) this.raw(new Uint8Array([0xe0, 0]));
    if (this.ws) this.ws.close();
    this.ws = null;
    this.setState('closed');
  }
}
