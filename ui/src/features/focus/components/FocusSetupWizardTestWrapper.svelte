<script lang="ts">
  import FocusSetupWizard from './FocusSetupWizard.svelte';

  export let open = false;
  export let onStart = () => {};
  export let onClose = () => {};
  export let bindWizard: (ref: FocusSetupWizard) => void = () => {};

  let wizardRef: FocusSetupWizard;
  $: if (wizardRef) bindWizard(wizardRef);
</script>

<FocusSetupWizard bind:this={wizardRef} bind:open {onStart} {onClose} />
