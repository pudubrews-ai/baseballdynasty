import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const dir = 'dist/client/assets';
let bad = false;
try {
  for (const f of readdirSync(dir)) {
    const content = readFileSync(join(dir, f), 'utf8');
    if (/sk-ant-/i.test(content) || /ANTHROPIC_API_KEY/i.test(content)) {
      console.error(`SECURITY: ${f} contains an Anthropic key reference. Build blocked.`);
      bad = true;
    }
  }
} catch (e) {
  // dist not built yet — fine.
}
if (bad) process.exit(1);
