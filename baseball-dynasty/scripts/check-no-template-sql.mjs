import { execSync } from 'node:child_process';
try {
  // Search for: db.prepare(`...${...}...`) or db.exec(`...${...}...`)
  const out = execSync(
    "grep -rEn 'db\\.(prepare|exec)\\(\\s*`[^`]*\\$\\{' server/ --include='*.ts' || true",
    { encoding: 'utf8' }
  );
  if (out.trim()) {
    console.error('SECURITY: Template-literal interpolation found in SQL. Use parameterized queries.');
    console.error(out);
    process.exit(1);
  }
} catch (e) {
  process.exit(1);
}
