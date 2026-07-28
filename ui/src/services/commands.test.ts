/**
 * Command wrapper tests for grouped search and detail views.
 *
 * Verifies typed wrappers invoke the matching Rust command names.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  searchGrouped,
  getArtistDetail,
  getAlbumDetail,
  playAlbum,
  playStream,
  isLatestStreamRequest,
  getCachedArtistDetail,
  refreshArtistDetail,
  getStaleFavoriteArtistIds,
} from '@services/commands';

const mocks = vi.hoisted(() => ({
  invokeCommand: vi.fn(),
}));

vi.mock('@services/tauri', () => ({
  invokeCommand: mocks.invokeCommand,
}));

describe('Grouped search commands', () => {
  beforeEach(() => {
    mocks.invokeCommand.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('searchGrouped invokes search_grouped with query only', async () => {
    const expected = {
      songs: [],
      artists: [{ id: 'artist:queen', name: 'Queen', trackCount: 10 }],
      albums: [],
      hasMoreSongs: false,
    };
    mocks.invokeCommand.mockResolvedValueOnce(expected);

    const result = await searchGrouped('queen');

    expect(mocks.invokeCommand).toHaveBeenCalledWith('search_grouped', { query: 'queen', filter: null, offset: null, limit: null });
    expect(result).toEqual(expected);
  });

  it('searchGrouped passes filter when provided', async () => {
    mocks.invokeCommand.mockResolvedValueOnce({ songs: [], artists: [], albums: [], hasMoreSongs: false });

    await searchGrouped('daft', 'artists');

    expect(mocks.invokeCommand).toHaveBeenCalledWith('search_grouped', {
      query: 'daft',
      filter: 'artists',
      offset: null,
      limit: null,
    });
  });

  it('searchGrouped passes offset and limit for pagination', async () => {
    mocks.invokeCommand.mockResolvedValueOnce({ songs: [], artists: [], albums: [], hasMoreSongs: false });

    await searchGrouped('daft', undefined, 50, 50);

    expect(mocks.invokeCommand).toHaveBeenCalledWith('search_grouped', {
      query: 'daft',
      filter: null,
      offset: 50,
      limit: 50,
    });
  });

  it('getArtistDetail invokes get_artist_detail with id', async () => {
    const expected = {
      id: 'artist:queen',
      name: 'Queen',
      thumbnail: 'https://img.test/queen.jpg',
      topTracks: [],
      albums: [],
    };
    mocks.invokeCommand.mockResolvedValueOnce(expected);

    const result = await getArtistDetail('artist:queen');

    expect(mocks.invokeCommand).toHaveBeenCalledWith('get_artist_detail', { id: 'artist:queen' });
    expect(result).toEqual(expected);
  });

  it('getCachedArtistDetail invokes get_cached_artist_detail with id', async () => {
    const expected = {
      id: 'artist:queen',
      name: 'Queen',
      thumbnail: null,
      topTracks: [],
      albums: [],
    };
    mocks.invokeCommand.mockResolvedValueOnce(expected);

    const result = await getCachedArtistDetail('artist:queen');

    expect(mocks.invokeCommand).toHaveBeenCalledWith('get_cached_artist_detail', { id: 'artist:queen' });
    expect(result).toEqual(expected);
  });

  it('getCachedArtistDetail resolves null when uncached', async () => {
    mocks.invokeCommand.mockResolvedValueOnce(null);
    const result = await getCachedArtistDetail('artist:ghost');
    expect(mocks.invokeCommand).toHaveBeenCalledWith('get_cached_artist_detail', { id: 'artist:ghost' });
    expect(result).toBeNull();
  });

  it('refreshArtistDetail invokes refresh_artist_detail with id', async () => {
    const expected = {
      id: 'artist:queen',
      name: 'Queen',
      thumbnail: null,
      topTracks: [],
      albums: [],
    };
    mocks.invokeCommand.mockResolvedValueOnce(expected);

    const result = await refreshArtistDetail('artist:queen');

    expect(mocks.invokeCommand).toHaveBeenCalledWith('refresh_artist_detail', { id: 'artist:queen' });
    expect(result).toEqual(expected);
  });

  it('getStaleFavoriteArtistIds invokes get_stale_favorite_artist_ids', async () => {
    mocks.invokeCommand.mockResolvedValueOnce(['artist:queen', 'artist:daft-punk']);
    const result = await getStaleFavoriteArtistIds();
    expect(mocks.invokeCommand).toHaveBeenCalledWith('get_stale_favorite_artist_ids');
    expect(result).toEqual(['artist:queen', 'artist:daft-punk']);
  });

  it('getAlbumDetail invokes get_album_detail with id', async () => {
    const expected = {
      id: 'album:discovery:daft-punk',
      title: 'Discovery',
      artist: 'Daft Punk',
      artistId: 'artist:daft-punk',
      cover: 'https://img.test/cover.jpg',
      year: 2001,
      tracks: [],
    };
    mocks.invokeCommand.mockResolvedValueOnce(expected);

    const result = await getAlbumDetail('album:discovery:daft-punk');

    expect(mocks.invokeCommand).toHaveBeenCalledWith('get_album_detail', {
      id: 'album:discovery:daft-punk',
    });
    expect(result).toEqual(expected);
  });

  it('playAlbum invokes play_album with albumId', async () => {
    mocks.invokeCommand.mockResolvedValueOnce(undefined);

    await playAlbum('album:discovery:daft-punk');

    expect(mocks.invokeCommand).toHaveBeenCalledWith('play_album', { albumId: 'album:discovery:daft-punk' });
  });

  it('play invokes play with url', async () => {
    mocks.invokeCommand.mockResolvedValueOnce(undefined);

    const { play } = await import('@services/commands');
    await play('https://stream.test/track.mp3');

    expect(mocks.invokeCommand).toHaveBeenCalledWith('play', {
      url: 'https://stream.test/track.mp3',
    });
  });

  it('playLocal invokes play_local with path', async () => {
    mocks.invokeCommand.mockResolvedValueOnce(undefined);

    const { playLocal } = await import('@services/commands');
    await playLocal('/music/track.mp3');

    expect(mocks.invokeCommand).toHaveBeenCalledWith('play_local', {
      path: '/music/track.mp3',
    });
  });

  it('correlates repeated stream requests so an older same-track event is stale', async () => {
    mocks.invokeCommand.mockResolvedValue(undefined);
    const track = { id: 'same-track' } as any;
    await playStream(track);
    const firstId = mocks.invokeCommand.mock.calls.at(-1)?.[1].streamRequestId;
    await playStream(track);
    const secondId = mocks.invokeCommand.mock.calls.at(-1)?.[1].streamRequestId;

    expect(secondId).toBeGreaterThan(firstId);
    expect(isLatestStreamRequest(firstId)).toBe(false);
    expect(isLatestStreamRequest(secondId)).toBe(true);
  });

  it('reResolveStream invokes re_resolve_stream with track and request id', async () => {
    const expected = { streamUrl: 'http://127.0.0.1:8765/proxy?fresh', proxyCapability: 'cap' };
    mocks.invokeCommand.mockResolvedValueOnce(expected);
    const { reResolveStream } = await import('@services/commands');
    const track = { id: 't1', sourceId: 'yt-id', source: 'YouTube' } as any;

    const result = await reResolveStream(track, 7);

    expect(mocks.invokeCommand).toHaveBeenCalledWith('re_resolve_stream', { track, streamRequestId: 7 });
    expect(result).toEqual(expected);
  });

  it('openMiniPlayer invokes open_mini_player', async () => {
    mocks.invokeCommand.mockResolvedValueOnce(undefined);

    const { openMiniPlayer } = await import('@services/commands');
    await openMiniPlayer();

    expect(mocks.invokeCommand).toHaveBeenCalledWith('open_mini_player');
  });

  it('restoreFullPlayer invokes restore_full_player', async () => {
    mocks.invokeCommand.mockResolvedValueOnce(undefined);

    const { restoreFullPlayer } = await import('@services/commands');
    await restoreFullPlayer();

    expect(mocks.invokeCommand).toHaveBeenCalledWith('restore_full_player');
  });
});
