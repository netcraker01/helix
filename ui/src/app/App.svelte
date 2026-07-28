<script lang="ts">
  import { onMount } from 'svelte';
  import Sidebar from './layout/Sidebar.svelte';
  import { sidebarCollapsed } from './layout/sidebar';
  import { queueVisible } from '@features/player/stores/queuePanel';
  import { createResponsiveCollapseOwner } from './layout/viewport';
  import BottomBar from './layout/BottomBar.svelte';
  import ToastContainer from '@shared/components/ToastContainer.svelte';
  import { currentPath } from './router/navigation';
  import { getStaleFavoriteArtistIds } from '@services/commands';
  import { warmArtistDetail } from '@features/library/stores/artistDetail';
import Home from '../routes/Home/Page.svelte';
import Search from '../routes/Search/Page.svelte';
import PlaylistsPage from '../routes/Playlists/Page.svelte';
import PlaylistDetail from '../routes/Playlists/PlaylistDetail.svelte';
import NowPlaying from '../routes/NowPlaying/Page.svelte';
import Library from '../routes/Library/Page.svelte';
import FolderDetail from '../routes/Library/FolderDetail.svelte';
import Settings from '../routes/Settings/Page.svelte';
import ArtistPage from '../routes/Artist/Page.svelte';
import AlbumPage from '../routes/Album/Page.svelte';
import FocusPage from '../routes/Focus/Page.svelte';
import MiniPlayer from '@features/mini-player/MiniPlayer.svelte';
import Visualizer from '@features/player/components/Visualizer.svelte';
import { frequencyData, cinematicMode, cinematicIntensity, modoCineActive } from '@features/player/stores/player';
  import UpdateAvailableModal from '@features/updater/UpdateAvailableModal.svelte';
  import WelcomeModal from '@features/welcome/WelcomeModal.svelte';
  import GlobalSearchBar from './layout/GlobalSearchBar.svelte';

  // Cinematic ambient background is active when the Settings cinematic-mode
  // toggle is ON and there is frequency data available.
  $: cineOn = $cinematicMode && $frequencyData != null;

  // Bass and peak for the cinematic CSS gradients. These are PRIMITIVE reactive
  // values (number, not object), so Svelte compares by value and only re-renders
  // when the number actually changes — NOT every time frequencyData updates.
  // Previously this was a single `$: cinePulse = { bass, peak }` which created
  // a NEW object reference every frame (~70fps), forcing App.svelte to
  // re-render entirely even when the values hadn't changed.
  $: cineBass = (() => {
    const fd = $frequencyData;
    if (!fd || !fd.bins.length) return 0;
    const bins = fd.bins;
    const n = Math.max(1, Math.floor(bins.length * 0.25));
    let sum = 0;
    for (let i = 0; i < n; i++) sum += bins[i];
    return Math.min(1, sum / n);
  })();
  $: cinePeak = $frequencyData?.peak ?? 0;

  type RouteMatch =
    | { name: 'home' }
    | { name: 'search' }
    | { name: 'playlists' }
    | { name: 'playlist-detail'; id: string }
    | { name: 'now-playing' }
    | { name: 'library' }
    | { name: 'folder-detail'; folderPath: string }
    | { name: 'settings' }
    | { name: 'mini-player' }
    | { name: 'artist'; id: string }
    | { name: 'album'; id: string }
    | { name: 'focus' };

  function resolveRoute(path: string): RouteMatch {
    if (path === '/search') return { name: 'search' };
    if (path === '/playlists') return { name: 'playlists' };
    if (path === '/now-playing') return { name: 'now-playing' };
    if (path === '/library') return { name: 'library' };
    if (path === '/settings') return { name: 'settings' };
    if (path === '/mini-player') return { name: 'mini-player' };
    if (path.startsWith('/library/folder/')) return { name: 'folder-detail', folderPath: decodeURIComponent(path.slice('/library/folder/'.length)) };
    if (path.startsWith('/playlists/')) return { name: 'playlist-detail', id: decodeURIComponent(path.slice('/playlists/'.length)) };
    if (path.startsWith('/artist/')) return { name: 'artist', id: decodeURIComponent(path.slice('/artist/'.length)) };
    if (path.startsWith('/album/')) return { name: 'album', id: decodeURIComponent(path.slice('/album/'.length)) };
    if (path === '/focus') return { name: 'focus' };
    return { name: 'home' };
  }

  $: route = resolveRoute($currentPath);

  onMount(() => {
    const updateResponsivePanels = createResponsiveCollapseOwner(() => {
      sidebarCollapsed.set(true);
      queueVisible.set(false);
    });
    const onResize = () => updateResponsivePanels(window.innerWidth);
    onResize();
    window.addEventListener('resize', onResize);

    // ── Artist detail SWR startup warmer ─────────────────────────────
    // After a 4-second startup delay, fetch stale favorite artists and
    // warm their detail caches in the background so the next visit to an
    // artist page shows fresh data without foreground latency.
    const warmerTimer = setTimeout(async () => {
      try {
        const staleIds = await getStaleFavoriteArtistIds();
        // Warm each stale artist in the background. The bounded scheduler
        // limits concurrency so this does not compete with user-triggered
        // foreground loads.
        for (const id of staleIds) {
          warmArtistDetail(id);
        }
      } catch {
        // Startup warmer failures are non-critical — the foreground load
        // path will fetch fresh data on demand.
      }
    }, 4_000);

    return () => {
      window.removeEventListener('resize', onResize);
      clearTimeout(warmerTimer);
    };
  });
</script>

{#if route.name === 'mini-player'}
  <MiniPlayer />
{:else}
<div class="app-shell" class:cinematic-active={cineOn} class:sidebar-collapsed={$sidebarCollapsed}>
  <!-- Cinematic ambient background: layered reactive gradients/glow that paint
       BEHIND app content (z-index: -1 within an isolated stacking context on
       .app-shell). Only rendered when the user opted in and frequency data is
       available. Opacity is driven solely by the user intensity slider so
       quiet passages don't make the background flicker. -->
  {#if cineOn}
    <div
      class="cinematic-layer"
      style="--cine-peak: {cinePeak}; --cine-bass: {cineBass}; --cine-intensity: {$cinematicIntensity};"
      aria-hidden="true"
    >
      <div class="cinematic-wash"></div>
      <div class="cinematic-glow"></div>
      <div class="cinematic-vignette"></div>
    </div>
  {/if}

  <Sidebar />
  <main class="content">
    {#if route.name !== 'search' && route.name !== 'home' && route.name !== 'settings'}
      <GlobalSearchBar />
    {/if}
    {#if route.name === 'search'}
      <Search />
    {:else if route.name === 'playlists'}
      <PlaylistsPage />
    {:else if route.name === 'playlist-detail'}
      <PlaylistDetail id={route.id} />
    {:else if route.name === 'now-playing'}
      <NowPlaying />
    {:else if route.name === 'library'}
      <Library />
    {:else if route.name === 'folder-detail'}
      <FolderDetail folderPath={route.folderPath} />
    {:else if route.name === 'settings'}
      <Settings />
    {:else if route.name === 'artist'}
      <ArtistPage id={route.id} />
    {:else if route.name === 'album'}
      <AlbumPage id={route.id} />
    {:else if route.name === 'focus'}
      <FocusPage />
    {:else}
      <Home />
    {/if}
  </main>
  <BottomBar />
  <ToastContainer />
  <UpdateAvailableModal />
  <WelcomeModal />
  {#if $modoCineActive}
    <div class="visualizer-embed">
      <Visualizer />
    </div>
  {/if}
</div>
{/if}

<style>
  .app-shell {
    display: grid;
    grid-template-columns: 240px 1fr;
    grid-template-rows: minmax(0, 1fr) auto;
    transition: grid-template-columns 0.25s ease;
    grid-template-areas:
      "sidebar content"
      "sidebar bottombar";
    height: 100vh;
    background: var(--bg-base, #0a0a0f);
    color: var(--text-primary, #e0e0e0);
    font-family: 'Inter', sans-serif;
    position: relative;
    /* Create a new stacking context so the cinematic background (z-index: -1)
       stays scoped to the shell and paints behind the static grid children. */
    isolation: isolate;
  }

  .app-shell.sidebar-collapsed {
    grid-template-columns: 80px 1fr;
  }

  .content {
    grid-area: content;
    overflow-y: auto;
    padding: 1.5rem;
    /* Position so it paints above the negative-z cinematic background. */
    position: relative;
    z-index: 1;
  }

  /* ── Cinematic ambient background ──────────────────────────────────
     Paints BEHIND app content. Opacity is driven solely by the user intensity
     slider (--cine-intensity, 0..1); reactivity comes from --cine-peak and
     --cine-bass custom properties (0..1) feeding gradient color stops, so the
     effect animates at display refresh without a JS rAF loop. Per-layer alphas
     are kept low (0.55/0.5/0.3) and blur radii large (48/72px) so the background
     stays soft and does not compete with text. */
  .cinematic-layer {
    position: fixed;
    inset: 0;
    z-index: -1;
    pointer-events: none;
    opacity: var(--cine-intensity, 0.5);
    overflow: hidden;
  }

  .cinematic-wash {
    position: absolute;
    inset: -10%;
    background:
      radial-gradient(
        ellipse 60% 50% at 20% 30%,
        hsla(calc(240 + var(--cine-peak, 0) * 120), 70%, 25%, 0.55),
        transparent 70%
      ),
      radial-gradient(
        ellipse 50% 40% at 80% 70%,
        hsla(calc(200 + var(--cine-bass, 0) * 80), 65%, 22%, 0.55),
        transparent 70%
      );
    filter: blur(48px);
    transition: opacity 0.2s ease;
  }

  .cinematic-glow {
    position: absolute;
    inset: 20% 25%;
    background: radial-gradient(
      circle,
      hsla(calc(260 + var(--cine-peak, 0) * 60), 75%, 55%, calc(0.15 + var(--cine-bass, 0) * 0.35)),
      transparent 60%
    );
    filter: blur(72px);
    transition: opacity 0.15s ease;
  }

  .cinematic-vignette {
    position: absolute;
    inset: 0;
    background: radial-gradient(
      ellipse at center,
      transparent 55%,
      rgba(0, 0, 0, 0.3) 100%
    );
  }

  .visualizer-embed {
    position: fixed;
    inset: 0;
    z-index: 99;
    pointer-events: auto;
  }

</style>
