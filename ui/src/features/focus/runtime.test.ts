import { beforeEach, describe, expect, it, vi } from 'vitest';
import { focusStore } from './stores/focus';
import * as focus from './stores/focus';
import { advanceExpiredFocus, executeFocusDirective, initFocusRuntime, resetFocusRuntimeForTests } from './runtime';
import type { FocusSession } from './types';
import * as commands from '@services/commands';
import * as player from '@features/player/stores/player';
import { currentTrack, isPlaying, progress } from '@features/player/stores/player';

function session(overrides: Partial<FocusSession> = {}): FocusSession {
  return {
    id: 'focus-1', intention: '', goal: '', firstAction: '', workflow: 'pomodoro',
    cadence: { workDurationMs: 100, breakDurationMs: 50, rounds: 4 }, round: 1,
    phase: 'work', state: 'runningWork', phaseStartedAt: 0, phaseDeadlineAt: 100,
    pausedRemainingMs: null, revision: 0, musicStrategy: { kind: 'none' },
    degradation: null, outcome: null, ...overrides,
  };
}

describe('Focus runtime deadline owner', () => {
  beforeEach(() => {
    resetFocusRuntimeForTests();
    currentTrack.set(null);
    isPlaying.set(false);
    progress.set({ position: 0, duration: 0 });
    vi.restoreAllMocks();
  });

  it('dispatches once per session revision and deadline', () => {
    const skip = vi.spyOn(focusStore, 'skip').mockResolvedValue(true);
    expect(advanceExpiredFocus(session(), 100)).toBe(true);
    expect(advanceExpiredFocus(session(), 101)).toBe(false);
    expect(advanceExpiredFocus(session({ revision: 1, phase: 'break', state: 'runningBreak', phaseDeadlineAt: 150 }), 150)).toBe(true);
    expect(skip).toHaveBeenCalledTimes(2);
    skip.mockRestore();
  });

  it('advances final work so the backend can complete it', () => {
    const skip = vi.spyOn(focusStore, 'skip').mockResolvedValue(true);
    expect(advanceExpiredFocus(session({ round: 4 }), 100)).toBe(true);
    expect(skip).toHaveBeenCalledTimes(1);
    skip.mockRestore();
  });

  it('retries an expired deadline after its skip fails', async () => {
    const skip = vi.spyOn(focusStore, 'skip')
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    expect(advanceExpiredFocus(session(), 100)).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(advanceExpiredFocus(session(), 101)).toBe(true);
    expect(skip).toHaveBeenCalledTimes(2);
  });

  it('continues Focus startup when event listener registration fails', async () => {
    vi.spyOn(focus, 'startFocusListener').mockRejectedValueOnce(new Error('listener unavailable'));
    const load = vi.spyOn(focusStore, 'load').mockResolvedValue(undefined);
    vi.spyOn(globalThis, 'setInterval').mockReturnValue(0 as never);

    await expect(initFocusRuntime()).resolves.toBeUndefined();
    expect(load).toHaveBeenCalledOnce();
  });

  it('treats an empty query selection as playback failure', async () => {
    vi.spyOn(commands, 'searchGrouped').mockResolvedValue({ songs: [] } as never);

    await expect(executeFocusDirective({
      operationId: 'query-empty', action: 'play', intent: { kind: 'query', value: 'missing' },
    })).rejects.toThrow('returned no tracks');
  });

  it('replays a stopped current track and restores its position', async () => {
    const track = { id: 'local-1', title: 'Track', artist: 'Artist', localPath: '/music/track.flac' } as never;
    currentTrack.set(track);
    progress.set({ position: 37, duration: 120 });
    vi.spyOn(player, 'resumeTrackForFocus').mockRejectedValue(new Error('pipeline stopped'));
    const replay = vi.spyOn(player, 'replayTrackForFocus').mockResolvedValue(undefined);

    await executeFocusDirective({
      operationId: 'continue', action: 'play', intent: { kind: 'continueCurrent' },
    });

    expect(replay).toHaveBeenCalledWith(track, 37);
  });
});
