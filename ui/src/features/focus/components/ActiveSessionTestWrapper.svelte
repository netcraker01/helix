<script lang="ts">
  import ActiveSession from './ActiveSession.svelte';
  import type { FocusSession } from '@features/focus/types';

  export let session: FocusSession;
  export let loading = false;
  export let onPause: () => void = () => {};
  export let onResume: () => void = () => {};
  export let onSkip: () => void = () => {};
  export let onEnd: () => void = () => {};
  export let onQuickNote: () => void = () => {};
  export let onDistraction: () => void = () => {};
</script>

<ActiveSession
  {session}
  {loading}
  onPause={onPause}
  onResume={onResume}
  onSkip={onSkip}
  onEnd={onEnd}
  onQuickNote={onQuickNote}
  onDistraction={onDistraction}
/>
