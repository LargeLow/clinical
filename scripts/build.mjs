import { access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
for (const file of ['public/index.html', 'public/style.css', 'public/app.js', 'server.mjs']) await access(file);
for (const file of ['server.mjs', 'public/app.js']) execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
console.log('Clinical is ready to deploy.');
