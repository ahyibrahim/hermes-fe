# Fluid UI handoff (local milestone tracking)

Branch: `fluid-ui` (hermes-fe)  
Plan: `/home/ai/.cursor/plans/fluid_ui_overhaul_9baddf28.plan.md`  
Local commits only until milestone ships. No push unless user approves.

## Throwaway env (keep through E)

- URL: http://127.0.0.1:3001
- FE build: `/home/ai/Workspace/hermes-fe/apps/web/build`
- DB: `/tmp/hermes-fluid.db`
- Files: `/tmp/hermes-fluid-files`
- Start (if down):
  ```sh
  cd /home/ai/Workspace/hermes-fe && npm run build
  cd /home/ai/Workspace/hermes-be && \
  HERMES_WEB_DIR=/home/ai/Workspace/hermes-fe/apps/web/build \
  HERMES_DB_PATH=/tmp/hermes-fluid.db \
  HERMES_FILES_DIR=/tmp/hermes-fluid-files \
  PORT=3001 npm run dev
  ```
- After each release: rebuild FE, hard-refresh browser.

## Status

| Release | Status | Commit / notes |
|---------|--------|----------------|
| A — motion tokens, overlay enter/exit, rail slide | **done** (soaked) | `fluid-a: add motion tokens, overlay enter/exit, and rail slide` |
| B — room-switch dual-buffer | **next** | See below |
| C — message physics + scroll | pending | |
| D — async settle + composer | pending | |
| E — auth/profile VT + **phone rail overlay** | pending | Must fix phone letter-stack crush (parked from A soak) |

## Next chat starter (Release B)

Paste something like:

> Implement **Fluid UI Release B only** on hermes-fe branch `fluid-ui`.  
> Read `FLUID-UI-HANDOFF.md` and plan `fluid_ui_overhaul_9baddf28`.  
> Goal: room switch never flashes empty transcript — ChatShell dual-buffer + minimal session cooperation.  
> Commit as `fluid-b: …`. Keep commits local. Rebuild FE for throwaway on :3001 when done. Do not start C–E.

### B locked approach

1. ChatShell holds `displayMessages` / transition phase while `selectRoom` / `enterRoom` runs.
2. Do not bind scroller to wiped session messages mid-switch.
3. Small change in `packages/core/src/session.ts` `enterRoom` so clearing messages does not force a blank UI frame (clear on history apply, or ignore empty sync while pending).
4. Crossfade/slide center column when history arrives; composer stays planted.

### B primary files

- `apps/web/src/lib/components/ChatShell.svelte`
- `packages/core/src/session.ts` (minimal)
- Message list / `MessageGroup` as needed
- Reuse `apps/web/src/lib/motion.ts` + tokens from A

## Known follow-ups (for E)

- **Phone rail crush:** Expanding rooms/people under `PHONE_MAX_WIDTH_MQ` still uses desktop 3-column grid → chat crushed to letter-stacked text. Fix: overlay/full-bleed drawer over chat (do not shrink center). Documented in plan Release E.

## A notes (done)

- Motion helpers: `apps/web/src/lib/motion.ts`
- Tokens + shell rail grid transition in `apps/web/src/app.css`
- Overlay enter/exit via Svelte transitions on menus, hover cards, call UI, MD/image expand, watch, crop, toast, jump/typing
