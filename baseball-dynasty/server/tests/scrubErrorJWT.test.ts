// §6.6: Verify scrubError fully redacts JWT-shaped bearer tokens

import { describe, it, expect } from 'vitest';
import { scrubError } from '../util/scrub.js';

describe('scrubError JWT bearer token redaction (§6.6 / §3.4)', () => {
  it('redacts JWT-shaped bearer tokens completely', () => {
    const err = new Error('Authorization: Bearer eyJhbGc.eyJ0eXAi.SflKxwRJSMeKKF2QT4');
    const scrubbed = scrubError(err);
    expect(scrubbed.message).not.toContain('eyJ');
    expect(scrubbed.message).not.toContain('SflKxw');
    expect(scrubbed.message).toContain('[REDACTED]');
  });

  it('redacts full JWT with base64url chars including dots', () => {
    const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const err = new Error(`Request failed: bearer ${token}`);
    const scrubbed = scrubError(err);
    expect(scrubbed.message).not.toContain('eyJhbGc');
    expect(scrubbed.message).not.toContain('SflKxw');
    expect(scrubbed.message).toContain('bearer [REDACTED]');
  });

  it('redacts API key from error message', () => {
    const err = new Error('Invalid key: sk-ant-api03-abc123def456ghi789');
    const scrubbed = scrubError(err);
    expect(scrubbed.message).not.toContain('sk-ant-');
    expect(scrubbed.message).toContain('[REDACTED_KEY]');
  });

  it('redacts x-api-key header', () => {
    const err = new Error('Request included x-api-key: my-secret-key-12345');
    const scrubbed = scrubError(err);
    expect(scrubbed.message).not.toContain('my-secret-key');
    expect(scrubbed.message).toContain('[REDACTED]');
  });

  it('plain error message without sensitive data passes through', () => {
    const err = new Error('Database connection failed');
    const scrubbed = scrubError(err);
    expect(scrubbed.message).toBe('Database connection failed');
  });
});
