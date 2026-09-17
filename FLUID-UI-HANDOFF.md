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
| A — motion tokens, overlay enter/exit, rail slide | **done** (soaked) | `fluid-a: …` |
| B — room-switch dual-buffer | **done** (soaked) | `39b506d` `fluid-b: keep transcript visible across room switches` |
| C — message physics + scroll | **next** | See below |
| D — async settle + composer + **call invite toast** | pending | Redesign ugly incoming-call banner + stronger motion |
| E — auth/profile VT + **phone rail overlay** | pending | Must fix phone letter-stack crush (parked from A soak) |

## Next chat starter (Release C)

Paste something like:

> Implement **Fluid UI Release C only** on hermes-fe branch `fluid-ui`.  
> Read `FLUID-UI-HANDOFF.md` and plan `fluid_ui_overhaul_9baddf28`.  
> Goal: message enter/send physics + smooth scroll pin (viewport-limited); no full-history restagger on room enter.  
> Commit as `fluid-c: …`. Keep commits local. Rebuild FE for throwaway on :3001 when done. Do not start D–E.  
> Throwaway stays on http://127.0.0.1:3001. Handoff + plan are the source of truth for C.

### C locked approach

1. Incoming message enter (short rise/fade); outgoing send with origin bias from composer.
2. Delete/edit: height collapse / soft morph where feasible.
3. Replace hard `scrollTop = scrollHeight` snaps with short smooth pin when already near bottom; jump-to-latest glides.
4. **Density rule:** animate only rows that mount near the viewport / recent appends — not a full-history restagger on room enter (B owns the room-enter scene).
5. Performance gate: if jank, add `content-visibility` or virtualization before more animation.

### C primary files

- `apps/web/src/lib/components/ChatShell.svelte` (scroll pin, jump)
- `apps/web/src/lib/components/MessageItem.svelte` / `MessageGroup.svelte`
- `apps/web/src/app.css`
- Reuse `apps/web/src/lib/motion.ts` + tokens from A; do not regress B dual-buffer

## Known follow-ups (for later releases)

- **E — Phone rail crush:** Expanding rooms/people under `PHONE_MAX_WIDTH_MQ` still uses desktop 3-column grid → chat crushed to letter-stacked text. Fix: overlay/full-bleed drawer over chat (do not shrink center). Documented in plan Release E.
- **D — Call invite toast:** Incoming-call banner (DM/group when someone else starts a call) is plain and ugly. Redesign as compact invite (avatar, title, Join/dismiss) + stronger enter/exit/pulse on top of A’s `transition:toast`. Documented in plan Release D.

## B notes (done, soaked)

1. ChatShell holds `displayMessages` / `transcriptPhase` / `pendingRoom` while `selectRoom` → `enterRoom` runs.
2. Scroller binds to `displayMessages`, not wiped session messages mid-switch.
3. `session.enterRoom` keeps prior messages until `applyRoomHistory`; skips live appends while `enteringRoom` is set; supersede via `enterGeneration`.
4. Crossfade/slide center column via `.scene-leaving` / `.scene-entering`; composer stays planted; header title soft-fades on room key.

### B smoke (user-confirmed)

- Rapid room hopping: no empty / “No messages yet” flash
- Unread + mark-read, DM/create room, call-toast join paths OK in soak

## A notes (done)

- Motion helpers: `apps/web/src/lib/motion.ts`
- Tokens + shell rail grid transition in `apps/web/src/app.css`
- Overlay enter/exit via Svelte transitions on menus, hover cards, call UI, MD/image expand, watch, crop, toast, jump/typing
