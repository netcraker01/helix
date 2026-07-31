/**
 * Format a millisecond duration as mm:ss.
 * Negative values are clamped to 00:00.
 */
export function formatMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** Format a millisecond duration as a human-readable phrase, e.g. "25 min". */
export function formatMsPhrase(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60000));
  return `${minutes} min`;
}
