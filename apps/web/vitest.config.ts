import { fileURLToPath } from 'node:url';
import { sveltekit } from '@sveltejs/kit/vite';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [sveltekit(), svelteTesting()],
  resolve: {
    alias: [
      // The fake backend and NodeTransport need the Node build of ws, not the
      // browser stub that the `browser` resolve condition would pick.
      { find: /^ws$/, replacement: fileURLToPath(new URL('../../node_modules/ws/wrapper.mjs', import.meta.url)) },
    ],
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
    pool: 'threads',
    testTimeout: 15_000,
  },
});
