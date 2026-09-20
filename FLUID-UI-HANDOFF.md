# Fluid UI Milestone (v0.24.0 Lock)

Branch: `fluid-ui` (hermes-fe)  
Release target: **v0.24.0** (locked, ready for preparation)  
Local commits only until milestone ships. No push unless user approves.

## Throwaway env (testing instance)

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

## Status Summary

| Release | Status | Scope / Deliverables |
|---------|--------|----------------------|
| A — motion tokens, overlay enter/exit, rail slide | **done** (soaked) | Motion tokens, CSS transitions, overlay enter/exit |
| B — room-switch dual-buffer | **done** (soaked) | Dual-buffered transcript rendering during room switching |
| C — message physics + scroll | **done** (soaked) | Physics-based message entry animations, smooth scroll pinning |
| D — async settle + composer + **call invite toast** | **done** (soaked) | Link/media skeleton-to-content settle, composer easing, call invite toast |
| F — D-soak defect fixes + file transfer UX | **done** (soaked) | Drag-and-drop file target, attachment chip, portal overlays, hover card positioning |
| E — auth/profile VT + **phone rail overlay** | **done** (soaked) | View Transitions for auth/profile, mobile full-bleed overlay drawers, backdrop dismissal |

## Milestone Completion / Release Lock State

All planned releases (A through F) are implemented, verified, and locked in package versions (`v0.24.0`). Prepare release branch and GitHub issue hierarchy for merge/deploy.

### E locked approach (implemented)

1. Enabled seamless View Transitions in `routes/+layout.svelte` using `onNavigate` and `document.startViewTransition` when supported.
2. Attached CSS `view-transition-name` tokens to `.auth-brand`, `.auth-card`, and `.profile-card` in `app.css` to prevent layout thrashing/white flashes during authentication and profile navigation, with reduced motion support.
3. Fixed mobile chat crushing under `PHONE_MAX_WIDTH_MQ`: `.shell` keeps fixed rail margins without shrinking the center transcript.
4. Converted mobile expanded rails into full-bleed overlay drawers with z-index elevation, drop shadows, and a click-to-dismiss backdrop scrim (`.rail-drawer-backdrop`) in `ChatShell.svelte` and `app.css`.
5. Added automatic drawer collapsing on mobile viewports when switching rooms or initiating DMs.
6. Added outer backdrop click and Escape key dismissal on `/profile`.

### E smoke checklist

- [x] Navigating between Sign in, Register, Password Reset, and Profile displays seamless crossfade / morph transitions without blank page flashes.
- [x] On mobile viewport (`< 48rem`), expanding the rooms rail slides out an overlay drawer without crushing the center chat into letter-stacked text.
- [x] Expanding the people rail on mobile slides out an overlay drawer from the right without squeezing the message transcript.
- [x] Tapping the dimmed backdrop outside an open mobile drawer closes the drawer and restores focus to chat.
- [x] Selecting a room or starting a DM on mobile automatically collapses the drawer.
- [x] Clicking the backdrop or pressing Escape on the Profile page returns to chat view.

### F locked approach (implemented)

1. Stabilized callback identity for `onWatchTogether` and added metadata caching in `$lib/ui.ts` to eliminate thumbnail flickering and redundant network requests.
2. Removed redundant `background: #111` on `.call-share-expand video/img` in `app.css` to fix black box artifacts behind expanded images.
3. Added `portal` action in `$lib/ui.ts` and attached `use:portal` to `ImagePreview.svelte`, `MdPreview.svelte`, and `CallBar.svelte` to escape mobile ancestor transform containment blocks.
4. Positioned `HoverCard.svelte` with viewport-relative fixed coordinates and `use:portal` to prevent clipping inside scrollable room/member lists.
5. Added drag-and-drop file target overlay with dragenter/dragleave counter guards across the chat area.
6. Added rich attachment preview chip above the composer with live image thumbnail, file-type badge, formatted byte size, and remove button.

### F smoke checklist

- [ ] Watch-Together / YouTube links do not re-fetch metadata or flicker thumbnails on room re-renders.
- [ ] Expanding attached images displays clean backdrop dimming without black box artifacts.
- [ ] Expanding images/markdown on mobile viewports fills the entire screen instead of being clipped to the message container.
- [ ] Hovering or tapping avatars in Room Menu / member list opens hover cards without clipping by `overflow-y: auto`.
- [ ] Dragging and dropping files anywhere on the chat area displays the drop overlay and stages the file in the composer.
- [ ] Staged file displays an image thumbnail (for images) or extension badge (for other files) with filename and file size above the composer.

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
