# Handover

## State

C whole-app source implementation is frozen after independent Gate technical **PASS**. The user authorized applying the human-approved homepage treatment across the app in [0007](../design/evidence/history/0007-spatial-studio-whole-app-rollout.md): **“Approve C homepage and continue across the app.”** This authorization does not claim a separate human route-by-route aesthetic review. Do not alter immutable 0001–0007 records or receipts.

## Source-owned delta

The implementation touched these scoped areas while preserving unrelated dirty work:

- Presentation/routes: `src/routes/{HomeSurface,EntryRoute,GameRoutes,AuthRoutes}.tsx`, `src/features/admin/AdminRoutes.tsx`, `src/styles/global.css`, `src/features/board/{game-board,SpatialBoardScene}.tsx`, plus focused UI tests.
- Deferred runtime: `src/app/App.tsx`, `src/features/auth/auth-context.tsx`, `src/features/game/runtime/deferred-firebase-adapter.ts`, its `.js` dynamic import of `firebase-game-adapter`, runtime exports/tests, and `tests/runtime-selector.test.ts`.
- Emulator support: `src/lib/firebase/client.ts`, `.env.example`, `src/vite-env.d.ts`, `scripts/{test-firebase-e2e,run-firebase-e2e,seed-firestore}.*`, `vite.config.ts`, focused config/seed tests.
- Compatibility/tooling: `scripts/question-bank-v3.1.ts` typed-constructor compatibility, `.js` specifier imports used by runtime/content tests, `tsconfig.node.json`, shared CSS tokens, `scripts/scan-visual-contract.ts`, and `public/assets/backgrounds/spatial-studio-v1.webp` plus `public/assets/backgrounds/spatial-studio-mobile-v1.webp`.
- E2E compatibility: `tests/e2e/{smoke,firebase,admin-only}.spec.ts`; final repair uses current team labels and `.stage-score--horizontal`.
- Docs and immutable design evidence, without rewriting prior history.

Behavior work covers approved C composition; entry validation; lobby role auto-routing, copy feedback and rematch recovery; truthful active/final results; owned tactile materials; lazy route chunks; configurable **emulator-only** ports; disposable local Firebase harnesses; and legacy demo seed identities matching existing fixture defaults. Runtime validation, schema, rules, permissions, question content, and production records were not weakened or changed.

## Verification

Gate passed typecheck, lint, structural scan, UI 48/48 at initial Gate, game 25, Functions 22, content 68, focused config/seed, build, post-fix board 17/17, admin-only 1/1 in 2.7s, Firebase E2E 1/1 in 18.8s, rules, and smoke checks. Root also verified final real result, admin/account route captures, visual fallback/motion, and performance. See [QA-CHECKLIST.md](QA-CHECKLIST.md).

For full local multiplayer, run `$env:VITE_GAME_RUNTIME = 'local'` then `npm run dev`, and open `http://localhost:5173`. See [SETUP-AND-RUN.md](SETUP-AND-RUN.md) for fixture and isolated-emulator modes. `127.0.0.1:5173` is unrelated user work.

## Release follow-up

Production Google/App Check/signing/approved-release checks remain external/guarded. Resolve Node 22 Functions versus Node 24 host parity and assess Gate’s seven moderate transitive `uuid` audit findings before production release. No deployment is authorized.


