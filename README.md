# hermes-fe

Terminal client for **Hermes**, a private messenger for a small group of friends. It runs on the local network and over Tailscale, and talks to the [hermes-be](https://github.com/ahyibrahim/hermes-be) backend (one Node process, Fastify, SQLite).

This repository is the CLI. A web UI is planned; see [Roadmap](#roadmap).

## Requirements

- Node.js 18 or newer (the client uses the built-in `fetch` and the Node test runner)
- A reachable hermes-be instance

## Install and run

```sh
npm install
npm run build
npm start
```

`npm start` is a shortcut for `node dist/cli.js`, so you can also run the compiled entry point directly.

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `HERMES_BASE_URL` | `http://ying-1:3000` | Base URL of the backend. The WebSocket URL is derived from it, so `http://` becomes `ws://` and `https://` becomes `wss://`. |

```sh
HERMES_BASE_URL=http://localhost:3000 npm start
```

## Signing in

On start the client asks whether you want to log in or register:

1. `Login (l) or register (r)?` — answer `l` or `r`.
2. `Username:`
3. `Password:` — this prompt is masked. Each character you type prints a `*`, backspace erases one, and the password itself is never written to the terminal. Registering also logs you in with the same credentials.
4. `Room (id or slug):` — the client lists the rooms you can see first. You can answer with a room slug, a room name or the numeric id shown in the list; all of them resolve to a slug, since the backend addresses rooms by slug.

Ctrl-C at the password prompt exits the client, the same as `/quit`.

## Slash commands

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

Sending is a REST call: the client does `POST /messages` and the backend persists the row and broadcasts it to every socket joined to that room. Live delivery therefore arrives over the WebSocket at `/ws` as a `message` frame, not as a reply to the send. The client de-duplicates by message id, so your own message is not printed twice.

The auth token goes on the WebSocket handshake (both as `?token=` and as an `Authorization: Bearer` header); an unauthenticated upgrade is rejected with HTTP 401. If the socket drops, the client reconnects and rejoins the current room automatically, and the prompt shows `offline` while it is down. REST keeps working in that state, so history and sending still work without live updates.

Files go to `POST /files` as multipart, which also creates a message carrying the `file_id` that `/getfile` takes. See the [hermes-be README](https://github.com/ahyibrahim/hermes-be#readme) for the full REST and WebSocket contract.

## Development

```sh
npm run build
npm test
```

`npm test` builds and then runs every compiled test file under `dist/` with the Node test runner.

Source layout in `src/`:

| File | Contents |
|------|----------|
| `cli.ts` | Entry point: auth loop, room prompt, chat loop, slash commands |
| `terminal.ts` | Readline helpers, including the masked password prompt |
| `api.ts` | REST client |
| `ws.ts` | WebSocket client with reconnect |
| `commands.ts` | Chat line parsing |
| `types.ts` | Shared types |

## Roadmap

A web UI is coming. In v0.3.0 this repository becomes an npm workspaces monorepo: `api.ts`, `ws.ts`, `types.ts` and `commands.ts` move into `packages/core` behind platform adapters so the same logic drives both the CLI and the browser, and the CLI keeps working throughout. The full release plan lives in [hermes-be/docs/ROADMAP.md](https://github.com/ahyibrahim/hermes-be/blob/main/docs/ROADMAP.md).
