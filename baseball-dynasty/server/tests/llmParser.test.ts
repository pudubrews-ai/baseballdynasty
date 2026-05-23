import { describe, it, expect } from 'vitest';
import { parseLlmJson, sanitizeNarrative, buildDraftPickPrompt } from '../services/llm.js';
import { DraftPickResponse } from '../../shared/schemas.js';

describe('LLM JSON parser (D14 — 11 malformed cases)', () => {
  it('empty string returns {ok: false}', () => {
    const result = parseLlmJson('', DraftPickResponse);
    expect(result.ok).toBe(false);
  });

  it('whitespace only returns {ok: false}', () => {
    const result = parseLlmJson('   \n\t  ', DraftPickResponse);
    expect(result.ok).toBe(false);
  });

  it('malformed JSON returns {ok: false}', () => {
    const result = parseLlmJson('{pickIndex: 3, reasoning: bad}', DraftPickResponse);
    expect(result.ok).toBe(false);
  });

  it('valid JSON wrong shape returns {ok: false}', () => {
    const result = parseLlmJson('{"answer": 42}', DraftPickResponse);
    expect(result.ok).toBe(false);
  });

  it('JSON with extra fields still parses if core fields present', () => {
    const result = parseLlmJson('{"pickIndex": 3, "reasoning": "good", "extra": "ignored"}', DraftPickResponse);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.pickIndex).toBe(3);
    }
  });

  it('JSON wrapped in markdown code fences parses correctly', () => {
    const result = parseLlmJson('```json\n{"pickIndex": 5, "reasoning": "test"}\n```', DraftPickResponse);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.pickIndex).toBe(5);
    }
  });

  it('10KB reasoning is accepted by parser but truncated by sanitizeNarrative', () => {
    const longReasoning = 'a'.repeat(10000);
    const result = parseLlmJson(`{"pickIndex": 2, "reasoning": "${longReasoning}"}`, DraftPickResponse);
    // Parser accepts it (schema allows max 1000)
    // sanitizeNarrative then caps at 280
    expect(result.ok).toBe(true);
    if (result.ok) {
      const sanitized = sanitizeNarrative(result.value.reasoning);
      expect(sanitized.length).toBeLessThanOrEqual(280);
    }
  });

  it('pickIndex: -1 fails Zod validation', () => {
    const result = parseLlmJson('{"pickIndex": -1, "reasoning": "test"}', DraftPickResponse);
    expect(result.ok).toBe(false);
  });

  it('pickIndex: 9.5 fails Zod integer validation', () => {
    const result = parseLlmJson('{"pickIndex": 9.5, "reasoning": "test"}', DraftPickResponse);
    expect(result.ok).toBe(false);
  });

  it('pickIndex: "3" (string) fails Zod number validation', () => {
    const result = parseLlmJson('{"pickIndex": "3", "reasoning": "test"}', DraftPickResponse);
    expect(result.ok).toBe(false);
  });

  it('pickIndex: null fails Zod validation', () => {
    const result = parseLlmJson('{"pickIndex": null, "reasoning": "test"}', DraftPickResponse);
    expect(result.ok).toBe(false);
  });
});

describe('sanitizeNarrative', () => {
  it('strips <script> tags', () => {
    const result = sanitizeNarrative('<script>alert(1)</script>');
    expect(result).not.toContain('<');
    expect(result).not.toContain('>');
    expect(result).not.toContain('script');
  });

  it('strips <img onerror> tags', () => {
    const result = sanitizeNarrative('<img src=x onerror=alert(1)>');
    expect(result).not.toContain('<');
    expect(result).not.toContain('>');
    expect(result).not.toContain('onerror');
  });

  it('removes javascript: protocol', () => {
    const result = sanitizeNarrative('javascript:alert(1)');
    expect(result).not.toContain('javascript:');
  });

  it('removes data: protocol', () => {
    const result = sanitizeNarrative('data:text/html,<script>');
    expect(result).not.toContain('data:');
  });

  it('caps to 280 characters', () => {
    const long = 'x'.repeat(500);
    const result = sanitizeNarrative(long);
    expect(result.length).toBeLessThanOrEqual(280);
  });

  it('preserves normal narrative text', () => {
    const text = 'The player hit a home run in the 9th inning.';
    const result = sanitizeNarrative(text);
    expect(result).toBe(text);
  });
});

describe('buildDraftPickPrompt', () => {
  it('does not contain sk- substring', () => {
    const prompt = buildDraftPickPrompt(
      'Test Team', 'win-now', 'aggressive', 'hitting', '{}', '[]'
    );
    expect(prompt).not.toMatch(/sk-/);
    expect(prompt).not.toMatch(/ANTHROPIC_API_KEY/);
    expect(prompt).not.toMatch(/api_key/i);
  });

  it('contains team name and GM attributes', () => {
    const prompt = buildDraftPickPrompt(
      'Lakewell Storm', 'rebuild', 'conservative', 'pitching', '{}', '[]'
    );
    expect(prompt).toContain('Lakewell Storm');
    expect(prompt).toContain('rebuild');
    expect(prompt).toContain('conservative');
    expect(prompt).toContain('pitching');
  });
});
