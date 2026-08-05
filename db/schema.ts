import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const aegisProfiles = sqliteTable(
  "aegis_profiles",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userEmail: text("user_email").notNull(),
    displayName: text("display_name").notNull().default(""),
    timezone: text("timezone").notNull().default("UTC"),
    heartJson: text("heart_json").notNull().default("[]"),
    compassJson: text("compass_json").notNull().default("[]"),
    areasJson: text("areas_json").notNull().default("[]"),
    peopleJson: text("people_json").notNull().default("[]"),
    rolesJson: text("roles_json").notNull().default("[]"),
    activitiesJson: text("activities_json").notNull().default("[]"),
    currentPressure: text("current_pressure").notNull().default(""),
    sevenDayCommitments: text("seven_day_commitments").notNull().default(""),
    fearOfForgetting: text("fear_of_forgetting").notNull().default(""),
    permissionsJson: text("permissions_json").notNull().default("{}"),
    onboardingStep: integer("onboarding_step").notNull().default(0),
    onboardingCompletedAt: text("onboarding_completed_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("aegis_profiles_user_email_unique").on(table.userEmail),
  ],
);

export const aegisDailyPlans = sqliteTable(
  "aegis_daily_plans",
  {
    id: text("id").primaryKey(),
    userEmail: text("user_email").notNull(),
    planDate: text("plan_date").notNull(),
    status: text("status").notNull().default("active"),
    summary: text("summary").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("aegis_daily_plans_user_day_unique").on(
      table.userEmail,
      table.planDate,
    ),
    index("aegis_daily_plans_owner_idx").on(table.userEmail),
  ],
);

export const aegisActions = sqliteTable(
  "aegis_actions",
  {
    id: text("id").primaryKey(),
    planId: text("plan_id").notNull(),
    userEmail: text("user_email").notNull(),
    position: integer("position").notNull(),
    title: text("title").notNull(),
    area: text("area").notNull(),
    why: text("why").notNull(),
    mode: text("mode").notNull(),
    status: text("status").notNull().default("open"),
    progressCount: integer("progress_count").notNull().default(0),
    sourceType: text("source_type").notNull().default("manual"),
    sourceLabel: text("source_label").notNull(),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("aegis_actions_owner_plan_idx").on(table.userEmail, table.planId),
  ],
);

export const aegisAuditEvents = sqliteTable(
  "aegis_audit_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userEmail: text("user_email").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    eventType: text("event_type").notNull(),
    beforeJson: text("before_json").notNull(),
    afterJson: text("after_json").notNull(),
    undoneAt: text("undone_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("aegis_audit_owner_created_idx").on(table.userEmail, table.createdAt),
    index("aegis_audit_entity_idx").on(
      table.userEmail,
      table.entityType,
      table.entityId,
    ),
  ],
);
