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
  resolveTrack,
  addTrackToPlaylist,
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

  it('resolves a source track without starting playback', async () => {
    const track = { id: 'yt-1', source: 'YouTube', sourceId: 'dQw4w9WgXcQ' } as any;
    mocks.invokeCommand.mockResolvedValueOnce(track);

    await expect(resolveTrack('YouTube', 'dQw4w9WgXcQ')).resolves.toBe(track);

    expect(mocks.invokeCommand).toHaveBeenCalledWith('resolve_track', {
      source: 'YouTube',
      id: 'dQw4w9WgXcQ',
    });
  });

  it('adds the resolved track to the selected playlist', async () => {
    const track = { id: 'yt-1', source: 'YouTube', sourceId: 'dQw4w9WgXcQ' } as any;
    mocks.invokeCommand.mockResolvedValueOnce(undefined);

    await addTrackToPlaylist('playlist-1', track);

    expect(mocks.invokeCommand).toHaveBeenCalledWith('add_track_to_playlist', {
      playlistId: 'playlist-1',
      track,
    });
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
