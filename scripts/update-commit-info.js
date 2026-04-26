import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { join } from 'path';

try {
  const hash = execSync('git rev-parse --short HEAD').toString().trim();
  const date = execSync('git log -1 --format=%cd').toString().trim();
  const branch = execSync('git rev-parse --abbrev-ref HEAD').toString().trim();
  
  const info = { hash, date, branch };
  writeFileSync(join(process.cwd(), 'www/src/commit-info.json'), JSON.stringify(info, null, 2));
  console.log('✅ Updated commit-info.json');
} catch (err) {
  console.warn('⚠️ Could not update commit-info.json:', err.message);
}
