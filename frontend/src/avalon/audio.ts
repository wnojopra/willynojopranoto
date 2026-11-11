/**
 * Avalon TV sound & Night Phase narrator: synthesized with Web Audio + browser SpeechSynthesis.
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import type { NightStep } from './protocol';

type Listener = () => void;

const PREF_SOUND = 'ava-sound';
const PREF_NARRATE = 'ava-narrate';

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
    // ignore storage errors
  }
}

class AvalonSoundEngine {
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private listeners = new Set<Listener>();

  soundOn = pref(PREF_SOUND);
  narrateOn = pref(PREF_NARRATE);

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

  wake() {
    if (!this.ctx) {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.soundOn ? 0.75 : 0;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -12;
      comp.ratio.value = 5;
      this.master.connect(comp).connect(ctx.destination);
      ctx.onstatechange = () => this.emit();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().then(() => this.emit());
    }
    this.emit();
  }

  setSound(on: boolean) {
    this.soundOn = on;
    savePref(PREF_SOUND, on);
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(on ? 0.75 : 0, this.ctx.currentTime, 0.05);
    }
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
    if (!this.ctx || !this.master || this.ctx.state !== 'running' || !this.soundOn) return null;
    return { ctx: this.ctx, out: this.master, now: this.ctx.currentTime };
  }

  /** Deep ceremonial chime for Night Phase transitions. */
  chime(freq = 293.66) {
    const r = this.ready();
    if (!r) return;
    const { ctx, out, now } = r;
    for (const mult of [1, 1.5, 2]) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = mult === 1 ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(freq * mult, now);
      const peak = mult === 1 ? 0.22 : 0.08;
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(peak, now + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 2.2);
      osc.connect(g).connect(out);
      osc.start(now);
      osc.stop(now + 2.3);
    }
  }

  /** Crisp token flip for Vote Reveal. */
  voteReveal(approved: boolean) {
    const r = this.ready();
    if (!r) return;
    const { ctx, out, now } = r;
    const chord = approved ? [261.63, 329.63, 392.0, 523.25] : [220.0, 261.63, 311.13];
    chord.forEach((f, idx) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = approved ? 'triangle' : 'sawtooth';
      osc.frequency.setValueAtTime(f, now + idx * 0.06);
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = approved ? 1800 : 900;
      g.gain.setValueAtTime(0.0001, now + idx * 0.06);
      g.gain.exponentialRampToValueAtTime(0.14, now + idx * 0.06 + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.06 + 1.1);
      osc.connect(filt).connect(g).connect(out);
      osc.start(now + idx * 0.06);
      osc.stop(now + idx * 0.06 + 1.15);
    });
  }

  /** Triumphant Arthurian fanfare on Quest Success, or Mordred's ominous brass on Quest Fail. */
  questOutcome(succeeded: boolean) {
    const r = this.ready();
    if (!r) return;
    const { ctx, out, now } = r;
    const notes = succeeded
      ? [293.66, 369.99, 440.0, 587.33] // D major
      : [146.83, 174.61, 207.65, 293.66]; // D diminished / dark minor
    notes.forEach((f, idx) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = succeeded ? 'triangle' : 'sawtooth';
      osc.frequency.setValueAtTime(f, now);
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = succeeded ? 2200 : 750;
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(idx === 0 ? 0.2 : 0.12, now + 0.08);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 2.6);
      osc.connect(filt).connect(g).connect(out);
      osc.start(now);
      osc.stop(now + 2.7);
    });
  }

  private voice(): SpeechSynthesisVoice | null {
    const voices = window.speechSynthesis?.getVoices() ?? [];
    const en = voices.filter((v) => v.lang.toLowerCase().startsWith('en'));
    const pick = (re: RegExp) => en.find((v) => re.test(v.name));
    return pick(/UK English Male|Daniel|Arthur|George|Male/i) ?? pick(/UK|GB/i) ?? en[0] ?? null;
  }

  /** Speaks one line and resolves when finished (or after a fallback timer if speechSynthesis is unavailable). */
  speakLine(text: string): Promise<void> {
    return new Promise((resolve) => {
      const synth = window.speechSynthesis;
      const fallbackMs = Math.max(2400, text.length * 62);
      if (!synth || !this.soundOn || !this.narrateOn || !this.awake || !text.trim()) {
        const id = window.setTimeout(resolve, fallbackMs);
        return () => clearTimeout(id);
      }
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const v = this.voice();
      if (v) u.voice = v;
      u.rate = 0.92;
      u.pitch = 0.85;
      u.volume = 1;
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(guard);
        resolve();
      };
      const guard = window.setTimeout(done, fallbackMs + 4000);
      u.onend = done;
      u.onerror = done;
      synth.speak(u);
    });
  }

  hush() {
    window.speechSynthesis?.cancel();
  }
}

export const avalonSound = new AvalonSoundEngine();

export function installAvalonWakeOnGesture(): () => void {
  const wake = () => avalonSound.wake();
  window.addEventListener('pointerdown', wake);
  window.addEventListener('keydown', wake);
  return () => {
    window.removeEventListener('pointerdown', wake);
    window.removeEventListener('keydown', wake);
  };
}

export function useAvalonAudioSettings() {
  return useSyncExternalStore(
    (fn) => avalonSound.subscribe(fn),
    () => `${avalonSound.soundOn}|${avalonSound.narrateOn}|${avalonSound.awake}`,
  );
}

/**
 * Runs the step-by-step Night Phase audio ceremony on the TV and returns the
 * current step index and whether the sequence has completed.
 */
export function useNightNarrator(active: boolean, script: NightStep[], runKey: number) {
  const [stepIndex, setStepIndex] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!active || script.length === 0) {
      avalonSound.hush();
      setStepIndex(0);
      setDone(false);
      return;
    }

    let cancelled = false;
    let timerId = 0;
    setStepIndex(0);
    setDone(false);

    const runStep = async (idx: number) => {
      if (cancelled) return;
      if (idx >= script.length) {
        avalonSound.chime(440);
        setDone(true);
        return;
      }
      setStepIndex(idx);
      const step = script[idx];
      avalonSound.chime(idx === script.length - 1 ? 392 : 293.66);
      await avalonSound.speakLine(step.text);
      if (cancelled) return;
      timerId = window.setTimeout(() => {
        void runStep(idx + 1);
      }, step.pauseAfterMs);
    };

    void runStep(0);

    return () => {
      cancelled = true;
      clearTimeout(timerId);
      avalonSound.hush();
    };
  }, [active, script, runKey]);

  return { stepIndex, done };
}
