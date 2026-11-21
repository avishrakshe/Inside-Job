// Every sound is synthesised with WebAudio: no audio files, nothing to license.
let ac: AudioContext | null = null;
let master: GainNode | null = null;
let muted = (() => { try { return localStorage.getItem("ij.mute") === "1"; } catch { return false; } })();
const listeners = new Set<(m: boolean) => void>();

function ctx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ac) {
    const C = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!C) return null;
    ac = new C();
    master = ac!.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ac!.destination);
  }
  if (ac!.state === "suspended") ac!.resume().catch(() => {});
  return ac;
}

if (typeof window !== "undefined") {
  const unlock = () => { ctx(); };
  window.addEventListener("pointerdown", unlock, { once: true });
  window.addEventListener("keydown", unlock, { once: true });
}

export function isMuted() { return muted; }
export function setMuted(m: boolean) {
  muted = m;
  try { localStorage.setItem("ij.mute", m ? "1" : "0"); } catch { /* ignore */ }
  if (master) master.gain.value = m ? 0 : 0.5;
  listeners.forEach((f) => f(m));
}
export function onMute(f: (m: boolean) => void) { listeners.add(f); return () => { listeners.delete(f); }; }

function tone(freq: number, dur: number, opts: { type?: OscillatorType; vol?: number; at?: number; slide?: number; attack?: number } = {}) {
  const a = ctx();
  if (!a || muted) return;
  const t0 = a.currentTime + (opts.at ?? 0);
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = opts.type ?? "sine";
  o.frequency.setValueAtTime(freq, t0);
  if (opts.slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, opts.slide), t0 + dur);
  const v = opts.vol ?? 0.3;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(v, t0 + (opts.attack ?? 0.008));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(master!);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

function noise(dur: number, opts: { vol?: number; at?: number; freq?: number; q?: number; type?: BiquadFilterType } = {}) {
  const a = ctx();
  if (!a || muted) return;
  const t0 = a.currentTime + (opts.at ?? 0);
  const n = Math.max(1, Math.floor(a.sampleRate * dur));
  const buf = a.createBuffer(1, n, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = opts.type ?? "bandpass";
  f.frequency.value = opts.freq ?? 1200;
  f.Q.value = opts.q ?? 1;
  const g = a.createGain();
  g.gain.value = opts.vol ?? 0.3;
  src.connect(f).connect(g).connect(master!);
  src.start(t0);
}

let stepAlt = false;
export const sfx = {
  step() { stepAlt = !stepAlt; noise(0.05, { vol: 0.12, freq: stepAlt ? 420 : 360, q: 2 }); },
  click() { tone(880, 0.06, { type: "square", vol: 0.08 }); },
  taskTick() { tone(1320, 0.05, { type: "triangle", vol: 0.06 }); },
  taskDone() { [660, 880, 1320].forEach((f, i) => tone(f, 0.18, { type: "triangle", vol: 0.18, at: i * 0.08 })); },
  cuff() {
    tone(1900, 0.05, { type: "square", vol: 0.12 });
    tone(1500, 0.07, { type: "square", vol: 0.12, at: 0.07 });
    noise(0.12, { vol: 0.25, freq: 3000, q: 4, at: 0.02 });
    tone(110, 0.4, { type: "sawtooth", vol: 0.12, at: 0.05, slide: 55 });
  },
  cuffed() {
    tone(400, 0.6, { type: "sawtooth", vol: 0.16, slide: 70 });
    noise(0.3, { vol: 0.3, freq: 600, q: 0.8 });
    tone(1900, 0.05, { type: "square", vol: 0.1, at: 0.3 });
    tone(1500, 0.07, { type: "square", vol: 0.1, at: 0.37 });
  },
  alarm() {
    for (let k = 0; k < 3; k++) {
      tone(560, 0.38, { type: "sawtooth", vol: 0.13, at: k * 0.42, slide: 980 });
    }
  },
  body() {
    tone(196, 0.9, { type: "sawtooth", vol: 0.18 });
    tone(207, 0.9, { type: "sawtooth", vol: 0.14 });
    noise(0.5, { vol: 0.3, freq: 200, q: 0.7, type: "lowpass" });
  },
  vote() { tone(520, 0.08, { type: "square", vol: 0.1 }); tone(780, 0.1, { type: "square", vol: 0.1, at: 0.07 }); },
  reveal() {
    tone(55, 1.4, { type: "sine", vol: 0.5, slide: 40 });
    noise(1.2, { vol: 0.15, freq: 300, q: 0.5, type: "lowpass" });
    [392, 494, 587].forEach((f, i) => tone(f, 0.9, { type: "triangle", vol: 0.07, at: 0.25 + i * 0.12 }));
  },
  moleReveal() {
    tone(55, 1.5, { type: "sine", vol: 0.5, slide: 35 });
    [311, 293, 233].forEach((f, i) => tone(f, 0.8, { type: "sawtooth", vol: 0.06, at: 0.25 + i * 0.18 }));
  },
  eject() {
    tone(900, 1.4, { type: "sine", vol: 0.15, slide: 60 });
    noise(1.0, { vol: 0.12, freq: 900, q: 0.4, at: 0.1 });
    tone(60, 0.4, { type: "sine", vol: 0.5, at: 1.4 });
  },
  win() { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, i === 5 ? 0.7 : 0.16, { type: "triangle", vol: 0.2, at: i * 0.13 })); },
  lose() { [392, 370, 349, 262].forEach((f, i) => tone(f, i === 3 ? 0.9 : 0.3, { type: "sawtooth", vol: 0.1, at: i * 0.32 })); },
  join() { tone(660, 0.1, { type: "triangle", vol: 0.15 }); tone(990, 0.15, { type: "triangle", vol: 0.15, at: 0.08 }); },
};
