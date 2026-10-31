// Speech to text that runs on the device, for places where the browser has no speech service
// (the desktop app, Firefox/Safari tabs, a phone with no recognition service). Runs in a worker so a slow
// transcription never freezes the dashboard. The model (~40 MB) is fetched once and then kept by the browser.
// The desktop app ships the model and the runtime next to the dashboard (/models/), so it works with no internet.
const BUNDLED = /Electron\//.test(self.navigator.userAgent || "");
const LIB = BUNDLED ? "/models/lib/transformers.min.js" : "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js";
const MODEL = "Xenova/whisper-tiny.en";

let asr = null, loading = null, useGpu = BUNDLED && !!(self.navigator && self.navigator.gpu), gpuFailed = false;

// The desktop app runs the model on the graphics chip when it has one (about 3x quicker); anything else, or any trouble,
// falls back to the processor model that works everywhere.
async function make(T, gpu, progress) {
  return T.pipeline("automatic-speech-recognition", MODEL, gpu
    ? { device: "webgpu", dtype: { encoder_model: "fp16", decoder_model_merged: "fp16" }, progress_callback: progress }
    : { device: "wasm", dtype: "q8", progress_callback: progress });
}

async function load() {
  if (asr) return;
  if (!loading) loading = (async () => {
    const T = await import(LIB);
    if (BUNDLED) {
      T.env.allowLocalModels = true; T.env.localModelPath = "/models/"; T.env.allowRemoteModels = false;
      T.env.backends.onnx.wasm.wasmPaths = "/models/lib/";
    } else T.env.allowLocalModels = false;
    const seen = {};
    const progress = p => {
      if (p && p.status === "progress" && p.file) {
        seen[p.file] = { loaded: p.loaded || 0, total: p.total || 0 };
        let l = 0, t = 0; for (const k in seen) { l += seen[k].loaded; t += seen[k].total; }
        if (t) self.postMessage({ type: "progress", pct: Math.min(99, Math.round(100 * l / t)) });
      }
    };
    if (useGpu) {
      try {
        const ad = await self.navigator.gpu.requestAdapter();
        if (!ad) throw new Error("no graphics adapter");
        asr = await make(T, true, progress);
        await asr(new Float32Array(16000), { max_new_tokens: 2 });      // warm-up: the first call compiles the shaders
      } catch (e) { useGpu = false; gpuFailed = true; asr = null; }
    }
    if (!asr) {
      asr = await make(T, false, progress);
      try { await asr(new Float32Array(16000), { max_new_tokens: 2 }); } catch (e) {}
    }
  })();
  await loading;
}

self.onmessage = async e => {
  const m = e.data || {};
  try {
    if (m.type === "load") { await load(); self.postMessage({ type: "ready" }); }
    else if (m.type === "run") {
      await load();
      // a short command never needs more than a few dozen tokens: cap it so noise cannot make the model ramble for seconds
      const out = await asr(m.audio, { max_new_tokens: 40 });
      // the model writes sounds it hears as "[Music]", "(beep)" or "*click*": those are not speech
      let text = String((out && out.text) || "").replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*|[♪♫]/g, " ").replace(/\s+/g, " ").trim();
      // and on near-silence it sometimes invents sign-offs it has seen in videos
      if (/^(?:thanks?(?: you)?(?: so much)?(?: for (?:watching|listening))?|thank you\.?|you|bye(?: bye)?|okay|the end|subtitles by .*|\.+)[.!? ]*$/i.test(text)) text = "";
      // a loop of the same short word is the model stuck: not speech
      if (/\b(\w{2,})\b(?:\W+\1\b){4,}/i.test(text)) text = "";
      self.postMessage({ type: "text", id: m.id, text: /[a-z]{2}/i.test(text) ? text : "" });
    }
  } catch (err0) {
    let err = err0;
    if (useGpu && m.type === "run") {                                    // graphics trouble: carry on with the processor model
      useGpu = false; gpuFailed = true; asr = null; loading = null;
      try { await load(); const o2 = await asr(m.audio, { max_new_tokens: 40 }); self.postMessage({ type: "text", id: m.id, text: String((o2 && o2.text) || "").trim() }); return; } catch (e2) { err = e2; }
    }
    loading = null;
    self.postMessage({ type: "error", id: m.id, message: String((err && err.message) || err) });
  }
};
