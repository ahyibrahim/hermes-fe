#!/usr/bin/env node
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const index = fileURLToPath(new URL('../apps/web/build/index.html', import.meta.url));

try {
  await access(index);
} catch {
  console.error('Expected apps/web/build/index.html after the web build.');
  process.exit(1);
}

console.log('apps/web/build/index.html present');
