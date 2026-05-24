// §6.7: Verify only ONE scrubError definition exists in server/
// This is a precommit grep gate implemented as a test

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

describe('scrubError uniqueness gate (§6.7 / §3.5)', () => {
  it('only one scrubError function definition exists in server/ (excluding tests)', () => {
    const serverDir = resolve(import.meta.dirname, '../..');
    try {
      // grep for export function scrubError in server/ excluding test files
      const output = execSync(
        `grep -rn "export function scrubError" "${serverDir}/server/" --include="*.ts" --exclude-dir=tests`,
        { encoding: 'utf8' }
      ).trim();

      const matches = output.split('\n').filter(Boolean);
      expect(matches.length).toBe(1);
      expect(matches[0]).toContain('util/scrub.ts');
    } catch (err: unknown) {
      // grep exits with code 1 if no matches — that would be a problem too
      if (err instanceof Error && 'status' in err && (err as NodeJS.ErrnoException & { status: number }).status === 1) {
        // No matches at all — also wrong
        expect.fail('No scrubError function found in server/ — it should exist in util/scrub.ts');
      }
      throw err;
    }
  });
});
