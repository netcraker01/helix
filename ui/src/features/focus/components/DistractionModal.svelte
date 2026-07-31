<script lang="ts">
  import { t } from '@i18n';

  export let open = false;
  export let onSave: (value: string) => void = () => {};
  export let onClose: () => void = () => {};

  let text = '';

  function handleSave(): void {
    const value = text.trim();
    if (value) onSave(value);
    text = '';
    onClose();
  }

  function handleClose(): void {
    text = '';
    onClose();
  }

  $: if (!open) text = '';
</script>

{#if open}
  <div class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="distraction-title">
    <div class="modal-panel">
      <h2 id="distraction-title">{$t('focus.active.distraction_title')}</h2>
      <p class="hint">{$t('focus.active.distraction_hint')}</p>
      <textarea
        class="note-input"
        rows="3"
        bind:value={text}
        placeholder={$t('focus.active.distraction_placeholder')}
        maxlength="300"
      ></textarea>

      <div class="modal-actions">
        <button type="button" class="btn secondary" on:click={handleClose}>
          {$t('common.cancel')}
        </button>
        <button type="button" class="btn primary" on:click={handleSave} disabled={!text.trim()}>
          {$t('focus.active.distraction_save')}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    z-index: 110;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(4px);
  }

  .modal-panel {
    width: 100%;
    max-width: 420px;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 1.25rem;
    border-radius: var(--jellyx-radius-lg, 24px);
    background: var(--bg-surface, #111827);
    border: 1px solid var(--border-color, #1f2937);
  }

  .modal-panel h2 {
    margin: 0;
    font-size: 1.1rem;
    color: var(--text-primary, #e0e0e0);
  }

  .hint {
    margin: 0;
    font-size: 0.85rem;
    color: var(--text-secondary, #9ca3af);
  }

  .note-input {
    width: 100%;
    padding: 0.75rem;
    border: 1px solid var(--border-color, #1f2937);
    border-radius: var(--jellyx-radius-sm, 8px);
    background: var(--bg-elevated, #1f2937);
    color: var(--text-primary, #e0e0e0);
    font-size: 0.95rem;
    resize: vertical;
  }

  .note-input:focus {
    outline: 2px solid var(--color-accent, #6366f1);
    outline-offset: 1px;
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    margin-top: 0.25rem;
  }

  .btn {
    padding: 0.55rem 1.25rem;
    border-radius: var(--jellyx-radius-md, 16px);
    border: 1px solid transparent;
    font-size: 0.9rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s, opacity 0.15s;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn.primary {
    background: var(--color-accent, #6366f1);
    color: #ffffff;
  }

  .btn.secondary {
    background: transparent;
    border-color: var(--border-color, #1f2937);
    color: var(--text-secondary, #9ca3af);
  }
</style>
