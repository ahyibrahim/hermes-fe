# hermes-fe

Clients for **Hermes**, a private messenger for a small group of friends. It runs on the local network and over Tailscale, and talks to the [hermes-be](https://github.com/ahyibrahim/hermes-be) backend (one Node process, Fastify, SQLite).

This repository is an npm workspaces monorepo. v0.7.0 ships `packages/core` (a browser-safe session library), `apps/cli` (the terminal client), and `apps/web` (a static SvelteKit SPA with rooms, DMs, and a profile page).

## Requirements

- Node.js 18.19 or newer (the clients use built-in `fetch` and the Node test runner; the web toolchain is pinned for Node 18.19)
- A reachable hermes-be instance

## Install

```sh
npm install
npm run build
```

`npm run build` compiles `@hermes/core`, then the CLI, then the web static bundle into `apps/web/build/`.

| Command | What it is |
|---------|------------|
| `npm run dev:web` | Vite for the web UI (hot reload). Proxies API/WS to a running hermes-be. |
| `npm start` | The **CLI**, not the web UI. |
| `npm run build` | Compile core + CLI + the static SPA. Production has no frontend Node process. |

## Web UI

A cheap Discord-shaped layout: rooms on the left (create a group with the field at the bottom; DMs show as `@name`), messages and composer in the middle, people on the right (click someone to open a DM). It follows OS light/dark via `prefers-color-scheme`. There is no extra server/guild rail — Hermes has rooms, not guilds.

### Development

Start hermes-be first (see that repo's README). Then:

```sh
npm run dev:web
```

That is `vite dev --host` in `apps/web`. The API base URL is empty (same origin as the Vite dev server). Vite proxies `/health`, `/auth`, `/rooms`, `/messages`, `/files`, `/users`, and `/ws` to `http://ying-1:3000` by default — that is **production** on this host. For a local backend:

```sh
VITE_HERMES_PROXY_TARGET=http://127.0.0.1:3000 npm run dev:web
```

To talk to a backend directly instead of through the proxy (needs CORS, which hermes-be does not send):

```sh
VITE_HERMES_BASE_URL=http://ying-1:3000 npm run dev:web
```

hermes-be does not send CORS headers, so the proxy is the path that works from `localhost`.

### Production bundle (same origin as the API)

```sh
npm run build
```

The artifact is `apps/web/build/` (`index.html` plus hashed `_app/` assets). hermes-be serves that directory from `HERMES_WEB_DIR`. On the tailnet that is `http://ying-1:3000` — the same origin as the API, so the bundle uses relative URLs and does not bake in a hostname.

To try that path **before** tagging or running `deploy.sh` (throwaway DB, not `/var/lib/hermes`):

```sh
npm run build
cd /home/ai/Workspace/hermes-be
HERMES_WEB_DIR=/home/ai/Workspace/hermes-fe/apps/web/build \
HERMES_DB_PATH=/tmp/hermes-local.db \
HERMES_FILES_DIR=/tmp/hermes-local-files \
npm run dev
```

Open `http://127.0.0.1:3000`. That is the same serving path as production: one Fastify process, no Vite, no second Node service.

The web session token lives in `localStorage` under `hermes.session`. `~/.config/hermes` is CLI-only.

Routes (client-side SPA, fallback `index.html`):

| Path | Screen |
|------|--------|
| `/login` | Sign in |
| `/register` | Create an account |
| `/` | Authenticated shell (redirects to `/login` if `resume()` fails) |

Room selection is the left rail, not a URL. A 401 (`authExpired`) sends the browser back to `/login`.

Full end-to-end chat still needs hermes-be running. `vite build` plus `apps/web/build/index.html` is the CI check.

## Deploy

The web UI is static files. Do not run `npm start` or Vite on the host. After a tagged release, hermes-be's `deploy.sh` unpacks `apps/web/build/` into `HERMES_WEB_DIR` and the **backend** serves it. Runbook: [hermes-be/docs/DEPLOY.md](https://github.com/ahyibrahim/hermes-be/blob/main/docs/DEPLOY.md).

```sh
npm run build
cd /home/ai/Workspace/hermes-be
sudo ./scripts/setup-host.sh p1    # once, if /etc/hermes/p1.env does not exist
sudo HERMES_WEB_BUNDLE=/home/ai/Workspace/hermes-fe/apps/web/build \
  ./scripts/deploy.sh p1 v0.6.0
```

`deploy.sh` checks the hermes-be **tag** out of GitHub, not this working tree. Merge the PRs and push `v0.6.0` on both remotes before that command. Pushing a tag does not deploy by itself. Rehearse the membership migration on `s1` first — see the hermes-be deploy runbook.

## CLI

```sh
npm start
```

`npm start` runs the compiled **CLI** at `apps/cli/dist/cli.js`. It does not start the web UI. The `@hermes/cli` package also declares `bin.hermes`, so after a build you can run `node apps/cli/dist/cli.js` or install the workspace and invoke `hermes`.

### Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `HERMES_BASE_URL` | `http://ying-1:3000` | Base URL of the backend. The WebSocket URL is derived from it, so `http://` becomes `ws://` and `https://` becomes `wss://`. |
| `XDG_CONFIG_HOME` | `~/.config` | Directory used for the persistent login file `hermes/config.json`. |

```sh
HERMES_BASE_URL=http://localhost:3000 npm start
```

### Signing in

On start the client asks whether you want to log in or register:

1. `Login (l) or register (r)?` — answer `l` or `r`.
2. `Username:`
3. `Password:` — this prompt is masked. Each character you type prints a `*`, backspace erases one, and the password itself is never written to the terminal. Registering also logs you in with the same credentials.
4. `Room (id or slug):` — the client lists the rooms you can see first. You can answer with a room slug, a room name or the numeric id shown in the list; all of them resolve to a slug, since the backend addresses rooms by slug.

A successful login is stored at `~/.config/hermes/config.json` (mode `0600`). The next start reuses that token and skips the login prompt. If the backend rejects it with HTTP 401 on REST or on the WebSocket upgrade — the current path while server-side sessions are still rolling out — the file is cleared and the login prompt comes back. A corrupt config file is treated the same way.

Ctrl-C at the password prompt exits the client, the same as `/quit`.

### Slash commands

Inside a room, anything that does not start with `/` is sent as a message. The available commands, as listed by `/help`:

| Command | Description |
|---------|-------------|
| `/help` | Show the command list |
| `/health` | Print the backend health response |
| `/join <room>` | Switch rooms, then reload the user list and history |
| `/sendfile <path>` | Upload a local file to the current room |
| `/getfile <id> [path]` | Download a file by id, saving to `path` or to `file-<id>` |
| `/quit` | Exit the client (`/exit` does the same) |

## How messaging works

Sending is a REST call: the client does `POST /messages` and the backend persists the row and broadcasts it to every socket joined to that room. Live delivery therefore arrives over the WebSocket at `/ws` as a `message` frame, not as a reply to the send. The shared core de-duplicates by message id, so your own message is not printed twice.

The auth token goes on the WebSocket handshake (both as `?token=` and as an `Authorization: Bearer` header); an unauthenticated upgrade is rejected with HTTP 401. If the socket drops, the client reconnects and re-issues `join_room` for the current room. REST keeps working in that state, so history and sending still work without live updates.

Files go to `POST /files` as multipart, which also creates a message carrying the `file_id`. The web UI shows a download control on those messages. See the [hermes-be README](https://github.com/ahyibrahim/hermes-be#readme) for the full REST and WebSocket contract.

## Layout

| Path | Package | Contents |
|------|---------|----------|
| `packages/core` | `@hermes/core` | Types, REST client, WebSocket client, slash-command parser, room resolver, session controller. The main entry is browser-safe: no `node:` or `ws` imports. |
| `packages/core/node` | `@hermes/core/node` | Node adapters: `ws` transport, `node:fs` file IO, XDG token store. |
| `packages/core/testing` | `@hermes/core/testing` | In-process fake `node:http` + `ws` backend for tests. Not part of the main entry. |
| `apps/cli` | `@hermes/cli` | Readline UI, masked password prompt, and a thin render loop over the session controller. |
| `apps/web` | `@hermes/web` | SvelteKit `adapter-static` SPA. Login, register, rooms, messages, presence, composer, file attach/download. |

Three adapters keep core off the platform:

- **Transport** — `ws` in Node, native `WebSocket` in the browser (`BrowserTransport`).
- **File IO** — `node:fs/promises` in Node; `BrowserFileIO` (in-memory, plus ingesting a browser `File`) in the web app. The REST client never imports `fs` itself.
- **Token storage** — `~/.config/hermes/config.json` mode `0600` in Node; `localStorage` key `hermes.session` in the browser (`LocalStorageTokenStore`).

The session controller is an event emitter (`message`, `history`, `presence`, `connected`, `joined`, `status`, `info`, `error`, `authExpired`). It has no `console.log` and no readline. The web app wires `HermesApi` + `HermesWsClient` + those adapters the same way the CLI does.

## Development

```sh
npm run build
npm test
npm run smoke
npm run dev:web
```

`npm test` builds the workspaces (including `apps/web/build/`), runs every compiled test file under `packages/core/dist/` and `apps/cli/dist/` with the Node test runner, checks that the `@hermes/core` main entry import graph stays free of `node:` and `ws`, then runs `svelte-check` and asserts `apps/web/build/index.html` exists. `npm run smoke` drives the CLI against the fake backend: login, join, send, a slash command, the `0600` token file, restart without a prompt, and a corrupt token falling back to login.

## Roadmap

v0.7.0 adds a profile page (read-only username and role, password change, avatar). Voice is v0.8.0. The full release plan lives in [hermes-be/docs/ROADMAP.md](https://github.com/ahyibrahim/hermes-be/blob/main/docs/ROADMAP.md).
