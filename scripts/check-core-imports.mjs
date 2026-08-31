#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const entry = process.argv[2] ?? 'packages/core/dist/index.js';
const root = fileURLToPath(new URL('..', import.meta.url));
const start = isAbsolute(entry) ? entry : join(root, entry);
const seen = new Set();
const offenders = [];

function walk(file) {
  if (seen.has(file)) {
    return;
  }
  seen.add(file);

  let source;
  try {
    source = readFileSync(file, 'utf8');
  } catch (error) {
    offenders.push(`${file}: unreadable (${error instanceof Error ? error.message : String(error)})`);
    return;
  }

  const specs = [
    ...source.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g),
    ...source.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g),
  ];

  for (const match of specs) {
    const spec = match[1];
    if (spec.startsWith('node:') || spec === 'ws' || spec.startsWith('ws/')) {
      offenders.push(`${file} imports ${spec}`);
      continue;
    }
    if (!spec.startsWith('.')) {
      continue;
    }
    walk(fileURLToPath(new URL(spec, pathToFileURL(file))));
  }
}

walk(start);

if (offenders.length > 0) {
  console.error('Core main entry is not browser-safe:');
  for (const line of offenders) {
    console.error(`  ${line}`);
  }
  process.exit(1);
}

console.log(`Core main entry import graph is browser-safe (${seen.size} modules from ${start}).`);
