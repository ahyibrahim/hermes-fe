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
| C — message physics + scroll | **done** (soak) | See below |
| D — async settle + composer + **call invite toast** | pending | Redesign ugly incoming-call banner + stronger motion |
| E — auth/profile VT + **phone rail overlay** | pending | Must fix phone letter-stack crush (parked from A soak) |

## Next chat starter (Release D)

Paste something like:

> Implement **Fluid UI Release D only** on hermes-fe branch `fluid-ui`.  
> Read `FLUID-UI-HANDOFF.md` and plan `fluid_ui_overhaul_9baddf28`.  
> Goal: async settle (link/YT/image/avatar) + composer height motion + call invite toast redesign/motion.  
> Commit as `fluid-d: …`. Keep commits local. Rebuild FE for throwaway on :3001 when done. Do not start E.  
> Throwaway stays on http://127.0.0.1:3001. Handoff + plan are the source of truth for D.

### C locked approach (implemented)

1. Incoming message enter (short rise/fade); outgoing send with origin bias from composer (`msgEnter` in `motion.ts`).
2. Delete: soft body fade-out + tombstone fade-in; group slots use short `animate:flip` for height settle.
3. Stick-to-bottom uses short smooth pin when transcript is idle; ResizeObserver / room-scene commits stay instant; jump-to-latest glides.
4. **Density rule:** `liveEnterIds` gates enter motion — only `session.on('message')` appends animate; room history / `commitTranscript` / `syncFromSession` clear the set (no full-history restagger).
5. Performance: `content-visibility: auto` on `.msg-cluster`.

### C primary files

- `apps/web/src/lib/components/ChatShell.svelte` (scroll pin, jump, liveEnterIds)
- `apps/web/src/lib/components/MessageItem.svelte` / `MessageGroup.svelte`
- `apps/web/src/lib/motion.ts` (`msgEnter`)
- `apps/web/src/app.css` (cluster content-visibility, slot spacing)

### C smoke checklist

- [ ] Send own message: rises from composer; stick-to-bottom smooth pins
- [ ] Receive message while at bottom: short rise/fade; stays pinned
- [ ] Jump-to-latest glides (not hard snap)
- [ ] Room hop: no per-message restagger (B scene only)
- [ ] Unsend/delete: soft morph to tombstone; list height eases
- [ ] Long room still scrollable; no obvious jank
- [ ] `prefers-reduced-motion`: shortened fades, no large travel

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
