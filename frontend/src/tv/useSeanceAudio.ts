import { useEffect, useRef, useSyncExternalStore, type RefObject } from 'react';
import type { PlanchetteState, StateMsg } from '../protocol';
import { installWakeOnGesture, sound } from './audio';
import { PRACTICE_STEPS } from './tutorial';

const PULL_SECONDS = 20;

function names(list: string[]): string {
  if (list.length <= 1) return list.join('');
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

/** Re-renders when sound settings or the audio context's state change. */
export function useSoundSettings() {
  return useSyncExternalStore(
    (fn) => sound.subscribe(fn),
    () => `${sound.soundOn}|${sound.narrateOn}|${sound.awake}`,
  );
}

/**
 * Drives the TV's sound from game state: the drone, heartbeat, stingers,
 * payout sounds, and the narrator reading questions and cards.
 */
export function useSeanceAudio(state: StateMsg | null, planchetteRef: RefObject<PlanchetteState | null>) {
  const prev = useRef<StateMsg | null>(null);
  const seenRelics = useRef(new Set<number>());
  useSoundSettings();

  useEffect(() => installWakeOnGesture(), []);

  // Event sounds: compare with the last state we saw.
  useEffect(() => {
    if (!state) return;
    const before = prev.current;
    prev.current = state;
    const fresh = state.relicEvents.filter((e) => !seenRelics.current.has(e.seq));
    for (const e of state.relicEvents) seenRelics.current.add(e.seq);
    // First state after loading the page: catch up silently.
    if (!before) return;

    const name = (id: string | null | undefined) => state.players.find((p) => p.id === id)?.name ?? 'Someone';
    const kind = state.game.roundKind;
    const newRound = state.roundNo !== before.roundNo;
    const entered = (phase: StateMsg['phase']) => state.phase === phase && (before.phase !== phase || newRound);

    // A new question: toll and read it out (Medium rounds start in the "medium" phase).
    if ((entered('medium') || (entered('question') && before.phase !== 'medium')) && state.question) {
      sound.toll();
      const intro =
        kind === 'final'
          ? 'The Final Séance. '
          : kind === 'practice'
            ? 'A practice round. Nothing counts. '
            : state.phase === 'medium'
              ? `${name(state.medium?.playerId)} is the Medium. `
              : '';
      sound.say(intro + state.question.text, { interrupt: true });
      if (kind === 'practice') sound.say(PRACTICE_STEPS.question.body);
    }
    if (kind === 'practice' && entered('pull')) sound.say(PRACTICE_STEPS.pull.body, { interrupt: true });

    if (entered('reveal')) {
      sound.stinger(kind === 'final');
      const result = state.spots.find((s) => s.id === state.resultSpotId);
      const reveal = state.reveal;
      const winners = reveal ? Object.values(reveal.payout).filter((v) => v > 0).length : 0;
      setTimeout(() => {
        if (reveal?.rolledOver) sound.groan();
        else if (winners > 0) sound.coins(Math.min(28, 8 + winners * 3));
      }, 1300);
      const lines: string[] = [];
      if (result) lines.push(`The spirits have spoken. ${result.label}.`);
      const curse = state.curse && state.curse.roundNo === state.roundNo ? state.curse : null;
      if (curse) {
        setTimeout(() => sound.gong(), 2200);
        lines.push(`The board has cursed ${name(curse.playerId)}. ${curse.text}${curse.drink && curse.alt ? ` Or: ${curse.alt}` : ''}`);
      }
      if (kind === 'practice') lines.push(PRACTICE_STEPS.reveal.body);
      const pitied = state.players.filter((p) => reveal?.catchUp?.includes(p.id)).map((p) => p.name);
      if (pitied.length) lines.push(`The spirits take pity on ${names(pitied)}.`);
      lines.forEach((l, i) => sound.say(l, { interrupt: i === 0 }));
    }

    if (entered('results')) {
      sound.organ();
      const fc = state.finalCurse;
      sound.say(
        `The spirits have judged you.${fc ? ` ${names(fc.playerIds.map(name))}, the Final Curse is yours. ${fc.text}` : ''}`,
        { interrupt: true },
      );
    }
    if (entered('lobby')) sound.hush();

    for (const e of fresh) {
      if (e.key === 'jumpscare') sound.scream();
      else if (e.key === 'whisper') {
        sound.whoosh();
        if (e.text) sound.say(e.text, { whisper: true });
      } else sound.shimmer();
    }
  }, [state]);

  // The drone follows the phase; louder for the Final Séance.
  const phase = state?.phase;
  const kind = state?.game.roundKind;
  const awake = sound.awake;
  useEffect(() => {
    if (!awake) return;
    const inSeance = phase && phase !== 'lobby' && phase !== 'results';
    sound.drone(!inSeance ? (phase === 'lobby' ? 0.35 : 0) : kind === 'final' ? 1 : phase === 'pull' ? 0.8 : 0.6);
  }, [phase, kind, awake]);

  // Floorboards creak now and then during the séance.
  useEffect(() => {
    if (!awake || !phase || phase === 'lobby' || phase === 'results') return;
    let id = 0;
    const next = () => {
      id = window.setTimeout(() => {
        sound.creak();
        next();
      }, 9000 + Math.random() * 18000);
    };
    next();
    return () => clearTimeout(id);
  }, [phase, awake]);

  // Heartbeat during the pull, speeding up as time runs out.
  const roundNo = state?.roundNo;
  useEffect(() => {
    if (!awake || phase !== 'pull') return;
    let id = 0;
    const beat = () => {
      const left = planchetteRef.current?.timeLeft ?? PULL_SECONDS;
      const urgency = Math.min(1, Math.max(0, 1 - left / PULL_SECONDS)) ** 2;
      sound.heartbeat(0.3 + 0.7 * urgency);
      const bpm = 62 + 108 * urgency;
      id = window.setTimeout(beat, 60000 / bpm);
    };
    id = window.setTimeout(beat, 400);
    return () => clearTimeout(id);
  }, [phase, roundNo, awake, planchetteRef]);

  // Clock ticks in the last 5 seconds of betting.
  const endsIn = state?.phaseEndsIn ?? null;
  useEffect(() => {
    if (!awake || (phase !== 'question' && phase !== 'medium') || endsIn === null) return;
    const ids: number[] = [];
    for (let s = 5; s >= 1; s--) {
      const at = (endsIn - s) * 1000;
      if (at > 0) ids.push(window.setTimeout(() => sound.tick(s === 1), at));
    }
    return () => ids.forEach(clearTimeout);
  }, [phase, roundNo, endsIn, awake]);
}
