// GT7 telemetry link that runs inside the app itself (no bridge computer). It does what gt7-listener.js does on a
// PC: heartbeat the console, find it, decrypt and decode the packets. The only platform piece is a UDP transport.
// Presents the same surface as the bridge's WebSocket, so the dashboard code does not care which one it has.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.GT7Core = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const SEND_PORT = 33739, RECV_PORT = 33740;
  const HB_ORDER = ["C", "~", "B", "A"];
  const IV_XOR = [0xDEADBEAF, 0xDEADBEEF, 0x55FABB4F];
  const KEY = new Uint8Array(32);
  "Simulator Interface Packet GT7 ver 0.0".split("").slice(0, 32).forEach((c, i) => { KEY[i] = c.charCodeAt(0); });
  const KEY_WORDS = (() => {
    const dv = new DataView(KEY.buffer);
    return Array.from({ length: 8 }, (_, i) => dv.getUint32(i * 4, true));
  })();
  const SIGMA = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574];

  const rotl = (a, b) => ((a << b) | (a >>> (32 - b))) >>> 0;

  function salsaBlock(nonceLo, nonceHi, counter, out, outOff) {
    const x = new Uint32Array(16);
    x[0] = SIGMA[0];
    for (let i = 0; i < 4; i++) x[1 + i] = KEY_WORDS[i];
    x[5] = SIGMA[1];
    x[6] = nonceLo; x[7] = nonceHi;
    x[8] = counter >>> 0; x[9] = 0;
    x[10] = SIGMA[2];
    for (let i = 0; i < 4; i++) x[11 + i] = KEY_WORDS[4 + i];
    x[15] = SIGMA[3];
    const z = Uint32Array.from(x);
    for (let i = 0; i < 10; i++) {
      z[4] ^= rotl(z[0] + z[12] >>> 0, 7);  z[8] ^= rotl(z[4] + z[0] >>> 0, 9);
      z[12] ^= rotl(z[8] + z[4] >>> 0, 13); z[0] ^= rotl(z[12] + z[8] >>> 0, 18);
      z[9] ^= rotl(z[5] + z[1] >>> 0, 7);   z[13] ^= rotl(z[9] + z[5] >>> 0, 9);
      z[1] ^= rotl(z[13] + z[9] >>> 0, 13); z[5] ^= rotl(z[1] + z[13] >>> 0, 18);
      z[14] ^= rotl(z[10] + z[6] >>> 0, 7); z[2] ^= rotl(z[14] + z[10] >>> 0, 9);
      z[6] ^= rotl(z[2] + z[14] >>> 0, 13); z[10] ^= rotl(z[6] + z[2] >>> 0, 18);
      z[3] ^= rotl(z[15] + z[11] >>> 0, 7); z[7] ^= rotl(z[3] + z[15] >>> 0, 9);
      z[11] ^= rotl(z[7] + z[3] >>> 0, 13); z[15] ^= rotl(z[11] + z[7] >>> 0, 18);
      z[1] ^= rotl(z[0] + z[3] >>> 0, 7);   z[2] ^= rotl(z[1] + z[0] >>> 0, 9);
      z[3] ^= rotl(z[2] + z[1] >>> 0, 13);  z[0] ^= rotl(z[3] + z[2] >>> 0, 18);
      z[6] ^= rotl(z[5] + z[4] >>> 0, 7);   z[7] ^= rotl(z[6] + z[5] >>> 0, 9);
      z[4] ^= rotl(z[7] + z[6] >>> 0, 13);  z[5] ^= rotl(z[4] + z[7] >>> 0, 18);
      z[11] ^= rotl(z[10] + z[9] >>> 0, 7); z[8] ^= rotl(z[11] + z[10] >>> 0, 9);
      z[9] ^= rotl(z[8] + z[11] >>> 0, 13); z[10] ^= rotl(z[9] + z[8] >>> 0, 18);
      z[12] ^= rotl(z[15] + z[14] >>> 0, 7); z[13] ^= rotl(z[12] + z[15] >>> 0, 9);
      z[14] ^= rotl(z[13] + z[12] >>> 0, 13); z[15] ^= rotl(z[14] + z[13] >>> 0, 18);
    }
    for (let i = 0; i < 16; i++) {
      const w = (z[i] + x[i]) >>> 0, o = outOff + i * 4;
      out[o] = w & 255; out[o + 1] = (w >>> 8) & 255; out[o + 2] = (w >>> 16) & 255; out[o + 3] = w >>> 24;
    }
  }

  function decryptWith(buf, k) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const iv1 = dv.getInt32(0x40, true);
    const iv2 = iv1 ^ IV_XOR[k];
    const out = new Uint8Array(buf.length), ks = new Uint8Array(64);
    for (let off = 0; off < buf.length; off += 64) {
      salsaBlock(iv2 >>> 0, iv1 >>> 0, off / 64, ks, 0);
      for (let i = 0; i < 64 && off + i < buf.length; i++) out[off + i] = buf[off + i] ^ ks[i];
    }
    const m = new DataView(out.buffer).getUint32(0, true);
    return (m & ~3) === 0x47375330 ? out : null;
  }

  function latin1(p, from, to) {
    let s = "";
    for (let i = from; i < to; i++) s += String.fromCharCode(p[i]);
    return s;
  }

  // Remembers which of the three key variants this console uses, and the field count of the grid.
  function createDecoder() {
    let pick = -1, lastCars = 0;

    function decrypt(buf) {
      if (!buf || buf.length < 0x128) return null;
      if (pick >= 0) { const p = decryptWith(buf, pick); if (p) return p; }
      for (let k = 0; k < IV_XOR.length; k++) {
        const p = decryptWith(buf, k);
        if (p) { pick = k; return p; }
      }
      return null;
    }

    function parse(p, now) {
      const dv = new DataView(p.buffer, p.byteOffset, p.byteLength);
      const f = o => dv.getFloat32(o, true);
      const f4 = o => [f(o), f(o + 4), f(o + 8), f(o + 12)];
      const gearBits = p[0x90], flags = dv.getUint16(0x8E, true), speedMs = f(0x4C);
      const rps = f4(0xA4), rad = f4(0xB4);
      const d = {
        t: now === undefined ? Date.now() : now,
        len: p.length,
        pos: { x: f(0x04), y: f(0x08), z: f(0x0C) },
        vel: { x: f(0x10), y: f(0x14), z: f(0x18) },
        rot: { p: f(0x1C), y: f(0x20), r: f(0x24) },
        north: f(0x28),
        angVel: { x: f(0x2C), y: f(0x30), z: f(0x34) },
        speed: speedMs * 3.6,
        speedMs,
        rpm: f(0x3C),
        rpmWarn: dv.getUint16(0x88, true),
        rpmLimit: dv.getUint16(0x8A, true),
        maxSpeed: dv.getInt16(0x8C, true),
        gear: gearBits & 0x0F,
        suggestedGear: gearBits >> 4,
        throttle: p[0x91] / 255,
        brake: p[0x92] / 255,
        fuel: f(0x44),
        fuelCapacity: f(0x48),
        tyreTemp: f4(0x60),
        wheelRPS: rps,
        tyreRadius: rad,
        tyreSpeed: rps.map((w, i) => Math.abs(w) * rad[i]),
        slipRatio: rps.map((w, i) => speedMs > 2 ? (Math.abs(w) * rad[i]) / speedMs : 1),
        suspHeight: f4(0xC4),
        oilTemp: f(0x5C),
        waterTemp: f(0x58),
        oilPressure: f(0x54),
        boost: f(0x50) - 1,
        rideHeight: f(0x38),
        roadPlane: [f(0x94), f(0x98), f(0x9C)],
        roadPlaneDist: f(0xA0),
        packetId: dv.getInt32(0x70, true),
        lap: dv.getInt16(0x74, true),
        totalLaps: dv.getInt16(0x76, true),
        bestLapMs: dv.getInt32(0x78, true),
        lastLapMs: dv.getInt32(0x7C, true),
        timeOfDayMs: dv.getInt32(0x80, true),
        gridPosition: dv.getInt16(0x84, true),
        preRaceCars: dv.getInt16(0x86, true),
        clutch: f(0xF4),
        clutchEngage: f(0xF8),
        gearboxRpm: f(0xFC),
        transTopSpeed: f(0x100),
        carId: dv.getInt32(0x124, true),
        flags,
        onTrack: !!(flags & 0x01),
        paused: !!(flags & 0x02),
        loading: !!(flags & 0x04),
        inGear: !!(flags & 0x08),
        turbo: !!(flags & 0x10),
        revLimiter: !!(flags & 0x20),
        handbrake: !!(flags & 0x40),
        lights: !!(flags & 0x80),
        asm: !!(flags & 0x400),
        tcs: !!(flags & 0x800)
      };
      if (d.preRaceCars > 0) lastCars = d.preRaceCars;
      d.carsOnTrack = lastCars || d.preRaceCars;
      if (p.length >= 0x13C) {
        d.steerRad = f(0x128);
        d.steerRate = f(0x12C);
        d.gLat = f(0x130) / 9.80665;
        d.gVert = f(0x134) / 9.80665;
        d.gLong = f(0x138) / 9.80665;
      }
      if (p.length >= 0x158) {
        d.throttleFiltered = p[0x13C] / 255;
        d.brakeFiltered = p[0x13D] / 255;
        d.torqueVector = f4(0x140);
        d.energyRecovery = f(0x150);
      }
      if (p.length >= 0x170) {
        d.surface = latin1(p, 0x158, 0x15C);
        d.currentLapMs = dv.getInt32(0x15C, true);
        d.wheelAngle = [f(0x160), f(0x164)];
        d.wheelBase = f(0x168);
        d.carCategory = latin1(p, 0x16C, 0x170).replace(/\0/g, "");
      }
      return d;
    }

    return { decrypt, parse };
  }

  function ipv4(s) { return /^\d+\.\d+\.\d+\.\d+$/.test(s); }
  function toBytes(s) { return new Uint8Array([s.charCodeAt(0)]); }

  // transport: { bind(port) -> Promise, send(bytes, ip, port), close(), onPacket(fn(bytes, ip)), info() -> Promise<[{ ip, netmask }]> }
  class Gt7Link {
    constructor(transport, opts) {
      opts = opts || {};
      this.tr = transport;
      this.now = opts.now || (() => Date.now());
      this.readyState = 0;
      this.onopen = this.onmessage = this.onclose = this.onerror = null;
      this.dec = createDecoder();
      this.psIp = opts.ip && ipv4(opts.ip) ? opts.ip : null;
      this.udpPort = opts.port || RECV_PORT;
      this.hbIdx = 0;
      this.hbSent = 0; this.count = 0; this.pps = 0; this.total = 0; this.gaps = 0; this.badKey = 0;
      this.lastId = -1; this.lastPacketAt = 0; this.packetLen = 0;
      this.nets = []; this.sweep = []; this.sweepAt = 0;
      this.timers = [];
      this.tr.onPacket((bytes, ip) => this.packet(bytes, ip));
      Promise.resolve().then(() => this.start());
    }

    emit(obj) { if (this.onmessage) this.onmessage({ data: JSON.stringify(obj) }); }

    async start() {
      try {
        this.nets = (await this.tr.info()) || [];
        await this.tr.bind(this.udpPort);
      } catch (e) {
        this.readyState = 3;
        if (this.onerror) this.onerror(e);
        if (this.onclose) this.onclose();
        return;
      }
      if (this.readyState === 3) return;
      this.readyState = 1;
      if (this.onopen) this.onopen();
      this.beat();
      this.timers.push(setInterval(() => this.beat(), 1000));
      this.timers.push(setInterval(() => this.watch(), 250));
      this.timers.push(setInterval(() => this.tick(), 1000));
      this.emit(this.meta());
    }

    hb() { return HB_ORDER[this.hbIdx]; }

    broadcasts() {
      return this.nets.map(n => {
        const ip = n.ip.split(".").map(Number), m = (n.netmask || "255.255.255.0").split(".").map(Number);
        return ip.map((p, i) => p | (~m[i] & 255)).join(".");
      });
    }

    subnetHosts() {
      const out = [];
      for (const n of this.nets) {
        if (n.netmask !== "255.255.255.0") continue;
        const base = n.ip.split(".").slice(0, 3).join("."), self = Number(n.ip.split(".")[3]);
        for (let h = 1; h < 255; h++) if (h !== self) out.push(base + "." + h);
      }
      return out;
    }

    sweepTick() {
      if (this.psIp || this.lastPacketAt) return;
      if (this.sweepAt >= this.sweep.length) { this.sweep = this.subnetHosts(); this.sweepAt = 0; if (!this.sweep.length) return; }
      const byte = toBytes(this.hb());
      const end = Math.min(this.sweepAt + 32, this.sweep.length);
      for (; this.sweepAt < end; this.sweepAt++) this.tr.send(byte, this.sweep[this.sweepAt], SEND_PORT);
    }

    beat() {
      if (this.readyState !== 1) return;
      this.hbSent++;
      const byte = toBytes(this.hb());
      const targets = this.psIp ? [this.psIp] : this.broadcasts();
      if (!this.psIp) this.sweepTick();
      for (const ip of targets) this.tr.send(byte, ip, SEND_PORT);
    }

    // Faster re-beat when the stream stalls; walks the heartbeat letters until the console answers.
    watch() {
      const since = this.now() - this.lastPacketAt;
      if (this.lastPacketAt && since > 250 && since < 30000) { this.gaps++; this.beat(); }
      else if (this.lastPacketAt && since >= 30000 && this.psIp) this.beat();
      else if (!this.lastPacketAt) {
        if (this.hbSent % 8 === 0) this.hbIdx = (this.hbIdx + 1) % HB_ORDER.length;
        this.beat();
      }
    }

    tick() {
      this.pps = this.count; this.count = 0;
      this.emit(this.meta());
    }

    packet(bytes, from) {
      const plain = this.dec.decrypt(bytes);
      if (!plain) { this.badKey++; return; }
      const d = this.dec.parse(plain, this.now());
      if (!this.psIp || this.psIp !== from) this.psIp = from;
      if (d.packetId <= this.lastId && d.packetId > this.lastId - 300) return;
      this.lastId = d.packetId;
      this.count++; this.total++; this.packetLen = bytes.length;
      this.lastPacketAt = this.now();
      if (this.onmessage) this.onmessage({ data: JSON.stringify(d) });
    }

    meta() {
      const t = this.now();
      return {
        type: "meta", t, ip: this.psIp, port: this.udpPort, hb: this.hb(),
        pps: this.pps, total: this.total, gaps: this.gaps, badKey: this.badKey, clients: 1,
        packetLen: this.packetLen, reach: null, mode: "GT7", ips: this.nets.map(n => n.ip),
        udpPort: this.udpPort, lastPacketAt: this.lastPacketAt,
        connected: !!this.lastPacketAt && t - this.lastPacketAt < 1500
      };
    }

    // The dashboard sends the same commands it sends the PC bridge.
    send(text) {
      let msg; try { msg = JSON.parse(text); } catch (e) { return; }
      if (msg.type === "target") {
        const ip = String(msg.ip || "").trim();
        if (ip === "" || ipv4(ip)) {
          this.psIp = ip || null; this.lastPacketAt = 0; this.hbIdx = 0;
          this.beat(); this.emit(this.meta());
        }
      } else if (msg.type === "udpPort") {
        const p = Number(msg.port);
        if (p >= 1024 && p <= 65535 && p !== this.udpPort) {
          this.udpPort = p; this.lastPacketAt = 0;
          Promise.resolve(this.tr.bind(p)).then(() => this.emit(this.meta()), () => {});
        }
      }
    }

    close() {
      this.readyState = 3;
      this.timers.forEach(clearInterval); this.timers = [];
      try { this.tr.close(); } catch (e) {}
    }
  }

  // Wraps the native UDP plugin (Capacitor "ApexaUdp") as a transport. Bytes cross the bridge as base64.
  function nativeTransport(plugin) {
    const b64 = u8 => { let s = ""; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); };
    const unb64 = s => { const r = atob(s), u = new Uint8Array(r.length); for (let i = 0; i < r.length; i++) u[i] = r.charCodeAt(i); return u; };
    let handle = null, cb = null;
    return {
      onPacket(fn) { cb = fn; },
      async bind(port) {
        if (handle) { try { await handle.remove(); } catch (e) {} handle = null; }
        handle = await plugin.addListener("packet", ev => { if (cb) cb(unb64(ev.data), ev.ip); });
        await plugin.bind({ port });
      },
      send(bytes, ip, port) { plugin.send({ data: b64(bytes), ip, port }).catch(() => {}); },
      async info() { const r = await plugin.localInfo(); return r && r.nets || []; },
      close() { try { plugin.close(); } catch (e) {} if (handle) { try { handle.remove(); } catch (e) {} handle = null; } }
    };
  }

  return { createDecoder, Gt7Link, nativeTransport, SEND_PORT, RECV_PORT };
});
