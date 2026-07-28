/**
 * Artist detail store tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import {
  artistDetail,
  loadArtistDetail,
  clearArtistDetail,
  isLoadingArtistDetail,
  artistDetailError,
} from '@features/library/stores/artistDetail';
import type { ArtistDetail } from '@shared/types/models';

const mocks = vi.hoisted(() => ({
  getCachedArtistDetailCmd: vi.fn(),
  refreshArtistDetailCmd: vi.fn(),
}));

vi.mock('@services/commands', () => ({
  getCachedArtistDetail: mocks.getCachedArtistDetailCmd,
  refreshArtistDetail: mocks.refreshArtistDetailCmd,
}));

vi.mock('@shared/stores/notifications', () => ({
  notifications: {
    push: vi.fn(),
  },
}));

describe('artistDetail store', () => {
  beforeEach(() => {
    mocks.getCachedArtistDetailCmd.mockReset();
    mocks.refreshArtistDetailCmd.mockReset();
    clearArtistDetail();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearArtistDetail();
  });

  it('loads artist detail from fresh fetch when uncached', async () => {
    const detail = {
      id: 'artist:queen-swr',
      name: 'Queen',
      thumbnail: 'https://img.test/queen.jpg',
      topTracks: [],
      albums: [],
    };
    // No cache → triggers fresh fetch
    mocks.getCachedArtistDetailCmd.mockResolvedValue(null);
    mocks.refreshArtistDetailCmd.mockResolvedValue(detail);

    await loadArtistDetail('artist:queen-swr');

    expect(get(artistDetail)).toEqual(detail);
    expect(get(isLoadingArtistDetail)).toBe(false);
    expect(get(artistDetailError)).toBeNull();
  });

  it('shows cached immediately then refreshes in background', async () => {
    const cached = {
      id: 'artist:queen-bg',
      name: 'Queen',
      thumbnail: 'https://img.test/queen.jpg',
      topTracks: [],
      albums: [],
    };
    const fresh = {
      ...cached,
      topTracks: [{ id: 'track:1', title: 'Bohemian Rhapsody', duration: 354 }],
      albums: [{ id: 'album:1', title: 'A Night at the Opera', year: 1975, artist: 'Queen', trackCount: 12, cover: null }],
    };
    mocks.getCachedArtistDetailCmd.mockResolvedValue(cached);
    mocks.refreshArtistDetailCmd.mockResolvedValue(fresh);

    await loadArtistDetail('artist:queen-bg');

    // Cached data shown immediately
    expect(get(artistDetail)).toEqual(cached);
    expect(get(isLoadingArtistDetail)).toBe(false);

    // Wait for background refresh to settle (scheduler + microtask queue)
    await vi.waitFor(() => {
      expect(get(artistDetail)).toEqual(fresh);
      expect(mocks.refreshArtistDetailCmd).toHaveBeenCalledWith('artist:queen-bg');
    });
  });

  it('sets error on failure', async () => {
    mocks.getCachedArtistDetailCmd.mockResolvedValue(null);
    mocks.refreshArtistDetailCmd.mockRejectedValue(new Error('not found'));

    // Store does NOT reject on error — it sets error state internally
    await loadArtistDetail('artist:ghost-swr');

    expect(get(artistDetail)).toBeNull();
    expect(get(isLoadingArtistDetail)).toBe(false);
    expect(get(artistDetailError)).toBe('not found');
  });

  it('clears state', () => {
    clearArtistDetail();

    expect(get(artistDetail)).toBeNull();
    expect(get(artistDetailError)).toBeNull();
  });
});
