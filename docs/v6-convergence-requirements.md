# Pepper V6 convergence audit

Audit date: 2026-09-01

Implementation branch: `codex/v6-pepper-family-slice`, based on the canonical V6 commit `19c3393` (`v6-logistics-foundation`).

## System boundary

| Layer | Canonical role | Decision |
| --- | --- | --- |
| V6 Supabase / One Brain | Household identity, family state, events, tasks, responsibilities, consequences, captures, audit history, calendar evidence | Canonical read/write system |
| Pepper | Consumer-facing family concierge | Visible product and only user-facing name |
| Aegis | Reasoning, consequence detection, reconciliation, and planning intelligence | Background capability, not a user destination |
| Google Calendar | Connected evidence and optional outbound sync | Input/output layer; never authoritative family state |
| Alpha Foundation | Approved visual language and interaction experiments | Reference implementation only |
| Alpha D1 and bridge snapshots | Prototype persistence and transfer mechanism | Discard as canonical state |

## Requirements matrix

| Requirement | Evidence in V6 / production | Alpha evidence | Gap or duplication | Slice decision |
| --- | --- | --- | --- | --- |
| One Brain is canonical | Supabase `events`, `tasks`, `responsibilities`, `state_changes`, captures, and audit tables are live | Alpha maintains a separate D1-shaped state | Duplicate state can diverge | Read and mutate Supabase only |
| Pepper visible, Aegis behind it | V6 `/pepper` and Edge APIs already use Pepper naming | Alpha exposes some Aegis/Central Brain language | Product naming is inconsistent | Keep Pepper in UI; keep Aegis internal |
| Five family members | Production has Elle/Danielle, Matt, Chloe, Lyra, Posey with adult/teen/child roles | Alpha hard-codes five members | V6 UI has login choices but no roster or member pages | Add a canonical roster and member drill-downs; display Elle as Danielle in the family experience without changing identity data |
| Household permissions | Custom member sessions and RLS protect household/private rows | Prototype controls are local | Alpha cannot enforce privacy | All reads and writes pass a validated family session and explicit household/private checks |
| Family-state entities | Household members, events, tasks, meals, groceries, reflections, locations, relationships, responsibilities, decisions, state changes, consequences, routines, future watch, preparation, captures | Events, tasks, chores, health, school, intake, connections are represented as page-local state | Alpha duplicates canonical entities and adds uncoupled ones | Use V6 entities; classify chores by canonical task fields; activities/transport by event fields |
| Natural-language update loop | `pepper-tell-v2` preserves raw capture, plans writes, reconciles or requests review | Alpha composer sends updates to a bridge/API | Both surfaces exist but only V6 is transactional | Retain V6 Tell Pepper composer |
| Assignment propagation | V6 triggers project event/task changes into responsibilities and state changes | Alpha owner/driver controls update prototype state | V6 UI cannot invoke assignment | Add server-authorized task owner and event driver mutations; reload all affected views |
| Complete and cancel | Canonical task/event status constraints and projections support both | Alpha supports cancel/complete in selected views | V6 task UI only toggles complete and events are read-only | Add exact complete, cancel, reopen/restore actions |
| Member schedules and activities | Events and horizon expose `person_slug`, time, kind, location, source, transport owner | Alpha family/week and school logistics views | No V6 member page | Build member page from events plus horizon data |
| Chores | Universal task fields support area, classification, recurrence, tags, notes, next action | Alpha has a dedicated chore experience | No canonical chore table is needed | Treat recurring Home/Family tasks or chore-tagged tasks as chores |
| Transportation | Event transport owner/status, responsibilities, consequence engine, horizon readiness | Alpha driver selector and school logistics cards | Alpha owns transport state separately | Rebuild controls against canonical events |
| Calendar connection | Google OAuth, connection metadata, sync runs, calendar-derived events, refresh UI | Alpha connection/intake pages | Alpha overstates connection as canonical | Keep connection status/refresh; label Calendar as evidence |
| Email connection | V6 capture/reconciliation can accept evidence, but production Gmail intake is not yet a complete user workflow | Alpha connection/intake concepts | Connection status and derived family state can drift if email becomes a second inbox | Add an honest Gmail connection path; future ingestion must create reviewable One Brain changes, not an inbox clone |
| Conflict checks | Consequence engine detects person/driver conflicts and missing transport; horizon promotes readiness | Alpha computes some warnings locally | Duplicate inference is possible | Render One Brain consequences; do not reimplement them in React |
| Privacy | Private tasks/events/reflections/captures are member-scoped | Alpha has no durable household enforcement | Prototype privacy is cosmetic | Exclude other members' private rows even on family member pages |
| Home hierarchy | V6 has Today, attention, preparation, Now/Next, weekly insight | Alpha has command-center hierarchy and many dashboard counters | Both are busy and partly duplicate information | Keep Now, Next, Needs You, Pepper Noticed; remove metric-first emphasis |
| Progressive disclosure | V6 uses details panels and horizon views | Alpha drawers/member detail affordances | Event/task details are not actionable in V6 | Use one detail sheet/panel per selected item |
| Visual system | V6 has an older blue/ivory CSS theme | Alpha contains approved tokens, atmosphere interpolation, and responsive primitives | Two palettes and card systems | Port tokens/atmosphere, rebuild components, keep semantic colors stable |
| Time-of-day light | Not present in canonical V6 | Alpha has smooth local-time interpolation and a developer scrubber | Dev scrubber obstructed real beta use | Port atmosphere engine; keep scrubber out of the user build |
| Responsive family use | Existing V6 is responsive but single-column | Alpha includes phone-oriented controls and member pages | Deep actions need mobile ergonomics | Use full-width rows on phone and split member layout on desktop |
| Accessibility | Existing native controls and labels; no complete audit | Alpha specifies contrast/reduced motion | Visual acceptance is incomplete | Preserve labels/focus, add non-color status text, verify contrast and mobile layout |
| School logistics | V6 supports routines/events/transport but lacks full 2026-27 source normalization | Alpha contains seeded school schedules and exception concepts | Alpha data must not become a second calendar | Retain as reference until imported into canonical events/routines |
| Health and intake | Preview adds member-scoped connection state and normalized daily step/goal/activity metrics | Alpha contains Apple Health/intake prototypes | A browser cannot read HealthKit directly and Alpha state is not canonical | Rebuild as explicit iPhone HealthKit export into Supabase; show health only where it changes the member's day |
| Projects continuity | Universal task fields include `project`, area, next action, dependencies, tags, and recurrence | Alpha and earlier product notes treat individual/shared Projects as core | Current member pages expose task titles but not Project context or a Project destination | Preserve the fields in this slice; build canonical private/shared Project continuity next rather than flattening Projects into tasks |

## V6 product-law coverage

| V6 note | Current evidence | Required treatment |
| --- | --- | --- |
| Pepper is an assistant, not a planner | Tell Pepper, consequences, preparation, and rituals exist | Keep Home focused on decisions and next actions |
| Answer before information | Home leads with consequence/next-event summary | Preserve; member pages may expose detail after selection |
| No lists by default; roughly three useful items | Today currently exposes many equally weighted sections | Remove metric-first modules and keep secondary lists behind Family/details |
| No metrics unless they change a decision | Existing At a Glance counts do not change a decision | Removed from the primary Home flow |
| Empty states disappear | Several V5 cards render generic empty content | Family sections use concise empty rows; further Home cleanup remains |
| Every warning has a response | Consequence cards are informative only | Item-related warnings now open owner/driver controls; other consequence response mapping remains later work |
| Details are pulled, not pushed | Existing `details` and Alpha drawers | Rebuild as member and item action sheets |
| Conversation is the primary control | Tell Pepper composer is fixed and always available | Retain unchanged |
| Every event has a real start/end window | Two production events lack `ends_at` | Do not invent history; require ends for new structured events and repair separately |
| Location and travel time belong to scheduling | Locations and consequence model exist; travel duration is incomplete | Show locations; travel-time reasoning remains a follow-up |
| Routine chores stay quiet; exceptions surface | Routines and universal task recurrence exist | Classify chores canonically and keep handled/routine work secondary |
| Everything shown is actionable | Existing event rows were read-only | Event/task rows now open owner/status actions |
| Email creates state changes, not an inbox | Preview has a read-only Gmail OAuth pathway but no message ingestion worker | Keep the connection honest; the next email slice must reconcile evidence into One Brain without exposing a duplicate inbox |
| Ahead shows exceptions and preparation | Horizon and preparation services exist | Preserve Ahead; do not turn it into a calendar dump |
| Pepper answers “Can this actually work?” | Consequence engine detects person/driver conflicts | Render its result; do not duplicate conflict logic in React |
| Captures append first, then reconcile | One Brain capture plan and review functions exist | Preserve transactional path and actor/capture provenance |
| Build order: One Brain, event reality, logistics, experience | One Brain and logistics foundations exist | This slice is the first experience built on those foundations |
| Calendar is provider evidence with local lifecycle override | Calendar ingestion exists; local override is incomplete | Keep Google non-canonical and avoid claiming provider changes were written back |
| Preparation loop is notice, decide, recommend, act, remember | Preparation action/handled state exists | Preserve current preparation actions |
| Source/freshness may be shown; raw confidence should not | Horizon data contains confidence internally | Show Calendar evidence/source, never raw confidence scores |
| Ambiguous updates remain private and reviewable | Capture review path is member-scoped | Preserve review workflow and do not fabricate records |

## Working production capability inventory

- Custom five-member PIN sessions and member-scoped private data.
- Canonical One Brain capture reconciliation with idempotency, review, actor, and capture provenance.
- Current-day family events, household/private tasks, groceries, reflections, meals, and recent change history.
- Calendar OAuth/status/manual refresh and calendar-derived event evidence.
- Thirty-day horizon, family routines, future watch, preparation, weekly insight, morning/evening rituals.
- Transportation ownership, responsibility projection, conflict/missing-driver consequences, and state-change audit.
- Universal task organizer fields and append-only home-brain task export ledger in production.

## Alpha disposition

| Alpha component | Classification | Reason |
| --- | --- | --- |
| Canonical color tokens | **port** | Approved visual foundation and reusable across V6 |
| Time-of-day interpolation engine | **port** | Pure presentation logic; no state duplication |
| Time-zone-aware atmosphere application | **port** | Matches California-local experience and visual brief |
| Icon-button and segmented-control patterns | **port** | Improves mobile action clarity |
| Responsive row/list primitives | **port** | Appropriate for repeated family actions |
| Home command hierarchy | **rebuild** | Good intent, but must read canonical priorities and avoid dashboard density |
| Family roster/member pages | **rebuild** | Interaction is approved; data and permissions must come from One Brain |
| Owner selector | **rebuild** | Must enforce canonical household roles and persist server-side |
| Driver selector | **rebuild** | Must allow adults only and trigger canonical consequences/projections |
| Task/chore directory | **rebuild** | Must use universal task fields rather than Alpha categories |
| Calendar views | **rebuild** | Calendar evidence must be merged into canonical family reality |
| Item detail drawer | **rebuild** | Approved progressive disclosure, but actions must be canonical |
| Connection status/intake | **rebuild** | Connection state must be read from secure provider records |
| School logistics presentation | **retain only as reference** | Useful model, but seeded prototype data is not canonical |
| Family week visual layout | **retain only as reference** | Useful composition; current V6 horizon should supply the data |
| Apple Health/intake screens | **rebuild** | Use member-scoped connection state and normalized daily metrics; do not copy Alpha's local state |
| Developer time scrubber | **retain only as reference** | Development tool only; excluded from private beta UI |
| Onboarding/Compass/Heart visuals | **retain only as reference** | Outside the current vertical slice |
| Alpha D1 state | **discard** | Parallel source of truth |
| Bridge snapshot as live app state | **discard** | Transfer mechanism, not runtime authority |
| Visible Central Brain page | **discard** | Aegis should remain background intelligence |
| Dashboard stat tiles and duplicated lists | **discard** | Violates V6 answer-first, low-administration product laws |
| Hard-coded family schedules as UI constants | **discard** | Family reality must come from canonical records |

## Audit findings

1. **Critical convergence gap:** the canonical repository was missing five production migration versions, and its One Brain migration has a different version stamp than production. This branch restores the three universal-task/home-brain migrations required by the slice. The older session seed and internal product-ops migration still need a controlled history reconciliation before a clean database replay.
2. **High privacy gap:** six `private` runtime tables have RLS disabled. Direct anon/authenticated grants are not currently present, but RLS should still be enabled as defense in depth.
3. **High interaction gap:** V6 renders events and tasks but lacks a complete assignment/status workflow.
4. **High projection gap:** the existing task checkbox path uses a privileged update instead of a single explicit item-mutation contract with actor context.
5. **Medium data gap:** two production events have no `ends_at`; V6 product law requires complete event windows, but the build must not invent historical end times.
6. **Medium UX duplication:** Today includes ritual, Now/Next, attention, preparation, metrics, tasks, groceries, captures, and insight at equal visual weight.
7. **Medium naming gap:** the canonical member slug/display value is Elle while current product usage calls the adult Danielle. The slice uses a display alias only; an identity migration needs a separate reviewed decision.

## Projects and Connections review cross-check

The earlier Projects/Connections product review remains useful when treated as a constraint on V6 rather than a competing roadmap.

| Earlier idea | Current slice | Decision |
| --- | --- | --- |
| Connections are directly reachable and easy to understand | Calendar, Gmail, and Apple Health have one Connections surface with honest configured/connected states | **Keep now.** Do not imply that Google is configured until preview credentials exist |
| Connection detail explains owner, privacy, coverage, authority, and last sync | Current rows disclose owner, privacy, coverage, readable data, automatic behavior, and approval boundaries | **Keep now.** Disconnect and editable authority presets remain next, after OAuth is configured |
| Family Week is an operational plan, not a prose summary or duplicate calendar block | Next 7 renders canonical horizon days, preparation, and coordination issues | **Keep now.** Add member filters and recommended conflict resolutions next; Day/Month are calendar depth, not required for this slice |
| Projects and chores connect to schedules and ownership | Member pages combine events, tasks, chores, and transportation; task rows retain their Project label | **Partial.** Build Project destinations and shared/private Project continuity in the next slice |
| Routine work can proceed under standing Trust Rules | One Brain enforces permissions per mutation, but no household-configurable authority model exists | **Missing, high priority.** Build Trust Rules with the first protected-outcome workflow |
| “Handled” requires completion evidence and a safe Undo path | This slice records audit/state changes and supports restore; UI currently shows status, not a receipt | **Missing, high priority.** Build evidence-backed handled receipts before claiming autonomous completion |
| Calm Home remains valuable when nothing is urgent | Home has quiet empty states and next-event context | **Keep and verify.** Do not add Projects, Connections, or calendar grids as permanent Home widgets |
| Voice remains a primary input | Tell Pepper supports browser speech recognition with keyboard dictation fallback | **Keep.** Voice and text must enter the same capture/reconciliation path |

The next smallest product proof is not broader dashboard coverage. It is one protected family outcome flowing from connected evidence through ownership, authorized action, completion evidence, recovery, and a handled receipt.

Security remediation reference: [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security).
