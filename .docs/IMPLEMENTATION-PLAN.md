# Implementation plan — current state

| ID | Work item | Owner | Dependencies | Acceptance | State |
| --- | --- | --- | --- | --- | --- |
| T-01 | Preserve history and collect design evidence | Forge / root | Immutable 0001–0007 | Receipts unchanged; C selection and expansion authority linked. | Complete |
| T-02 | Homepage/create/join representative implementation | Forge | 0006 selection | Real create/join/category controls; human live homepage review completed. | Complete |
| T-03 | Shared C public shell and recovery/auth surfaces | Forge | T-02 | Rules, setup, lobby, account/auth, missing/not-found retain real routes and recovery. | Complete |
| T-04 | C game role rollout | Forge | T-03, canonical board contract | Host/player/audience/results preserve role privacy, axes, hit geometry, and responsive layout. | Complete |
| T-05 | Guarded admin composition | Forge | Existing capability APIs | Guard remains; readable lists/details/actions; no auth bypass. | Complete |
| T-06 | Entry performance and emulator reliability | Forge | Existing router/Firebase contracts | Game/Auth/Admin lazy chunks; isolated-port E2E harness; no production default change. | Complete |
| T-07 | Independent technical/release assessment | Gate / root | T-01–T-06 | Gate technical PASS; production-only authorization checks remain. | Complete / production follow-up |

## Acceptance mapping

- `A-01` design authority: 0006 selected C and 0007 authorizes expanding the **approved homepage treatment** across the app. It does not claim a separate human route-by-route aesthetic review.
- `A-02` behavior: no fabricated data, no role/private-answer leak, canonical 25-cell geometry and team axes unchanged.
- `A-03` quality: relevant automated checks, emulator evidence, and structural scan are recorded as `QA-*` in [QA-CHECKLIST.md](QA-CHECKLIST.md).
- `A-04` release: only complete after `T-07`; production Google/App Check/signing/release verification remains outside this local source freeze.

The plan intentionally avoids production, schema, rule, and permission changes.

