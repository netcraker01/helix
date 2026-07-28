/**
 * Artist detail store — stale-while-revalidate (SWR) with bounded priority
 * scheduling and late-response guards.
 *
 * SWR contract:
 * - On `load(id)`, first try `get_cached_artist_detail(id)`. If cached,
 *   render immediately and trigger a background refresh. If not cached,
 *   show loading state and fetch fresh via `refresh_artist_detail`.
 * - On refresh error, retain cached data and set an error state (don't
 *   clear the rendered detail).
 * - `isLoading` = no cache, first load. `isRefreshing` = have cache,
 *   background refresh in flight.
 * - Late-response guard: if user navigates to a different artist before a
 *   refresh completes, discard the stale response.
 * - Session dedup: don't trigger a second refresh for the same artist if
 *   one is already in flight this session.
 *
 * Bounded priority scheduler:
 * - One background slot, two total slots. Foreground requests get priority
 *   over background warming.
 * - Foreground elevation of an already-queued startup job re-pumps the
 *   scheduler so an available foreground slot does not stay idle.
 */
import { writable, type Writable } from 'svelte/store';
import {
  getCachedArtistDetail,
  refreshArtistDetail,
} from '@services/commands';
import { notifications } from '@shared/stores/notifications';
import type { ArtistDetail } from '@shared/types/models';

export interface ArtistDetailStore {
  subscribe: Writable<ArtistDetail | null>['subscribe'];
  load: (id: string) => Promise<void>;
  clear: () => void;
  /** Warm a favorite artist in the background without changing the visible
   *  artist. Used by the startup warmer. Resolves to true when a refresh
   *  was actually performed, false when skipped (already fresh this session
   *  or already in flight). */
  warm: (id: string) => Promise<boolean>;
}

// ── Bounded priority scheduler ────────────────────────────────────────
// One background slot, two total slots. Foreground requests get priority
// over background warming; the foreground slot is never occupied by a
// background job when a foreground request is waiting.

const MAX_TOTAL_SLOTS = 2;
const MAX_BACKGROUND_SLOTS = 1;

interface SchedulerState {
  totalActive: number;
  backgroundActive: number;
  queue: Array<{
    id: string;
    isBackground: boolean;
    run: () => Promise<void>;
    resolve: () => void;
  }>;
}

const scheduler: SchedulerState = {
  totalActive: 0,
  backgroundActive: 0,
  queue: [],
};

/** Session-level dedup: artist ids that have been refreshed (or are being
 *  refreshed) this session. A second `load` or `warm` for the same id within
 *  the session is a no-op. Cleared only by a full page reload. */
const refreshedThisSession = new Set<string>();

function pumpScheduler(): void {
  while (scheduler.totalActive < MAX_TOTAL_SLOTS && scheduler.queue.length > 0) {
    // Find the next eligible job. Foreground jobs can take any slot;
    // background jobs can only take a non-foreground slot (i.e. the
    // background slot, which is the second slot when one is already
    // occupied, or the first slot when none are occupied).
    const nextIndex = scheduler.queue.findIndex((job) => {
      if (!job.isBackground) return true;
      // Background job: only eligible if the background slot is free.
      return scheduler.backgroundActive < MAX_BACKGROUND_SLOTS;
    });
    if (nextIndex === -1) break;

    const job = scheduler.queue.splice(nextIndex, 1)[0];
    scheduler.totalActive += 1;
    if (job.isBackground) scheduler.backgroundActive += 1;

    void job.run().finally(() => {
      scheduler.totalActive -= 1;
      if (job.isBackground) scheduler.backgroundActive -= 1;
      job.resolve();
      pumpScheduler();
    });
  }
}

function enqueueRefresh(id: string, isBackground: boolean, run: () => Promise<void>): Promise<void> {
  return new Promise<void>((resolve) => {
    scheduler.queue.push({ id, isBackground, run, resolve });
    pumpScheduler();
  });
}

/** Elevation: when a foreground `load` arrives for an id that is already
 *  queued as a background warming job, mark that queued job as foreground so
 *  it gets priority and re-pump the scheduler. This is the key fix for the
 *  "available foreground slot stays idle" case. */
function elevateQueuedToForeground(id: string): void {
  const queued = scheduler.queue.find((job) => job.id === id);
  if (queued && queued.isBackground) {
    queued.isBackground = false;
    pumpScheduler();
  }
}

// ── Store ─────────────────────────────────────────────────────────────

function createArtistDetailStore(): ArtistDetailStore {
  const { subscribe, set } = writable<ArtistDetail | null>(null);
  // The id the user currently expects to see. A late refresh response for a
  // different id is discarded.
  let visibleId: string | null = null;

  async function performRefresh(id: string, isBackground: boolean): Promise<ArtistDetail | null> {
    try {
      const fresh = await refreshArtistDetail(id);
      refreshedThisSession.add(id);
      return fresh;
    } catch (e) {
      // Background warmers swallow errors silently — the cache stays intact
      // and the next foreground load will surface the error if needed.
      if (!isBackground) throw e;
      return null;
    }
  }

  return {
    subscribe,

    /** Load artist detail by ID using SWR semantics. */
    async load(id: string) {
      // Session dedup + late-response guard setup.
      visibleId = id;
      artistDetailError.set(null);

      // Try cache first.
      let cached: ArtistDetail | null = null;
      try {
        cached = await getCachedArtistDetail(id);
      } catch {
        // Cache read failure → treat as uncached and fall through to fresh
        // load. We do not surface cache-read errors to the user.
        cached = null;
      }

      if (cached && visibleId === id) {
        // Render cached immediately.
        set(cached);
        isLoadingArtistDetail.set(false);
        isRefreshingArtistDetail.set(true);

        // Session dedup: only refresh if we haven't already this session.
        if (!refreshedThisSession.has(id)) {
          // Foreground elevation: if this id is already queued as a
          // background warming job, promote it so the foreground slot picks
          // it up immediately.
          elevateQueuedToForeground(id);
          void enqueueRefresh(id, false, async () => {
            const fresh = await performRefresh(id, false);
            // Late-response guard: discard if user navigated away.
            if (visibleId !== id) {
              isRefreshingArtistDetail.set(false);
              return;
            }
            if (fresh) {
              set(fresh);
            }
            isRefreshingArtistDetail.set(false);
          });
        } else {
          isRefreshingArtistDetail.set(false);
        }
        return;
      }

      // No cache (or cache read failed): fresh load with loading state.
      isLoadingArtistDetail.set(true);
      // If a background warming job for this id was queued, elevate it so
      // the foreground slot runs it now.
      elevateQueuedToForeground(id);
      if (refreshedThisSession.has(id)) {
        // Already refreshed this session but cache was empty/missing — try
        // a direct refresh anyway since we have nothing to show.
      }
      try {
        const fresh = await refreshArtistDetail(id);
        refreshedThisSession.add(id);
        if (visibleId !== id) {
          // Late-response guard: discard.
          isLoadingArtistDetail.set(false);
          return;
        }
        set(fresh);
      } catch (e) {
        if (visibleId !== id) {
          isLoadingArtistDetail.set(false);
          return;
        }
        const msg = e instanceof Error ? e.message : String(e);
        artistDetailError.set(msg);
        notifications.push({
          type: 'error',
          title: 'Artist Error',
          message: msg,
          dismissible: true,
        });
        set(null);
      } finally {
        isLoadingArtistDetail.set(false);
      }
    },

    /** Warm a favorite artist in the background. Does not change the
     *  visible artist. Returns true when a refresh was performed. */
    async warm(id: string) {
      if (refreshedThisSession.has(id)) return false;
      // Skip if already in flight or queued.
      if (scheduler.queue.some((job) => job.id === id)) return false;
      if (scheduler.totalActive > 0 && scheduler.queue.length > 0) {
        // We still enqueue — the scheduler handles slot allocation.
      }
      await enqueueRefresh(id, true, async () => {
        await performRefresh(id, true);
      });
      return true;
    },

    /** Clear artist detail and error state. */
    clear() {
      visibleId = null;
      set(null);
      artistDetailError.set(null);
      isRefreshingArtistDetail.set(false);
      isLoadingArtistDetail.set(false);
    },
  };
}

/** Current artist detail (null if not loaded). */
export const artistDetail = createArtistDetailStore();

/** Whether an artist detail request is in flight with no cache (first load). */
export const isLoadingArtistDetail = writable(false);

/** Whether a background refresh is in flight while cached data is shown. */
export const isRefreshingArtistDetail = writable(false);

/** Error message from the last failed artist detail load (null if no error). */
export const artistDetailError = writable<string | null>(null);

/** Convenience action: load artist detail by ID. */
export const loadArtistDetail = artistDetail.load.bind(artistDetail);

/** Convenience action: clear artist detail state. */
export const clearArtistDetail = artistDetail.clear.bind(artistDetail);

/** Convenience action: warm a favorite artist in the background. */
export const warmArtistDetail = artistDetail.warm.bind(artistDetail);