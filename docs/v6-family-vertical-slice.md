# V6 family vertical slice contract

## Journey

`Pepper Home -> Family -> member -> item -> assign owner/driver -> complete or cancel -> One Brain projections -> refreshed Home, Family, member, Week, and Ahead views`

## Canonical mutation rules

| Item | Read permission | Assignment permission | Status permission | Canonical effects |
| --- | --- | --- | --- | --- |
| Household task | Same household | Adult or adult admin | Adult/admin, owner, or creator | Update task, responsibility, state change, audit, home-brain task ledger |
| Private task | Owner or creator only | Owner/creator; adult cannot inspect another member's private task | Owner or creator | Same projections without revealing content |
| Household event | Same household | Adult/admin; driver must be an adult in household | Adult/admin | Update event, transportation responsibility, state change, audit, consequences on next engine pass |
| Private event | Event owner only | Event owner and adult/admin | Event owner and adult/admin | Same projections without household disclosure |

All mutations use a validated `x-pepper-session`, an explicit household predicate, exact target status, and database transaction. Actor context is set before the canonical write so downstream One Brain triggers retain who made the change.

## View contract

- Home shows no more than the next useful layer: Needs You, Now, Next, Pepper Noticed, then progressive detail.
- Family always shows Danielle, Matt, Chloe, Lyra, and Posey from canonical household membership.
- A member page combines member-specific canonical events, assigned tasks, chores, activities, and transportation.
- Other members' private rows never appear on a member page.
- Item actions remain available from Home and member pages and return the same canonical result.
- After a successful mutation Pepper refetches both household state and the open member view.
- Calendar-derived records identify Calendar as evidence; Pepper status/ownership remains canonical.

## Acceptance data

The non-production dataset must include:

- All five family members with the production role shape.
- One household chore assigned to a child.
- One unassigned household task.
- One member-private task that is invisible to other members.
- One school or activity event with an unassigned driver.
- One calendar-derived event.
- One completed item and one canceled item.
- At least one event with a valid start/end window and one canonical consequence/responsibility projection.

## Out of scope

- Renaming the canonical `elle` identity to Danielle.
- Writing status changes back to Google Calendar.
- Full school calendar ingestion, onboarding, meals, or messaging redesign.
- Direct browser access to HealthKit. The preview uses an explicit iPhone Shortcut/companion export into member-scoped daily metrics.
- Gmail message ingestion and reasoning. This slice exposes a read-only connection pathway only; future email evidence must reconcile into One Brain rather than become a second inbox.
- Protected Outcomes, household-configurable Trust Rules, completion-evidence receipts, and automated recovery.
- Full Project navigation and automation. Project metadata is preserved for the next continuity slice.
- Production migration, function deployment, or branch merge.
