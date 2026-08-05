import { generateFirstDay } from "./aegis-plan";
import type {
  AegisAction,
  AegisState,
  AuditEvent,
  DailyPlan,
  Profile,
  ProfileInput,
} from "./aegis-types";

type ProfileRow = {
  display_name: string;
  timezone: string;
  heart_json: string;
  compass_json: string;
  areas_json: string;
  people_json: string;
  roles_json: string;
  activities_json: string;
  current_pressure: string;
  seven_day_commitments: string;
  fear_of_forgetting: string;
  permissions_json: string;
  onboarding_step: number;
  onboarding_completed_at: string | null;
  updated_at: string;
};

type PlanRow = {
  id: string;
  plan_date: string;
  status: "active" | "closed";
  summary: string;
  created_at: string;
  updated_at: string;
};

type ActionRow = {
  id: string;
  plan_id: string;
  position: number;
  title: string;
  area: string;
  why: string;
  mode: "complete" | "progress" | "today_only";
  status: "open" | "done" | "progress";
  progress_count: number;
  source_type: "manual";
  source_label: string;
  completed_at: string | null;
  updated_at: string;
};

type AuditRow = {
  id: number;
  entity_type: "action" | "plan" | "profile";
  entity_id: string;
  event_type: string;
  before_json: string;
  after_json: string;
  undone_at: string | null;
  created_at: string;
};

type AegisD1Statement = {
  bind: (...values: unknown[]) => AegisD1Statement;
  first: <T = Record<string, unknown>>() => Promise<T | null>;
  all: <T = Record<string, unknown>>() => Promise<{ results: T[] }>;
  run: () => Promise<unknown>;
};

type AegisD1Database = {
  prepare: (query: string) => AegisD1Statement;
  batch: (statements: AegisD1Statement[]) => Promise<unknown[]>;
};

function db() {
  const database = (
    globalThis as typeof globalThis & { __AEGIS_D1__?: AegisD1Database }
  ).__AEGIS_D1__;
  if (!database) throw new Error("Aegis storage is not available.");
  return database;
}

let schemaReady: Promise<void> | null = null;

function ensureAegisSchema() {
  if (schemaReady) return schemaReady;
  const database = db();
  schemaReady = database
    .batch([
      database.prepare(`CREATE TABLE IF NOT EXISTS aegis_profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_email TEXT NOT NULL,
        display_name TEXT NOT NULL DEFAULT '',
        timezone TEXT NOT NULL DEFAULT 'UTC',
        heart_json TEXT NOT NULL DEFAULT '[]',
        compass_json TEXT NOT NULL DEFAULT '[]',
        areas_json TEXT NOT NULL DEFAULT '[]',
        people_json TEXT NOT NULL DEFAULT '[]',
        roles_json TEXT NOT NULL DEFAULT '[]',
        activities_json TEXT NOT NULL DEFAULT '[]',
        current_pressure TEXT NOT NULL DEFAULT '',
        seven_day_commitments TEXT NOT NULL DEFAULT '',
        fear_of_forgetting TEXT NOT NULL DEFAULT '',
        permissions_json TEXT NOT NULL DEFAULT '{}',
        onboarding_step INTEGER NOT NULL DEFAULT 0,
        onboarding_completed_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      database.prepare(
        "CREATE UNIQUE INDEX IF NOT EXISTS aegis_profiles_user_email_unique ON aegis_profiles (user_email)",
      ),
      database.prepare(`CREATE TABLE IF NOT EXISTS aegis_daily_plans (
        id TEXT PRIMARY KEY NOT NULL,
        user_email TEXT NOT NULL,
        plan_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        summary TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      database.prepare(
        "CREATE UNIQUE INDEX IF NOT EXISTS aegis_daily_plans_user_day_unique ON aegis_daily_plans (user_email, plan_date)",
      ),
      database.prepare(
        "CREATE INDEX IF NOT EXISTS aegis_daily_plans_owner_idx ON aegis_daily_plans (user_email)",
      ),
      database.prepare(`CREATE TABLE IF NOT EXISTS aegis_actions (
        id TEXT PRIMARY KEY NOT NULL,
        plan_id TEXT NOT NULL,
        user_email TEXT NOT NULL,
        position INTEGER NOT NULL,
        title TEXT NOT NULL,
        area TEXT NOT NULL,
        why TEXT NOT NULL,
        mode TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        progress_count INTEGER NOT NULL DEFAULT 0,
        source_type TEXT NOT NULL DEFAULT 'manual',
        source_label TEXT NOT NULL,
        completed_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      database.prepare(
        "CREATE INDEX IF NOT EXISTS aegis_actions_owner_plan_idx ON aegis_actions (user_email, plan_id)",
      ),
      database.prepare(`CREATE TABLE IF NOT EXISTS aegis_audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_email TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        before_json TEXT NOT NULL,
        after_json TEXT NOT NULL,
        undone_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      database.prepare(
        "CREATE INDEX IF NOT EXISTS aegis_audit_owner_created_idx ON aegis_audit_events (user_email, created_at)",
      ),
      database.prepare(
        "CREATE INDEX IF NOT EXISTS aegis_audit_entity_idx ON aegis_audit_events (user_email, entity_type, entity_id)",
      ),
    ])
    .then(() => undefined)
    .catch((error) => {
      schemaReady = null;
      throw error;
    });
  return schemaReady;
}

function jsonArray(value: string) {
  try {
    const result = JSON.parse(value);
    return Array.isArray(result) ? result.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function jsonObject<T>(value: string, fallback: T): T {
  try {
    const result = JSON.parse(value);
    return result && typeof result === "object" ? (result as T) : fallback;
  } catch {
    return fallback;
  }
}

function profileFromRow(row: ProfileRow): Profile {
  return {
    displayName: row.display_name,
    timezone: row.timezone,
    heart: jsonArray(row.heart_json),
    compass: jsonArray(row.compass_json),
    areas: jsonArray(row.areas_json),
    people: jsonArray(row.people_json),
    roles: jsonArray(row.roles_json),
    activities: jsonArray(row.activities_json),
    currentPressure: row.current_pressure,
    sevenDayCommitments: row.seven_day_commitments,
    fearOfForgetting: row.fear_of_forgetting,
    permissions: jsonObject(row.permissions_json, {
      approvalBeforeExternalAction: true,
      connectedCalendar: false,
      connectedEmail: false,
      sensitiveAreasEnabled: [],
      sourceMode: "manual",
    }),
    onboardingStep: row.onboarding_step,
    onboardingCompletedAt: row.onboarding_completed_at,
    updatedAt: row.updated_at,
  };
}

function actionFromRow(row: ActionRow): AegisAction {
  return {
    id: row.id,
    planId: row.plan_id,
    position: row.position,
    title: row.title,
    area: row.area,
    why: row.why,
    mode: row.mode,
    status: row.status,
    progressCount: row.progress_count,
    sourceType: row.source_type,
    sourceLabel: row.source_label,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
  };
}

function auditFromRow(row: AuditRow): AuditEvent {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    eventType: row.event_type,
    undoneAt: row.undone_at,
    createdAt: row.created_at,
  };
}

export async function getAegisState(userEmail: string): Promise<AegisState> {
  await ensureAegisSchema();
  const database = db();
  const profileRow = await database
    .prepare("SELECT * FROM aegis_profiles WHERE user_email = ? LIMIT 1")
    .bind(userEmail)
    .first<ProfileRow>();

  if (!profileRow) return { profile: null, plan: null, audit: [] };

  const planRow = await database
    .prepare(
      "SELECT * FROM aegis_daily_plans WHERE user_email = ? ORDER BY plan_date DESC, created_at DESC LIMIT 1",
    )
    .bind(userEmail)
    .first<PlanRow>();

  let plan: DailyPlan | null = null;
  if (planRow) {
    const actionResult = await database
      .prepare(
        "SELECT * FROM aegis_actions WHERE user_email = ? AND plan_id = ? ORDER BY position ASC",
      )
      .bind(userEmail, planRow.id)
      .all<ActionRow>();
    plan = {
      id: planRow.id,
      planDate: planRow.plan_date,
      status: planRow.status,
      summary: planRow.summary,
      createdAt: planRow.created_at,
      updatedAt: planRow.updated_at,
      actions: actionResult.results.map(actionFromRow),
    };
  }

  const auditResult = await database
    .prepare(
      "SELECT * FROM aegis_audit_events WHERE user_email = ? ORDER BY id DESC LIMIT 12",
    )
    .bind(userEmail)
    .all<AuditRow>();

  return {
    profile: profileFromRow(profileRow),
    plan,
    audit: auditResult.results.map(auditFromRow),
  };
}

function profileStatement(
  database: ReturnType<typeof db>,
  userEmail: string,
  profile: ProfileInput,
  completedAt: string | null,
) {
  return database
    .prepare(
      `INSERT INTO aegis_profiles (
        user_email, display_name, timezone, heart_json, compass_json, areas_json,
        people_json, roles_json, activities_json, current_pressure,
        seven_day_commitments, fear_of_forgetting, permissions_json,
        onboarding_step, onboarding_completed_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_email) DO UPDATE SET
        display_name = excluded.display_name,
        timezone = excluded.timezone,
        heart_json = excluded.heart_json,
        compass_json = excluded.compass_json,
        areas_json = excluded.areas_json,
        people_json = excluded.people_json,
        roles_json = excluded.roles_json,
        activities_json = excluded.activities_json,
        current_pressure = excluded.current_pressure,
        seven_day_commitments = excluded.seven_day_commitments,
        fear_of_forgetting = excluded.fear_of_forgetting,
        permissions_json = excluded.permissions_json,
        onboarding_step = excluded.onboarding_step,
        onboarding_completed_at = COALESCE(excluded.onboarding_completed_at, aegis_profiles.onboarding_completed_at),
        updated_at = excluded.updated_at`,
    )
    .bind(
      userEmail,
      profile.displayName,
      profile.timezone,
      JSON.stringify(profile.heart),
      JSON.stringify(profile.compass),
      JSON.stringify(profile.areas),
      JSON.stringify(profile.people),
      JSON.stringify(profile.roles),
      JSON.stringify(profile.activities),
      profile.currentPressure,
      profile.sevenDayCommitments,
      profile.fearOfForgetting,
      JSON.stringify(profile.permissions),
      profile.onboardingStep,
      completedAt,
      new Date().toISOString(),
    );
}

export async function saveProfileDraft(userEmail: string, profile: ProfileInput) {
  await ensureAegisSchema();
  await profileStatement(db(), userEmail, profile, null).run();
  return getAegisState(userEmail);
}

export async function completeOnboarding(
  userEmail: string,
  profile: ProfileInput,
  planDate: string,
) {
  await ensureAegisSchema();
  const database = db();
  const now = new Date().toISOString();
  await profileStatement(database, userEmail, { ...profile, onboardingStep: 7 }, now).run();

  const existingPlan = await database
    .prepare(
      "SELECT id FROM aegis_daily_plans WHERE user_email = ? AND plan_date = ? LIMIT 1",
    )
    .bind(userEmail, planDate)
    .first<{ id: string }>();

  if (!existingPlan) {
    const planId = crypto.randomUUID();
    const actions = generateFirstDay(profile);
    const statements = [
      database
        .prepare(
          "INSERT INTO aegis_daily_plans (id, user_email, plan_date, status, summary, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?, ?)",
        )
        .bind(
          planId,
          userEmail,
          planDate,
          "Three protected outcomes chosen from your current reality, near-term commitments, and Heart.",
          now,
          now,
        ),
    ];

    actions.forEach((action, position) => {
      statements.push(
        database
          .prepare(
            `INSERT INTO aegis_actions (
              id, plan_id, user_email, position, title, area, why, mode, status,
              progress_count, source_type, source_label, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', 0, 'manual', ?, ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            planId,
            userEmail,
            position,
            action.title,
            action.area,
            action.why,
            action.mode,
            action.sourceLabel,
            now,
            now,
          ),
      );
    });

    statements.push(
      database
        .prepare(
          "INSERT INTO aegis_audit_events (user_email, entity_type, entity_id, event_type, before_json, after_json, created_at) VALUES (?, 'plan', ?, 'first_day_created', '{}', ?, ?)",
        )
        .bind(userEmail, planId, JSON.stringify({ outcomeCount: 3 }), now),
    );
    await database.batch(statements);
  }

  return getAegisState(userEmail);
}

export async function updateOwnedAction(
  userEmail: string,
  actionId: string,
  input: {
    operation: "edit" | "apply";
    title?: string;
    mode?: "complete" | "progress" | "today_only";
  },
) {
  await ensureAegisSchema();
  const database = db();
  const before = await database
    .prepare("SELECT * FROM aegis_actions WHERE id = ? AND user_email = ? LIMIT 1")
    .bind(actionId, userEmail)
    .first<ActionRow>();
  if (!before) throw new Error("Action not found.");

  const now = new Date().toISOString();
  const mode = input.mode ?? before.mode;
  const title = input.title?.trim() || before.title;
  let status = before.status;
  let progressCount = before.progress_count;
  let completedAt = before.completed_at;
  let eventType = "action_edited";

  if (input.operation === "apply") {
    status = mode === "progress" ? "progress" : "done";
    progressCount = mode === "progress" ? progressCount + 1 : progressCount;
    completedAt = now;
    eventType =
      mode === "progress"
        ? "progress_logged"
        : mode === "today_only"
          ? "today_only_logged"
          : "action_completed";
  }

  const after = {
    ...before,
    title,
    mode,
    status,
    progress_count: progressCount,
    completed_at: completedAt,
    updated_at: now,
  };

  await database.batch([
    database
      .prepare(
        "UPDATE aegis_actions SET title = ?, mode = ?, status = ?, progress_count = ?, completed_at = ?, updated_at = ? WHERE id = ? AND user_email = ?",
      )
      .bind(
        title,
        mode,
        status,
        progressCount,
        completedAt,
        now,
        actionId,
        userEmail,
      ),
    database
      .prepare(
        "INSERT INTO aegis_audit_events (user_email, entity_type, entity_id, event_type, before_json, after_json, created_at) VALUES (?, 'action', ?, ?, ?, ?, ?)",
      )
      .bind(
        userEmail,
        actionId,
        eventType,
        JSON.stringify(before),
        JSON.stringify(after),
        now,
      ),
  ]);

  return getAegisState(userEmail);
}

export async function undoOwnedAction(userEmail: string, actionId: string) {
  await ensureAegisSchema();
  const database = db();
  const event = await database
    .prepare(
      "SELECT * FROM aegis_audit_events WHERE user_email = ? AND entity_type = 'action' AND entity_id = ? AND undone_at IS NULL ORDER BY id DESC LIMIT 1",
    )
    .bind(userEmail, actionId)
    .first<AuditRow>();
  if (!event) throw new Error("Nothing is available to undo for this action.");

  const before = JSON.parse(event.before_json) as ActionRow;
  const now = new Date().toISOString();
  await database.batch([
    database
      .prepare(
        "UPDATE aegis_actions SET title = ?, mode = ?, status = ?, progress_count = ?, completed_at = ?, updated_at = ? WHERE id = ? AND user_email = ?",
      )
      .bind(
        before.title,
        before.mode,
        before.status,
        before.progress_count,
        before.completed_at,
        now,
        actionId,
        userEmail,
      ),
    database
      .prepare(
        "UPDATE aegis_audit_events SET undone_at = ? WHERE id = ? AND user_email = ?",
      )
      .bind(now, event.id, userEmail),
  ]);
  return getAegisState(userEmail);
}

export async function deleteAegisData(userEmail: string) {
  await ensureAegisSchema();
  const database = db();
  await database.batch([
    database.prepare("DELETE FROM aegis_audit_events WHERE user_email = ?").bind(userEmail),
    database.prepare("DELETE FROM aegis_actions WHERE user_email = ?").bind(userEmail),
    database.prepare("DELETE FROM aegis_daily_plans WHERE user_email = ?").bind(userEmail),
    database.prepare("DELETE FROM aegis_profiles WHERE user_email = ?").bind(userEmail),
  ]);
}

export async function exportAegisData(userEmail: string) {
  return {
    exportedAt: new Date().toISOString(),
    account: userEmail,
    ...(await getAegisState(userEmail)),
  };
}
