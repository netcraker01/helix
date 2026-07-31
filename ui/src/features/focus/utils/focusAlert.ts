/**
 * Focus alert tones — pleasant synthesized chimes using the Web Audio API.
 *
 * No audio files needed. Two distinct tones signal phase transitions:
 * - `work`  : a warm two-note rising chime (work phase ended → time to rest)
 * - `break` : a soft two-note falling chime (break ended → time to focus)
 *
 * A silent mode flag (persisted in localStorage) mutes all tones.
 */

const SILENT_KEY = 'jellyx-focus-silent';

let silent = readSilent();

function readSilent(): boolean {
  try {
    return localStorage.getItem(SILENT_KEY) === '1';
  } catch {
    return false;
  }
}

export function isSilent(): boolean {
  return silent;
}

export function setSilent(value: boolean): void {
  silent = value;
  try {
    localStorage.setItem(SILENT_KEY, value ? '1' : '0');
  } catch {
    /* localStorage unavailable — keep in-memory only */
  }
}

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  // Autoplay policy may leave the context suspended — resume on demand.
  if (ctx.state === 'suspended') {
    void ctx.resume();
  }
  return ctx;
}

/**
 * Play a single soft tone with a gentle attack/decay envelope.
 * Uses a sine wave through a gain node for a warm, non-harsh sound.
 */
function playTone(frequency: number, startAt: number, duration: number, peakGain: number): void {
  const audioCtx = getCtx();
  if (!audioCtx) return;

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(frequency, startAt);

  // Attack: fade in over 40ms to avoid a click.
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(peakGain, startAt + 0.04);
  // Decay: fade out over the remaining duration.
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.05);
}

/**
 * Signal that a work phase has ended.
 * A rising C5 → E5 two-note chime — warm and uplifting, invites rest.
 */
export function playWorkEndAlert(): void {
  if (silent) return;
  const audioCtx = getCtx();
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  // C5 (523.25 Hz) then E5 (659.25 Hz) — a gentle major third.
  playTone(523.25, t, 0.45, 0.18);
  playTone(659.25, t + 0.18, 0.6, 0.16);
}

/**
 * Signal that a break phase has ended.
 * A falling E5 → C5 two-note chime — soft and grounding, invites focus.
 */
export function playBreakEndAlert(): void {
  if (silent) return;
  const audioCtx = getCtx();
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  // E5 (659.25 Hz) then C5 (523.25 Hz) — a gentle resolve down.
  playTone(659.25, t, 0.45, 0.18);
  playTone(523.25, t + 0.18, 0.6, 0.16);
}