/**
 * Focus event subscriptions.
 *
 * Thin typed wrappers around the generic Tauri event bus for the
 * `focus-event` envelope emitted by the Rust backend after committed
 * mutations.
 */

import { subscribeEvent } from '@services/tauri';
import type { FocusEvent } from '@features/focus/types';

type UnlistenFn = () => void;

/** Subscribe to committed Focus mutations and phase changes. */
export function onFocusEvent(cb: (event: FocusEvent) => void): Promise<UnlistenFn> {
  return subscribeEvent<FocusEvent>('focus-event', cb);
}
