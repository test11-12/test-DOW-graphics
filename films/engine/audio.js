// Procedural sound: everything is synthesised with Web Audio and rendered once into a buffer with an
// OfflineAudioContext, so live playback, scrubbing and the offline MP4 mux all use the same soundtrack.
const SR = 48000;

export function noiseBuffer(ctx, seconds, kind = 'white', seed = 1) {
  const n = Math.floor(seconds * ctx.sampleRate), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
  let s = seed >>> 0; const rnd = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 * 2 - 1; };
  if (kind === 'white') for (let i = 0; i < n; i++) d[i] = rnd();
  else if (kind === 'pink') { let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0; for (let i = 0; i < n; i++) { const w = rnd(); b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898; d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926; } }
  else { let l = 0; for (let i = 0; i < n; i++) { l = (l + 0.02 * rnd()) / 1.02; d[i] = l * 3.5; } }
  return buf;
}

// ramp helper: points = [[time, value], ...] (absolute film time)
export function auto(param, points, exp = false) {
  if (!points.length) return;
  param.setValueAtTime(Math.max(points[0][1], exp ? 1e-4 : -1e9), Math.max(0, points[0][0]));
  for (let i = 1; i < points.length; i++) {
    const [t, v] = points[i];
    if (exp) param.exponentialRampToValueAtTime(Math.max(v, 1e-4), Math.max(0, t)); else param.linearRampToValueAtTime(v, Math.max(0, t));
  }
}

export class Mixer {
  constructor(ctx, duration) {
    this.ctx = ctx; this.duration = duration;
    this.master = ctx.createGain(); this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 3.5; comp.attack.value = 0.006; comp.release.value = 0.25;
    const lim = ctx.createDynamicsCompressor(); lim.threshold.value = -2.5; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.08;
    this.master.connect(comp); comp.connect(lim); lim.connect(ctx.destination);
    this.bed = ctx.createGain(); this.bed.connect(this.master);     // music + effects, ducked under narration
    this.music = ctx.createGain(); this.music.connect(this.bed);
    this.sfx = ctx.createGain(); this.sfx.connect(this.bed);
    this.voice = ctx.createGain(); this.voice.gain.value = 1.0; this.voice.connect(this.master);
    // reverb
    const ir = ctx.createBuffer(2, Math.floor(ctx.sampleRate * 3.6), ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); let s = 1234 + c * 777; for (let i = 0; i < d.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; const t = i / ctx.sampleRate; d[i] = ((s / 4294967296) * 2 - 1) * Math.pow(1 - i / d.length, 2.2) * Math.exp(-t * 1.1) * (t < 0.012 ? t / 0.012 : 1); } }
    this.reverb = ctx.createConvolver(); this.reverb.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = 0.55; this.reverb.connect(wet); wet.connect(this.bed);
    this.white = noiseBuffer(ctx, 4, 'white', 11); this.pink = noiseBuffer(ctx, 6, 'pink', 23); this.brown = noiseBuffer(ctx, 6, 'brown', 37);
  }
  src(buf, t0, t1, loop = true) { const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = loop; s.start(Math.max(0, t0), (t0 * 0.37) % buf.duration); s.stop(Math.min(this.duration, t1)); return s; }
  filt(type, f, q = 0.7) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
  gain(v = 0) { const g = this.ctx.createGain(); g.gain.value = v; return g; }
  pan(v = 0) { const p = this.ctx.createStereoPanner(); p.pan.value = v; return p; }
  chain(...nodes) { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); return nodes[nodes.length - 1]; }

  // filtered noise layer. env: [[t, gain]...]; freq: number | [[t, hz]...]
  noise({ kind = 'pink', type = 'bandpass', freq = 800, q = 0.7, env, pan = 0, dest = this.sfx, send = 0 }) {
    const t0 = env[0][0], t1 = env[env.length - 1][0];
    const s = this.src(this[kind], t0, t1 + 0.05), f = this.filt(type, Array.isArray(freq) ? freq[0][1] : freq, q), g = this.gain(0), p = this.pan(0);
    if (Array.isArray(freq)) auto(f.frequency, freq, true);
    if (Array.isArray(pan)) auto(p.pan, pan); else p.pan.value = pan;
    auto(g.gain, env); this.chain(s, f, g, p, dest);
    if (send) { const sg = this.gain(send); p.connect(sg); sg.connect(this.reverb); }
    return { src: s, filter: f, gain: g };
  }
  tone({ type = 'sine', freq = 440, env, pan = 0, dest = this.sfx, send = 0, detune = 0, lp = 0 }) {
    const t0 = env[0][0], t1 = env[env.length - 1][0];
    const o = this.ctx.createOscillator(); o.type = type; o.detune.value = detune;
    if (Array.isArray(freq)) auto(o.frequency, freq, true); else o.frequency.value = freq;
    const g = this.gain(0), p = this.pan(pan); auto(g.gain, env);
    if (lp) { const f = this.filt('lowpass', lp, 0.5); this.chain(o, f, g, p, dest); } else this.chain(o, g, p, dest);
    if (send) { const sg = this.gain(send); p.connect(sg); sg.connect(this.reverb); }
    o.start(Math.max(0, t0)); o.stop(Math.min(this.duration, t1 + 0.05));
    return o;
  }

  // jet engine: thr and dist are breakpoint curves over film time. ab adds afterburner rumble and crackle.
  jet({ env, pitch = [[0, 1]], ab = null, pan = 0, whine = 0.5, bright = 1 }) {
    const t0 = env[0][0], t1 = env[env.length - 1][0];
    const mul = (k) => env.map(([t, v]) => [t, v * k]);
    this.noise({ kind: 'brown', type: 'lowpass', freq: 190, env: mul(1.5), pan });
    this.noise({ kind: 'pink', type: 'bandpass', freq: pitch.map(([t, v]) => [t, 620 * v]), q: 0.6, env: mul(0.9 * bright), pan, send: 0.08 });
    this.noise({ kind: 'white', type: 'bandpass', freq: pitch.map(([t, v]) => [t, 2600 * v]), q: 1.1, env: mul(0.16 * bright), pan });
    if (whine > 0) for (const [f, d] of [[3150, 0], [3185, 6], [6250, -4]]) this.tone({ type: 'sawtooth', freq: pitch.map(([t, v]) => [t, f * v]), detune: d, env: mul(0.012 * whine), pan, lp: 9000 });
    if (ab) {
      this.noise({ kind: 'brown', type: 'lowpass', freq: 95, env: ab.map(([t, v]) => [t, v * 2.4]), pan });
      // crackle: clipped, amplitude-chopped noise
      const s = this.src(this.white, t0, t1), hp = this.filt('highpass', 900, 0.5), lp = this.filt('lowpass', 5200, 0.5), g = this.gain(0), sh = this.ctx.createWaveShaper();
      const curve = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.abs(x) > 0.72 ? Math.sign(x) : 0; } sh.curve = curve;
      const chop = this.src(this.brown, t0, t1); chop.playbackRate.value = 6; const cf = this.filt('lowpass', 40, 0.5);
      const depth = this.gain(0); auto(depth.gain, ab.map(([t, v]) => [t, v * 2.2])); this.chain(chop, cf, depth, g.gain); // gain rides the chopper
      this.chain(s, sh, hp, lp, g, this.pan(pan), this.sfx);
    }
  }
  // sonic boom: N-wave double crack with a long desert tail
  boom(t, { gain = 1, gap = 0.11, pan = 0 } = {}) {
    for (const [dt, k] of [[0, 1], [gap, 0.85]]) {
      this.tone({ type: 'sine', freq: [[t + dt, 95], [t + dt + 0.22, 28]], env: [[t + dt, 0], [t + dt + 0.004, 1.6 * gain * k], [t + dt + 0.25, 0]], pan, send: 0.5 });
      this.noise({ kind: 'white', type: 'lowpass', freq: [[t + dt, 5200], [t + dt + 0.12, 300]], env: [[t + dt, 0], [t + dt + 0.002, 0.9 * gain * k], [t + dt + 0.14, 0]], pan, send: 0.6 });
    }
    this.noise({ kind: 'brown', type: 'lowpass', freq: 110, env: [[t, 0], [t + 0.05, 1.3 * gain], [t + 0.9, 0.5 * gain], [t + 4.2, 0]], pan, send: 0.3 });
  }
  wind({ env, freq = 520, q = 0.5, pan = 0 }) { this.noise({ kind: 'pink', type: 'bandpass', freq, q, env, pan }); this.noise({ kind: 'brown', type: 'lowpass', freq: 240, env: env.map(([t, v]) => [t, v * 0.8]), pan }); }
  whoosh(t, { dur = 1.2, gain = 0.5, f0 = 300, f1 = 3200, pan = [-0.6, 0.6] } = {}) {
    this.noise({ kind: 'white', type: 'bandpass', freq: [[t, f0], [t + dur * 0.5, f1], [t + dur, f0 * 0.6]], q: 1.4, env: [[t, 0], [t + dur * 0.45, gain], [t + dur, 0]], pan: [[t, pan[0]], [t + dur, pan[1]]], send: 0.25 });
  }
  thump(t, { gain = 0.8, f0 = 70, f1 = 30, dur = 0.5, pan = 0, send = 0.4 } = {}) {
    this.tone({ type: 'sine', freq: [[t, f0], [t + dur, f1]], env: [[t, 0], [t + 0.006, gain], [t + dur, 0]], pan, send });
  }
  explosion(t, { gain = 1, pan = 0, delay = 0 } = {}) {
    const s = t + delay;
    this.thump(s, { gain: 1.5 * gain, f0: 62, f1: 22, dur: 1.4, pan, send: 0.7 });
    this.noise({ kind: 'brown', type: 'lowpass', freq: [[s, 900], [s + 2.5, 80]], env: [[s, 0], [s + 0.01, 1.8 * gain], [s + 0.5, 0.7 * gain], [s + 4.5, 0]], pan, send: 0.5 });
    this.noise({ kind: 'white', type: 'bandpass', freq: [[s, 2400], [s + 0.5, 500]], q: 0.6, env: [[s, 0], [s + 0.004, 0.7 * gain], [s + 0.6, 0]], pan, send: 0.4 });
  }
  beep(t, { freq = 1320, dur = 0.07, gain = 0.06, pan = 0 } = {}) { this.tone({ type: 'sine', freq, env: [[t, 0], [t + 0.004, gain], [t + dur, gain], [t + dur + 0.02, 0]], pan, send: 0.05 }); }
  radio(t, dur = 0.5, gain = 0.05) { this.noise({ kind: 'white', type: 'bandpass', freq: 1900, q: 3, env: [[t, 0], [t + 0.01, gain], [t + dur, gain * 0.8], [t + dur + 0.02, 0]] }); }

  // ---- score
  // sustained pad chord: notes in Hz
  pad(t0, t1, notes, { gain = 0.05, attack = 2.5, release = 3, bright = 900, pan = 0.25 } = {}) {
    const end = Math.min(this.duration, t1 + release);
    const f = this.filt('lowpass', bright, 0.4), g = this.gain(0), out = this.gain(1);
    auto(g.gain, [[t0, 0], [t0 + attack, gain], [t1, gain], [end, 0]]);
    auto(f.frequency, [[t0, bright * 0.5], [t0 + attack * 1.5, bright], [t1, bright * 0.8], [end, bright * 0.4]], true);
    notes.forEach((hz, i) => {
      for (const d of [-7, 0, 8]) {
        const o = this.ctx.createOscillator(); o.type = i === 0 ? 'triangle' : 'sawtooth'; o.frequency.value = hz; o.detune.value = d + (i * 3 - 4);
        const p = this.pan(((i + (d > 0 ? 1 : 0)) % 2 ? 1 : -1) * pan), og = this.gain(i === 0 ? 0.9 : 0.42);
        this.chain(o, og, p, f); o.start(Math.max(0, t0)); o.stop(end);
      }
    });
    this.chain(f, g, out, this.music);
    const sg = this.gain(0.6); out.connect(sg); sg.connect(this.reverb);
  }
  // soft pulse (heartbeat / clock) repeating between t0 and t1
  pulse(t0, t1, interval, { freq = 55, gain = 0.25, accel = 0 } = {}) {
    let t = t0, iv = interval;
    while (t < t1) { this.tone({ type: 'sine', freq: [[t, freq * 1.6], [t + 0.12, freq]], env: [[t, 0], [t + 0.008, gain], [t + 0.28, 0]], dest: this.music, send: 0.15 }); t += iv; iv = Math.max(0.18, iv * (1 - accel)); }
  }
  riser(t0, t1, { gain = 0.2 } = {}) {
    this.noise({ kind: 'white', type: 'bandpass', freq: [[t0, 300], [t1, 5200]], q: 2.2, env: [[t0, 0], [t1 - 0.05, gain], [t1, 0]], dest: this.music, send: 0.4 });
    this.tone({ type: 'sawtooth', freq: [[t0, 55], [t1, 220]], env: [[t0, 0], [t1 - 0.05, gain * 0.35], [t1, 0]], dest: this.music, lp: 1200, send: 0.3 });
  }
  hit(t, { gain = 0.7 } = {}) {
    this.tone({ type: 'sine', freq: [[t, 82], [t + 1.8, 31]], env: [[t, 0], [t + 0.01, gain], [t + 2.6, 0]], dest: this.music, send: 0.6 });
    this.noise({ kind: 'brown', type: 'lowpass', freq: 400, env: [[t, 0], [t + 0.01, gain * 0.9], [t + 1.6, 0]], dest: this.music, send: 0.7 });
  }
  // duck the bed under narration clips
  duck(clips, depth = 0.42) {
    const g = this.bed.gain; g.setValueAtTime(1, 0);
    for (const c of clips) { const a = Math.max(0, c.t - 0.25), b = c.t + c.dur; g.setValueAtTime(1, a); g.linearRampToValueAtTime(depth, a + 0.25); g.setValueAtTime(depth, b); g.linearRampToValueAtTime(1, b + 0.6); }
  }
}

const b64ToBuf = b64 => { const bin = atob(b64), a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a.buffer; };

// score(mixer) schedules everything; narration = [{t, dur, audio(base64 mp3)}]
export async function renderSoundtrack(duration, score, narration = []) {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new OAC(2, Math.ceil(duration * SR), SR);
  const mix = new Mixer(ctx, duration);
  const clips = [];
  for (const line of narration) {
    if (!line.audio) continue;
    try {
      const buf = await ctx.decodeAudioData(b64ToBuf(line.audio));
      const s = ctx.createBufferSource(); s.buffer = buf;
      // gentle presence lift and low cut for the voice
      const hp = mix.filt('highpass', 85, 0.7), pk = mix.filt('peaking', 3200, 0.9); pk.gain.value = 2.5;
      mix.chain(s, hp, pk, mix.voice); s.start(line.t);
      const sg = mix.gain(0.05); pk.connect(sg); sg.connect(mix.reverb);
      clips.push({ t: line.t, dur: buf.duration });
    } catch (e) { console.warn('narration decode failed', line.id, e); }
  }
  mix.duck(clips);
  score(mix);
  return ctx.startRendering();
}

export function wavBytes(buffer) {
  const n = buffer.length, ch = buffer.numberOfChannels, out = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); out.setUint32(4, 36 + n * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true);
  out.setUint32(24, buffer.sampleRate, true); out.setUint32(28, buffer.sampleRate * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, n * ch * 2, true);
  const d = []; for (let c = 0; c < ch; c++) d.push(buffer.getChannelData(c));
  let o = 44; for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const v = Math.max(-1, Math.min(1, d[c][i])); out.setInt16(o, v * 32767, true); o += 2; }
  return new Uint8Array(out.buffer);
}
