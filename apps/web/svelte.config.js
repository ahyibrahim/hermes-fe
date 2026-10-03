import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      pages: 'build',
      assets: 'build',
      fallback: 'index.html',
      precompress: false,
      strict: true,
    }),
    // Emitted as a <meta> CSP with a hash of SvelteKit's inline bootstrap
    // script. hermes-be adds the header-only directives (frame-ancestors,
    // form-action) on every response.
    csp: {
      mode: 'hash',
      directives: {
        'default-src': ['self'],
        'script-src': ['self'],
        // Svelte transitions insert <style> at runtime, and components use
        // style= attributes.
        'style-src': ['self', 'unsafe-inline'],
        // Link-preview images come through hermes-be as blob: URLs, like
        // image and avatar previews; data: for inline markdown images.
        'img-src': ['self', 'blob:', 'data:'],
        'media-src': ['self', 'blob:'],
        'font-src': ['self', 'data:'],
        // wss: covers browsers that do not match ws(s) against 'self'.
        'connect-src': ['self', 'wss:'],
        'frame-src': ['https://www.youtube.com', 'https://www.youtube-nocookie.com'],
        'worker-src': ['self', 'blob:'],
        'object-src': ['none'],
        'base-uri': ['self'],
        'form-action': ['self'],
      },
    },
  },
};

export default config;
