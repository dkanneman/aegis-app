export type ActionMode = "complete" | "progress" | "today_only";
export type ActionStatus = "open" | "done" | "progress";

export type AegisPermissions = {
  approvalBeforeExternalAction: true;
  connectedCalendar: false;
  connectedEmail: false;
  sensitiveAreasEnabled: string[];
  sourceMode: "manual";
};

export type ProfileInput = {
  displayName: string;
  timezone: string;
  heart: string[];
  compass: string[];
  areas: string[];
  people: string[];
  roles: string[];
  activities: string[];
  currentPressure: string;
  sevenDayCommitments: string;
  fearOfForgetting: string;
  permissions: AegisPermissions;
  onboardingStep: number;
};

export type Profile = ProfileInput & {
  onboardingCompletedAt: string | null;
  updatedAt: string;
};

export type AegisAction = {
  id: string;
  planId: string;
  position: number;
  title: string;
  area: string;
  why: string;
  mode: ActionMode;
  status: ActionStatus;
  progressCount: number;
  sourceType: "manual";
  sourceLabel: string;
  completedAt: string | null;
  updatedAt: string;
};

export type DailyPlan = {
  id: string;
  planDate: string;
  status: "active" | "closed";
  summary: string;
  createdAt: string;
  updatedAt: string;
  actions: AegisAction[];
};

export type AuditEvent = {
  id: number;
  entityType: "action" | "plan" | "profile";
  entityId: string;
  eventType: string;
  undoneAt: string | null;
  createdAt: string;
};

export type AegisState = {
  profile: Profile | null;
  plan: DailyPlan | null;
  audit: AuditEvent[];
};

export const DEFAULT_PERMISSIONS: AegisPermissions = {
  approvalBeforeExternalAction: true,
  connectedCalendar: false,
  connectedEmail: false,
  sensitiveAreasEnabled: [],
  sourceMode: "manual",
};
