# Local Pepper restoration, September 29, 2026

## Local access

Open http://127.0.0.1:4189/pepper on this Mac. This is synthetic data, not the
live beta. Use separate browser profiles/private windows to test two members.

| Profile | Synthetic PIN | Role |
| --- | --- | --- |
| test-parent | 246810 | adult_admin |
| test-child | 135790 | child |

These disposable local PINs have no production authority. The existing login RPC
uses household slug `eriksen`; the isolated database maps that slug to a synthetic
household named `[PEPPER TEST] Local family`. No family data was imported.

Retained runtime and evidence are outside Git under this chat's visualization
workspace, in `pepper-restoration`. To restart the retained runtime:

```sh
/Users/c.w.warrenframing/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /Users/c.w.warrenframing/.codex/visualizations/2026/08/19/01a01b77-174e-7162-99ae-f29bcf0a4b18/pepper-restoration/restart.mjs
```

The restart script preserves local test data. It starts only the labeled disposable
database, reviewed offline worker and loopback Vite server. An interrupted worker
must first be removed with the launcher's `stop` operation using its recorded
`pepper-restoration/worker` directory; it refuses to overwrite unknown state.
The shared Colima VM must be available. `web.pid` and `web.log` identify the retained
frontend. Stop that exact PID when finished, then use the local launcher's stop
command. Do not stop unrelated Colima workloads.

## Repairs and isolation

- The actual starting index was 67 files, patch
  `932c4847fc96fc46a66950651ff14b99c0ce3aeaaa2e4b0c12d861af9e0c9064`.
  The reported 58-file snapshot was obsolete. The requested callback URL was
  already correct; neither it nor the production redirect guard needed changes.
- Extended the local launcher with a preview mode. It bundles pinned Supabase JS
  2.57.4 using esbuild 0.25.10 and runs real family handlers plus internal-only
  PostgREST 16.2. The verified postgres 3.4.7 tarball was reused.
- The local postgres adapter allows only `pepper-oauth-db`. Its SSL override is
  confined to the disposable import map; deployed handlers are unchanged.
- `family_preview_local_worker.mjs` routes only local REST and reviewed handlers.
  Calendar, Gmail/integrations and AEGIS workers are not loaded. Provider requests,
  OAuth, photo upload and account deletion are disabled. The Docker network is
  internal; PostgREST is not published. The frontend uses loopback API configuration
  and a dummy anonymous key. The local service JWT never enters the browser.
- Added synthetic preview seed records. No original `.env` or credential file was
  copied into the staged-only export. No live system was queried or modified.
- Installed Homebrew coreutils 9.12 (gmp 6.3.0 dependency). With its `gnubin` on PATH,
  the unmodified `scripts/build-verified.sh` executes its real timeout-bounded
  vinext build and artifact checks. No build check was bypassed.

## Verification

| Gate | Actual result |
| --- | --- |
| Real worker startup | Responding on loopback 54329; no provider egress |
| Pre-forward HTTP/database gate | 2 passed, 12 expected old-schema failures |
| Post-forward HTTP/database gate | 14/14 passed, zero skipped |
| Forward apply/rollback/reapply/guarded replay | Passed; exact schema and data hashes restored |
| Family HTTP/database workflows | 7/7 passed, zero skipped |
| Focused fast tests | 104/104 passed |
| Complete fast repository suite | 203/203 passed, zero skipped |
| TypeScript and strict focused client/logic/harness ESLint | Passed |
| Timeout-bounded production build and artifact validation | Passed |
| Household authorization SQL | Both DO assertions passed in rollback transaction |
| Local database lint and advisors | No warning/error findings, with documented pg_cron prerequisite |
| Git staged/unstaged whitespace | Passed |
| Broader strict lint of three existing server handlers | Still fails: 203 errors, 2 warnings; not waived |

Browser evidence uses real HTTP/database responses, not response fixtures. Tested
parent at 1440px and child at 390px, with zero page errors, no horizontal overflow
and no external requests. Login, Today, event details, chores, meals and groceries
loaded. Child chore completion was read back by the parent; grocery checkoff was
shared; a parent's saved meal edit appeared in the child session. Synthetic chores
and groceries were reopened afterward through authorized actions, retaining audits.
The current app has a Today event agenda and event details, not a separate full
calendar navigation screen. Apple Health, email, external Calendar delivery, real
voice recognition, physical-device testing and automatic-menu quality are not
verified by this restoration. Do not describe them as working integrations.

The forward migration SHA-256 is
`6d623514bd33a5af626002b84f0e70268df12e17106ed0a0faff6f1d66412b64`;
rollback SHA-256 is
`0f3ba132d771f27b2e90d8fe03754b59bde91ce1980dc1672740016ffee3d0e1`.
Baseline/restored schema hash:
`180c64d485aabaaf697e57ea704c2eb3f6ef912199c135a8b7144975d11d365e`.
Baseline/restored data hash:
`a3b6c8a6f2745ef79151d90a3701e1538cca5dc5e8990731d4fc8a2845a4ae76`.
The local clean chain, fixtures and lint are not a production schema inspection.

## Readiness decisions

**Local app testing: READY with the stated offline limitations.** The preview is
kept running deliberately. Data changes persist in the disposable local database.

**External Google sandbox: NOT READY.** A fresh offline reproduction starts an OAuth
state, revokes its initiating member session, and invokes the callback with dummy
code. The callback reaches the rejected token-exchange double and returns
`oauth_exchange_failed`, rather than rejecting authorization before exchange.
No active connection is created in this test, but callback state is not bound to
and revalidated against the initiating active session/member. Fix that security
boundary and add database-backed revocation tests before real OAuth. This turn
does not repair or weaken it, or initiate an external run.

**Family beta release: NOT READY.** In addition to callback revocation, resolve or
explicitly review broader strict server lint, complete remaining workflow/device
coverage, and run a separately authorized sandbox against the resulting fingerprint.

The earlier whole-release rollback differences remain real: compensating writes
append task-ledger/state-change audit entries, advance sequences and update
responsibility timestamps. They must not be deleted to manufacture matching hashes.
They do not block disposable local or sandbox testing, but exact production rollback
requires a reviewed backup/restore or compensating-rollback policy. The recurring
chore rollback deliberately refuses once successor occurrences exist. The exact
forward-migration rollback tested here does not prove whole-release exact rollback.

No commit, push, deployment, real OAuth, Google/Gmail/AEGIS or production access
occurred. Public package installation is tooling setup, not external sandbox testing.

## Preserved boundaries

Base: `d555fee1c4b5a9ade0d48c4d64b2fcd064207406`.
Config index blob: `5f5ec76724c596fc76c7ff05ea9cfc4e33ea367e`.
Working-config SHA-256:
`aed6555f9ed5dd8a83f4d2bc7c93ec02688b237cca80f89d57ca5e5d64fe64d6`.
Both original intentional overlaps remain: config's unfinished Gmail stanza and
CSS's unrelated health-setup deletion. Gmail, multi-member email and unrelated iOS
work remain unstaged. The final machine-readable candidate fingerprint is retained
in `pepper-restoration/final-fingerprint.json`; no self-referential patch hash is
embedded in this staged document.
