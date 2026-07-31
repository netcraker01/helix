import { get } from 'svelte/store';
import { searchGrouped } from '@services/commands';
import {
  currentTrack,
  isPlaying,
  progress,
  pauseTrackForFocus,
  playTrackForFocus,
  resumeTrackForFocus,
  replayTrackForFocus,
  stopTrackForFocus,
} from '@features/player/stores/player';
import { focusStore, startFocusListener } from './stores/focus';
import type { FocusPlaybackDirective, FocusSession } from './types';

const handledDirectives = new Set<string>();
const advancingDeadlines = new Set<string>();
let initialized = false;

function deadlineKey(session: FocusSession): string | null {
  if (!['runningWork', 'runningBreak'].includes(session.state) || session.phaseDeadlineAt == null) return null;
  return `${session.id}:${session.revision}:${session.phaseDeadlineAt}`;
}

export function advanceExpiredFocus(session: FocusSession | null, now = Date.now()): boolean {
  if (!session || session.phaseDeadlineAt == null || now < session.phaseDeadlineAt) return false;
  const key = deadlineKey(session);
  if (!key || advancingDeadlines.has(key)) return false;
  advancingDeadlines.add(key);
  void focusStore.skip().then((skipped) => {
    if (!skipped) advancingDeadlines.delete(key);
  }).catch(() => advancingDeadlines.delete(key));
  return true;
}

async function continueCurrent(): Promise<void> {
  const track = get(currentTrack);
  if (!track) throw new Error('No current track to continue');
  if (get(isPlaying)) return;

  const position = get(progress).position;
  try {
    await resumeTrackForFocus();
  } catch {
    await replayTrackForFocus(track, position);
  }
}

export async function executeFocusDirective(directive: FocusPlaybackDirective): Promise<void> {
  switch (directive.action) {
    case 'play': {
      const intent = directive.intent;
      if (!intent || intent.kind === 'continueCurrent') {
        await continueCurrent();
        return;
      }
      const results = await searchGrouped(intent.value, 'songs', 0, 1);
      const track = results.songs[0];
      if (!track) throw new Error('Focus music selection returned no tracks');
      await playTrackForFocus(track);
      return;
    }
    case 'pause':
      await pauseTrackForFocus();
      return;
    case 'resume':
      await resumeTrackForFocus();
      return;
    case 'stop':
      await stopTrackForFocus();
  }
}

async function handleDirective(directive: FocusPlaybackDirective | null | undefined): Promise<void> {
  if (!directive || handledDirectives.has(directive.operationId)) return;
  handledDirectives.add(directive.operationId);
  try {
    await executeFocusDirective(directive);
    await focusStore.acknowledgePlayback(directive.operationId);
  } catch {
    await focusStore.acknowledgePlayback(directive.operationId, 'failed');
  }
}

/** Own Focus events, playback directives, and timer expiry for the app lifetime. */
export async function initFocusRuntime(): Promise<void> {
  if (initialized) return;
  initialized = true;
  try {
    await startFocusListener();
  } catch {
    // Focus events are optional at startup; loading still provides a usable snapshot.
  }
  await focusStore.load();
  focusStore.subscribe((state) => {
    advanceExpiredFocus(state.session);
    void handleDirective(state.pendingDirective);
  });
  setInterval(() => advanceExpiredFocus(get(focusStore).session), 500);
}

export function resetFocusRuntimeForTests(): void {
  handledDirectives.clear();
  advancingDeadlines.clear();
  initialized = false;
}
