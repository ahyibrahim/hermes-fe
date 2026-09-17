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
| C — message physics + scroll | **done** (soaked) | `84a12b3` `fluid-c: add message enter physics and smooth scroll pin` |
| D — async settle + composer + **call invite toast** | **done** (soak) | See below |
| E — auth/profile VT + **phone rail overlay** | pending | Must fix phone letter-stack crush (parked from A soak) |

## Next chat starter (Release E)

Paste something like:

> Implement **Fluid UI Release E only** on hermes-fe branch `fluid-ui`.  
> Read `FLUID-UI-HANDOFF.md` and plan `fluid_ui_overhaul_9baddf28`.  
> Goal: auth/profile view transitions + phone rail overlay (fix letter-stack crush) + mobile drawers.  
> Commit as `fluid-e: …`. Keep commits local. Rebuild FE for throwaway on :3001 when done.  
> Throwaway stays on http://127.0.0.1:3001. Handoff + plan are the source of truth for E.

### D locked approach (implemented)

1. Link / YouTube / image / avatar: reserved skeleton (or fixed footprint) → crossfade settle; YT meta fills without layout thrash.
2. Composer `growComposer` eases height via measured prev→next; send control micro-flash aligned with `playSfx('send')`.
3. Typing: reserved `composer-presence` strip + soft ambient rule; connection: soft composer border / whoami cue ambient (not label-only).
4. Call invite toast: compact strip (avatar, “Incoming call”, name, room) + Join / quiet dismiss; stronger `toast` (rise + scale) + live pulse; phone still above composer.
5. Reuses A motion tokens / `soft` / strengthened `toast` — no second toast system.

### D primary files

- `apps/web/src/lib/components/LinkPreviewCard.svelte`
- `apps/web/src/lib/components/YouTubePreviewCard.svelte`
- `apps/web/src/lib/components/ImagePreview.svelte`
- `apps/web/src/lib/components/Avatar.svelte`
- `apps/web/src/lib/components/ChatShell.svelte` (composer, presence, call toast)
- `apps/web/src/lib/motion.ts` (`toast` rise+scale)
- `apps/web/src/app.css` (settle shimmer, composer ambient, `.call-toast*`)

### D smoke checklist

- [ ] Paste link / YT: skeleton or reserved space, then soft settle (no hard jump)
- [ ] Image attach: reserved skel → image crossfade; stick-to-bottom still OK
- [ ] Avatars: letter → face crossfade without footprint change
- [ ] Composer multiline grow/shrink eases; send flash + SFX together
- [ ] Someone typing: presence strip under header of composer area, no layout snap
- [ ] Disconnect / reconnect: soft ambient on composer / whoami (not only menu text)
- [ ] Incoming call (other room): compact invite toast; Join / dismiss; pulse; phone above Send
- [ ] `prefers-reduced-motion`: shortened fades, no large travel / pulse

## Known follow-ups (for later releases)

- **E — Phone rail crush:** Expanding rooms/people under `PHONE_MAX_WIDTH_MQ` still uses desktop 3-column grid → chat crushed to letter-stacked text. Fix: overlay/full-bleed drawer over chat (do not shrink center). Documented in plan Release E.

## C notes (done, soaked)

1. Incoming message enter (short rise/fade); outgoing send with origin bias from composer (`msgEnter` in `motion.ts`).
2. Delete: soft body fade-out + tombstone fade-in; group slots use short `animate:flip` for height settle.
3. Stick-to-bottom uses short smooth pin when transcript is idle; ResizeObserver / room-scene commits stay instant; jump-to-latest glides.
4. **Density rule:** `liveEnterIds` gates enter motion — only `session.on('message')` appends animate; room history / `commitTranscript` / `syncFromSession` clear the set (no full-history restagger).
5. Performance: `content-visibility: auto` on `.msg-cluster`.

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
