import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('release version', () => {
  it('keeps app, workspace, UI, and lock entries at 0.4.3', () => {
    const root = resolve(process.cwd(), '..');
    for (const file of ['Cargo.toml', 'jellyx-desktop/Cargo.toml', 'jellyx-desktop/tauri.conf.json', 'ui/package.json']) {
      expect(readFileSync(resolve(root, file), 'utf8')).toContain('0.4.3');
    }
    const lock = readFileSync(resolve(root, 'Cargo.lock'), 'utf8');
    for (const crate of ['jellyx-cli', 'jellyx-core', 'jellyx-desktop', 'jellyx-ffi']) {
      expect(lock).toMatch(new RegExp(`name = "${crate}"\\r?\\nversion = "0\\.4\\.3"`));
    }
  });
});
