# Fluid UI handoff (local milestone tracking)

Branch: `fluid-ui`  
Plan: multi-release A→E, local commits only until milestone ships.

## Throwaway env

Keep one local stack running after A is smoke-tested through E.

From hermes-be README (same-origin / throwaway DB): build fe → point `HERMES_WEB_DIR` at `apps/web/build`, or use `npm run dev:web` in hermes-fe for Vite HMR while iterating.

## Status

| Release | Status | Notes |
|---------|--------|-------|
| A — motion tokens, overlay enter/exit, rail slide | ready for soak | Commit prefix `fluid-a:`. Smoke below before starting B. |
| B — room-switch dual-buffer | pending | |
| C — message physics + scroll | pending | |
| D — async settle + composer | pending | |
| E — auth/profile VT + mobile drawers | pending | |

## Smoke checklist (A)

- [ ] Open/close room menu (Escape / outside click) — enter and exit both animate
- [ ] Open/close user menu
- [ ] Room menu → Add people popup
- [ ] Hover card on a user chip
- [ ] Collapse/expand rooms rail — grid animates; content fades
- [ ] Collapse/expand people rail
- [ ] MD attach expand + close
- [ ] Image attach expand + close
- [ ] Call toast appear/dismiss (if a call event is easy to trigger)
- [ ] Watch overlay open/leave (if easy)
- [ ] Avatar crop modal on profile
- [ ] `prefers-reduced-motion: reduce` — still usable, shorter/simpler motion

## A implementation notes

- Motion helpers: `apps/web/src/lib/motion.ts` (`popup`, `backdrop`, `panel`, `soft`, `toast`, `drawer`)
- Tokens in `app.css`: `--motion-fast|base|slow|scene`, `--ease-out`, `--ease-in`
- Shell `grid-template-columns` transitions on rail collapse
- CSS open-only keyframes removed; enter/exit via Svelte transitions
- No session / room-switch changes (that is B)

## Known follow-ups

(none yet)
