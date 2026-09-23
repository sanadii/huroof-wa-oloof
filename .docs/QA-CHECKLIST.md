# QA checklist

| ID | Check | Owner | Evidence/status |
| --- | --- | --- | --- |
| QA-01 | Typecheck | Gate | Passed independently. |
| QA-02 | Lint | Gate | Passed independently. |
| QA-03 | UI tests | Gate | 48/48 passed at initial Gate; post-fix focused board suite passed 17/17. A consolidated post-fix UI total was not reported. |
| QA-04 | Game/domain tests | Gate | 25 tests passed, including deferred subscription cleanup. |
| QA-05 | Functions tests | Gate | 22 tests passed. |
| QA-06 | Content tests | Gate | 68 tests passed. |
| QA-07 | Structural visual scan | Gate / Forge | Passed; structural evidence is not aesthetic approval. |
| QA-08 | Firestore + Storage rules | Root | Isolated local emulators: Firestore 10 assertions including expected denial; Storage 4 denial assertions. |
| QA-09 | Fixture multiplayer smoke | Root | Passed 1/1 in 7.7s: host, two players, audience, two rounds, winner/rematch, public-payload privacy. |
| QA-10 | Homepage accessibility/fallback | Root | Axe 390×844: 0 WCAG 2A/2AA violations; blocked-background/reduced-motion usable, static, no overflow, 0 uncaught errors. |
| QA-11 | Route performance | Root | Entry 92.12 KB gzip. Fixture production preview loaded no Firebase/Admin/Auth homepage chunks; deferred Firebase 158.49 KB local / 159.45 KB emulator output. |
| QA-12 | Human visual authority | Root/user | 0006 selected C; 0007 authorizes expansion of the approved homepage treatment. Human authority, not a test result. |
| QA-13 | Real Firebase E2E | Root / Gate | Passed 1/1 in 29.2s (root) and 18.8s (Gate): isolated Auth/Functions/Firestore/Storage, create/join, privacy, race winner, reload, correction, five-second expiry. |
| QA-14 | Emulator admin workflow | Root | Real emulator Google popup + guarded existing bootstrap; draft persisted/reopened/submitted `in_review`; default question timer value 35 seconds persisted after reload. |
| QA-15 | Admin and results rendering | Root | All ten admin routes plus final question/review/release/room/category/user details, account, user lookup, and completed results reviewed at 1440/390; no document overflow, Axe 0 WCAG 2A/2AA per final route. |
| QA-16 | Role geometry/materials | Forge / Root | Player 390/320 no overflow; audience 1280/390 tactile board and compact scores; real owned red/green faces and white text rechecked. |
| QA-17 | Pointer/motion | Root | Homepage fine-pointer tilt within ±4 degrees, returns to zero, no persistent running animation after entrance. |
| QA-18 | Independent Gate | Gate | **PASS** after post-fix build/scan, board 17/17, admin-only 1/1 in 2.7s, real Firebase E2E, rules, and local smoke checks. |

All evidence is local/fixture/emulator evidence. Production Google authentication, App Check/signing, production release behavior, and an approved production release remain unverified or guarded. Functions target Node 22 while the host runner is Node 24. Gate also reported seven moderate transitive `uuid` dependency-audit findings; review/update them before production release.

