// §5.1: Shared error scrubber — strips API keys and credentials from error messages
export function scrubError(err: unknown): { code: string; message: string } {
  const msg = err instanceof Error ? err.message : String(err);
  const code = (err as Record<string, unknown>)?.['status'] ? `http_${(err as Record<string, unknown>)['status']}` : 'server_error';
  const scrubbed = msg
    .replace(/sk-ant-[a-zA-Z0-9_-]+/g, '[REDACTED_KEY]')
    .replace(/authorization[^,}\n]*/gi, 'authorization: [REDACTED]')
    .replace(/x-api-key[^,}\n]*/gi, 'x-api-key: [REDACTED]')
    .replace(/bearer\s+[a-zA-Z0-9._~+/=\-]+/gi, 'bearer [REDACTED]');
  return { code, message: scrubbed };
}
