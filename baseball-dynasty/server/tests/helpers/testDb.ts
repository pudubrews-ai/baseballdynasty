// Shared test helper: sets up an in-memory DB for integration tests
import { beforeAll, afterAll } from 'vitest';

// Set DB_PATH to :memory: before any imports of db.ts
process.env['DB_PATH'] = ':memory:';

export async function setupTestDb() {
  const { initDb } = await import('../../db.js');
  await initDb();
}
