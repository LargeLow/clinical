import { access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
for (const file of ['public/index.html', 'public/style.css', 'public/app.js', 'server.mjs', 'attachments.mjs', 'assistant.mjs', 'workspace.mjs', 'public/workspace.js']) await access(file);
for (const file of ['server.mjs', 'attachments.mjs', 'assistant.mjs', 'workspace.mjs', 'public/workspace.js', 'public/app.js']) execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
console.log('Clinical is ready to deploy.');
