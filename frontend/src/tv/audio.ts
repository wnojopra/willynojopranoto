/**
 * The TV's sound: everything is synthesized with Web Audio (no audio files to
 * license or fetch), plus a narrator using the browser's built-in speech.
 *
 * Browsers only allow sound after a click/tap on the page, so the engine
 * wakes up on the first pointer or key press. Preferences (sound on/off,
 * narrator on/off) are stored in localStorage; they're not secrets.
 */

type Listener = () => void;

const PREF_SOUND = 'sb-sound';
const PREF_NARRATE = 'sb-narrate';

function pref(key: string): boolean {
  try {
    return localStorage.getItem(key) !== 'off';
  } catch {
    return true;
  }
}

function savePref(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? 'on' : 'off');
  } catch {
    // Private mode etc.: the setting just won't stick.
  }
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

class SoundEngine {
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private droneBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private droneNodes: AudioScheduledSourceNode[] = [];
  private droneFilter: BiquadFilterNode | null = null;
  private listeners = new Set<Listener>();
  private speaking = 0;
  private droneLevel = 0;

  soundOn = pref(PREF_SOUND);
  narrateOn = pref(PREF_NARRATE);

  /** True once the browser lets us make noise. */
  get awake(): boolean {
    return this.ctx?.state === 'running';
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  /** Call from a user gesture. Creates/resumes the audio context. */
  wake() {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.soundOn ? 0.8 : 0;
      // A gentle limiter so stacked effects don't clip the TV speakers.
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -12;
      comp.ratio.value = 6;
      this.master.connect(comp).connect(ctx.destination);
      this.sfx = ctx.createGain();
      this.sfx.connect(this.master);
      this.droneBus = ctx.createGain();
      this.droneBus.gain.value = 0;
      this.droneBus.connect(this.master);
      const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.noise = buf;
      ctx.onstatechange = () => this.emit();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().then(() => this.emit());
    this.emit();
  }

  setSound(on: boolean) {
    this.soundOn = on;
    savePref(PREF_SOUND, on);
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(on ? 0.8 : 0, this.ctx.currentTime, 0.05);
    if (!on) window.speechSynthesis?.cancel();
    this.emit();
  }

  setNarrate(on: boolean) {
    this.narrateOn = on;
    savePref(PREF_NARRATE, on);
    if (!on) window.speechSynthesis?.cancel();
    this.emit();
  }

  private ready(): { ctx: AudioContext; out: GainNode; now: number } | null {
    if (!this.ctx || !this.sfx || this.ctx.state !== 'running' || !this.soundOn) return null;
    return { ctx: this.ctx, out: this.sfx, now: this.ctx.currentTime };
  }

  private noiseSource(ctx: AudioContext): AudioBufferSourceNode {
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    return src;
  }

  private env(ctx: AudioContext, t: number, peak: number, attack: number, decay: number): GainNode {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  }

  // ---- Séance drone ------------------------------------------------------

  /** Low, slowly breathing drone under the whole séance. level 0 = off, 1 = Final Séance. */
  drone(level: number) {
    if (!this.ctx || !this.droneBus) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    if (level > 0 && this.droneNodes.length === 0) this.startDrone(ctx);
    this.droneLevel = level;
    const duck = this.speaking > 0 ? 0.45 : 1;
    this.droneBus.gain.setTargetAtTime(level * 0.14 * duck, t, level > 0 ? 1.2 : 0.8);
    if (this.droneFilter) this.droneFilter.frequency.setTargetAtTime(260 + level * 260, t, 1.5);
  }

  private startDrone(ctx: AudioContext) {
    const bus = this.droneBus!;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 300;
    filter.Q.value = 5;
    filter.connect(bus);
    this.droneFilter = filter;

    // A1, a detuned A1, and C2 (a minor third: ominous, not muddy).
    for (const [f, type, vol] of [
      [55, 'sawtooth', 0.5],
      [55.35, 'sawtooth', 0.5],
      [65.4, 'triangle', 0.35],
      [110.2, 'sine', 0.12],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = vol;
      o.connect(g).connect(filter);
      o.start();
      this.droneNodes.push(o);
    }
    // The filter breathes slowly.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const depth = ctx.createGain();
    depth.gain.value = 140;
    lfo.connect(depth).connect(filter.frequency);
    lfo.start();
    this.droneNodes.push(lfo);

    // Wind: band-passed noise that swells and fades.
    const wind = this.noiseSource(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 420;
    bp.Q.value = 0.8;
    const wg = ctx.createGain();
    wg.gain.value = 0.18;
    const wlfo = ctx.createOscillator();
    wlfo.frequency.value = 0.05;
    const wdepth = ctx.createGain();
    wdepth.gain.value = 0.14;
    wlfo.connect(wdepth).connect(wg.gain);
    const sweep = ctx.createGain();
    sweep.gain.value = 260;
    wlfo.connect(sweep).connect(bp.frequency);
    wind.connect(bp).connect(wg).connect(bus);
    wind.start();
    wlfo.start();
    this.droneNodes.push(wind, wlfo);
  }

  // ---- One-shots ---------------------------------------------------------

  /** One heartbeat (lub-dub). strength 0..1. */
  heartbeat(strength: number) {
    const r = this.ready();
    if (!r) return;
    const { ctx, out, now } = r;
    for (const [dt, k] of [
      [0, 1],
      [0.17, 0.65],
    ]) {
      const t = now + dt;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(75, t);
      o.frequency.exponentialRampToValueAtTime(38, t + 0.14);
      const g = this.env(ctx, t, 0.25 + 0.55 * strength * k, 0.008, 0.22);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.3);
    }
  }

  /** A floorboard creaks somewhere in the house. */
  creak() {
    const r = this.ready();
    if (!r) return;
    const { ctx, out, now } = r;
    const dur = rand(0.5, 1.1);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const base = rand(140, 220);
    o.frequency.setValueAtTime(base, now);
    o.frequency.linearRampToValueAtTime(base * rand(0.7, 1.4), now + dur);
    // Stick-slip friction: chop the tone into ragged grains.
    const chop = ctx.createOscillator();
    chop.type = 'square';
    chop.frequency.setValueAtTime(rand(18, 30), now);
    chop.frequency.linearRampToValueAtTime(rand(8, 40), now + dur);
    const chopGain = ctx.createGain();
    chopGain.gain.value = 0.5;
    const amp = ctx.createGain();
    amp.gain.value = 0.5;
    chop.connect(chopGain).connect(amp.gain);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = rand(700, 1300);
    bp.Q.value = 9;
    const g = this.env(ctx, now, 0.12, 0.08, dur);
    o.connect(amp).connect(bp).connect(g).connect(out);
    o.start(now);
    chop.start(now);
    o.stop(now + dur + 0.2);
    chop.stop(now + dur + 0.2);
  }

  /** A low bell: a new question appears. */
  toll() {
    const r = this.ready();
    if (!r) return;
    const { ctx, out, now } = r;
    for (const [ratio, vol, decay] of [
      [1, 0.22, 3.2],
      [2.0, 0.08, 2.2],
      [2.76, 0.07, 1.6],
      [5.4, 0.03, 0.9],
    ]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = 196 * ratio;
      const g = this.env(ctx, now, vol, 0.005, decay);
      o.connect(g).connect(out);
      o.start(now);
      o.stop(now + decay + 0.1);
    }
  }

  /** The last seconds of betting. */
  tick(high = false) {
    const r = this.ready();
    if (!r) return;
    const { ctx, out, now } = r;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = high ? 1400 : 900;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = o.frequency.value;
    bp.Q.value = 4;
    const g = this.env(ctx, now, 0.08, 0.002, 0.05);
    o.connect(bp).connect(g).connect(out);
    o.start(now);
    o.stop(now + 0.1);
  }

  /** The planchette locks in: boom plus a dissonant swell. */
  stinger(big = false) {
    const r = this.ready();
    if (!r) return;
    const { ctx, out, now } = r;
    const boom = ctx.createOscillator();
    boom.type = 'sine';
    boom.frequency.setValueAtTime(70, now);
    boom.frequency.exponentialRampToValueAtTime(28, now + 1.4);
    const bg = this.env(ctx, now, big ? 0.9 : 0.7, 0.01, big ? 2.2 : 1.5);
    boom.connect(bg).connect(out);
    boom.start(now);
    boom.stop(now + 2.5);

    const hit = this.noiseSource(ctx);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const hg = this.env(ctx, now, 0.35, 0.005, 0.4);
    hit.connect(lp).connect(hg).connect(out);
    hit.start(now);
    hit.stop(now + 0.5);

    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(300, now);
    filt.frequency.exponentialRampToValueAtTime(big ? 4200 : 2800, now + 0.25);
    filt.frequency.exponentialRampToValueAtTime(500, now + 2.5);
    const cg = this.env(ctx, now, big ? 0.16 : 0.12, 0.08, big ? 3.5 : 2.5);
    filt.connect(cg).connect(out);
    const notes = big ? [110, 220, 233.1, 311.1, 466.2, 659.3] : [220, 233.1, 311.1, 466.2];
    for (const f of notes) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = rand(-8, 8);
      o.connect(filt);
      o.start(now);
      o.stop(now + 4);
    }
  }

  /** Candy rains down on the winners. */
  coins(count: number) {
    const r = this.ready();
    if (!r) return;
    const { ctx, out, now } = r;
    const pitches = [1318.5, 1568, 1760, 2093, 2349.3, 2637];
    let t = now + 0.05;
    for (let i = 0; i < count; i++) {
      const f = pitches[Math.floor(Math.random() * pitches.length)];
      for (const [mult, vol] of [
        [1, 0.09],
        [2.7, 0.03],
      ]) {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = f * mult;
        const g = this.env(ctx, t, vol, 0.002, 0.28);
        o.connect(g).connect(out);
        o.start(t);
        o.stop(t + 0.35);
      }
      t += rand(0.035, 0.09);
    }
  }

  /** Nobody called it: a sad, sinking groan. */
  groan() {
    const r = this.ready();
    if (!r) return;
    const { ctx, out, now } = r;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(233, now);
    o.frequency.exponentialRampToValueAtTime(98, now + 1.4);
    const vib = ctx.createOscillator();
    vib.frequency.value = 5;
    const vd = ctx.createGain();
    vd.gain.value = 6;
    vib.connect(vd).connect(o.frequency);
    const g = this.env(ctx, now, 0.2, 0.05, 1.5);
    o.connect(g).connect(out);
    o.start(now);
    vib.start(now);
    o.stop(now + 1.7);
    vib.stop(now + 1.7);
  }

  /** Someone used a Relic. */
  shimmer() {
    const r = this.ready();
    if (!r) return;
    const { ctx, out, now } = r;
    [880, 1108.7, 1318.5, 1760].forEach((f, i) => {
      const t = now + i * 0.07;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = this.env(ctx, t, 0.07, 0.01, 1.2);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 1.3);
    });
  }

  /** A ghost whispers: a breathy whoosh. */
  whoosh() {
    const r = this.ready();
    if (!r) return;
    const { ctx, out, now } = r;
    const n = this.noiseSource(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 2;
    bp.frequency.setValueAtTime(300, now);
    bp.frequency.exponentialRampToValueAtTime(2400, now + 0.9);
    bp.frequency.exponentialRampToValueAtTime(600, now + 1.8);
    const g = this.env(ctx, now, 0.25, 0.6, 1.3);
    n.connect(bp).connect(g).connect(out);
    n.start(now);
    n.stop(now + 2);
  }

  /** Jump Scare: a shriek and a crash. Loud on purpose. */
  scream() {
    const r = this.ready();
    if (!r) return;
    const { ctx, out, now } = r;
    const crash = this.noiseSource(ctx);
    const cg = this.env(ctx, now, 0.7, 0.003, 0.6);
    crash.connect(cg).connect(out);
    crash.start(now);
    crash.stop(now + 0.7);
    for (const base of [700, 1050]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(base, now);
      o.frequency.exponentialRampToValueAtTime(base * 2.6, now + 0.25);
      o.frequency.exponentialRampToValueAtTime(base * 1.8, now + 0.9);
      const vib = ctx.createOscillator();
      vib.frequency.value = 11;
      const vd = ctx.createGain();
      vd.gain.value = base * 0.06;
      vib.connect(vd).connect(o.frequency);
      const g = this.env(ctx, now, 0.22, 0.02, 0.9);
      o.connect(g).connect(out);
      o.start(now);
      vib.start(now);
      o.stop(now + 1);
      vib.stop(now + 1);
    }
  }

  /** The board deals a curse: a deep gong. */
  gong() {
    const r = this.ready();
    if (!r) return;
    const { ctx, out, now } = r;
    for (const [f, vol, decay] of [
      [73.4, 0.35, 4],
      [146.8 * 1.01, 0.12, 3],
      [202.6, 0.1, 2.5],
      [311, 0.05, 1.8],
    ]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f * 1.02, now);
      o.frequency.exponentialRampToValueAtTime(f, now + 0.6);
      const g = this.env(ctx, now, vol, 0.01, decay);
      o.connect(g).connect(out);
      o.start(now);
      o.stop(now + decay + 0.1);
    }
  }

  /** The results: a slow organ chord. */
  organ() {
    const r = this.ready();
    if (!r) return;
    const { ctx, out, now } = r;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 1800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.12, now + 0.8);
    g.gain.setValueAtTime(0.12, now + 3);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 5.5);
    filt.connect(g).connect(out);
    // D minor, with a low D pedal.
    for (const f of [73.4, 146.8, 174.6, 220, 293.7, 349.2]) {
      for (const type of ['square', 'sine'] as const) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = f;
        o.detune.value = rand(-4, 4);
        const v = ctx.createGain();
        v.gain.value = type === 'square' ? 0.15 : 0.4;
        o.connect(v).connect(filt);
        o.start(now);
        o.stop(now + 5.6);
      }
    }
  }

  // ---- Narrator ------------------------------------------------------------

  private voice(): SpeechSynthesisVoice | null {
    const voices = window.speechSynthesis?.getVoices() ?? [];
    const en = voices.filter((v) => v.lang.toLowerCase().startsWith('en'));
    const pick = (re: RegExp) => en.find((v) => re.test(v.name));
    return pick(/UK English Male|Daniel|Arthur|Male/i) ?? pick(/UK|GB/i) ?? en[0] ?? null;
  }

  /** Reads text aloud on the TV. `whisper` is quieter and higher, for ghost messages. */
  say(text: string, opts: { whisper?: boolean; interrupt?: boolean } = {}) {
    const synth = window.speechSynthesis;
    if (!synth || !this.soundOn || !this.narrateOn || !this.awake || !text.trim()) return;
    if (opts.interrupt) synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = this.voice();
    if (v) u.voice = v;
    u.rate = opts.whisper ? 0.85 : 0.92;
    u.pitch = opts.whisper ? 1.5 : 0.6;
    u.volume = opts.whisper ? 0.75 : 1;
    const done = () => {
      this.speaking = Math.max(0, this.speaking - 1);
      this.drone(this.droneLevel);
    };
    u.onstart = () => {
      this.speaking++;
      this.drone(this.droneLevel);
    };
    u.onend = done;
    u.onerror = done;
    synth.speak(u);
  }

  hush() {
    window.speechSynthesis?.cancel();
    this.speaking = 0;
  }
}

export const sound = new SoundEngine();

/** Wakes audio on the first gesture anywhere on the page (browsers require one). */
export function installWakeOnGesture(): () => void {
  const wake = () => sound.wake();
  window.addEventListener('pointerdown', wake);
  window.addEventListener('keydown', wake);
  return () => {
    window.removeEventListener('pointerdown', wake);
    window.removeEventListener('keydown', wake);
  };
}
