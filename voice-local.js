// Microphone -> utterances -> text, all on the device. Used where the browser has no speech service.
// Segmenter is plain maths on audio samples (testable); LocalListener wires it to the microphone and the worker.

const RATE = 16000, FRAME = 320;                       // 20 ms frames at 16 kHz

// Bring a quiet voice up to a steady level before the model hears it: the model reads loudness as part of the sound,
// so a soft voice is recognised far worse than the same words spoken at normal volume.
export function levelled(a) {
  const n = Math.floor(a.length / FRAME), lv = [];
  for (let f = 0; f < n; f++) { let e = 0; for (let i = f * FRAME; i < (f + 1) * FRAME; i++) e += a[i] * a[i]; lv.push(Math.sqrt(e / FRAME)); }
  if (!lv.length) return a;
  lv.sort((x, y) => x - y);
  const speech = lv[Math.floor(lv.length * 0.8)];            // the level of the louder part of the phrase
  if (!(speech > 1e-4)) return a;
  const g = Math.max(1, Math.min(30, 0.1 / speech));
  if (g > 1.05) for (let i = 0; i < a.length; i++) { const v = a[i] * g; a[i] = v > 0.99 ? 0.99 : v < -0.99 ? -0.99 : v; }
  return a;
}

export class Segmenter {
  constructor(o) {
    o = o || {};
    this.noise = 0.006;                                // the room's background level, followed from the quiet moments
    this.minThr = o.minThr || 0.0045;                  // a quiet voice at arm's length sits around 0.01 to 0.02
    this.k = o.k || 3;                                 // how far above the room a voice has to rise
    this.hangFrames = o.hangFrames || 24;              // 480 ms of quiet ends an utterance
    this.maxFrames = o.maxFrames || 500;               // 10 s cap
    this.minFrames = o.minFrames || 12;                // shorter than 240 ms of voice is a click or cough
    this.ring = []; this.watch = [];
    this.reset();
  }
  reset() { this.pre = []; this.buf = null; this.hot = 0; this.quiet = 0; this.voiced = 0; this.watch = []; }
  thr() { return Math.max(this.minThr, this.noise * this.k); }
  // once a phrase has started, the softer ends of words and the last word of a sentence still count as speech
  thrKeep() { return Math.max(this.minThr * 0.55, this.noise * 1.7); }
  // the background level is the low end of what was heard in the last 1.5 s of non-speech
  follow(rms) {
    this.ring.push(rms); if (this.ring.length > 75) this.ring.shift();
    if (this.ring.length >= 10) { const s = this.ring.slice().sort((x, y) => x - y); this.noise = Math.max(0.0012, s[Math.floor(s.length * 0.25)]); }
  }

  // one 20 ms frame in, an utterance (Float32Array at 16 kHz) out when one has just ended
  push(frame) {
    let e = 0; for (let i = 0; i < frame.length; i++) e += frame[i] * frame[i];
    const rms = Math.sqrt(e / frame.length), thr = this.thr();
    if (!this.buf) {
      this.pre.push(frame); if (this.pre.length > 25) this.pre.shift();
      if (rms > thr) this.hot++; else { this.hot = 0; this.follow(rms); }
      if (this.hot >= 3) { this.buf = this.pre.slice(); this.pre = []; this.quiet = 0; this.voiced = this.hot; this.watch = []; }
      return null;
    }
    this.buf.push(frame);
    if (rms > this.thrKeep()) { this.quiet = 0; this.voiced++; } else this.quiet++;
    // a level that never moves for four seconds is a fan or a TV, not a driver: take it as the new background and let go
    this.watch.push(rms); if (this.watch.length > 100) this.watch.shift();
    if (this.watch.length >= 100) {
      const mean = this.watch.reduce((a, v) => a + v, 0) / 100, spread = Math.max.apply(null, this.watch) - Math.min.apply(null, this.watch);
      if (spread < mean * 0.9) { this.ring = this.watch.slice(); this.noise = Math.max(0.0012, mean * 0.9); this.buf = null; this.hot = 0; this.quiet = 0; this.voiced = 0; this.watch = []; return null; }
    }
    if (this.quiet >= this.hangFrames || this.buf.length >= this.maxFrames) {
      const frames = this.buf.slice(0, this.buf.length - Math.max(0, this.quiet - 8)), ok = this.voiced >= this.minFrames;
      this.buf = null; this.hot = 0; this.quiet = 0; this.voiced = 0; this.watch = [];
      if (!ok) return null;
      const out = new Float32Array(frames.length * FRAME);
      frames.forEach((f, i) => out.set(f, i * FRAME));
      return levelled(out);
    }
    return null;
  }
}

// Linear resampler from the microphone's rate to 16 kHz, carrying the fractional position between chunks.
export class Resampler {
  constructor(from) { this.step = from / RATE; this.pos = 0; this.tail = new Float32Array(0); }
  push(chunk) {
    const src = new Float32Array(this.tail.length + chunk.length);
    src.set(this.tail); src.set(chunk, this.tail.length);
    const out = [];
    while (this.pos + 1 < src.length) {
      const i = Math.floor(this.pos), f = this.pos - i;
      out.push(src[i] * (1 - f) + src[i + 1] * f);
      this.pos += this.step;
    }
    const keep = Math.floor(this.pos);
    this.tail = src.slice(keep); this.pos -= keep;
    return Float32Array.from(out);
  }
}

export class LocalListener {
  // opts: onText(text), onStatus(text), muted() -> bool
  constructor(opts) {
    this.o = opts || {};
    this.seg = new Segmenter();
    this.queue = []; this.busy = false; this.id = 0; this.ready = false; this.on = false;
  }

  worker() {
    if (this.w) return this.w;
    const w = this.w = new Worker(new URL("./voice-worker.js", import.meta.url), { type: "module" });
    w.onmessage = e => {
      const m = e.data || {};
      if (m.type === "progress") this.status("Loading the offline voice model… " + m.pct + "%");
      else if (m.type === "ready") { this.ready = true; this.status("Listening."); }
      else if (m.type === "text") { this.busy = false; if (m.text) this.o.onText && this.o.onText(m.text); this.pump(); }
      else if (m.type === "error") {
        this.busy = false;
        if (!this.ready) { this.status("The offline voice model could not load. Check the internet connection and try again."); this.fail = true; }
        else this.pump();
      }
    };
    w.onerror = () => { this.status("The offline voice model could not start on this device."); this.fail = true; };
    return w;
  }

  status(t) { this.o.onStatus && this.o.onStatus(t); }

  pump() {
    if (this.busy || !this.queue.length || !this.ready) return;
    const audio = this.queue.shift();
    this.busy = true;
    this.worker().postMessage({ type: "run", id: ++this.id, audio }, [audio.buffer]);
  }

  async start() {
    if (this.on) return;
    this.fail = false;
    this.status("Starting the microphone…");
    const stream = this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = this.ctx = new AC();
    const rs = new Resampler(ctx.sampleRate);
    const src = ctx.createMediaStreamSource(stream);
    const node = this.node = ctx.createScriptProcessor(4096, 1, 1);
    let rem = new Float32Array(0);
    node.onaudioprocess = ev => {
      if (!this.on) return;
      if (this.o.muted && this.o.muted()) { this.seg.reset(); rem = new Float32Array(0); return; }
      const mono = rs.push(ev.inputBuffer.getChannelData(0));
      const all = new Float32Array(rem.length + mono.length); all.set(rem); all.set(mono, rem.length);
      let i = 0;
      for (; i + FRAME <= all.length; i += FRAME) {
        const u = this.seg.push(all.slice(i, i + FRAME));
        if (u) { this.queue.push(u); if (this.queue.length > 3) this.queue.shift(); this.pump(); }
      }
      rem = all.slice(i);
    };
    src.connect(node); node.connect(ctx.destination);
    this.on = true;
    this.status(this.ready ? "Listening." : "Loading the offline voice model…");
    this.worker().postMessage({ type: "load" });
  }

  stop() {
    this.on = false;
    try { this.node && this.node.disconnect(); } catch (e) {}
    try { this.stream && this.stream.getTracks().forEach(t => t.stop()); } catch (e) {}
    try { this.ctx && this.ctx.close(); } catch (e) {}
    this.node = this.stream = this.ctx = null;
    this.queue = []; this.seg.reset();
  }

  // test hook: transcribe a ready-made 16 kHz clip
  async transcribe(audio) {
    const w = this.worker();
    return new Promise((res, rej) => {
      const prev = w.onmessage;
      const id = ++this.id;
      w.onmessage = e => {
        const m = e.data || {};
        if (m.type === "progress") { this.status("Loading the offline voice model… " + m.pct + "%"); return; }
        if (m.type === "text" && m.id === id) { w.onmessage = prev; res(m.text); }
        else if (m.type === "error") { w.onmessage = prev; rej(new Error(m.message)); }
      };
      w.postMessage({ type: "run", id, audio });
    });
  }
}
