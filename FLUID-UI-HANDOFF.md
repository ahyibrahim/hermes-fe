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
| B — room-switch dual-buffer | **done** | ChatShell `displayMessages` + scene phase; session defers clear until history |
| C — message physics + scroll | pending | |
| D — async settle + composer + **call invite toast** | pending | Redesign ugly incoming-call banner + stronger motion |
| E — auth/profile VT + **phone rail overlay** | pending | Must fix phone letter-stack crush (parked from A soak) |

## Next chat starter (Release C)

Paste something like:

> Implement **Fluid UI Release C only** on hermes-fe branch `fluid-ui`.  
> Read `FLUID-UI-HANDOFF.md` and plan `fluid_ui_overhaul_9baddf28`.  
> Goal: message enter/send physics + smooth scroll pin (viewport-limited); no full-history restagger.  
> Commit as `fluid-c: …`. Keep commits local. Rebuild FE for throwaway on :3001 when done. Do not start D–E.

### B notes (done)

1. ChatShell holds `displayMessages` / `transcriptPhase` / `pendingRoom` while `selectRoom` → `enterRoom` runs.
2. Scroller binds to `displayMessages`, not wiped session messages mid-switch.
3. `session.enterRoom` keeps prior messages until `applyRoomHistory`; skips live appends while `enteringRoom` is set; supersede via `enterGeneration`.
4. Crossfade/slide center column via `.scene-leaving` / `.scene-entering`; composer stays planted; header title soft-fades on room key.

### B smoke checklist

- [ ] Rapid room hopping: transcript never flashes empty / “No messages yet”
- [ ] Unread badges + mark-read still correct after switch
- [ ] DM start / create room still lands on the new transcript
- [ ] Call join from toast still switches room correctly
- [ ] `prefers-reduced-motion`: shorter opacity-only scene

## Known follow-ups (for later releases)

- **E — Phone rail crush:** Expanding rooms/people under `PHONE_MAX_WIDTH_MQ` still uses desktop 3-column grid → chat crushed to letter-stacked text. Fix: overlay/full-bleed drawer over chat (do not shrink center). Documented in plan Release E.
- **D — Call invite toast:** Incoming-call banner (DM/group when someone else starts a call) is plain and ugly. Redesign as compact invite (avatar, title, Join/dismiss) + stronger enter/exit/pulse on top of A’s `transition:toast`. Documented in plan Release D.

## A notes (done)

- Motion helpers: `apps/web/src/lib/motion.ts`
- Tokens + shell rail grid transition in `apps/web/src/app.css`
- Overlay enter/exit via Svelte transitions on menus, hover cards, call UI, MD/image expand, watch, crop, toast, jump/typing
