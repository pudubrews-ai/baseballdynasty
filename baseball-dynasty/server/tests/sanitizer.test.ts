// §6.10: Sanitizer bypass regression tests
import { describe, it, expect } from 'vitest';
import { sanitizeNarrative } from '../services/llm.js';

describe('sanitizeNarrative bypass prevention (§4.6)', () => {
  it('existing: strips <script> tags', () => {
    const result = sanitizeNarrative('<script>alert(1)</script>');
    expect(result).not.toContain('<');
    expect(result).not.toContain('>');
    expect(result).not.toContain('script');
  });

  it('bypass: nested double-tag <<script>script>alert(1)</script>', () => {
    const result = sanitizeNarrative('<<script>script>alert(1)</script>');
    // After loop-until-stable stripping, no HTML or script should remain
    expect(result).not.toContain('<');
    expect(result).not.toContain('>');
    expect(result).not.toContain('script');
  });

  it('bypass: unclosed tag <script', () => {
    const result = sanitizeNarrative('<script');
    expect(result).not.toContain('<');
    expect(result).not.toContain('script');
  });

  it('bypass: nested javascript: protocol jajavascript:vascript:alert(1)', () => {
    const result = sanitizeNarrative('jajavascript:vascript:alert(1)');
    expect(result).not.toContain('javascript:');
  });

  it('strips vbscript: protocol', () => {
    const result = sanitizeNarrative('vbscript:alert(1)');
    expect(result).not.toContain('vbscript:');
  });

  it('handles empty string', () => {
    expect(sanitizeNarrative('')).toBe('');
  });

  it('handles non-string input', () => {
    // @ts-expect-error testing runtime safety
    expect(sanitizeNarrative(null)).toBe('');
    // @ts-expect-error testing runtime safety
    expect(sanitizeNarrative(undefined)).toBe('');
  });

  it('caps to 280 characters after stripping', () => {
    const long = 'Hello world! '.repeat(100);
    const result = sanitizeNarrative(long);
    expect(result.length).toBeLessThanOrEqual(280);
  });

  it('preserves normal narrative text', () => {
    const text = 'The pitcher threw a complete game shutout.';
    expect(sanitizeNarrative(text)).toBe(text);
  });

  it('strips control characters', () => {
    const withCtrl = 'Hello\x00World\x07End';
    const result = sanitizeNarrative(withCtrl);
    expect(result).not.toMatch(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/);
  });
});
