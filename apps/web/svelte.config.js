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
        // The YouTube IFrame API script and the player script it loads.
        'script-src': ['self', 'https://www.youtube.com'],
        // Svelte transitions insert <style> at runtime, and components use
        // style= attributes.
        'style-src': ['self', 'unsafe-inline'],
        // Link-preview og:image and favicons can be on any https host until
        // they are proxied through hermes-be; blob: for image and avatar
        // previews, data: for inline markdown images.
        'img-src': ['self', 'blob:', 'data:', 'https:'],
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
