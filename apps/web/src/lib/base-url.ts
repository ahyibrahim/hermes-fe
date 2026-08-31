/**
 * API base URL for Hermes.
 *
 * Production (served by hermes-be from the same origin): empty string, so
 * `fetch('/health')` and friends are relative. `toSocketUrl` turns that into
 * `ws(s)://` + `location.origin`.
 *
 * Dev: same-origin through the Vite proxy (see vite.config.ts), which targets
 * `http://ying-1:3000`. Set `VITE_HERMES_BASE_URL` to hit a backend directly
 * (needs CORS) or to an empty string to keep using the proxy.
 */
export function getApiBaseUrl(): string {
  const override = import.meta.env.VITE_HERMES_BASE_URL;
  if (typeof override === 'string') {
    return override.replace(/\/$/, '');
  }

  return '';
}
