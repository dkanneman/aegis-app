# Pepper product roadmap

Canonicalized: 2026-09-03

Status: Product and engineering roadmap for Pepper after the V6 family vertical slice.

Related requirements: [V6 convergence audit](./v6-convergence-requirements.md) and [V6 family vertical slice contract](./v6-family-vertical-slice.md).

## Product position

Pepper is not a better-looking family calendar. Pepper is the family coordination system that notices and closes loops the family would otherwise have to carry.

> Pepper detects what the family needs, determines who owns it, helps resolve conflicts, updates everyone affected, and verifies that the outcome was handled.

Calendars, chores, meals, projects, health, and lists are supporting infrastructure. They are not the product advantage.

## Differentiating system

### Notice

- Read connected calendars, email, school notices, documents, and direct family input.
- Detect schedule changes, missing drivers, deadlines, conflicts, exceptions, and unassigned work.
- Normalize evidence into One Brain without creating duplicate tasks or events.

### Resolve

- Open an attention item and resolve it in place.
- Assign an owner or driver under household permissions.
- Choose between conflicting commitments.
- Draft or send an approved cancellation or coordination message.
- Update every affected schedule, task, and family-member view.

### Remember accurately

- Keep One Brain as canonical family state.
- Distinguish planned, assigned, on hold, completed, cancelled, and deleted.
- Preserve actor, source, decision, and completion evidence.
- Make consequential changes recoverable and auditable.

### Respect boundaries

- Adults administer the household and protected external actions.
- Children and teenagers manage only their permitted work and information.
- Health, email, goals, reflections, and private tasks remain member-scoped.
- Trust rules define what Pepper may handle automatically and what requires approval.

### Present decisions

- Lead with the one decision or action that matters now.
- Keep routine, handled, and historical information quiet.
- Avoid permanent dashboard boxes and duplicate calendar/task summaries.
- Do not display an alert unless the user can resolve it from that alert.

## Proof scenario

The first defensible Pepper experience must execute this sequence reliably:

1. Read a school message announcing a minimum day.
2. Match it to the correct child and school.
3. Replace the normal dismissal time without creating a duplicate.
4. Detect that the existing driver is unavailable.
5. Show one actionable alert.
6. Recommend an available authorized adult.
7. Assign the ride after any required approval.
8. Update Home, Calendar, the child's page, and the driver's page.
9. Notify the affected people.
10. Record the resolution and verify that it remains synchronized.

This is the reference acceptance flow for intake, reasoning, permissions, action, propagation, and evidence.

## Build order

1. **Identity and permissions**
   Replace profile-name and household-PIN access with individual authenticated accounts, revocable device sessions, recovery, and enforceable adult/teen/child roles.

2. **Connection reliability**
   Make Google Calendar, Apple Calendar, Gmail, Outlook, and school-source connections observable, recoverable, and honest about their current state.

3. **Canonical intake**
   Convert email, calendar, document, and direct input into reviewable One Brain evidence with source provenance and duplicate prevention.

4. **Coordination intelligence**
   Detect conflicts, missing ownership, transportation gaps, schedule exceptions, dependencies, and preparation needs from canonical state.

5. **Protected resolution**
   Add in-place recommended actions, household trust rules, approved external communication, undo, and evidence-backed handled receipts.

6. **Propagation and notification**
   Update every affected view within seconds and notify only the people whose plans or responsibilities changed.

7. **Native iPhone foundation**
   Add push notifications, background refresh, secure offline state, deep links, and native sign-in. Extend the current read-only HealthKit bridge with deliberate background refresh after the family validates its privacy and usefulness.

8. **Meals and groceries loop**
   Generate plans from dietary needs and schedules, derive the grocery list, assign purchasing and preparation, and track completion.

9. **Personal guidance**
   Generate each person's morning briefing and evening reflection from verified private and shared state, not generic prose or unverified assumptions.

## Work to stop

- Do not add unfinished tabs or disconnected feature demonstrations.
- Do not expand feature breadth while visible actions remain nonfunctional.
- Do not perform another visual redesign before the coordination loop is reliable.
- Do not describe provider authorization as a completed integration.
- Do not show information Pepper cannot help resolve.
- Do not create parallel stores, inboxes, calendars, or task systems outside One Brain.
- Do not expose Aegis as a competing user-facing product name.

## Family beta exit criteria

Pepper can expand beyond the initial household only when:

- Five individual accounts authenticate and recover correctly on physical iPhones.
- Authorized changes propagate to every affected account within five seconds.
- No private member data appears to an unauthorized household member.
- Duplicate task and event creation remains below one percent of ingested records and every duplicate is recoverable.
- Expired or revoked provider authorization produces a clear recovery path.
- Every visible command performs a real persisted action or is removed.
- External actions require the correct approval and retain a receipt.
- A seven-day household test completes without lost edits, false completion, missed school or transportation changes, or manual database repair.

## Product measure

The primary measure is not engagement or items entered. It is verified family coordination completed without one person having to notice, assign, remind, and check the work manually.
