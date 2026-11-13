/**
 * Procedural Web Audio sound engine for Wavelength.
 * Synthesizes dial ticks, shutter clacks, reveal drumrolls, and bullseye fanfares.
 */

import { useSyncExternalStore } from 'react';

type Listener = () => void;

const PREF_SOUND = 'wl-sound';

function loadPref(key: string): boolean {
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

class WavelengthSoundEngine {
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private listeners = new Set<Listener>();
  private lastTickStep: number | null = null;

  soundOn = loadPref(PREF_SOUND);

  get awake(): boolean {
    return this.ctx?.state === 'running';
  }

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

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
      this.master.gain.value = this.soundOn ? 0.7 : 0;
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
      this.master.gain.setTargetAtTime(on ? 0.7 : 0, this.ctx.currentTime, 0.04);
    }
    this.emit();
  }

  private ready(): { ctx: AudioContext; out: GainNode; now: number } | null {
    if (!this.ctx || !this.master || this.ctx.state !== 'running' || !this.soundOn) return null;
    return { ctx: this.ctx, out: this.master, now: this.ctx.currentTime };
  }

  /** Soft mechanical detent click every ~4 degrees while rotating the needle. */
  tickForAngle(angle: number) {
    const step = Math.round(angle / 4);
    if (this.lastTickStep === step) return;
    this.lastTickStep = step;
    const r = this.ready();
    if (!r) return;
    const { ctx, out, now } = r;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(520 + (step + 23) * 8, now);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.028);
    osc.connect(gain).connect(out);
    osc.start(now);
    osc.stop(now + 0.032);
  }

  /** Mechanical shutter whoosh + clack when opening or closing the screen. */
  shutter(opening: boolean) {
    const r = this.ready();
    if (!r) return;
    const { ctx, out, now } = r;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    const startFreq = opening ? 190 : 380;
    const endFreq = opening ? 420 : 160;
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(endFreq, now + 0.35);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
    osc.connect(gain).connect(out);
    osc.start(now);
    osc.stop(now + 0.4);
  }

  /** Rising suspense pulse while the shutter opens on reveal. */
  drumroll() {
    const r = this.ready();
    if (!r) return;
    const { ctx, out, now } = r;
    const notes = [220, 246.94, 277.18, 311.13, 349.23, 392.0];
    notes.forEach((freq, i) => {
      const t = now + i * 0.11;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.09 + i * 0.015, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
      osc.connect(gain).connect(out);
      osc.start(t);
      osc.stop(t + 0.11);
    });
  }

  /** Celebratory chord fanfare for scoring points, or gentle descending tone on a miss. */
  revealScore(pts: number, bullseye: boolean) {
    const r = this.ready();
    if (!r) return;
    const { ctx, out, now } = r;
    if (bullseye) {
      const chord = [523.25, 659.25, 783.99, 1046.5];
      chord.forEach((freq, i) => {
        const t = now + i * 0.07;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.22, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.65);
        osc.connect(gain).connect(out);
        osc.start(t);
        osc.stop(t + 0.68);
      });
    } else if (pts > 0) {
      const notes = pts >= 3 ? [440, 554.37, 659.25] : [392, 493.88];
      notes.forEach((freq, i) => {
        const t = now + i * 0.08;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.18, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
        osc.connect(gain).connect(out);
        osc.start(t);
        osc.stop(t + 0.42);
      });
    } else {
      // Soft descending "womp"
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(240, now);
      osc.frequency.exponentialRampToValueAtTime(135, now + 0.45);
      gain.gain.setValueAtTime(0.11, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.48);
      osc.connect(gain).connect(out);
      osc.start(now);
      osc.stop(now + 0.5);
    }
  }
}

export const wlSound = new WavelengthSoundEngine();

let gestureInstalled = false;
export function installWlWakeOnGesture() {
  if (gestureInstalled || typeof window === 'undefined') return;
  gestureInstalled = true;
  const handler = () => {
    wlSound.wake();
  };
  window.addEventListener('pointerdown', handler, { passive: true });
  window.addEventListener('keydown', handler, { passive: true });
}

export function useWlAudioState() {
  return useSyncExternalStore(
    wlSound.subscribe,
    () => `${wlSound.awake}:${wlSound.soundOn}`,
    () => 'false:true',
  );
}
