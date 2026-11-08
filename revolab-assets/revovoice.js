// Revolab Edge — clean-room browser runtime (ESM). 100% Revolab-owned code.
// Text -> speech entirely on-device: our G2P, our inference runtime, our weights.

export const KNOWN_VOICES = Object.freeze([
  { key: 'angellyn', label: 'angellyn', language: 'Malay', flag: '\u{1F1F2}\u{1F1FE}' },
  { key: 'sarah',    label: 'sarah',    language: 'Malay', flag: '\u{1F1F2}\u{1F1FE}' },
  { key: 'paan',     label: 'paan',     language: 'Malay', flag: '\u{1F1F2}\u{1F1FE}' },
]);
// Any other key works too: loadVoice() resolves @revolab/voice-<key> from
// the CDN first, so voices published after this package need no code change.
const SR = 22050;
const DEFAULT_MAX_SECONDS = 30;

async function fetchBytes(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`revolab-edge: fetch ${url} -> HTTP ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

export class RevolabEdge {
  constructor(mod, base) { this._m = mod; this._base = base; this._voice = null; }

  static async load({ assetBase = '' } = {}) {
    const base = assetBase.endsWith('/') ? assetBase : assetBase + '/';
    const { instance } = await WebAssembly.instantiate(
      await fetchBytes(base + 'revolab_edge.wasm'), { env: {} });
    const m = instance.exports;
    for (const fn of ['rv_alloc', 'rv_free', 'rv_voice_init', 'rv_g2p_init', 'rv_text_to_audio']) {
      if (typeof m[fn] !== 'function') throw new Error(`revolab-edge: wasm missing ${fn}`);
    }
    // G2P asset (lexicon+rules) initializes once at load
    const g2p = await fetchBytes(base + 'g2p.json');
    const p = m.rv_alloc(g2p.length);
    new Uint8Array(m.memory.buffer).set(g2p, p);
    const rc = m.rv_g2p_init(p, g2p.length);
    if (rc !== 0) throw new Error(`revolab-edge: g2p init rc=${rc}`);
    return new RevolabEdge(m, base);
  }

  async loadVoice(key, { voiceBase, quantized = true } = {}) {
    const base = voiceBase || this._base;
    // Voice resolution order: explicit voiceBase dir → voice-package CDN
    // (@revolab/voice-<key>, tiny npm packages of just weights) → the
    // voices bundled in this package.
    let dir, ext;
    if (voiceBase) {
      dir = (base.endsWith('/') ? base : base + '/') +
        (quantized ? `voices_q8/${key}/` : `voices/${key}/`);
      ext = quantized ? 'qbin' : 'bin';
    } else {
      const vpkg = `https://unpkg.com/@revolab/voice-${key}/`;
      const bundled = (base.endsWith('/') ? base : base + '/') +
        (quantized ? `voices_q8/${key}/` : `voices/${key}/`);
      try {
        const probe = await fetch(`${vpkg}manifest.json`);
        dir = probe.ok ? vpkg : bundled;
      } catch { dir = bundled; }
      ext = quantized ? 'qbin' : 'bin';
    }
    const m = this._m;
    const [dur, aco, dec, man] = await Promise.all([
      fetchBytes(dir + `duration.${ext}`), fetchBytes(dir + `acoustic.${ext}`),
      fetchBytes(dir + `decoder.${ext}`), fetchBytes(dir + 'manifest.json'),
    ]);
    const init = quantized ? m.rv_voice_init_q8 : m.rv_voice_init;
    const manS = new TextDecoder().decode(man);
    const ps = [dur, aco, dec].map(b => {
      const p = m.rv_alloc(b.length);
      new Uint8Array(m.memory.buffer).set(b, p);
      return [p, b.length];
    });
    const mp = m.rv_alloc(manS.length);
    new TextEncoder().encodeInto(manS, new Uint8Array(m.memory.buffer).subarray(mp, mp + manS.length));
    const rc = init(ps[0][0], ps[0][1], ps[1][0], ps[1][1], ps[2][0], ps[2][1], mp, manS.length);
    if (rc !== 0) throw new Error(`revolab-edge: voice init rc=${rc}`);
    this._voice = { key };
    return this._voice;
  }

  /** text -> { samples, sampleRate, elapsedMs } */
  async synthesize(text, { voice, voiceBase, quantized = true, lengthScale = 1.0, maxSeconds = DEFAULT_MAX_SECONDS } = {}) {
    if (typeof text !== 'string' || !text.trim()) throw new Error('revolab-edge: non-empty text required');
    if (voice && (!this._voice || this._voice.key !== voice)) await this.loadVoice(voice, { voiceBase, quantized });
    if (!this._voice) throw new Error('revolab-edge: loadVoice() first or pass {voice}');
    const m = this._m;
    const tb = new TextEncoder().encode(text);
    const tp = m.rv_alloc(tb.length);
    new Uint8Array(m.memory.buffer).set(tb, tp);
    let cap = SR * maxSeconds;
    let op = m.rv_alloc(cap * 4);
    const t0 = performance.now();
    let n = m.rv_text_to_audio(tp, tb.length, lengthScale, op, cap);
    if (n < 0) { // required size returned negative
      cap = -n;
      m.rv_free(op, 0);
      op = m.rv_alloc(cap * 4);
      n = m.rv_text_to_audio(tp, tb.length, lengthScale, op, cap);
    }
    const elapsedMs = performance.now() - t0;
    if (n <= 0) { m.rv_free(op, cap * 4); throw new Error(`revolab-edge: synth rc=${n}`); }
    const samples = new Float32Array(n);
    samples.set(new Float32Array(m.memory.buffer, op, n));
    m.rv_free(op, cap * 4); m.rv_free(tp, tb.length);
    return { samples, sampleRate: SR, elapsedMs };
  }
}

export function playAudio({ samples, sampleRate }, { audioContext } = {}) {
  const Ctor = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!Ctor) throw new Error('revolab-edge: playAudio requires WebAudio');
  const ctx = audioContext || new Ctor();
  const buf = ctx.createBuffer(1, samples.length, sampleRate);
  buf.getChannelData(0).set(samples);
  const src = ctx.createBufferSource();
  src.buffer = buf; src.connect(ctx.destination); src.start();
  return src;
}