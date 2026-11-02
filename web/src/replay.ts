import { useEffect, useRef, useState } from 'react';
import type { Match, MatchEvent } from './api';

/** What each team held at one moment of a round, rebuilt from its timeline. */
export interface ReplayFrame {
  done: Map<string, Set<string>>;   // team → objective ids held
  seen: Map<string, Set<string>>;   // team → objective ids revealed so far (Hidden Items)
  lines: Map<string, number>;
  cards: Map<string, number>;
}

/** Applies every event up to and including `t` (events are in time order). */
export function frameAt(events: MatchEvent[], t: number): ReplayFrame {
  const f: ReplayFrame = { done: new Map(), seen: new Map(), lines: new Map(), cards: new Map() };
  for (const e of events) {
    if (e.t > t) break;
    const held = f.done.get(e.team) ?? new Set<string>();
    if (e.type === 'goal' && e.objectiveId) held.add(e.objectiveId);
    if (e.type === 'lost' && e.objectiveId) held.delete(e.objectiveId);
    if (e.type === 'line') f.lines.set(e.team, e.value ?? 1);
    if (e.type === 'card') f.cards.set(e.team, e.value ?? 1);
    if (e.type === 'seen' && e.objectiveId) {
      const seen = f.seen.get(e.team) ?? new Set<string>();
      f.seen.set(e.team, seen.add(e.objectiveId));
    }
    f.done.set(e.team, held);
  }
  return f;
}

/** The round's length on the in-game clock (events can land just after the reported duration). */
export const replayEnd = (m: Match) => Math.max(m.durationMs, m.events.at(-1)?.t ?? 0);

export const SPEEDS = [10, 30, 60] as const;

/**
 * Replay clock: `t` is null when not replaying (show the final result), otherwise in-game ms.
 * Playing advances it by real time × speed and stops at the end.
 */
export function useReplay(end: number) {
  const [t, setTState] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(30);
  const last = useRef<number | null>(null);
  // the animation loop reads the current time from here; state updaters run too late to decide when to stop
  const current = useRef<number | null>(null);
  const setT = (v: number | null) => { current.current = v; setTState(v); };

  useEffect(() => {
    if (!playing) { last.current = null; return; }
    let raf = 0;
    const tick = (now: number) => {
      const dt = last.current === null ? 0 : now - last.current;
      last.current = now;
      const next = Math.min(end, (current.current ?? 0) + dt * speed);
      setT(next);
      if (next >= end) setPlaying(false);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, end]);

  return {
    t, playing, speed, setSpeed,
    seek: (v: number) => setT(Math.max(0, Math.min(end, v))),
    toggle: () => {
      // play from the start, or from the beginning again once it has finished
      if (!playing && (t === null || t >= end)) setT(0);
      setPlaying(p => !p);
    },
    stop: () => { setPlaying(false); setT(null); },
  };
}
