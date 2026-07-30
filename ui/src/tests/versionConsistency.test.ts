import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const version = '0.4.3';
const root = resolve(process.cwd(), '..');

describe('release version', () => {
  it('keeps app, workspace, UI, and lock entries at the v0.4.3 release version', () => {
    for (const file of [
      'Cargo.toml',
      'jellyx-desktop/Cargo.toml',
      'jellyx-desktop/tauri.conf.json',
      'ui/package.json',
      'ui/package-lock.json',
    ]) {
      expect(readFileSync(resolve(root, file), 'utf8')).toContain(version);
    }

    const lock = readFileSync(resolve(root, 'Cargo.lock'), 'utf8');
    for (const crate of ['jellyx-cli', 'jellyx-core', 'jellyx-desktop', 'jellyx-ffi']) {
      expect(lock).toMatch(new RegExp(`name = "${crate}"\\r?\\nversion = "${version.replaceAll('.', '\\.')}"`));
    }
  });
});
