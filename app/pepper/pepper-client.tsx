"use client";

import type { CSSProperties, FormEvent } from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Armchair,
  ArrowLeft,
  ArrowUp,
  Cable,
  Camera,
  CalendarDays,
  Check,
  ChevronRight,
  CircleUserRound,
  CircleX,
  Copy,
  HeartPulse,
  House,
  Info,
  LockKeyhole,
  ListTodo,
  Mail,
  Mic,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  School,
  ShieldCheck,
  ShoppingBasket,
  Sparkles,
  Trash2,
  Undo2,
  Utensils,
  UsersRound,
  UserPlus,
  X,
} from "lucide-react";
import { minutesInTimeZone, pepperAtmosphereAt } from "./pepper-atmosphere";
import {
  isMedicalAppointment,
  isMedicalCareTask,
} from "./pepper-appointments";
import {
  compareWorkTasks,
  isWorkTask,
  WORK_PRIORITY_GROUPS,
  workPriority,
} from "./pepper-work";
import styles from "./pepper.module.css";

const API =
  process.env.NEXT_PUBLIC_PEPPER_API_URL ||
  "https://mfgyeolvfthxacrqwwtc.supabase.co/functions/v1/pepper-family-api";
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1mZ3llb2x2ZnRoeGFjcnF3d3RjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgxNDMyMDAsImV4cCI6MjEwMzcxOTIwMH0.uW9_dqKw8txaJxb7ysxMS0b0-nMmxg6XCk41Bhc4e9o";
const TZ = "America/Los_Angeles";

type Member = {
  id?: string;
  slug: string;
  display_name: string;
  role: string;
};

type FamilyTask = {
  id: string;
  title: string;
  owner_member_id?: string | null;
  creator_member_id?: string | null;
  visibility: "household" | "private";
  status: "open" | "in_progress" | "on_hold" | "completed" | "canceled";
  due_at?: string | null;
  source?: string | null;
  area?: string | null;
  project?: string | null;
  priority?: string | null;
  classification?: string | null;
  tags?: string[] | null;
  recurrence?: string | null;
  next_action?: string | null;
  notes?: string | null;
  waiting_on?: string | null;
  completed_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  deleted_at?: string | null;
};

type FamilyEvent = {
  id: string;
  title: string;
  person_slug?: string | null;
  starts_at: string;
  ends_at?: string | null;
  location?: string | null;
  status: "tentative" | "confirmed" | "canceled" | "completed";
  visibility: "household" | "private";
  owner_member_id?: string | null;
  kind: string;
  transport_owner_member_id?: string | null;
  transport_status?: string | null;
  source?: string | null;
  external_url?: string | null;
  external_organizer_email?: string | null;
  external_organizer_name?: string | null;
  notes?: string | null;
  updated_at?: string | null;
  deleted_at?: string | null;
};

type MemberState = {
  member: Required<Member>;
  events: FamilyEvent[];
  tasks: FamilyTask[];
  school?: {
    profile: {
      school_name: string;
      district_name: string;
      grade_label?: string | null;
      family_arrival_target_local?: string | null;
      normal_dismissal_local: string;
    };
    upcoming_changes: Array<{
      schedule_date: string;
      schedule_kind: string;
      schedule_title: string;
      dismissal_at?: string | null;
    }>;
  } | null;
  setup?: MemberSetupProfile | null;
};

type SelectedItem =
  | { type: "task"; item: FamilyTask }
  | { type: "event"; item: FamilyEvent };

type ItemOperation =
  | "assign"
  | "edit"
  | "complete"
  | "cancel"
  | "delete"
  | "reopen"
  | "restore";

type ItemUpdate = {
  owner_member_id?: string | null;
  title?: string;
  status?: "open" | "in_progress" | "on_hold";
  due_date?: string;
  priority?: string;
  notes?: string;
  waiting_on?: string;
  next_action?: string;
  starts_local?: string;
  ends_local?: string;
  location?: string;
};

type ItemUpdateResult =
  | { ok: true }
  | { ok: false; error: string };

type Ritual = "morning" | "evening";

type PreparationItem = {
  id: string;
  title: string;
  summary?: string | null;
};

type Capture = {
  id?: string | number;
  original_text?: string | null;
  status?: string | null;
  reconciliation_status?: string | null;
  summary?: string | null;
  pepper_reply?: string | null;
  reply?: string | null;
  response?: string | null;
  text?: string | null;
  raw_text?: string | null;
  title?: string | null;
  created_at?: string | null;
  captured_at?: string | null;
  updated_at?: string | null;
};

type GroceryItem = {
  id: string;
  item: string;
  status: string;
  owner_member_id?: string | null;
  meal_plan_id?: string | null;
  completed_by_member_id?: string | null;
};

type MealPlanItem = {
  id: string;
  meal_date: string;
  meal_name: string;
  prep_at?: string | null;
  eat_at?: string | null;
  owner_member_id?: string | null;
  shopping_owner_member_id?: string | null;
};

type MealNeed = {
  id: string;
  member_id: string;
  need_type: "allergy" | "avoidance" | "preference" | "nutrition" | "schedule";
  label: string;
  details?: string | null;
  active: boolean;
};

type MemberSetupProfile = {
  member_id: string;
  activities: string[];
  school_name: string;
  grade_label: string;
  dietary_preferences: string[];
  medications: string[];
  goals: string[];
  avatar_url?: string | null;
  avatar_updated_at?: string | null;
  updated_at?: string | null;
};

type FrontSeatParticipant = {
  id: string;
  slug: string;
  display_name: string;
  role: string;
};

type FrontSeatDay = {
  date: string;
  scheduled_member_id: string;
  assigned_member_id: string;
  assigned_member: FrontSeatParticipant;
  status: "planned" | "confirmed";
  source: "rotation" | "manual";
  confirmed_at?: string | null;
  can_confirm: boolean;
};

type FrontSeatState = {
  id: string;
  key: string;
  label: string;
  anchor_date: string;
  participants: FrontSeatParticipant[];
  days: FrontSeatDay[];
  today: FrontSeatDay;
  can_manage: boolean;
};

type Consequence = {
  id: string;
  type?: string | null;
  title: string;
  summary: string;
  status?: string | null;
  severity?: string | null;
  event_id?: string | null;
  related_event_id?: string | null;
  affected_member_id?: string | null;
  starts_at?: string | null;
  primary_event?: FamilyEvent | null;
  related_event?: FamilyEvent | null;
  available_drivers?: Member[];
};

type ReadinessItem = {
  type: string;
  title: string;
  summary: string;
  severity?: string | null;
  consequence_id?: string | null;
  consequence_type?: string | null;
  event_id?: string | null;
  related_event_id?: string | null;
  primary_event?: FamilyEvent | null;
  related_event?: FamilyEvent | null;
};

type AttentionItem = Consequence | ReadinessItem;

type HorizonRowItem = {
  id: string;
  title: string;
  starts_at: string;
  item_type?: "task" | "watch" | string;
  source?: string | null;
  location?: string | null;
  transport_owner_name?: string | null;
  all_day?: boolean;
  detail?: string | null;
  schedule_kind?: string | null;
  resolution_level?: string | null;
  kind?: string | null;
  person_slug?: string | null;
};

type HorizonWatch = {
  id: string;
  type?: string | null;
  date: string;
  title: string;
  when?: string | null;
  preparation_summary?: string | null;
  location?: string | null;
};

type HorizonTask = {
  id: string;
  title: string;
  due_at?: string | null;
};

type HorizonDay = {
  date: string;
  label: string;
  items?: HorizonRowItem[];
  tasks?: HorizonTask[];
  watch?: HorizonWatch[];
};

type HorizonState = {
  readiness?: ReadinessItem[];
  coverage?: {
    headline?: string | null;
    coordination_issues?: number | null;
    preparation_now?: number | null;
  };
  days?: HorizonDay[];
  ahead?: {
    future_watch?: HorizonWatch[];
    routine_summaries?: Array<{ id: string; title: string; summary: string }>;
  };
};

type CalendarStatus = {
  configured?: boolean;
  connected?: boolean;
  calendar_name?: string | null;
  last_synced_at?: string | null;
  last_error?: string | null;
  connection?: {
    connected_by_member_id?: string | null;
    calendar_name?: string | null;
    last_synced_at?: string | null;
  } | null;
};

type WeeklyInsight = {
  id: string;
  observation?: string | null;
};

type SpeechRecognitionEventLike = {
  results?: {
    [index: number]: { [index: number]: { transcript?: string } };
  };
};

type SpeechRecognitionLike = {
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  start: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type MorningRitual = {
  headline?: string | null;
  today_events?: Array<{
    id: string;
    title: string;
    time?: string | null;
    starts_at?: string | null;
    location?: string | null;
  }> | null;
  today_event_count?: number | null;
  event_count?: number | null;
  due_today?:
    | unknown[]
    | string
    | number
    | Record<string, unknown>
    | null;
  due_today_count?: number | null;
  due_today_information?: string | null;
  due_today_summary?: string | null;
  focus_tasks?: FamilyTask[] | null;
  task_summary?: {
    open?: number | null;
    due_today?: number | null;
    overdue?: number | null;
    high_priority?: number | null;
  } | null;
  attention?: Consequence[] | null;
  preparation?: PreparationItem[] | null;
  preparation_count?: number | null;
  tomorrow?: {
    headline?: string | null;
    events?: Array<{
      id: string;
      title: string;
      time?: string | null;
      starts_at?: string | null;
    }> | null;
  } | null;
  tomorrow_headline?: string | null;
};

type EveningRitual = {
  headline?: string | null;
  reflection_prompt?: string | null;
  prompt?: string | null;
  handled_today?: number | null;
  today_events?: number | null;
  tomorrow_headline?: string | null;
};

type PepperState = {
  member: { id: string; slug: string; display_name: string; role: string };
  members: Array<{ id: string; slug: string; display_name: string; role: string }>;
  events: FamilyEvent[];
  monthEvents?: FamilyEvent[];
  familyTasks: FamilyTask[];
  privateTasks: FamilyTask[];
  chores?: FamilyTask[];
  groceries: GroceryItem[];
  meals?: MealPlanItem[];
  mealNeeds?: MealNeed[];
  memberProfiles?: MemberSetupProfile[];
  frontSeat?: FrontSeatState | null;
  captures: Capture[];
  metrics?: Record<string, unknown>;
  consequences?: Consequence[];
  weeklyInsight?: WeeklyInsight | null;
  horizon?: HorizonState;
  calendarStatus?: CalendarStatus;
  integrations?: {
    gmail?: {
      configured?: boolean;
      connected?: boolean;
      status?: string;
      last_synced_at?: string | null;
      last_error?: string | null;
      metadata?: { email?: string };
    };
    apple_health?: {
      connected?: boolean;
      status?: string;
      last_synced_at?: string | null;
      last_error?: string | null;
      latest?: {
        metric_date: string;
        step_count?: number | null;
        step_goal?: number | null;
        active_minutes?: number | null;
      } | null;
    };
  };
  preparation?: { now?: PreparationItem[] };
  rituals?: {
    morning?: MorningRitual;
    evening?: EveningRitual;
  };
  progressive?: boolean;
};

type View =
  | "today"
  | "tasks"
  | "meals"
  | "family"
  | "member"
  | "setup"
  | "connections";

type LazySection = "chores" | "meals" | "family" | "connections";

type ChoreDraft = {
  title: string;
  ownerMemberId: string;
  dueDate: string;
  recurrence: "none" | "daily" | "weekly" | "monthly";
};

type MealDraft = {
  mealDate: string;
  mealName: string;
  ownerMemberId: string;
  shoppingOwnerMemberId: string;
};

type GroceryDraft = {
  item: string;
  ownerMemberId: string;
  mealPlanId: string;
};

type MealNeedDraft = {
  memberId: string;
  needType: MealNeed["need_type"];
  label: string;
  details: string;
};

type PersonalTaskDraft = {
  title: string;
  dueDate: string;
  priority: "P0" | "P1" | "P2" | "P3";
};

type MemberSetupDraft = {
  memberId: string;
  displayName: string;
  role: "adult_admin" | "adult" | "teen" | "child";
  pin: string;
  activities: string;
  schoolName: string;
  gradeLabel: string;
  dietaryPreferences: string;
  medications: string;
  goals: string;
};

type HealthSetup = {
  pairing_token: string;
  publishable_key: string;
  ingest_url: string;
  requires: string;
};

type NativeHealthResult = {
  ok: boolean;
  step_count?: number;
  active_minutes?: number;
  error?: string;
};

type NativeHealthMessageHandler = {
  postMessage: (payload: {
    ingest_url: string;
    pairing_token: string;
  }) => void;
};

type PepperAnswer = {
  title: string;
  summary: string;
  items?: string[];
};

type PepperExchange = {
  prompt: string;
  mode: "answer" | "action" | "clarification";
  reply: string;
  answer?: PepperAnswer;
  captureId?: string;
  clarification?: { question: string; placeholder?: string };
  undoable?: boolean;
  viewItem?: SelectedItem;
  undo?:
    | { type: "capture"; captureId: string }
    | {
        type: "item";
        before: SelectedItem;
        after: SelectedItem;
        operation: ItemOperation;
      };
};

type DayPlanItem = {
  id: string;
  record_id: string;
  kind: "task" | "appointment" | "email";
  title: string;
  detail?: string | null;
  reason: string;
  urgency: "critical" | "high" | "planned" | "fixed";
  scheduled_for?: string | null;
  ends_at?: string | null;
  source: "tasks" | "calendar" | "email";
  external_url?: string | null;
};

type DailyPlan = {
  generated_at: string;
  date: string;
  headline: string;
  summary: string;
  items: DayPlanItem[];
  conflicts: string[];
  counts: { tasks: number; appointments: number; emails: number };
  email: {
    status: "connected" | "not_connected" | "unavailable";
    scanned: number;
    error?: string | null;
  };
};

function nativeHealthMessageHandler() {
  if (typeof window === "undefined") return null;
  const nativeWindow = window as Window & {
    webkit?: {
      messageHandlers?: { pepperHealth?: NativeHealthMessageHandler };
    };
  };
  return nativeWindow.webkit?.messageHandlers?.pepperHealth || null;
}

function syncNativeHealth(setup: HealthSetup) {
  return new Promise<NativeHealthResult>((resolve, reject) => {
    const handler = nativeHealthMessageHandler();
    if (!handler) {
      reject(new Error("Native Apple Health access is not available in this build."));
      return;
    }

    const timeout = window.setTimeout(() => {
      window.removeEventListener("pepper:health-result", onResult);
      reject(new Error("Apple Health did not finish. Please try again."));
    }, 45_000);
    function onResult(event: Event) {
      window.clearTimeout(timeout);
      window.removeEventListener("pepper:health-result", onResult);
      const result = (event as CustomEvent<NativeHealthResult>).detail;
      if (!result?.ok) {
        reject(new Error(result?.error || "Apple Health could not connect."));
        return;
      }
      resolve(result);
    }

    window.addEventListener("pepper:health-result", onResult, { once: true });
    handler.postMessage({
      ingest_url: setup.ingest_url,
      pairing_token: setup.pairing_token,
    });
  });
}

type PinSetupState = {
  token: string;
  displayName: string;
};

function displayName(member?: Pick<Member, "slug" | "display_name"> | null) {
  if (!member) return "";
  return member.slug === "elle" ? "Danielle" : member.display_name;
}

async function prepareProfilePhoto(file: File) {
  if (!file.type.startsWith("image/")) {
    throw new Error("Choose a photo from your library.");
  }
  if (file.size > 15 * 1024 * 1024) {
    throw new Error("Choose a photo smaller than 15 MB.");
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Pepper could not read that photo."));
      image.src = objectUrl;
    });
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    if (!side) throw new Error("Pepper could not read that photo.");
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Pepper could not prepare that photo.");
    context.drawImage(
      image,
      (image.naturalWidth - side) / 2,
      (image.naturalHeight - side) / 2,
      side,
      side,
      0,
      0,
      512,
      512,
    );
    return canvas.toDataURL("image/jpeg", 0.86);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function productNameText(value?: string | null) {
  return (value || "").replace(/\bElle\b/g, "Danielle");
}

function dateInTimeZone(value: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value || "";
  const year = part("year");
  const month = part("month");
  const day = part("day");
  return year && month && day ? `${year}-${month}-${day}` : "";
}

function localDate() {
  return dateInTimeZone(new Date());
}

function localDateFor(value?: string | null) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return dateInTimeZone(parsed);
}

function localDateTimeFor(value?: string | null) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(parsed);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

function addDateDays(date: string, amount: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
  const [year, month, day] = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return "";
  }
  parsed.setUTCDate(parsed.getUTCDate() + amount);
  return parsed.toISOString().slice(0, 10);
}

function time(ts?: string | null) {
  if (!ts) return "";
  const parsed = new Date(ts);
  if (Number.isNaN(parsed.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function localTimeLabel(value?: string | null) {
  if (!value) return "";
  const [hour, minute] = value.split(":").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(Date.UTC(2000, 0, 1, hour, minute)));
}

function dateLabel(date?: string | null) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return "Date unavailable";
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(parsed);
}

function normalizedAttentionText(value?: string | null) {
  return (value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function consequenceDisplayKey(item: Consequence) {
  return [
    item.type || "attention",
    item.affected_member_id || "",
    normalizedAttentionText(item.title),
    normalizedAttentionText(item.summary),
  ].join("|");
}

function sameCalendarOccurrence(
  primary?: FamilyEvent | null,
  related?: FamilyEvent | null,
) {
  if (!primary || !related) return false;
  if (normalizedAttentionText(primary.title) !== normalizedAttentionText(related.title)) {
    return false;
  }
  return true;
}

function visibleConsequences(items: Consequence[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (item.status && item.status !== "open") return false;
    if (item.event_id && item.event_id === item.related_event_id) return false;
    if (sameCalendarOccurrence(item.primary_event, item.related_event)) return false;
    const key = consequenceDisplayKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function longDate() {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date());
}

function greeting() {
  const hour = currentHour();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function currentHour() {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      hour: "numeric",
      hourCycle: "h23",
    }).format(new Date()),
  );
}

function countLabel(value: number, singular: string, plural = `${singular}s`) {
  return `${value} ${value === 1 ? singular : plural}`;
}

function captureText(capture: Capture) {
  return (
    capture.original_text ||
    capture.summary ||
    capture.pepper_reply ||
    capture.reply ||
    capture.response ||
    capture.text ||
    capture.raw_text ||
    capture.title ||
    "Pepper updated the family plan."
  );
}

function captureTime(capture: Capture) {
  const value =
    capture.created_at || capture.captured_at || capture.updated_at || "";
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function activeNow(events: FamilyEvent[]) {
  const now = Date.now();
  return (events || []).filter((event) => {
    const start = new Date(event.starts_at).getTime();
    const end = event.ends_at
      ? new Date(event.ends_at).getTime()
      : start + 60 * 60 * 1000;
    return start <= now && end > now;
  });
}

function upcomingToday(events: FamilyEvent[]) {
  const now = Date.now();
  const today = localDate();
  return (events || [])
    .filter((event) => {
      const start = new Date(event.starts_at);
      const eventDate = new Intl.DateTimeFormat("en-CA", {
        timeZone: TZ,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(start);
      return eventDate === today && start.getTime() >= now;
    })
    .sort(
      (a, b) =>
        new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
    );
}

function routineSchoolTripKind(event: FamilyEvent) {
  if (
    event.source !== "routine" ||
    event.status !== "confirmed" ||
    !event.transport_owner_member_id
  ) {
    return null;
  }
  const title = event.title.toLowerCase();
  if (/minimum|early release|finals?|late start|special|no school/.test(title)) {
    return null;
  }
  if (/pick[ -]?up|dismissal/.test(title)) return "pickup" as const;
  if (/drop[ -]?off|school run|morning school/.test(title)) {
    return "dropoff" as const;
  }
  return null;
}

const LAZY_SECTIONS: LazySection[] = [
  "chores",
  "meals",
  "family",
  "connections",
];

function sectionForView(view: View): LazySection | null {
  if (view === "setup") return "family";
  if (view === "tasks") return "chores";
  return LAZY_SECTIONS.includes(view as LazySection)
    ? (view as LazySection)
    : null;
}

function optimisticSelectedItem(
  selected: SelectedItem,
  operation: ItemOperation,
  changes: ItemUpdate,
): SelectedItem {
  if (selected.type === "task") {
    const nextStatus: FamilyTask["status"] | undefined =
      operation === "complete"
        ? "completed"
        : operation === "cancel" || operation === "delete"
          ? "canceled"
          : operation === "reopen" || operation === "restore"
            ? "open"
            : undefined;
    return {
      type: "task",
      item: {
        ...selected.item,
        ...(changes.title ? { title: changes.title } : {}),
        ...(changes.owner_member_id !== undefined
          ? { owner_member_id: changes.owner_member_id }
          : {}),
        ...(changes.status ? { status: changes.status } : {}),
        ...(changes.priority !== undefined ? { priority: changes.priority } : {}),
        ...(changes.notes !== undefined ? { notes: changes.notes } : {}),
        ...(changes.waiting_on !== undefined
          ? { waiting_on: changes.waiting_on }
          : {}),
        ...(changes.next_action !== undefined
          ? { next_action: changes.next_action }
          : {}),
        ...(nextStatus ? { status: nextStatus } : {}),
        ...(operation === "delete"
          ? { deleted_at: new Date().toISOString() }
          : operation === "restore"
            ? { deleted_at: null }
            : {}),
        ...(operation === "complete"
          ? { completed_at: new Date().toISOString() }
          : operation === "reopen" || operation === "restore"
            ? { completed_at: null }
            : {}),
      },
    };
  }
  const nextStatus: FamilyEvent["status"] | undefined =
    operation === "complete"
      ? "completed"
      : operation === "cancel" || operation === "delete"
        ? "canceled"
        : operation === "reopen" || operation === "restore"
          ? "confirmed"
          : undefined;
  return {
    type: "event",
    item: {
      ...selected.item,
      ...(changes.title ? { title: changes.title } : {}),
      ...(changes.location !== undefined ? { location: changes.location } : {}),
      ...(changes.notes !== undefined ? { notes: changes.notes } : {}),
      ...(changes.owner_member_id !== undefined
        ? {
            transport_owner_member_id: changes.owner_member_id,
            transport_status: changes.owner_member_id ? "assigned" : "unassigned",
          }
        : {}),
      ...(nextStatus ? { status: nextStatus } : {}),
      ...(operation === "delete"
        ? { deleted_at: new Date().toISOString() }
        : operation === "restore"
          ? { deleted_at: null }
          : {}),
    },
  };
}

function itemUpdateFrom(selected: SelectedItem): ItemUpdate {
  if (selected.type === "task") {
    return {
      title: selected.item.title,
      status: ["in_progress", "on_hold"].includes(selected.item.status)
        ? (selected.item.status as "in_progress" | "on_hold")
        : "open",
      due_date: localDateFor(selected.item.due_at),
      priority: selected.item.priority || "",
      notes: selected.item.notes || "",
      waiting_on: selected.item.waiting_on || "",
      next_action: selected.item.next_action || "",
    };
  }
  return {
    title: selected.item.title,
    starts_local: localDateTimeFor(selected.item.starts_at),
    ends_local: localDateTimeFor(selected.item.ends_at),
    location: selected.item.location || "",
    notes: selected.item.notes || "",
  };
}

function patchItemList<T extends { id: string }>(
  items: T[] | undefined,
  updated: T,
  remove = false,
) {
  if (!items) return items;
  if (remove) return items.filter((item) => item.id !== updated.id);
  return items.map((item) => (item.id === updated.id ? updated : item));
}

function upsertItemList<T extends { id: string }>(items: T[] | undefined, item: T) {
  if (!items?.some((candidate) => candidate.id === item.id)) {
    return [...(items || []), item];
  }
  return items.map((candidate) => (candidate.id === item.id ? item : candidate));
}

function profileWithPhoto(
  profile: MemberSetupProfile | null | undefined,
  memberId: string,
  avatarUrl: string | null,
): MemberSetupProfile {
  return {
    member_id: memberId,
    activities: [],
    school_name: "",
    grade_label: "",
    dietary_preferences: [],
    medications: [],
    goals: [],
    ...profile,
    avatar_url: avatarUrl,
  };
}

function patchProfilePhoto(
  profiles: MemberSetupProfile[] | undefined,
  memberId: string,
  avatarUrl: string | null,
) {
  const current = profiles || [];
  if (!current.some((profile) => profile.member_id === memberId)) {
    return [...current, profileWithPhoto(null, memberId, avatarUrl)];
  }
  return current.map((profile) =>
    profile.member_id === memberId
      ? profileWithPhoto(profile, memberId, avatarUrl)
      : profile,
  );
}

function patchPepperStateItem(
  current: PepperState,
  selected: SelectedItem,
): PepperState {
  if (selected.type === "task") {
    const remove = Boolean(selected.item.deleted_at);
    const familyTasks = selected.item.visibility === "household"
      ? upsertItemList(current.familyTasks, selected.item)
      : patchItemList(current.familyTasks, selected.item, true) || [];
    const privateTasks = selected.item.visibility === "private"
      ? upsertItemList(current.privateTasks, selected.item)
      : patchItemList(current.privateTasks, selected.item, true) || [];
    return {
      ...current,
      familyTasks: remove ? patchItemList(familyTasks, selected.item, true) || [] : familyTasks,
      privateTasks: remove ? patchItemList(privateTasks, selected.item, true) || [] : privateTasks,
      chores: isChore(selected.item)
        ? remove
          ? patchItemList(current.chores, selected.item, true)
          : upsertItemList(current.chores, selected.item)
        : patchItemList(current.chores, selected.item, true),
    };
  }
  const remove = Boolean(selected.item.deleted_at);
  return {
    ...current,
    events: remove
      ? patchItemList(current.events, selected.item, true) || []
      : upsertItemList(current.events, selected.item),
    monthEvents: remove
      ? patchItemList(current.monthEvents, selected.item, true)
      : upsertItemList(current.monthEvents, selected.item),
  };
}

function patchMemberStateItem(
  current: MemberState,
  selected: SelectedItem,
): MemberState {
  if (selected.type === "task") {
    const remove = Boolean(selected.item.deleted_at);
    return {
      ...current,
      tasks: remove
        ? patchItemList(current.tasks, selected.item, true) || []
        : upsertItemList(current.tasks, selected.item),
    };
  }
  const remove = Boolean(selected.item.deleted_at);
  return {
    ...current,
    events: remove
      ? patchItemList(current.events, selected.item, true) || []
      : upsertItemList(current.events, selected.item),
  };
}

export function PepperClient() {
  const [profileName, setProfileName] = useState("");
  const [pin, setPin] = useState("");
  const [pinSetup, setPinSetup] = useState<PinSetupState | null>(null);
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [token, setToken] = useState("");
  const [state, setState] = useState<PepperState | null>(null);
  const [view, setView] = useState<View>("today");
  const [memberState, setMemberState] = useState<MemberState | null>(null);
  const [memberBusy, setMemberBusy] = useState(false);
  const [selectedItem, setSelectedItem] = useState<SelectedItem | null>(null);
  const [conflictResolution, setConflictResolution] =
    useState<AttentionItem | null>(null);
  const [loadedSections, setLoadedSections] = useState<Set<LazySection>>(
    () => new Set(),
  );
  const [loadingSections, setLoadingSections] = useState<Set<LazySection>>(
    () => new Set(),
  );
  const [pendingActions, setPendingActions] = useState<Set<string>>(
    () => new Set(),
  );
  const sectionRequests = useRef<Partial<Record<LazySection, Promise<void>>>>({});
  const [atmosphere, setAtmosphere] = useState(() =>
    pepperAtmosphereAt(minutesInTimeZone(TZ)),
  );
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [message, setMessage] = useState("");
  const [pepperExchange, setPepperExchange] = useState<PepperExchange | null>(null);
  const [dayPlan, setDayPlan] = useState<DailyPlan | null>(null);
  const [dayPlanBusy, setDayPlanBusy] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [tell, setTell] = useState("");
  const [reflection, setReflection] = useState("");
  const [reflectionSaved, setReflectionSaved] = useState(false);
  const [reflectionSavedText, setReflectionSavedText] = useState("");
  const [ritualOpen, setRitualOpen] = useState<Ritual | null>(null);
  const [ritualBusy, setRitualBusy] = useState(false);
  const [calendarConfirmation, setCalendarConfirmation] = useState("");
  const [healthSetup, setHealthSetup] = useState<HealthSetup | null>(null);
  const [frontSeatOpen, setFrontSeatOpen] = useState(false);
  const isPepperIOS =
    typeof navigator !== "undefined" && navigator.userAgent.includes("Pepper-iOS");

  const setActionPending = useCallback((key: string, pending: boolean) => {
    setPendingActions((current) => {
      const next = new Set(current);
      if (pending) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const isActionPending = useCallback(
    (key: string) => pendingActions.has(key),
    [pendingActions],
  );

  const openTask = useCallback(
    (task: FamilyTask) => setSelectedItem({ type: "task", item: task }),
    [],
  );

  const openSelectedItem = useCallback(
    (item: SelectedItem) => setSelectedItem(item),
    [],
  );

  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(() => setMessage(""), 7000);
    return () => window.clearTimeout(timeout);
  }, [message]);

  async function call(body: Record<string, unknown>, session = token) {
    if (!API || !SUPABASE_ANON_KEY) {
      throw new Error("Pepper preview is not configured.");
    }
    const response = await fetch(API, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        ...(session ? { "x-pepper-session": session } : {}),
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok) {
      if (
        data.code === "unknown_action" ||
        data.error === "Unknown Pepper action."
      ) {
        throw new Error(
          "This Pepper preview is out of date. Refresh the current V6 beta and try again.",
        );
      }
      throw new Error(data.error || "Pepper could not complete that.");
    }
    return data;
  }

  async function load(session = token) {
    if (!session) return;
    setSyncing(true);
    try {
      const result = await call({ action: "state", progressive: true }, session);
      setState((current) =>
        current ? { ...current, ...result.state } : result.state,
      );
      setDayPlan(null);
      if (result.state?.progressive !== true) {
        setLoadedSections(new Set(LAZY_SECTIONS));
      }
      setLastSyncedAt(new Date());
    } catch (error) {
      const text =
        error instanceof Error ? error.message : "Pepper could not load.";
      if (/unlock|session/i.test(text)) {
        localStorage.removeItem("pepper_family_session");
        setToken("");
        setState(null);
        setLoadedSections(new Set());
        setLoadingSections(new Set());
        sectionRequests.current = {};
      }
      setMessage(text);
    } finally {
      setSyncing(false);
    }
  }

  async function loadSection(
    section: LazySection,
    force = false,
    session = token,
  ) {
    if (!session || (!force && loadedSections.has(section))) return;
    const inFlight = sectionRequests.current[section];
    if (inFlight) return inFlight;
    const request = (async () => {
      setLoadingSections((current) => new Set(current).add(section));
      try {
        const result = await call(
          { action: "section_state", section },
          session,
        );
        setState((current) =>
          current ? { ...current, ...(result.state || {}) } : current,
        );
        setLoadedSections((current) => new Set(current).add(section));
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Pepper could not open that section.",
        );
      } finally {
        setLoadingSections((current) => {
          const next = new Set(current);
          next.delete(section);
          return next;
        });
        delete sectionRequests.current[section];
      }
    })();
    sectionRequests.current[section] = request;
    return request;
  }

  async function loadMember(slug: string, session = token) {
    if (!session) return;
    setMemberBusy(true);
    try {
      const result = await call(
        { action: "member_state", member_slug: slug },
        session,
      );
      setMemberState(result.state);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Pepper could not open that person.",
      );
    } finally {
      setMemberBusy(false);
    }
  }

  async function openMember(slug: string) {
    setView("member");
    setSelectedItem(null);
    await loadMember(slug);
  }

  async function updateItem(
    item: SelectedItem,
    operation: ItemOperation,
    changes: ItemUpdate = {},
    options: { receipt?: boolean } = {},
  ): Promise<ItemUpdateResult> {
    const pendingKey = `item:${item.item.id}`;
    const optimistic = optimisticSelectedItem(item, operation, changes);
    setActionPending(pendingKey, true);
    setState((current) =>
      current ? patchPepperStateItem(current, optimistic) : current,
    );
    setMemberState((current) =>
      current ? patchMemberStateItem(current, optimistic) : current,
    );
    try {
      const result = await call({
        action: "item_update",
        item_type: item.type,
        id: item.item.id,
        operation,
        expected_updated_at: item.item.updated_at || null,
        ...changes,
      });
      const expectedStatus =
        operation === "complete"
          ? "completed"
          : operation === "cancel" || operation === "delete"
            ? "canceled"
            : operation === "reopen" || operation === "restore"
              ? item.type === "event"
                ? "confirmed"
                : "open"
              : null;
      if (
        !result.item ||
        result.item.id !== item.item.id ||
        (expectedStatus && result.item.status !== expectedStatus)
      ) {
        throw new Error(
          "Pepper could not verify that this change was saved. Nothing was marked handled.",
        );
      }
      const saved = { type: item.type, item: result.item } as SelectedItem;
      setState((current) =>
        current ? patchPepperStateItem(current, saved) : current,
      );
      setMemberState((current) =>
        current ? patchMemberStateItem(current, saved) : current,
      );
      const receipt = operation === "assign"
        ? "Assigned. The family plan is current."
        : operation === "edit"
          ? "Saved everywhere this item appears."
          : operation === "delete"
            ? "Deleted from Pepper."
            : operation === "reopen" || operation === "restore"
              ? "Restored to the active plan."
              : `${operation === "complete" ? "Completed" : "Canceled"}. The family plan is current.`;
      if (options.receipt !== false) {
        setPepperExchange({
          prompt: item.item.title,
          mode: "action",
          reply: receipt,
          viewItem: saved,
          undoable: true,
          undo: { type: "item", before: item, after: saved, operation },
        });
        setMessage("");
      }
      setSelectedItem(null);
      setDayPlan(null);
      if (item.type === "event") void load();
      return { ok: true };
    } catch (error) {
      setState((current) =>
        current ? patchPepperStateItem(current, item) : current,
      );
      setMemberState((current) =>
        current ? patchMemberStateItem(current, item) : current,
      );
      const text =
        error instanceof Error ? error.message : "Pepper could not update that.";
      setMessage(text);
      return { ok: false, error: text };
    } finally {
      setActionPending(pendingKey, false);
    }
  }

  async function undoPepperExchange() {
    const exchange = pepperExchange;
    if (!exchange?.undo) return;
    setBusy(true);
    try {
      if (exchange.undo.type === "capture") {
        const result = await call({
          action: "capture_undo",
          capture_id: exchange.undo.captureId,
        });
        setPepperExchange({
          prompt: exchange.prompt,
          mode: "action",
          reply: result.reply || "Undone. Pepper restored the previous plan.",
          undoable: false,
        });
        void load();
        return;
      }

      const { before, after, operation } = exchange.undo;
      let reverseOperation: ItemOperation = "reopen";
      let reverseChanges: ItemUpdate = {};
      if (operation === "assign") {
        reverseOperation = "assign";
        reverseChanges = {
          owner_member_id:
            before.type === "event"
              ? before.item.transport_owner_member_id || null
              : before.item.owner_member_id || null,
        };
      } else if (operation === "edit") {
        reverseOperation = "edit";
        reverseChanges = itemUpdateFrom(before);
      } else if (operation === "delete") {
        reverseOperation = "restore";
      } else if (operation === "restore") {
        reverseOperation = "delete";
      } else if (before.item.status === "completed") {
        reverseOperation = "complete";
      } else if (before.item.status === "canceled") {
        reverseOperation = "cancel";
      } else if (before.type === "task") {
        reverseOperation = "edit";
        reverseChanges = itemUpdateFrom(before);
      }
      const undone = await updateItem(after, reverseOperation, reverseChanges, {
        receipt: false,
      });
      if (!undone.ok) return;
      setPepperExchange({
        prompt: exchange.prompt,
        mode: "action",
        reply: "Undone. Pepper restored the previous plan.",
        viewItem: before,
        undoable: false,
      });
    } finally {
      setBusy(false);
    }
  }

  function openAttention(item: AttentionItem) {
    const type =
      ("consequence_type" in item ? item.consequence_type : null) ||
      item.type ||
      "";
    if (
      ["person_conflict", "driver_conflict"].includes(type) &&
      item.primary_event &&
      item.related_event
    ) {
      setSelectedItem(null);
      setConflictResolution(item);
      return;
    }
    if (item.primary_event) {
      setConflictResolution(null);
      setSelectedItem({ type: "event", item: item.primary_event });
      return;
    }
    setMessage(
      "Pepper knows this needs attention, but the linked schedule item is not available to this profile.",
    );
  }

  async function resolveConflict(
    item: AttentionItem,
    keepEventId: string,
    rejectEventId: string,
  ) {
    const consequenceId = "id" in item ? item.id : item.consequence_id;
    if (!consequenceId) {
      setMessage("Pepper could not identify that conflict.");
      return false;
    }
    const pendingKey = `conflict:${consequenceId}`;
    setActionPending(pendingKey, true);
    try {
      await call({
        action: "conflict_resolve",
        consequence_id: consequenceId,
        keep_event_id: keepEventId,
        reject_event_id: rejectEventId,
      });
      setState((current) =>
        current
          ? {
              ...current,
              events: current.events.map((event) =>
                event.id === rejectEventId
                  ? { ...event, status: "canceled" }
                  : event,
              ),
              consequences: (current.consequences || []).filter(
                (consequence) => consequence.id !== consequenceId,
              ),
            }
          : current,
      );
      setMessage("Conflict resolved. Pepper updated the family plan.");
      setConflictResolution(null);
      void load();
      return true;
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Pepper could not resolve that conflict.",
      );
      return false;
    } finally {
      setActionPending(pendingKey, false);
    }
  }

  async function createChore(draft: ChoreDraft) {
    const pendingKey = "chore:create";
    setActionPending(pendingKey, true);
    try {
      const result = await call({
        action: "chore_create",
        title: draft.title,
        owner_member_id: draft.ownerMemberId || null,
        due_date: draft.dueDate || null,
        recurrence: draft.recurrence,
      });
      const chore = result.chore as FamilyTask;
      setState((current) =>
        current
          ? {
              ...current,
              familyTasks: upsertItemList(current.familyTasks, chore),
              chores: upsertItemList(current.chores, chore),
            }
          : current,
      );
      setMemberState((current) =>
        current && current.member.id === chore.owner_member_id
          ? { ...current, tasks: upsertItemList(current.tasks, chore) }
          : current,
      );
      setMessage("Chore added. Pepper updated everyone’s plan.");
      return true;
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Pepper could not add that chore.",
      );
      return false;
    } finally {
      setActionPending(pendingKey, false);
    }
  }

  async function updateFrontSeat(
    operation: "assign" | "reset" | "confirm",
    assignedMemberId?: string,
  ) {
    const pendingKey = "front-seat";
    setActionPending(pendingKey, true);
    try {
      const result = await call({
        action: "front_seat_update",
        operation,
        assigned_member_id: assignedMemberId || null,
      });
      const rider = result.frontSeat?.today?.assigned_member?.display_name;
      setState((current) =>
        current ? { ...current, frontSeat: result.frontSeat } : current,
      );
      setMessage(
        operation === "confirm"
          ? `${rider || "Today’s rider"} is confirmed in front.`
          : operation === "reset"
            ? `Back to the regular rotation. ${rider || "Today’s rider"} has the front seat.`
            : `${rider || "Today’s rider"} has the front seat today.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Pepper could not update the front-seat turn.",
      );
    } finally {
      setActionPending(pendingKey, false);
    }
  }

  async function saveMeal(draft: MealDraft) {
    const pendingKey = `meal:${draft.mealDate}`;
    setActionPending(pendingKey, true);
    try {
      const result = await call({
        action: "meal_upsert",
        meal_date: draft.mealDate,
        meal_name: draft.mealName,
        owner_member_id: draft.ownerMemberId || null,
        shopping_owner_member_id: draft.shoppingOwnerMemberId || null,
      });
      setState((current) =>
        current
          ? { ...current, meals: upsertItemList(current.meals, result.meal) }
          : current,
      );
      setMessage("Meal saved. Pepper updated the weekly plan.");
      return true;
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Pepper could not save that meal.",
      );
      return false;
    } finally {
      setActionPending(pendingKey, false);
    }
  }

  async function saveMealNeed(draft: MealNeedDraft) {
    const pendingKey = "meal-need:create";
    setActionPending(pendingKey, true);
    try {
      const result = await call({
        action: "meal_need_upsert",
        member_id: draft.memberId,
        need_type: draft.needType,
        label: draft.label,
        details: draft.details,
      });
      setState((current) =>
        current
          ? {
              ...current,
              mealNeeds: upsertItemList(current.mealNeeds, result.mealNeed),
            }
          : current,
      );
      setMessage("Family meal need saved.");
      return true;
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Pepper could not save that meal need.",
      );
      return false;
    } finally {
      setActionPending(pendingKey, false);
    }
  }

  async function removeMealNeed(id: string) {
    const pendingKey = `meal-need:${id}`;
    setActionPending(pendingKey, true);
    try {
      await call({ action: "meal_need_upsert", id, active: false });
      setState((current) =>
        current
          ? {
              ...current,
              mealNeeds: (current.mealNeeds || []).filter(
                (need) => need.id !== id,
              ),
            }
          : current,
      );
      setMessage("Meal need removed from the active plan.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Pepper could not update that meal need.",
      );
    } finally {
      setActionPending(pendingKey, false);
    }
  }

  async function createGrocery(draft: GroceryDraft) {
    const pendingKey = "grocery:create";
    setActionPending(pendingKey, true);
    try {
      const result = await call({
        action: "grocery_create",
        item: draft.item,
        owner_member_id: draft.ownerMemberId || null,
        meal_plan_id: draft.mealPlanId || null,
      });
      setState((current) =>
        current
          ? {
              ...current,
              groceries: upsertItemList(current.groceries, result.grocery),
            }
          : current,
      );
      setMessage("Grocery added to the weekly meal plan.");
      return true;
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Pepper could not add that grocery.",
      );
      return false;
    } finally {
      setActionPending(pendingKey, false);
    }
  }

  async function changeGrocery(
    id: string,
    operation: "assign" | "attach" | "complete" | "reopen",
    value?: string,
  ) {
    const pendingKey = `grocery:${id}`;
    setActionPending(pendingKey, true);
    const previous = state?.groceries.find((item) => item.id === id);
    setState((current) =>
      current
        ? {
            ...current,
            groceries: current.groceries.map((item) =>
              item.id !== id
                ? item
                : {
                    ...item,
                    ...(operation === "assign"
                      ? { owner_member_id: value || null }
                      : {}),
                    ...(operation === "attach"
                      ? { meal_plan_id: value || null }
                      : {}),
                    ...(operation === "complete" ? { status: "completed" } : {}),
                    ...(operation === "reopen" ? { status: "open" } : {}),
                  },
            ),
          }
        : current,
    );
    try {
      const result = await call({
        action: "grocery_update",
        id,
        operation,
        ...(operation === "assign" ? { owner_member_id: value || null } : {}),
        ...(operation === "attach" ? { meal_plan_id: value || null } : {}),
      });
      setState((current) =>
        current && result.grocery
          ? {
              ...current,
              groceries: result.merged
                ? upsertItemList(
                    current.groceries.filter((item) => item.id !== id),
                    result.grocery,
                  )
                : upsertItemList(current.groceries, result.grocery),
            }
          : current,
      );
      setMessage("Grocery plan updated for everyone.");
    } catch (error) {
      if (previous) {
        setState((current) =>
          current
            ? {
                ...current,
                groceries: upsertItemList(current.groceries, previous),
              }
            : current,
        );
      }
      setMessage(
        error instanceof Error
          ? error.message
          : "Pepper could not update that grocery.",
      );
    } finally {
      setActionPending(pendingKey, false);
    }
  }

  async function generateMealPlan() {
    const pendingKey = "meal-plan";
    setActionPending(pendingKey, true);
    try {
      const result = await call({
        action: "meal_plan_generate",
        start_date: localDate(),
        refresh: true,
        instruction: "Refresh the seven-day family meal plan.",
      });
      setMessage(
        `Week refreshed from ${result.needs_considered || 0} saved family meal ${result.needs_considered === 1 ? "need" : "needs"}, with ${result.grocery_count || 0} unique groceries. Review meals and assign cooking or shopping.`,
      );
      await loadSection("meals", true);
      return true;
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Pepper could not generate the meal plan.",
      );
      return false;
    } finally {
      setActionPending(pendingKey, false);
    }
  }

  async function createPersonalTask(draft: PersonalTaskDraft) {
    const pendingKey = "personal-task:create";
    setActionPending(pendingKey, true);
    try {
      const result = await call({
        action: "personal_task_create",
        title: draft.title,
        due_date: draft.dueDate || null,
        priority: draft.priority,
      });
      const task = result.task as FamilyTask;
      setState((current) =>
        current
          ? {
              ...current,
              privateTasks: upsertItemList(current.privateTasks, task),
            }
          : current,
      );
      setMemberState((current) =>
        current && current.member.id === task.owner_member_id
          ? { ...current, tasks: upsertItemList(current.tasks, task) }
          : current,
      );
      setMessage("Added to your private to-do list.");
      return true;
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Pepper could not add that to-do.",
      );
      return false;
    } finally {
      setActionPending(pendingKey, false);
    }
  }

  async function saveMemberSetup(draft: MemberSetupDraft) {
    const pendingKey = `member-setup:${draft.memberId || "new"}`;
    setActionPending(pendingKey, true);
    try {
      const result = await call({
        action: "member_setup_save",
        member_id: draft.memberId || null,
        display_name: draft.displayName,
        role: draft.role,
        pin: draft.pin || null,
        activities: draft.activities,
        school_name: draft.schoolName,
        grade_label: draft.gradeLabel,
        dietary_preferences: draft.dietaryPreferences,
        medications: draft.medications,
        goals: draft.goals,
      });
      setState((current) => {
        if (!current) return current;
        const existingProfile = current.memberProfiles?.find(
          (profile) => profile.member_id === result.member_id,
        );
        const profile = {
          ...existingProfile,
          ...result.profile,
          member_id: result.member_id,
        } as MemberSetupProfile;
        const savedMember = {
          id: result.member_id,
          slug: result.slug,
          display_name: draft.displayName,
          role: draft.role,
        };
        return {
          ...current,
          members: upsertItemList(current.members, savedMember),
          memberProfiles: current.memberProfiles?.some(
            (item) => item.member_id === profile.member_id,
          )
            ? current.memberProfiles.map((item) =>
                item.member_id === profile.member_id ? profile : item,
              )
            : [...(current.memberProfiles || []), profile],
        };
      });
      setMessage(
        draft.memberId
          ? `${draft.displayName}’s details are updated.`
          : `${draft.displayName} was added to the family.`,
      );
      return true;
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Pepper could not save that family member.",
      );
      return false;
    } finally {
      setActionPending(pendingKey, false);
    }
  }

  async function saveProfilePhoto(memberId: string, file: File) {
    const pendingKey = `photo:${memberId}`;
    setActionPending(pendingKey, true);
    try {
      const imageDataUrl = await prepareProfilePhoto(file);
      const result = await call({
        action: "member_photo_save",
        member_id: memberId,
        image_data_url: imageDataUrl,
      });
      setState((current) =>
        current
          ? {
              ...current,
              memberProfiles: patchProfilePhoto(
                current.memberProfiles,
                memberId,
                result.avatar_url,
              ),
            }
          : current,
      );
      setMemberState((current) =>
        current?.member.id === memberId
          ? {
              ...current,
              setup: profileWithPhoto(
                current.setup,
                memberId,
                result.avatar_url,
              ),
            }
          : current,
      );
      setMessage("Profile photo updated for the family.");
      return true;
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Pepper could not update that profile photo.",
      );
      return false;
    } finally {
      setActionPending(pendingKey, false);
    }
  }

  async function removeProfilePhoto(memberId: string) {
    const pendingKey = `photo:${memberId}`;
    setActionPending(pendingKey, true);
    try {
      await call({ action: "member_photo_remove", member_id: memberId });
      setState((current) =>
        current
          ? {
              ...current,
              memberProfiles: patchProfilePhoto(
                current.memberProfiles,
                memberId,
                null,
              ),
            }
          : current,
      );
      setMemberState((current) =>
        current?.member.id === memberId
          ? {
              ...current,
              setup: profileWithPhoto(current.setup, memberId, null),
            }
          : current,
      );
      setMessage("Profile photo removed.");
      return true;
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Pepper could not remove that profile photo.",
      );
      return false;
    } finally {
      setActionPending(pendingKey, false);
    }
  }

  useEffect(() => {
    const url = new URL(window.location.href);
    const ritual = url.searchParams.get("ritual");
    const calendarResult = url.searchParams.get("calendar");
    const calendarConnected = calendarResult === "connected";
    const connection = url.searchParams.get("connection");
    const calendarReason = url.searchParams.get("reason");

    const queryTimer = window.setTimeout(() => {
      if (ritual === "morning" || ritual === "evening") {
        setView("today");
        setRitualOpen(ritual);
      }
      if (calendarConnected) {
        setView("connections");
        setCalendarConfirmation(
          "Google Calendar connected. Pepper is planning ahead from it.",
        );
      } else if (calendarResult === "error") {
        setView("connections");
        setCalendarConfirmation(
          calendarReason
            ? `Google Calendar did not connect: ${calendarReason.replaceAll("_", " ")}.`
            : "Google Calendar did not connect. Try again.",
        );
      }
      if (connection === "gmail_connected") {
        setView("connections");
        setCalendarConfirmation(
          "Google email connected. Pepper can check recent messages when you ask her to plan your day.",
        );
      } else if (connection === "gmail_error") {
        setView("connections");
        setCalendarConfirmation("Google email did not connect. Try again.");
      }
    }, 0);

    let confirmationTimer: number | undefined;
    if (calendarResult || connection) {
      url.searchParams.delete("calendar");
      url.searchParams.delete("connection");
      url.searchParams.delete("reason");
      window.history.replaceState(
        window.history.state,
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
      confirmationTimer = window.setTimeout(() => {
        setCalendarConfirmation("");
      }, 7000);
    }

    return () => {
      window.clearTimeout(queryTimer);
      if (confirmationTimer) window.clearTimeout(confirmationTimer);
    };
  }, []);

  useEffect(() => {
    const update = () =>
      setAtmosphere(pepperAtmosphereAt(minutesInTimeZone(TZ)));
    const timer = window.setInterval(update, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem("pepper_family_session") || "";
    const timer = window.setTimeout(() => {
      if (saved) {
        setToken(saved);
        void load(saved);
        return;
      }
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!token) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(token);
    }, 60_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    const section = sectionForView(view);
    if (token && section) void loadSection(section);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, view]);

  const schoolTransportation = useMemo(() => {
    const dropoffs: FamilyEvent[] = [];
    const pickups: FamilyEvent[] = [];
    const ids = new Set<string>();
    for (const event of state?.events || []) {
      if (localDateFor(event.starts_at) !== localDate()) continue;
      const kind = routineSchoolTripKind(event);
      if (!kind) continue;
      ids.add(event.id);
      if (kind === "dropoff") dropoffs.push(event);
      else pickups.push(event);
    }
    const byStart = (a: FamilyEvent, b: FamilyEvent) =>
      new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime();
    return {
      dropoffs: dropoffs.sort(byStart),
      pickups: pickups.sort(byStart),
      ids,
    };
  }, [state]);
  const nowEvents = useMemo(
    () =>
      activeNow(state?.events || []).filter(
        (event) => !schoolTransportation.ids.has(event.id),
      ),
    [schoolTransportation, state],
  );
  const nextEvents = useMemo(
    () =>
      upcomingToday(state?.events || [])
        .filter((event) => !schoolTransportation.ids.has(event.id))
        .slice(0, 5),
    [schoolTransportation, state],
  );
  const todayAgenda = useMemo(
    () =>
      Array.from(
        new Map([...nowEvents, ...nextEvents].map((event) => [event.id, event])).values(),
      ).sort(
        (a, b) =>
          new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
      ),
    [nextEvents, nowEvents],
  );
  const openConsequences = visibleConsequences(state?.consequences || []);
  const preparationNow = state?.preparation?.now || [];
  const morning = state?.rituals?.morning;
  const evening = state?.rituals?.evening;
  const rhythmPhase =
    currentHour() < 12
      ? "morning"
      : currentHour() >= 18
        ? "evening"
        : null;
  const todayResponsibilities = useMemo(() => {
    if (!state) return [];
    const today = localDate();
    return Array.from(
      new Map(
        [...(state.familyTasks || []), ...(state.privateTasks || [])].map((task) => [task.id, task]),
      ).values(),
    )
      .filter(
        (task) =>
          !["completed", "canceled"].includes(task.status) &&
          (task.owner_member_id === state.member.id ||
            (task.visibility === "private" &&
              task.creator_member_id === state.member.id)) &&
          ((Boolean(task.due_at) && localDateFor(task.due_at) <= today) ||
            ["P0", "P1"].includes((task.priority || "").toUpperCase())),
      )
      .sort(compareWorkTasks)
      .slice(0, 6);
  }, [state]);
  const reviewCaptures = [...(state?.captures || [])]
    .filter((capture) =>
      ["captured", "needs_review", "partially_applied"].includes(
        capture.status || "",
      ),
    )
    .sort((a, b) => {
      const aTime = new Date(
        a.created_at || a.captured_at || a.updated_at || 0,
      ).getTime();
      const bTime = new Date(
        b.created_at || b.captured_at || b.updated_at || 0,
      ).getTime();
      return bTime - aTime;
    })
    .slice(0, 5);
  const atmosphereStyle = {
    "--atmosphere-top": atmosphere.top,
    "--atmosphere-middle": atmosphere.middle,
    "--atmosphere-bottom": atmosphere.bottom,
    "--atmosphere-glow": atmosphere.glow,
  } as CSSProperties;

  async function login() {
    const identity = profileName.trim();
    if (!identity || !pin) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await call(
        {
          action: "login",
          member_slug: identity.toLowerCase(),
          pin,
          device_label: "Pepper family web",
        },
        "",
      );
      if (result.setup_required) {
        setPinSetup({
          token: String(result.setup_token || ""),
          displayName: String(result.member?.display_name || identity),
        });
        setPin("");
        setNewPin("");
        setConfirmPin("");
        return;
      }
      if (!result.token) throw new Error("Pepper could not start this session.");
      localStorage.setItem("pepper_family_session", result.token);
      setToken(result.token);
      setPin("");
      await load(result.token);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Login failed.");
    } finally {
      setBusy(false);
    }
  }

  async function completePinSetup() {
    if (!pinSetup || newPin.length < 4 || newPin !== confirmPin) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await call(
        {
          action: "pin_setup",
          setup_token: pinSetup.token,
          new_pin: newPin,
          device_label: "Pepper family web",
        },
        "",
      );
      if (!result.token) throw new Error("Pepper could not start this session.");
      localStorage.setItem("pepper_family_session", result.token);
      setToken(result.token);
      setPinSetup(null);
      setNewPin("");
      setConfirmPin("");
      await load(result.token);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "PIN setup failed.");
    } finally {
      setBusy(false);
    }
  }

  function restartLogin() {
    setPinSetup(null);
    setPin("");
    setNewPin("");
    setConfirmPin("");
    setMessage("");
  }

  async function logout() {
    try {
      if (token) await call({ action: "logout" });
    } catch {
      // Local sign-out should still work.
    }
    localStorage.removeItem("pepper_family_session");
    setToken("");
    setState(null);
    setDayPlan(null);
    setLoadedSections(new Set());
    setLoadingSections(new Set());
    setPendingActions(new Set());
    sectionRequests.current = {};
    setPin("");
    setPinSetup(null);
    setNewPin("");
    setConfirmPin("");
  }

  async function deleteAccount(confirmation: string) {
    const pendingKey = "account:delete";
    setActionPending(pendingKey, true);
    try {
      await call({ action: "account_delete", confirmation });
      localStorage.removeItem("pepper_family_session");
      setToken("");
      setState(null);
      setDayPlan(null);
      setProfileName("");
      setPin("");
      setMessage("Your Pepper account was deleted.");
      return true;
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Pepper could not delete this account.",
      );
      return false;
    } finally {
      setActionPending(pendingKey, false);
    }
  }

  function openDayPlanItem(item: DayPlanItem) {
    if (item.kind === "email") {
      if (item.external_url) {
        window.open(item.external_url, "_blank", "noopener,noreferrer");
      } else {
        setMessage("Pepper could not open that email directly.");
      }
      return;
    }
    if (!state) return;
    if (item.kind === "task") {
      const task = [...state.familyTasks, ...state.privateTasks].find(
        (candidate) => candidate.id === item.record_id,
      );
      if (task) {
        setSelectedItem({ type: "task", item: task });
        return;
      }
    } else {
      const event = [...state.events, ...(state.monthEvents || [])].find(
        (candidate) => candidate.id === item.record_id,
      );
      if (event) {
        setSelectedItem({ type: "event", item: event });
        return;
      }
    }
    setMessage("This item changed since Pepper organized the day. Refresh the plan.");
  }

  async function generateDayPlan(fromAsk = false, prompt = "Plan my day") {
    if (dayPlanBusy) return;
    setDayPlanBusy(true);
    if (fromAsk) setBusy(true);
    setMessage("Pepper is organizing tasks, email, and appointments…");
    try {
      const result = await call({ action: "day_plan" });
      if (!result.plan || !Array.isArray(result.plan.items)) {
        throw new Error("Pepper could not verify a complete day plan.");
      }
      const plan = result.plan as DailyPlan;
      setDayPlan(plan);
      setTell("");
      setView("today");
      setRitualOpen(null);
      setMessage("");
      if (fromAsk) {
        setPepperExchange({
          prompt,
          mode: "answer",
          reply: plan.headline,
          answer: {
            title: "Your day is organized",
            summary: plan.headline,
            items: plan.conflicts.length ? plan.conflicts : undefined,
          },
        });
      }
      window.requestAnimationFrame(() => {
        document.getElementById("pepper-day-plan")?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Pepper could not organize today.",
      );
    } finally {
      setDayPlanBusy(false);
      if (fromAsk) setBusy(false);
    }
  }

  async function sendTell(text = tell) {
    const clean = text.trim();
    if (!clean) return;
    const clarificationContext =
      pepperExchange?.mode === "clarification" && pepperExchange.captureId
        ? pepperExchange
        : null;
    if (
      !clarificationContext &&
      (/\b(plan|organize|prioritize|structure)\b.*\b(?:my |the )?(?:day|today)\b/i.test(clean) ||
        /\bwhat should i do (?:first|today)\b/i.test(clean))
    ) {
      await generateDayPlan(true, clean);
      return;
    }
    setBusy(true);
    setMessage(clarificationContext ? "Pepper is finishing that update…" : "Pepper is checking One Brain…");
    try {
      const result = await call(
        clarificationContext
          ? {
              action: "capture_review_retry",
              capture_id: clarificationContext.captureId,
              clarification_text: clean,
              idempotency_key: crypto.randomUUID(),
            }
          : {
              action: "tell",
              text: clean,
              source: "text",
              idempotency_key: crypto.randomUUID(),
            },
      );
      setTell("");
      const mode = result.mode === "answer"
        ? "answer"
        : result.mode === "clarification" || ["needs_review", "partially_applied"].includes(result.status)
          ? "clarification"
          : "action";
      const captureId = result.captureId || result.capture_id || clarificationContext?.captureId;
      setPepperExchange({
        prompt: clarificationContext?.prompt || clean,
        mode,
        reply:
          result.reply ||
          (mode === "answer"
            ? "Pepper found an answer."
            : mode === "clarification"
              ? "Pepper needs one detail before changing the plan."
              : "Updated."),
        answer: result.answer,
        captureId,
        clarification: result.clarification,
        undoable: Boolean(result.undoable),
        undo: result.undoable && captureId
          ? { type: "capture", captureId }
          : undefined,
      });
      setMessage("");
      if (mode !== "answer" && mode !== "clarification") void load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Pepper hit an error.");
    } finally {
      setBusy(false);
    }
  }

  async function retryCapture(capture: Capture) {
    if (!capture.id) return;
    const pendingKey = `capture:retry:${capture.id}`;
    setActionPending(pendingKey, true);
    try {
      const result = await call({
        action: "capture_review_retry",
        capture_id: String(capture.id),
        idempotency_key: crypto.randomUUID(),
      });
      const mode = result.mode === "answer"
        ? "answer"
        : result.mode === "clarification" || ["needs_review", "partially_applied"].includes(result.status)
          ? "clarification"
          : "action";
      const captureId = result.captureId || result.capture_id || String(capture.id);
      setPepperExchange({
        prompt: captureText(capture),
        mode,
        reply: result.reply || (mode === "clarification" ? "Pepper needs one detail." : "Pepper reprocessed that update."),
        answer: result.answer,
        captureId,
        clarification: result.clarification,
        undoable: Boolean(result.undoable),
        undo: result.undoable ? { type: "capture", captureId } : undefined,
      });
      setMessage("");
      if (result.status === "applied" || result.status === "answered") setInboxOpen(false);
      if (mode !== "clarification") void load();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Pepper could not retry that update.",
      );
    } finally {
      setActionPending(pendingKey, false);
    }
  }

  async function saveReflection() {
    const clean = reflection.trim();
    if (!clean) return;
    setRitualBusy(true);
    try {
      await call({ action: "reflect", type: "reflection", text: clean });
      setReflectionSavedText(clean);
      setReflection("");
      setReflectionSaved(true);
      setMessage("Saved privately.");
      void load();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Pepper could not save that reflection.",
      );
    } finally {
      setRitualBusy(false);
    }
  }

  function openRitual(ritual: Ritual) {
    setView("today");
    setRitualOpen(ritual);
    if (ritual === "evening") {
      void loadSection("connections");
      setReflectionSaved(false);
      setReflectionSavedText("");
    }
  }

  async function connectCalendar() {
    const pendingKey = "connection:calendar";
    setActionPending(pendingKey, true);
    try {
      const result = await call({
        action: "calendar_start",
        return_target: isPepperIOS ? "pepper_ios" : "web",
      });
      if (result.authorization_url) {
        window.location.assign(result.authorization_url);
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Calendar setup is not ready yet.",
      );
    } finally {
      setActionPending(pendingKey, false);
    }
  }

  async function syncCalendar() {
    const pendingKey = "connection:calendar";
    setActionPending(pendingKey, true);
    try {
      setMessage("Pepper is refreshing your calendar…");
      await call({ action: "calendar_sync" });
      await Promise.all([load(), loadSection("connections", true)]);
      setMessage("Calendar refreshed.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Calendar refresh failed.",
      );
    } finally {
      setActionPending(pendingKey, false);
    }
  }

  async function connectEmail() {
    const pendingKey = "connection:email";
    setActionPending(pendingKey, true);
    try {
      const result = await call({
        action: "email_start",
        return_target: isPepperIOS ? "pepper_ios" : "web",
      });
      if (result.authorization_url) window.location.assign(result.authorization_url);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Email setup is not ready yet.",
      );
    } finally {
      setActionPending(pendingKey, false);
    }
  }

  async function pairHealth() {
    const pendingKey = "connection:health";
    setActionPending(pendingKey, true);
    try {
      const nativeHealth = nativeHealthMessageHandler();
      const result = await call({
        action: "health_pair",
        client: nativeHealth ? "native_ios" : "shortcut",
      });
      if (nativeHealth) {
        setHealthSetup(null);
        setMessage("Choose the Apple Health data Pepper may read…");
        const health = await syncNativeHealth(result);
        setMessage(
          `Apple Health connected · ${(health.step_count || 0).toLocaleString()} steps today.`,
        );
      } else {
        setHealthSetup(result);
        setMessage("The Apple Health Shortcut pairing is ready for this iPhone.");
      }
      await Promise.all([load(), loadSection("connections", true)]);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Apple Health setup failed.",
      );
    } finally {
      setActionPending(pendingKey, false);
    }
  }

  function listen() {
    const w = window as Window & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    const SpeechRecognition = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setMessage("Use the iPhone keyboard microphone in the message field.");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript || "";
      setTell(transcript);
      void sendTell(transcript);
    };
    recognition.onerror = () =>
      setMessage("Voice did not start. Use the iPhone keyboard microphone.");
    recognition.start();
  }

  if (!token || !state) {
    return (
      <main className={styles.loginPage} style={atmosphereStyle}>
        <section className={styles.loginCard}>
          <div className={styles.eyebrow}>
            {pinSetup ? "Private family access" : "Pepper's promise"}
          </div>
          <div className={styles.wordmark}>Pepper</div>
          {pinSetup ? (
            <>
              <h1>Create your PIN.</h1>
              <p>
                {pinSetup.displayName}, choose a personal PIN for future visits.
                Pepper never displays or sends it back to you.
              </p>
              <label className={styles.pinLabel}>
                New PIN
                <input
                  autoFocus
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  value={newPin}
                  onChange={(event) =>
                    setNewPin(event.target.value.replace(/\D/g, "").slice(0, 12))
                  }
                  placeholder="4–12 digits"
                />
              </label>
              <label className={styles.pinLabel}>
                Confirm PIN
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  value={confirmPin}
                  onChange={(event) =>
                    setConfirmPin(event.target.value.replace(/\D/g, "").slice(0, 12))
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void completePinSetup();
                  }}
                  placeholder="Enter it again"
                />
              </label>
              {confirmPin && newPin !== confirmPin ? (
                <div className={styles.loginMessage}>Those PINs do not match.</div>
              ) : null}
              <button
                type="button"
                className={styles.primaryButton}
                disabled={busy || newPin.length < 4 || newPin !== confirmPin}
                onClick={() => void completePinSetup()}
              >
                {busy ? "Creating your PIN…" : "Create PIN and open Pepper"}
              </button>
              <button
                type="button"
                className={styles.loginSecondary}
                disabled={busy}
                onClick={restartLogin}
              >
                Use a different profile
              </button>
            </>
          ) : (
            <>
              <h1>Your day, organized.</h1>
              <p className={styles.loginPromise}>
                Pepper brings together your email, school events, chores, tasks,
                and appointments, then creates a daily flow in order of importance
                so you stay on top of everything and miss nothing.
              </p>
              <p className={styles.loginInstructions}>
                Enter your profile name and PIN. On your first visit, use the
                one-time invitation code from your family organizer.
              </p>
              <label className={styles.pinLabel}>
                Profile name
                <input
                  autoCapitalize="words"
                  autoComplete="username"
                  value={profileName}
                  onChange={(event) => setProfileName(event.target.value.slice(0, 100))}
                  placeholder="Your name"
                />
              </label>
              <label className={styles.pinLabel}>
                PIN or invitation code
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="current-password"
                  value={pin}
                  onChange={(event) =>
                    setPin(event.target.value.replace(/\D/g, "").slice(0, 12))
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void login();
                  }}
                  placeholder="4–12 digits"
                />
              </label>
              <button
                type="button"
                className={styles.primaryButton}
                disabled={busy || !profileName.trim() || pin.length < 4}
                onClick={() => void login()}
              >
                {busy ? "Opening Pepper…" : "Continue"}
              </button>
            </>
          )}
          {message ? <div className={styles.loginMessage}>{message}</div> : null}
        </section>
      </main>
    );
  }

  const calendar = state.calendarStatus;
  const calendarConnected = Boolean(calendar?.connected);
  const actorIsAdult = ["adult_admin", "adult"].includes(state.member.role);
  const primaryNavigation = [
    ["today", "Today", House],
    ["tasks", "Tasks", ListTodo],
    ["meals", "Meals", Utensils],
    ["family", "Family", UsersRound],
    ["member", "Me", CircleUserRound],
  ] as const;
  const navIsActive = (key: (typeof primaryNavigation)[number][0]) => {
    if (key === "member") {
      return view === "member" && memberState?.member.id === state.member.id;
    }
    if (key === "family") {
      return view === "family" || view === "setup" ||
        (view === "member" && memberState?.member.id !== state.member.id);
    }
    return view === key;
  };

  return (
    <main className={styles.page} style={atmosphereStyle}>
      <div className={styles.shell}>
        <header className={styles.topbar}>
          <div>
            <div className={styles.wordmark}>Pepper</div>
            <div className={styles.familyLine}>
              Eriksen family · {displayName(state.member)}
            </div>
          </div>
          <div className={styles.topbarActions}>
            <button
              type="button"
              className={styles.syncStatus}
              data-syncing={syncing ? "true" : undefined}
              title={lastSyncedAt ? `Last updated ${lastSyncedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Refresh Pepper"}
              aria-label={syncing ? "Pepper is syncing" : "Refresh Pepper"}
              disabled={syncing}
              onClick={() => void load()}
            >
              <RefreshCw size={15} aria-hidden="true" />
              <span>{syncing ? "Syncing" : "Live"}</span>
            </button>
            <button
              type="button"
              className={styles.iconButton}
              onClick={() => setView("connections")}
              aria-label="Open connections"
              title="Connections"
            >
              <Cable size={18} aria-hidden="true" />
            </button>
            <button type="button" className={styles.quietButton} onClick={logout}>
              Switch
            </button>
          </div>
        </header>

        <nav
          className={styles.tabs}
          aria-label="Pepper primary navigation"
          style={
            {
              "--pepper-tab-count": primaryNavigation.length,
            } as CSSProperties
          }
        >
          {primaryNavigation.map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              aria-current={navIsActive(key) ? "page" : undefined}
              className={navIsActive(key) ? styles.tabActive : styles.tab}
              onClick={() => {
                if (key === "member") {
                  void openMember(state.member.slug);
                  return;
                }
                setView(key);
              }}
            >
              <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        {calendarConfirmation ? (
          <div className={styles.calendarConfirmation} role="status">
            {calendarConfirmation}
          </div>
        ) : null}

        {view === "today" ? (
          <>
            <section className={styles.hero}>
              <div className={styles.eyebrow}>{longDate()}</div>
              <h1>
                {greeting()}, {displayName(state.member)}.
              </h1>
              <p>
                {openConsequences.length
                  ? `${openConsequences.length} ${
                      openConsequences.length === 1 ? "thing needs" : "things need"
                    } attention.`
                  : nextEvents[0]
                    ? `Next is ${nextEvents[0].title} at ${time(
                        nextEvents[0].starts_at,
                      )}.`
                    : "Nothing urgent is asking for you right now."}
              </p>
            </section>

            {openConsequences.length ? (
              <section className={styles.section}>
                <div className={styles.sectionLabel}>Needs attention</div>
                <div className={styles.noticeStack}>
                  {openConsequences.slice(0, 3).map((item) => (
                    <AttentionCard
                      item={item}
                      key={item.id}
                      onOpen={() => openAttention(item)}
                    />
                  ))}
                </div>
                {openConsequences.length > 3 ? (
                  <details className={styles.preparationMore}>
                    <summary>
                      Show {openConsequences.length - 3} more{" "}
                      {openConsequences.length - 3 === 1
                        ? "decision"
                        : "decisions"}
                    </summary>
                    <div className={styles.noticeStack}>
                      {openConsequences.slice(3).map((item) => (
                        <AttentionCard
                          item={item}
                          key={item.id}
                          onOpen={() => openAttention(item)}
                        />
                      ))}
                    </div>
                  </details>
                ) : null}
              </section>
            ) : null}

            <DayPlanPanel
              plan={dayPlan}
              busy={dayPlanBusy}
              emailConnected={Boolean(state.integrations?.gmail?.connected)}
              onGenerate={() => void generateDayPlan()}
              onOpen={openDayPlanItem}
            />

            <section className={styles.section}>
              <div className={styles.sectionLabel}>Daily Rhythm</div>
              {rhythmPhase === "morning" ? (
                <button
                  type="button"
                  className={styles.lookAhead}
                  aria-expanded={ritualOpen === "morning"}
                  aria-controls="pepper-ritual"
                  onClick={() => openRitual("morning")}
                >
                  <div>
                    <span className={styles.sectionLabel}>This morning</span>
                    <strong>Morning Brief</strong>
                    <p>
                      {morning?.headline ||
                        "A calm look at what matters today."}
                    </p>
                  </div>
                  <span className={styles.arrow}>→</span>
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.lookAhead}
                  aria-expanded={ritualOpen === "evening"}
                  aria-controls="pepper-ritual"
                  onClick={() => openRitual("evening")}
                >
                  <div>
                    <span className={styles.sectionLabel}>This evening</span>
                    <strong>Evening Reflection</strong>
                    <p>
                      {evening?.headline ||
                        evening?.reflection_prompt ||
                        evening?.prompt ||
                        "A private moment to set down what mattered today."}
                    </p>
                  </div>
                  <span className={styles.arrow}>→</span>
                </button>
              )}

              <div className={styles.ritualLinks}>
                <button
                  type="button"
                  className={styles.textButton}
                  onClick={() => openRitual("morning")}
                >
                  Morning Brief
                </button>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  className={styles.textButton}
                  onClick={() => openRitual("evening")}
                >
                  Evening Reflection
                </button>
              </div>

              {ritualOpen ? (
                <article
                  className={`${styles.insight} ${styles.ritualPanel}`}
                  id="pepper-ritual"
                  aria-live="polite"
                >
                  <button
                    type="button"
                    className={`${styles.quietButton} ${styles.ritualClose}`}
                    aria-label={`Close ${
                      ritualOpen === "morning"
                        ? "Morning Brief"
                        : "Evening Reflection"
                    }`}
                    onClick={() => setRitualOpen(null)}
                  >
                    ×
                  </button>

                  {ritualOpen === "morning" ? (
                    <MorningBriefPanel
                      state={state}
                      morning={morning}
                      openConsequences={openConsequences}
                      preparation={preparationNow}
                      onOpenItem={setSelectedItem}
                      onOpenAttention={openAttention}
                      onMeals={() => setView("meals")}
                      onMember={() => void openMember(state.member.slug)}
                    />
                  ) : (
                    <>
                      {!reflectionSaved ? (
                        <>
                          <div className={styles.eyebrow}>
                            {displayName(state.member)} · Evening Reflection
                          </div>
                          <h2>What is worth carrying forward?</h2>
                          <p>
                            {evening?.reflection_prompt ||
                              evening?.prompt ||
                              "What changed, what moved closer, and what can be released tonight?"}
                          </p>
                          <label className={styles.reflectionInput}>
                            Daily inputs
                            <textarea
                              value={reflection}
                              onChange={(event) => {
                                setReflection(event.target.value);
                                setReflectionSaved(false);
                              }}
                              placeholder={
                                evening?.reflection_prompt ||
                                evening?.prompt ||
                                "Progress, drift, gratitude, health, and anything Pepper should remember…"
                              }
                              rows={6}
                              autoFocus
                            />
                          </label>
                          <button
                            type="button"
                            className={styles.secondaryButton}
                            disabled={ritualBusy || !reflection.trim()}
                            onClick={() => void saveReflection()}
                          >
                            {ritualBusy ? "Saving…" : "Save privately and reflect"}
                          </button>
                        </>
                      ) : (
                        <EveningReflectionOutput
                          state={state}
                          input={reflectionSavedText}
                          evening={evening}
                        />
                      )}
                    </>
                  )}
                </article>
              ) : null}
            </section>

            {!dayPlan ? (
              <>
                <section className={styles.section}>
                  <div className={styles.sectionHeading}>
                    <div className={styles.sectionLabel}>Today&apos;s schedule</div>
                    <span className={styles.sectionCount}>{todayAgenda.length}</span>
                  </div>
                  <div className={styles.timeline}>
                    {todayAgenda.length ? (
                      todayAgenda.map((event) => (
                        <EventRow
                          key={event.id}
                          event={event}
                          state={state}
                          onOpen={() => setSelectedItem({ type: "event", item: event })}
                        />
                      ))
                    ) : (
                      <div className={styles.empty}>
                        The rest of today is clear.
                      </div>
                    )}
                  </div>
                </section>

                {schoolTransportation.dropoffs.length ||
                schoolTransportation.pickups.length ? (
                  <SchoolTransportationSummary
                    dropoffs={schoolTransportation.dropoffs}
                    pickups={schoolTransportation.pickups}
                    state={state}
                    onOpen={(event) =>
                      setSelectedItem({ type: "event", item: event })
                    }
                  />
                ) : null}
              </>
            ) : null}

            {state.frontSeat ? (
              <FrontSeatCard
                frontSeat={state.frontSeat}
                onOpen={() => setFrontSeatOpen(true)}
              />
            ) : null}

            <HealthSummary
              health={state.integrations?.apple_health}
              onOpen={() => setView("connections")}
            />

            {!dayPlan ? <section className={styles.section}>
              <div className={styles.sectionHeading}>
                <div className={styles.sectionLabel}>Today&apos;s responsibilities</div>
                <button
                  type="button"
                  className={styles.textButton}
                  onClick={() => setView("tasks")}
                >
                  All tasks
                </button>
              </div>
              <div className={styles.taskHubList}>
                {todayResponsibilities.length ? todayResponsibilities.map((task) => (
                  <TaskActionRow
                    key={task.id}
                    task={task}
                    state={state}
                    onOpen={() => setSelectedItem({ type: "task", item: task })}
                  />
                )) : (
                  <div className={styles.empty}>Nothing is waiting on you today.</div>
                )}
              </div>
            </section> : null}

            {reviewCaptures.length ? (
            <section className={`${styles.details} ${styles.inboxOnly}`}>
              <details
                open={inboxOpen}
                onToggle={(event) => setInboxOpen(event.currentTarget.open)}
              >
                <summary>
                  Pepper Inbox
                  {reviewCaptures.length
                    ? " · review needed"
                    : ""}
                </summary>
                <p className={styles.inboxExplanation}>
                  Pepper Inbox preserves updates it could not safely place. An
                  item here is not a task, meal, or calendar event unless Pepper
                  explicitly says it created one.
                </p>
                {reviewCaptures.length ? (
                  <div className={styles.evidence}>
                    {reviewCaptures.map((capture, index) => {
                      const needsReview = [
                        "captured",
                        "needs_review",
                        "partially_applied",
                      ].includes(capture.status || "");
                      return (
                        <blockquote key={capture.id || `capture-${index}`}>
                          <div className={styles.inboxCaptureHeading}>
                            {captureTime(capture) ? (
                              <time>{captureTime(capture)}</time>
                            ) : null}
                            {needsReview ? <span>Needs review</span> : null}
                          </div>
                          {captureText(capture)}
                          {needsReview ? (
                            <div className={styles.inboxCaptureActions}>
                              <button
                                type="button"
                                className={styles.inboxRetry}
                                disabled={isActionPending(`capture:retry:${capture.id}`)}
                                onClick={() => void retryCapture(capture)}
                              >
                                <RefreshCw size={13} aria-hidden="true" />
                                {isActionPending(`capture:retry:${capture.id}`)
                                  ? "Retrying…"
                                  : "Retry now"}
                              </button>
                              <button
                                type="button"
                                className={styles.inboxRetry}
                                onClick={() => {
                                  setTell(captureText(capture));
                                  setMessage(
                                    "Edit the update below so Pepper has the missing details it needs.",
                                  );
                                }}
                              >
                                <Pencil size={13} aria-hidden="true" />
                                Edit in composer
                              </button>
                            </div>
                          ) : null}
                        </blockquote>
                      );
                    })}
                  </div>
                ) : null}
              </details>
            </section>
            ) : null}
          </>
        ) : null}

        {view === "tasks" ? (
          loadedSections.has("chores") ? (
            <TasksPage
              chores={state.chores || []}
              state={state}
              isPending={isActionPending}
              onCreateChore={createChore}
              onCreatePersonalTask={createPersonalTask}
              onOpen={openTask}
              onToggle={(task) =>
                void updateItem(
                  { type: "task", item: task },
                  task.status === "completed" ? "reopen" : "complete",
                )
              }
            />
          ) : (
            <SectionLoading label="Opening tasks" active={loadingSections.has("chores")} />
          )
        ) : null}

        {view === "meals" ? (
          loadedSections.has("meals") ? (
            <MealsPage
              meals={state.meals || []}
              mealNeeds={state.mealNeeds || []}
              groceries={state.groceries || []}
              state={state}
              isPending={isActionPending}
              onSaveMeal={saveMeal}
              onSaveNeed={saveMealNeed}
              onRemoveNeed={removeMealNeed}
              onGenerate={generateMealPlan}
              onCreateGrocery={createGrocery}
              onChangeGrocery={changeGrocery}
            />
          ) : (
            <SectionLoading label="Opening this week’s meals" active={loadingSections.has("meals")} />
          )
        ) : null}

        {view === "family" ? (
          <FamilyDirectory
            members={state.members}
            profiles={state.memberProfiles || []}
            onOpen={(slug) => void openMember(slug)}
            canManage={actorIsAdult}
            onSetup={() => setView("setup")}
          />
        ) : null}

        {view === "setup" && actorIsAdult ? (
          loadedSections.has("family") ? (
            <FamilySetupPage
              state={state}
              isPending={isActionPending}
              onBack={() => setView("family")}
              onSave={saveMemberSetup}
              onPhotoUpload={saveProfilePhoto}
              onPhotoRemove={removeProfilePhoto}
            />
          ) : (
            <SectionLoading label="Opening family setup" active={loadingSections.has("family")} />
          )
        ) : null}

        {view === "member" ? (
          <MemberPage
            state={memberState}
            busy={memberBusy}
            isPending={isActionPending}
            household={state}
            onBack={() => setView("family")}
            onOpen={openSelectedItem}
            onCreateChore={createChore}
            onCreatePersonalTask={createPersonalTask}
            onPhotoUpload={saveProfilePhoto}
            onPhotoRemove={removeProfilePhoto}
          />
        ) : null}

        {view === "connections" ? (
          loadedSections.has("connections") ? (
            <ConnectionsPage
              calendar={calendar}
              gmail={state.integrations?.gmail}
              health={state.integrations?.apple_health}
              healthSetup={healthSetup}
              nativeHealthAvailable={Boolean(nativeHealthMessageHandler())}
              member={state.member}
              members={state.members}
              isPending={isActionPending}
              onCalendar={() =>
                void (calendarConnected ? syncCalendar() : connectCalendar())
              }
              onEmail={() => void connectEmail()}
              onHealth={() => void pairHealth()}
              onFamily={() => setView("family")}
              onDeleteAccount={deleteAccount}
            />
          ) : (
            <SectionLoading label="Checking connections" active={loadingSections.has("connections")} />
          )
        ) : null}
      </div>

      {selectedItem ? (
        <ItemActionSheet
          selected={selectedItem}
          state={state}
          busy={isActionPending(`item:${selectedItem.item.id}`)}
          onClose={() => setSelectedItem(null)}
          onUpdate={(operation, changes) =>
            updateItem(selectedItem, operation, changes)
          }
        />
      ) : null}

      {conflictResolution ? (
        <ConflictResolutionSheet
          item={conflictResolution}
          state={state}
          busy={isActionPending(
            `conflict:${
              "id" in conflictResolution
                ? conflictResolution.id
                : conflictResolution.consequence_id || ""
            }`,
          )}
          onClose={() => setConflictResolution(null)}
          onResolve={(keepEventId, rejectEventId) =>
            resolveConflict(conflictResolution, keepEventId, rejectEventId)
          }
        />
      ) : null}

      {frontSeatOpen && state.frontSeat ? (
        <FrontSeatSheet
          frontSeat={state.frontSeat}
          busy={isActionPending("front-seat")}
          onClose={() => setFrontSeatOpen(false)}
          onUpdate={updateFrontSeat}
        />
      ) : null}

      {ritualOpen && message ? (
        <div className={styles.ritualToast} role="status">
          {message}
        </div>
      ) : null}

      {!ritualOpen ? (
        <div className={styles.composer}>
          {pepperExchange ? (
            <section
              className={styles.pepperReply}
              data-mode={pepperExchange.mode}
              aria-live="polite"
            >
              <div className={styles.pepperReplyHeading}>
                <span className={styles.pepperReplyMark} aria-hidden="true">
                  <Sparkles size={15} />
                </span>
                <div>
                  <small>
                    {pepperExchange.mode === "answer"
                      ? "Pepper found"
                      : pepperExchange.mode === "clarification"
                        ? "One detail needed"
                        : "Pepper updated"}
                  </small>
                  <strong>
                    {pepperExchange.answer?.title ||
                      (pepperExchange.mode === "answer"
                        ? "From your family plan"
                        : pepperExchange.mode === "clarification"
                          ? "Before I change the plan"
                          : "One Brain")}
                  </strong>
                </div>
                <button
                  type="button"
                  className={styles.pepperReplyDismiss}
                  onClick={() => setPepperExchange(null)}
                  aria-label="Dismiss Pepper response"
                >
                  <X size={15} aria-hidden="true" />
                </button>
              </div>
              <p>
                {pepperExchange.mode === "clarification"
                  ? pepperExchange.clarification?.question || pepperExchange.reply
                  : pepperExchange.answer?.summary || pepperExchange.reply}
              </p>
              {pepperExchange.answer?.items?.length ? (
                <ul className={styles.pepperReplyItems}>
                  {pepperExchange.answer.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : null}
              {pepperExchange.undoable || pepperExchange.viewItem || pepperExchange.mode === "clarification" ? (
                <div className={styles.pepperReplyActions}>
                  {pepperExchange.undoable ? (
                    <button type="button" disabled={busy} onClick={() => void undoPepperExchange()}>
                      <Undo2 size={15} aria-hidden="true" /> Undo
                    </button>
                  ) : null}
                  {pepperExchange.viewItem ? (
                    <button type="button" onClick={() => setSelectedItem(pepperExchange.viewItem || null)}>
                      <Pencil size={15} aria-hidden="true" /> View or edit
                    </button>
                  ) : null}
                  {pepperExchange.mode === "clarification" ? (
                    <button type="button" onClick={() => { setPepperExchange(null); setTell(""); }}>
                      <X size={15} aria-hidden="true" /> Start over
                    </button>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}
          {message ? (
            <div className={styles.toast} role="status">
              <span>{message}</span>
              <div className={styles.toastActions}>
                {message.includes("Pepper Inbox") ? (
                  <button
                    type="button"
                    className={styles.toastLink}
                    onClick={() => {
                      setView("today");
                      setInboxOpen(true);
                    }}
                  >
                    Open Inbox
                  </button>
                ) : null}
                <button
                  type="button"
                  className={styles.toastDismiss}
                  onClick={() => setMessage("")}
                  aria-label="Dismiss message"
                >
                  <X size={15} aria-hidden="true" />
                </button>
              </div>
            </div>
          ) : null}
          <div className={styles.composeInner}>
            <button
              type="button"
              className={styles.mic}
              onClick={listen}
              aria-label="Talk to Pepper"
            >
              <Mic size={19} strokeWidth={1.8} />
            </button>
            <input
              value={tell}
              onChange={(event) => setTell(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void sendTell();
              }}
              placeholder={
                pepperExchange?.mode === "clarification"
                  ? pepperExchange.clarification?.placeholder || "Add the missing detail…"
                  : "Ask Pepper or tell her what changed…"
              }
            />
            <button
              type="button"
              className={styles.send}
              disabled={busy || !tell.trim()}
              onClick={() => void sendTell()}
              aria-label="Send to Pepper"
            >
              <ArrowUp size={18} strokeWidth={2.2} aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function DayPlanPanel({
  plan,
  busy,
  emailConnected,
  onGenerate,
  onOpen,
}: {
  plan: DailyPlan | null;
  busy: boolean;
  emailConnected: boolean;
  onGenerate: () => void;
  onOpen: (item: DayPlanItem) => void;
}) {
  return (
    <section
      className={`${styles.section} ${styles.dayPlan}`}
      id="pepper-day-plan"
      aria-busy={busy}
    >
      <header className={styles.dayPlanHeader}>
        <div>
          <span className={styles.sectionLabel}>Pepper&apos;s plan</span>
          <h2>Your day, organized.</h2>
          <p>
            {plan
              ? plan.headline
              : "Pepper can arrange your priorities around the places you need to be."}
          </p>
        </div>
        <button
          type="button"
          className={styles.dayPlanGenerate}
          disabled={busy}
          onClick={onGenerate}
        >
          {plan ? (
            <RefreshCw size={16} aria-hidden="true" />
          ) : (
            <Sparkles size={16} aria-hidden="true" />
          )}
          {busy ? "Organizing…" : plan ? "Refresh plan" : "Plan my day"}
        </button>
      </header>

      {plan ? (
        <>
          {plan.conflicts.length ? (
            <div className={styles.dayPlanConflicts} role="alert">
              <strong>Resolve before the day starts</strong>
              {plan.conflicts.map((conflict) => (
                <span key={conflict}>{conflict}</span>
              ))}
            </div>
          ) : null}

          <div className={styles.dayPlanList}>
            {plan.items.length ? (
              plan.items.map((item) => {
                const Icon =
                  item.kind === "appointment"
                    ? CalendarDays
                    : item.kind === "email"
                      ? Mail
                      : ListTodo;
                return (
                  <button
                    type="button"
                    className={styles.dayPlanRow}
                    data-kind={item.kind}
                    data-urgency={item.urgency}
                    key={item.id}
                    onClick={() => onOpen(item)}
                  >
                    <time>{item.scheduled_for ? time(item.scheduled_for) : "Later"}</time>
                    <span className={styles.dayPlanIcon} aria-hidden="true">
                      <Icon size={16} strokeWidth={1.8} />
                    </span>
                    <span className={styles.dayPlanBody}>
                      <strong>{item.title}</strong>
                      <small>
                        {item.reason}
                        {item.detail ? ` · ${item.detail}` : ""}
                      </small>
                    </span>
                    <ChevronRight className={styles.rowChevron} size={16} aria-hidden="true" />
                  </button>
                );
              })
            ) : (
              <div className={styles.dayPlanEmpty}>
                Nothing needs to be scheduled from the information Pepper can verify.
              </div>
            )}
          </div>

          <footer className={styles.dayPlanSources}>
            <span>{plan.counts.tasks} task priorities</span>
            <span>{plan.counts.appointments} appointments</span>
            <span>
              {plan.email.status === "connected"
                ? `${plan.email.scanned} recent emails checked privately`
                : "Email was not included"}
            </span>
            <time>Updated {time(plan.generated_at)}</time>
          </footer>
        </>
      ) : (
        <div className={styles.dayPlanPrompt}>
          <span><ListTodo size={15} aria-hidden="true" /> Open tasks</span>
          <span><CalendarDays size={15} aria-hidden="true" /> Appointments</span>
          <span><Mail size={15} aria-hidden="true" /> {emailConnected ? "Private email signals" : "Connect email to include it"}</span>
        </div>
      )}
    </section>
  );
}

function SectionLoading({ label, active }: { label: string; active: boolean }) {
  return (
    <section className={styles.sectionLoading} aria-live="polite">
      <span aria-hidden="true" />
      <strong>{active ? `${label}…` : label}</strong>
    </section>
  );
}

function memberName(state: PepperState, id?: string | null) {
  return displayName(state.members?.find((member) => member.id === id));
}

type BriefTaskGroup = "work" | "theatre" | "school" | "chores" | "personal";

const BRIEF_TASK_LABELS: Record<BriefTaskGroup, string> = {
  work: "Work",
  theatre: "Theatre",
  school: "School + homework",
  chores: "Chores",
  personal: "Personal + home",
};

function briefTaskText(task: FamilyTask) {
  return [task.title, task.area, task.project, task.classification, ...(task.tags || [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function briefTaskGroup(task: FamilyTask): BriefTaskGroup {
  const text = briefTaskText(task);
  if (isChore(task)) return "chores";
  if (/theat(?:er|re)|costum|wardrobe|rehearsal|production/.test(text)) {
    return "theatre";
  }
  if (/homework|school|study|class|assignment|academic|test prep/.test(text)) {
    return "school";
  }
  if (
    isWorkTask(task) ||
    /real estate|realtor|listing|escrow|open house|client property|broker/.test(text)
  ) {
    return "work";
  }
  return "personal";
}

function briefPriorityRank(task: FamilyTask) {
  return {
    critical: 0,
    high: 1,
    planned: 2,
    later: 3,
    unprioritized: 4,
  }[workPriority(task)];
}

function compareBriefTasks(left: FamilyTask, right: FamilyTask) {
  if (left.status !== right.status) {
    if (left.status === "in_progress") return -1;
    if (right.status === "in_progress") return 1;
    if (left.status === "on_hold") return 1;
    if (right.status === "on_hold") return -1;
  }
  const priorityDifference = briefPriorityRank(left) - briefPriorityRank(right);
  if (priorityDifference) return priorityDifference;
  if (left.due_at && right.due_at) {
    const dueDifference = left.due_at.localeCompare(right.due_at);
    if (dueDifference) return dueDifference;
  } else if (left.due_at) {
    return -1;
  } else if (right.due_at) {
    return 1;
  }
  return left.title.localeCompare(right.title);
}

function briefTaskTiming(task: FamilyTask, today: string) {
  if (task.status === "on_hold") return "On hold";
  const due = localDateFor(task.due_at);
  if (!due) return "No due date";
  if (due < today) return "Overdue";
  if (due === today) return "Due today";
  return dateLabel(due);
}

function briefTaskPriority(task: FamilyTask) {
  const priority = workPriority(task);
  if (priority === "critical") return "Critical";
  if (priority === "high") return "High priority";
  if (priority === "planned") return "Planned";
  if (priority === "later") return "Later";
  return "Needs priority";
}

function MorningBriefPanel({
  state,
  morning,
  openConsequences,
  preparation,
  onOpenItem,
  onOpenAttention,
  onMeals,
  onMember,
}: {
  state: PepperState;
  morning?: MorningRitual;
  openConsequences: Consequence[];
  preparation: PreparationItem[];
  onOpenItem: (item: SelectedItem) => void;
  onOpenAttention: (item: AttentionItem) => void;
  onMeals: () => void;
  onMember: () => void;
}) {
  const today = localDate();
  const activeEvents = state.events
    .filter(
      (event) =>
        localDateFor(event.starts_at) === today &&
        !["completed", "canceled"].includes(event.status),
    )
    .sort(
      (left, right) =>
        new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime(),
    );
  const taskMap = new Map<string, FamilyTask>();
  for (const task of [
    ...(state.familyTasks || []),
    ...(state.privateTasks || []),
    ...(state.chores || []),
    ...(morning?.focus_tasks || []),
  ]) {
    taskMap.set(task.id, task);
  }
  const routineTaskTitles = new Set(
    [...taskMap.values()]
      .filter((task) => isChore(task) || isWorkTask(task))
      .map((task) => task.title.trim().toLowerCase()),
  );
  const relevantPreparation = preparation.filter(
    (item) => !routineTaskTitles.has(item.title.trim().toLowerCase()),
  );
  const focusTasks = [...taskMap.values()]
    .filter(
      (task) =>
        task.owner_member_id === state.member.id &&
        !["completed", "canceled"].includes(task.status),
    )
    .sort(compareBriefTasks);
  const taskGroupOrder: BriefTaskGroup[] = ["work", "theatre", "school", "chores", "personal"];
  const focusGroups = taskGroupOrder
    .map((key) => {
      const tasks = focusTasks.filter((task) => briefTaskGroup(task) === key);
      const limit = key === "work" ? 6 : key === "theatre" ? 4 : 5;
      return { key, label: BRIEF_TASK_LABELS[key], total: tasks.length, tasks: tasks.slice(0, limit) };
    })
    .filter((group) => group.total > 0);
  const displayedTaskCount = focusGroups.reduce(
    (total, group) => total + group.tasks.length,
    0,
  );
  const transportEvents = activeEvents.filter(
    (event) =>
      Boolean(event.transport_status) ||
      /pick[ -]?up|drop[ -]?off|school run|ride|transport/i.test(event.title),
  );
  const transportIssue = transportEvents.find(
    (event) =>
      event.transport_status === "unassigned" ||
      !event.transport_owner_member_id,
  );
  const todayMeal = (state.meals || []).find(
    (meal) => meal.meal_date === today,
  );
  const openGroceries = (state.groceries || []).filter(
    (item) => item.status !== "completed",
  );
  const mealGroceries = todayMeal
    ? openGroceries.filter((item) => item.meal_plan_id === todayMeal.id)
    : openGroceries.filter((item) => !item.meal_plan_id);
  const unassignedGroceries = mealGroceries.filter(
    (item) => !item.owner_member_id,
  );
  const latestHealth = state.integrations?.apple_health?.latest;
  const nextEvent = activeEvents[0];
  const nextTask = focusTasks[0];
  const firstAttention = openConsequences[0];
  const firstTransport = transportIssue || transportEvents[0];
  const outcomes = [
    firstAttention
      ? {
          label: "Decision",
          title: firstAttention.title,
          detail: firstAttention.summary,
          onOpen: () => onOpenAttention(firstAttention),
        }
      : nextTask
        ? {
            label: BRIEF_TASK_LABELS[briefTaskGroup(nextTask)],
            title: nextTask.title,
            detail: `${briefTaskPriority(nextTask)} · ${briefTaskTiming(nextTask, today)}${nextTask.project ? ` · ${nextTask.project}` : ""}`,
            onOpen: () => onOpenItem({ type: "task", item: nextTask }),
          }
        : {
            label: "Priority",
            title: nextEvent?.title || "The known plan is covered",
            detail: nextEvent
              ? `Next at ${time(nextEvent.starts_at)}.`
              : "No urgent outcome is unresolved.",
            onOpen: nextEvent
              ? () => onOpenItem({ type: "event", item: nextEvent })
              : undefined,
          },
    firstTransport
      ? {
          label: "Handoff",
          title: firstTransport.title,
          detail: transportIssue
            ? "A driver still needs to be assigned."
            : `${memberName(state, firstTransport.transport_owner_member_id) || "Driver"} owns this ride.`,
          onOpen: () => onOpenItem({ type: "event", item: firstTransport }),
        }
      : {
          label: "Handoff",
          title: "No uncovered ride found",
          detail: "Pepper has no transportation gap in today's known plan.",
        },
    unassignedGroceries.length
      ? {
          label: "Capacity",
          title: `${countLabel(unassignedGroceries.length, "grocery item")} need an owner`,
          detail: todayMeal
            ? `For tonight's ${todayMeal.meal_name}.`
            : "Assign the weekly shop once.",
          onOpen: onMeals,
        }
      : todayMeal
        ? {
            label: "Capacity",
            title: todayMeal.meal_name,
            detail: `Tonight's meal is in the plan${memberName(state, todayMeal.owner_member_id) ? ` with ${memberName(state, todayMeal.owner_member_id)} cooking` : ""}.`,
            onOpen: onMeals,
          }
        : {
            label: "Capacity",
            title: latestHealth?.step_count
              ? `${latestHealth.step_count.toLocaleString()} steps recorded`
              : "Protect some recovery space",
            detail: "Capacity is part of the plan, not an afterthought.",
          },
  ];

  return (
    <div className={styles.morningBrief}>
      <header className={styles.morningBriefMasthead}>
        <div>
          <div className={styles.eyebrow}>
            {displayName(state.member)} · Morning Brief
          </div>
          <h2>Protect the hinge points.</h2>
        </div>
        <div className={styles.morningBriefDate}>
          <strong>{longDate()}</strong>
          <span>{morning?.headline || "Live family state"}</span>
        </div>
      </header>

      <section className={styles.morningBriefOutcomes}>
        <div className={styles.morningBriefBandTitle}>
          Three must-protect outcomes
        </div>
        <div className={styles.morningBriefOutcomeGrid}>
          {outcomes.map((outcome, index) => {
            const content = (
              <>
                <span>{index + 1}</span>
                <div>
                  <small>{outcome.label}</small>
                  <strong>{outcome.title}</strong>
                  <p>{outcome.detail}</p>
                </div>
              </>
            );
            return outcome.onOpen ? (
              <button
                type="button"
                className={styles.morningBriefOutcome}
                key={outcome.label}
                onClick={outcome.onOpen}
              >
                {content}
              </button>
            ) : (
              <div className={styles.morningBriefOutcome} key={outcome.label}>
                {content}
              </div>
            );
          })}
        </div>
      </section>

      <div className={styles.morningBriefColumns}>
        <div className={styles.morningBriefColumn}>
          <BriefSection title="Places to be + transportation">
            {activeEvents.length ? (
              activeEvents.slice(0, 7).map((event) => (
                <button
                  type="button"
                  className={styles.morningBriefRow}
                  key={event.id}
                  onClick={() => onOpenItem({ type: "event", item: event })}
                >
                  <time>{time(event.starts_at)}</time>
                  <span>
                    <strong>{event.title}</strong>
                    <small>
                      {event.location || "Location not recorded"}
                      {event.transport_status
                        ? ` · ${memberName(state, event.transport_owner_member_id) || "Needs a driver"}`
                        : ""}
                    </small>
                  </span>
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              ))
            ) : (
              <BriefEmpty>No places are recorded for today.</BriefEmpty>
            )}
          </BriefSection>

          <BriefSection title="Your task plan">
            {focusGroups.length ? (
              <>
                <div className={styles.morningBriefTaskSummary}>
                  <strong>
                    {countLabel(
                      morning?.task_summary?.open ?? focusTasks.length,
                      "open task",
                    )}
                  </strong>
                  <span>
                    {morning?.task_summary?.high_priority
                      ? `${countLabel(
                          morning.task_summary.high_priority,
                          "high-priority task",
                          "high-priority tasks",
                        )} · `
                      : ""}
                    Showing the next {displayedTaskCount}
                  </span>
                </div>
                {focusGroups.map((group) => (
                  <div className={styles.morningBriefTaskGroup} key={group.key}>
                    <div className={styles.morningBriefTaskGroupHeader}>
                      <strong>{group.label}</strong>
                      <span>{group.total}</span>
                    </div>
                    {group.tasks.map((task) => (
                      <button
                        type="button"
                        className={styles.morningBriefRow}
                        key={task.id}
                        onClick={() => onOpenItem({ type: "task", item: task })}
                      >
                        <span className={styles.morningBriefCheck} aria-hidden="true" />
                        <span>
                          <strong>{task.title}</strong>
                          <small>
                            {briefTaskPriority(task)} · {briefTaskTiming(task, today)}
                            {task.project ? ` · ${task.project}` : ""}
                          </small>
                        </span>
                        <ChevronRight size={16} aria-hidden="true" />
                      </button>
                    ))}
                    {group.total > group.tasks.length ? (
                      <button
                        type="button"
                        className={styles.morningBriefMore}
                        onClick={onMember}
                      >
                        {group.total - group.tasks.length} more in {group.label.toLowerCase()}
                      </button>
                    ) : null}
                  </div>
                ))}
              </>
            ) : (
              <BriefEmpty>No open task is assigned to you.</BriefEmpty>
            )}
          </BriefSection>

          <BriefSection title="Decide + prepare" tone="coral">
            {openConsequences.length || relevantPreparation.length ? (
              <>
                {openConsequences.slice(0, 3).map((item) => (
                  <button
                    type="button"
                    className={styles.morningBriefDecision}
                    key={item.id}
                    onClick={() => onOpenAttention(item)}
                  >
                    <strong>{item.title}</strong>
                    <span>{item.summary}</span>
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                ))}
                {relevantPreparation.slice(0, 3).map((item) => (
                  <div className={styles.morningBriefDecision} key={item.id}>
                    <strong>{item.title}</strong>
                    <span>{item.summary || "Worth handling before it becomes urgent."}</span>
                  </div>
                ))}
              </>
            ) : (
              <BriefEmpty>No decision is waiting on you.</BriefEmpty>
            )}
          </BriefSection>
        </div>

        <div className={styles.morningBriefColumn}>
          <BriefSection title={"Tonight's dinner + groceries"} tone="green">
            <button
              type="button"
              className={styles.morningBriefFeature}
              onClick={onMeals}
            >
              <Utensils size={20} aria-hidden="true" />
              <span>
                <strong>{todayMeal?.meal_name || "Dinner is not planned yet"}</strong>
                <small>
                  {todayMeal
                    ? [
                        memberName(state, todayMeal.owner_member_id)
                          ? `${memberName(state, todayMeal.owner_member_id)} cooks`
                          : "Cook unassigned",
                        memberName(state, todayMeal.shopping_owner_member_id)
                          ? `${memberName(state, todayMeal.shopping_owner_member_id)} shops`
                          : "Shop unassigned",
                      ].join(" · ")
                    : "Open Meals to choose dinner and assign the shop."}
                </small>
              </span>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
            {mealGroceries.length ? (
              <p className={styles.morningBriefInlineList}>
                Groceries: {mealGroceries.slice(0, 4).map((item) => item.item).join(", ")}
                {mealGroceries.length > 4 ? ` +${mealGroceries.length - 4} more` : ""}
              </p>
            ) : null}
          </BriefSection>

          <BriefSection title="Evening self-care" tone="lavender">
            <div className={styles.morningBriefFeatureStatic}>
              <HeartPulse size={20} aria-hidden="true" />
              <span>
                <strong>
                  {latestHealth?.step_count
                    ? `${latestHealth.step_count.toLocaleString()} steps so far`
                    : "Leave capacity for the close of the day"}
                </strong>
                <small>
                  {latestHealth?.step_goal
                    ? `${latestHealth.step_goal.toLocaleString()} step goal · ${latestHealth.active_minutes || 0} active minutes`
                    : "Health context stays private to the person who can see it."}
                </small>
              </span>
            </div>
          </BriefSection>

          <BriefSection title="Heart + compass">
            <dl className={styles.morningBriefCompass}>
              <div>
                <dt>Mindset</dt>
                <dd>{state.weeklyInsight?.observation || "Protect what matters before adding more."}</dd>
              </div>
              <div>
                <dt>Future {displayName(state.member)}</dt>
                <dd>{morning?.tomorrow?.headline || "Carry forward only what remains truly open."}</dd>
              </div>
              <div>
                <dt>Gratitude</dt>
                <dd>Available for tonight&apos;s private reflection.</dd>
              </div>
            </dl>
          </BriefSection>

          <BriefSection title="Trust + freshness" tone="quiet">
            <div className={styles.morningBriefTrust}>
              <span>
                Calendar {state.calendarStatus?.connected ? "connected" : "not connected"}
                {state.calendarStatus?.last_synced_at
                  ? ` · ${connectionActivity(state.calendarStatus.last_synced_at)}`
                  : ""}
              </span>
              <span>
                Email {state.integrations?.gmail?.connected ? "connected" : "not connected"}
                {state.integrations?.gmail?.last_synced_at
                  ? ` · ${connectionActivity(state.integrations.gmail.last_synced_at)}`
                  : ""}
              </span>
              <span>Built for {displayName(state.member)} from permitted One Brain state.</span>
            </div>
          </BriefSection>
        </div>
      </div>
    </div>
  );
}

function BriefSection({
  title,
  tone = "default",
  children,
}: {
  title: string;
  tone?: "default" | "blue" | "green" | "coral" | "lavender" | "quiet";
  children: React.ReactNode;
}) {
  return (
    <section className={styles.morningBriefSection} data-tone={tone}>
      <h3>{title}</h3>
      <div>{children}</div>
    </section>
  );
}

function BriefEmpty({ children }: { children: React.ReactNode }) {
  return <p className={styles.morningBriefEmpty}>{children}</p>;
}

function EveningReflectionOutput({
  state,
  input,
  evening,
}: {
  state: PepperState;
  input: string;
  evening?: EveningRitual;
}) {
  const today = localDate();
  const taskMap = new Map<string, FamilyTask>();
  for (const task of [
    ...(state.familyTasks || []),
    ...(state.privateTasks || []),
    ...(state.chores || []),
  ]) {
    taskMap.set(task.id, task);
  }
  const completedTasks = [...taskMap.values()].filter(
    (task) =>
      task.status === "completed" &&
      localDateFor(task.completed_at || task.updated_at) === today,
  );
  const completedEvents = state.events.filter(
    (event) =>
      event.status === "completed" && localDateFor(event.starts_at) === today,
  );
  const openDue = [...taskMap.values()].filter(
    (task) =>
      !["completed", "canceled"].includes(task.status) &&
      localDateFor(task.due_at) === today,
  );
  const openConsequences = visibleConsequences(state.consequences || []);
  const verifiedHandled =
    completedTasks.length + completedEvents.length || evening?.handled_today || 0;
  const latestHealth = state.integrations?.apple_health?.latest;
  const usageToday = (state.captures || []).filter(
    (capture) =>
      localDateFor(
        capture.created_at || capture.captured_at || capture.updated_at,
      ) === today,
  ).length;
  const person = displayName(state.member);

  return (
    <div className={styles.eveningOutput}>
      <header className={styles.eveningOutputHeader}>
        <div className={styles.eyebrow}>{person} · Private reflection</div>
        <h2>Pepper Evening Reflection</h2>
        <span>{longDate()}</span>
      </header>

      <p className={styles.eveningLead}>
        <strong>Provisional answer:</strong>{" "}
        {verifiedHandled
          ? `today moved closer through ${countLabel(verifiedHandled, "verified completion")}.`
          : "Pepper does not yet have completion evidence for today; missing evidence is not the same as failure."}
        {latestHealth?.step_count
          ? ` Health shows ${latestHealth.step_count.toLocaleString()} steps${latestHealth.active_minutes ? ` and ${latestHealth.active_minutes} active minutes` : ""}.`
          : ""}
      </p>

      <blockquote className={styles.eveningInputQuote}>
        <strong>Your account of the day</strong>
        <p>{input}</p>
      </blockquote>

      <section>
        <h3>Today&apos;s principle: Carry only what is truly open.</h3>
        <p>
          Pepper separates verified completion, a deliberate cancelation, and a missing update. An incomplete record does not automatically become tonight&apos;s emergency.
        </p>
      </section>

      <section>
        <h3>Honest drift</h3>
        <p>
          {openDue.length || openConsequences.length
            ? `${countLabel(openDue.length, "due item")} and ${countLabel(openConsequences.length, "decision")} remain visibly open. Pepper is not marking either as failed without evidence.`
            : "Nothing due today or awaiting a decision remains open in the state this person is permitted to see."}
        </p>
      </section>

      <section className={styles.enoughnessGate}>
        <h3>Enoughness Gate</h3>
        <p>
          Do not turn every missing checkbox into tonight&apos;s work. Preserve what is already handled, repair only consequential gaps, and release optional resets that do not outrank health, family handoffs, or tomorrow&apos;s first commitment.
        </p>
      </section>

      <section>
        <h3>Values check</h3>
        <p>
          {state.weeklyInsight?.observation ||
            "Truth means distinguishing scheduled from completed. Care means protecting capacity. Self-trust means defining enough before adding effort."}
        </p>
      </section>

      <section>
        <h3>Future {person}</h3>
        <p>
          {evening?.tomorrow_headline ||
            "Begin with a short exact-state check, protect the first commitment, and carry forward only verified gaps."}
        </p>
      </section>

      <footer className={styles.eveningFreshness}>
        <strong>Sync freshness</strong>
        <span>
          Reflection saved privately for {person}. {usageToday
            ? `${countLabel(usageToday, "Pepper update")} recorded today. `
            : ""}
          Calendar {state.calendarStatus?.connected ? "connected" : "not connected"}; email {state.integrations?.gmail?.connected ? "connected" : "not connected"}.
        </span>
      </footer>
    </div>
  );
}

function AttentionCard({
  item,
  onOpen,
}: {
  item: AttentionItem;
  onOpen: () => void;
}) {
  const type =
    ("consequence_type" in item ? item.consequence_type : null) ||
    item.type ||
    "";
  const isConflict = ["person_conflict", "driver_conflict"].includes(type);
  const canResolve = isConflict
    ? Boolean(item.primary_event && item.related_event)
    : Boolean(item.primary_event);
  const action = isConflict ? "Choose a plan" : "Assign or cancel";

  return (
    <button
      type="button"
      className={`${styles.notice} ${styles.noticeButton}`}
      disabled={!canResolve}
      onClick={onOpen}
    >
      <span>
        <strong>{productNameText(item.title)}</strong>
        <p>{productNameText(item.summary)}</p>
        {canResolve ? <small className={styles.noticeAction}>{action}</small> : null}
      </span>
      {canResolve ? <ChevronRight size={19} aria-hidden="true" /> : null}
    </button>
  );
}

function SchoolTransportationSummary({
  dropoffs,
  pickups,
  state,
  onOpen,
}: {
  dropoffs: FamilyEvent[];
  pickups: FamilyEvent[];
  state: PepperState;
  onOpen: (event: FamilyEvent) => void;
}) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionLabel}>School transportation</div>
      <div className={styles.schoolTransportGroups}>
        {dropoffs.length ? (
          <SchoolTransportGroup
            events={dropoffs}
            label="School drop-off"
            state={state}
            onOpen={onOpen}
          />
        ) : null}
        {pickups.length ? (
          <SchoolTransportGroup
            events={pickups}
            label="School pickup"
            state={state}
            onOpen={onOpen}
          />
        ) : null}
      </div>
    </section>
  );
}

function SchoolTransportGroup({
  events,
  label,
  state,
  onOpen,
}: {
  events: FamilyEvent[];
  label: "School drop-off" | "School pickup";
  state: PepperState;
  onOpen: (event: FamilyEvent) => void;
}) {
  const drivers = Array.from(
    new Set(
      events
        .map((event) => memberName(state, event.transport_owner_member_id))
        .filter(Boolean),
    ),
  );
  const routeLabel =
    label === "School drop-off"
      ? "Confirmed daily route"
      : `${events.length} ${events.length === 1 ? "pickup" : "pickups"}`;
  const coverage = drivers.length
    ? `${routeLabel} · ${drivers.join(" + ")} driving`
    : routeLabel;

  return (
    <details className={styles.schoolTransportGroup}>
      <summary>
        <span className={styles.schoolTransportIcon} aria-hidden="true">
          <School size={18} strokeWidth={1.8} />
        </span>
        <span className={styles.schoolTransportSummary}>
          <strong>{label}</strong>
          <small>{coverage}</small>
        </span>
        <ChevronRight
          className={styles.schoolTransportChevron}
          size={19}
          aria-hidden="true"
        />
      </summary>
      <div className={styles.schoolTransportDetails}>
        {events.map((event) => (
          <EventRow
            event={event}
            state={state}
            key={event.id}
            onOpen={() => onOpen(event)}
          />
        ))}
      </div>
    </details>
  );
}

function FrontSeatCard({
  frontSeat,
  onOpen,
}: {
  frontSeat: FrontSeatState;
  onOpen: () => void;
}) {
  const today = frontSeat.today;
  return (
    <section className={styles.section}>
      <button
        type="button"
        className={styles.frontSeatCard}
        onClick={onOpen}
        aria-label={`Front seat today: ${today.assigned_member.display_name}. Open the rotation.`}
      >
        <span className={styles.frontSeatIcon} aria-hidden="true">
          <Armchair size={21} strokeWidth={1.7} />
        </span>
        <span className={styles.frontSeatCardBody}>
          <span className={styles.sectionLabel}>Front seat today</span>
          <strong>{today.assigned_member.display_name}</strong>
          <small>
            {today.status === "confirmed"
              ? "Ride confirmed"
              : today.source === "manual"
                ? "Today’s turn was changed"
                : "Posey → Chloe → Lyra"}
          </small>
        </span>
        <ChevronRight size={19} aria-hidden="true" />
      </button>
    </section>
  );
}

function FrontSeatSheet({
  frontSeat,
  busy,
  onClose,
  onUpdate,
}: {
  frontSeat: FrontSeatState;
  busy: boolean;
  onClose: () => void;
  onUpdate: (
    operation: "assign" | "reset" | "confirm",
    assignedMemberId?: string,
  ) => Promise<void>;
}) {
  const today = frontSeat.today;
  return (
    <div className={styles.sheetBackdrop} role="presentation" onMouseDown={onClose}>
      <section
        className={`${styles.actionSheet} ${styles.frontSeatSheet}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="front-seat-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button type="button" className={styles.sheetClose} onClick={onClose} aria-label="Close">
          <X size={19} />
        </button>
        <div className={styles.eyebrow}>Family rotation</div>
        <h2 id="front-seat-title">The front-seat turn</h2>
        <p className={styles.sheetIntro}>
          Youngest to oldest, one day at a time. A change today will not disturb tomorrow’s turn.
        </p>

        <div className={styles.frontSeatToday} data-confirmed={today.status === "confirmed"}>
          <span className={styles.frontSeatTodayIcon} aria-hidden="true">
            <Armchair size={26} strokeWidth={1.6} />
          </span>
          <span>
            <small>Today</small>
            <strong>{today.assigned_member.display_name}</strong>
            <span>
              {today.status === "confirmed"
                ? "Confirmed in front"
                : today.source === "manual"
                  ? "Changed for today"
                  : "Regular turn"}
            </span>
          </span>
          {today.status === "confirmed" ? <Check size={21} aria-label="Confirmed" /> : null}
        </div>

        {frontSeat.can_manage ? (
          <div className={styles.frontSeatManage}>
            <span>Change today’s turn</span>
            <div className={styles.frontSeatChoices} role="group" aria-label="Choose today’s front-seat rider">
              {frontSeat.participants.map((participant) => (
                <button
                  type="button"
                  key={participant.id}
                  aria-pressed={participant.id === today.assigned_member_id}
                  disabled={busy || participant.id === today.assigned_member_id}
                  onClick={() => void onUpdate("assign", participant.id)}
                >
                  {participant.display_name}
                </button>
              ))}
            </div>
            {today.source === "manual" ? (
              <button
                type="button"
                className={styles.frontSeatReset}
                disabled={busy}
                onClick={() => void onUpdate("reset")}
              >
                <RotateCcw size={15} aria-hidden="true" /> Restore regular turn
              </button>
            ) : null}
          </div>
        ) : (
          <p className={styles.permissionNote}>Danielle or Matt can change today’s turn.</p>
        )}

        <div className={styles.frontSeatWeek}>
          <strong>Coming up</strong>
          {frontSeat.days.slice(1).map((day) => (
            <div className={styles.frontSeatDay} key={day.date}>
              <span>{dateLabel(day.date)}</span>
              <strong>{day.assigned_member.display_name}</strong>
              {day.source === "manual" ? <small>Changed</small> : null}
            </div>
          ))}
        </div>

        {today.can_confirm && today.status !== "confirmed" ? (
          <div className={styles.sheetActions}>
            <button type="button" disabled={busy} onClick={() => void onUpdate("confirm")}>
              <Check size={17} aria-hidden="true" /> {busy ? "Saving…" : "Confirm today’s ride"}
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function EventRow({
  event,
  state,
  onOpen,
  showDate = false,
}: {
  event: FamilyEvent;
  state: PepperState;
  onOpen?: () => void;
  showDate?: boolean;
}) {
  const driver = memberName(state, event.transport_owner_member_id);
  return (
    <button
      type="button"
      className={`${styles.eventRow} ${showDate ? styles.eventRowWithDate : ""}`}
      onClick={onOpen}
    >
      <div className={styles.eventTime}>
        {showDate ? <span>{dateLabel(localDateFor(event.starts_at))}</span> : null}
        <span>{time(event.starts_at)}</span>
      </div>
      <div className={styles.eventBody}>
        <strong>{event.title}</strong>
        {event.location ? <p>{event.location}</p> : null}
        {driver ? (
          <span className={styles.ownerPill}>{driver} driving</span>
        ) : event.kind === "transport" || event.transport_status === "unassigned" ? (
          <span className={styles.needPill}>Driver needed</span>
        ) : null}
      </div>
      {onOpen ? <ChevronRight className={styles.rowChevron} size={18} /> : null}
    </button>
  );
}

function HealthSummary({
  health,
  onOpen,
}: {
  health?: NonNullable<PepperState["integrations"]>["apple_health"];
  onOpen: () => void;
}) {
  const latest = health?.latest;
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeading}>
        <div className={styles.sectionLabel}>Health</div>
        <button type="button" className={styles.textButton} onClick={onOpen}>
          {health?.connected ? "Connection" : "Connect"}
        </button>
      </div>
      <button type="button" className={styles.healthSummary} onClick={onOpen}>
        <HeartPulse size={21} aria-hidden="true" />
        <span>
          <strong>
            {latest?.step_count != null
              ? `${latest.step_count.toLocaleString()} steps`
              : "Apple Health is not reporting yet"}
          </strong>
          <small>
            {latest?.step_goal
              ? `Goal ${latest.step_goal.toLocaleString()} · ${latest.active_minutes || 0} active minutes`
              : health?.connected
                ? `${latest?.active_minutes || 0} active minutes today`
                : "Connect Apple Health from your iPhone."}
          </small>
        </span>
        <ChevronRight size={18} />
      </button>
    </section>
  );
}

function ConnectionsPage({
  calendar,
  gmail,
  health,
  healthSetup,
  nativeHealthAvailable,
  member,
  members,
  isPending,
  onCalendar,
  onEmail,
  onHealth,
  onFamily,
  onDeleteAccount,
}: {
  calendar?: CalendarStatus;
  gmail?: NonNullable<PepperState["integrations"]>["gmail"];
  health?: NonNullable<PepperState["integrations"]>["apple_health"];
  healthSetup: HealthSetup | null;
  nativeHealthAvailable: boolean;
  member: PepperState["member"];
  members: PepperState["members"];
  isPending: (key: string) => boolean;
  onCalendar: () => void;
  onEmail: () => void;
  onHealth: () => void;
  onFamily: () => void;
  onDeleteAccount: (confirmation: string) => Promise<boolean>;
}) {
  const [openProvider, setOpenProvider] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const calendarConnection = calendar?.connection;
  const canConnectEmail = ["adult_admin", "adult", "teen"].includes(member.role);
  const calendarOwner = displayName(
    members.find(
      (candidate) => candidate.id === calendarConnection?.connected_by_member_id,
    ),
  );
  const familyCoverage = members.map(displayName).join(", ");
  const schoolCoverage = members
    .filter((candidate) => ["teen", "child"].includes(candidate.role))
    .map(displayName)
    .join(", ");
  const providers: ConnectionProviderView[] = [
    {
      id: "calendar",
      group: "Email and calendars",
      icon: <CalendarDays size={21} />,
      mark: "G",
      title: "Google Calendar",
      identifier:
        calendarConnection?.calendar_name || "Primary Google Calendar",
      summary: calendar?.connected
        ? "Calendar evidence is flowing into schedules, transportation, and conflict checks."
        : "Read-only schedule evidence for events, locations, and conflicts.",
      state: calendar?.connected
        ? "connected"
        : calendar?.configured
          ? "available"
          : "setup",
      statusLabel: calendar?.connected
        ? "Connected"
        : calendar?.configured
          ? "Ready to connect"
          : "Setup pending",
      owner: calendarOwner || "Assigned when connected",
      privacy: "Per event",
      coverage: familyCoverage,
      lastActivity: connectionActivity(calendarConnection?.last_synced_at),
      reads: [
        "Event title, time, location, attendance, and provider changes",
        "Owner and transportation signals included with calendar evidence",
      ],
      automatic: [
        "Compare calendar evidence with the canonical family plan",
        "Raise schedule, ownership, and transportation conflicts",
      ],
      approval: [
        "Creating or changing an external calendar event",
        "Invitations, notifications, and new commitments",
      ],
      sharing:
        "Calendar evidence keeps the household or private visibility of the family item it supports.",
      feeds: ["Today", "Morning brief", "Family pages"],
      action: calendar?.connected
        ? "Refresh"
        : calendar?.configured
          ? "Connect"
          : "Setup pending",
      actionDisabled:
        !calendar?.configured || isPending("connection:calendar"),
      actionBusy: isPending("connection:calendar"),
      actionIcon: calendar?.connected ? <RefreshCw size={15} /> : <Plus size={15} />,
      onAction: onCalendar,
    },
    {
      id: "gmail",
      group: "Email and calendars",
      icon: <Mail size={21} />,
      mark: "M",
      title: "Google email",
      identifier: gmail?.metadata?.email || "Gmail or Google Workspace",
      summary: gmail?.connected
        ? "Account linked. Pepper checks recent priority messages only when this member requests a day plan."
        : canConnectEmail
          ? "Connect the personal, school, or work Google account you use most."
          : "Email connections are available from adult and teen profiles.",
      state: gmail?.connected
        ? "connected"
        : gmail?.configured && canConnectEmail
          ? "available"
          : "setup",
      statusLabel: gmail?.connected
        ? "Connected"
        : gmail?.configured && canConnectEmail
          ? "Ready to connect"
          : canConnectEmail
            ? "Setup pending"
            : "Not available",
      owner: displayName(member),
      privacy: "Private source",
      coverage: displayName(member),
      lastActivity: gmail?.connected ? connectionActivity(gmail.last_synced_at) : "No verified activity yet",
      reads: [
        "Google account identity for the connected member",
        "Subject, sender, and short snippet from recent unread or important messages when Plan my day is requested",
      ],
      automatic: [
        "Rank likely email commitments alongside this member's tasks and appointments",
        "Do not create a task or mark anything handled from email alone",
      ],
      approval: [
        "Sending email or sharing private content",
        "Creating any new external commitment",
      ],
      sharing:
        "Private by default. Only permission-safe family actions may leave the member's private context.",
      feeds: ["Private day plan"],
      action: gmail?.connected
        ? undefined
        : gmail?.configured && canConnectEmail
          ? "Connect"
          : canConnectEmail
            ? "Setup pending"
            : undefined,
      actionDisabled:
        !gmail?.configured || !canConnectEmail || isPending("connection:email"),
      actionBusy: isPending("connection:email"),
      actionIcon: <Plus size={15} />,
      onAction: onEmail,
    },
    {
      id: "school",
      group: "Schools and activities",
      icon: <School size={21} />,
      mark: "S",
      title: "School schedules",
      identifier: "La Mariposa · Las Colinas · Rancho Campana",
      summary:
        "Official 2026–27 rules and dated exceptions live directly in One Brain.",
      state: "builtin",
      statusLabel: "Built into One Brain",
      owner: "Pepper",
      privacy: "Family",
      coverage: schoolCoverage || "Chloe, Lyra, Posey",
      lastActivity: "2026–27 rules loaded",
      reads: [
        "Official school-day, minimum-day, early-release, finals, and no-school rules",
        "Family arrival targets, pickup ownership, and activity handoffs",
      ],
      automatic: [
        "Replace normal pickup times when an exception applies",
        "Check missing drivers and impossible transportation handoffs",
      ],
      approval: [
        "Changing a driver or canceling an active plan",
        "Any new external school commitment",
      ],
      sharing:
        "School logistics are shared only with members of this Pepper household.",
      feeds: ["Today", "Morning brief", "Family pages"],
      action: "Open family",
      actionIcon: <UsersRound size={15} />,
      onAction: onFamily,
    },
    {
      id: "health",
      group: "Health and personal",
      icon: <HeartPulse size={21} />,
      mark: "H",
      title: "Apple Health",
      identifier: health?.connected
        ? `Last received ${health.latest?.metric_date || "recently"}`
        : nativeHealthAvailable
          ? health?.status === "pending"
            ? "This iPhone · Health access incomplete"
            : "This iPhone · HealthKit"
          : health?.status === "pending"
          ? "Apple Health Shortcut waiting"
          : "This iPhone",
      summary: health?.connected
        ? "Approved daily steps, goals, and active minutes are reaching Pepper."
        : nativeHealthAvailable
          ? health?.status === "pending"
            ? "No activity has reached Pepper yet. Try again and approve Steps and Exercise in Health."
            : "Read your approved daily steps and exercise minutes directly from Apple Health."
          : "A private iPhone pathway for steps, goals, and active minutes.",
      state: health?.connected
        ? "connected"
        : health?.status === "pending"
          ? "available"
          : "setup",
      statusLabel: health?.connected
        ? "Connected"
        : health?.status === "pending"
          ? nativeHealthAvailable
            ? "Needs attention"
            : "Pairing ready"
          : "Not connected",
      owner: displayName(member),
      privacy: "Private",
      coverage: displayName(member),
      lastActivity: health?.latest?.metric_date
        ? dateLabel(health.latest.metric_date)
        : "No verified activity yet",
      reads: [
        nativeHealthAvailable
          ? "Only today's steps and exercise minutes after you approve Health access"
          : "Only daily steps, step goal, and active minutes approved in the iPhone Shortcut",
      ],
      automatic: [
        "Update this member's private Home health summary when the paired device reports",
      ],
      approval: [
        nativeHealthAvailable
          ? "Apple shows the Health permission sheet before Pepper can read anything"
          : "Every HealthKit category is selected on the iPhone",
        "Pepper never writes data back to HealthKit",
      ],
      sharing:
        "Private to this member. Health details do not appear on other family pages.",
      feeds: ["Private Home health"],
      action: health?.connected
        ? "Refresh"
        : nativeHealthAvailable
          ? health?.status === "pending"
            ? "Try again"
            : "Connect"
          : "Set up Shortcut",
      actionIcon: health?.connected ? <RefreshCw size={15} /> : <Plus size={15} />,
      actionDisabled: isPending("connection:health"),
      actionBusy: isPending("connection:health"),
      onAction: onHealth,
    },
  ];
  const groups = ["Email and calendars", "Schools and activities", "Health and personal"];
  const activeCount = providers.filter((provider) =>
    ["connected", "builtin"].includes(provider.state),
  ).length;
  const selectedProvider =
    providers.find((provider) => provider.id === openProvider) || null;
  const deletingAccount = isPending("account:delete");

  function runProviderAction(provider: ConnectionProviderView) {
    if (provider.actionDisabled || !provider.onAction) return;
    setOpenProvider(null);
    provider.onAction();
  }

  return (
    <>
      <section className={`${styles.hero} ${styles.connectionHero}`}>
        <div className={styles.eyebrow}>Connections</div>
        <h1>Your connected world.</h1>
        <p>{activeCount} active pathways · Pepper remains the source of truth for the family plan.</p>
      </section>

      <section className={styles.connectionsOverview} aria-label="Connection summary">
        <div className={styles.connectionsOverviewLead}>
          <span aria-hidden="true"><ShieldCheck size={20} /></span>
          <p>
            <small>Connection center</small>
            <strong>{activeCount} active pathways</strong>
            <em>Every source keeps its own privacy and authority boundary.</em>
          </p>
        </div>
        <dl>
          <div><dt>External actions</dt><dd>Ask first</dd></div>
          <div><dt>Visibility</dt><dd>Per source</dd></div>
          <div><dt>Credentials</dt><dd>Hidden</dd></div>
        </dl>
      </section>

      {groups.map((group) => {
        const groupProviders = providers.filter((provider) => provider.group === group);
        return (
          <section className={styles.connectionGroup} key={group}>
            <header className={styles.connectionGroupHeader}>
              <h2>{group}</h2>
              <span>{groupProviders.length}</span>
            </header>
            <div className={styles.connectionGrid}>
              {groupProviders.map((provider) => (
                <ConnectionCard
                  key={provider.id}
                  provider={provider}
                  onDetails={() => setOpenProvider(provider.id)}
                  onAction={() => runProviderAction(provider)}
                />
              ))}
            </div>
          </section>
        );
      })}

      <section className={styles.connectionGroup}>
        <header className={styles.connectionGroupHeader}>
          <h2>Household services</h2>
          <span>0</span>
        </header>
        <div className={styles.connectionEmpty}>
          <House size={19} aria-hidden="true" />
          <span>
            <strong>No household service is connected.</strong>
            <small>Only verified providers will appear here.</small>
          </span>
        </div>
      </section>

      <section className={styles.accountControls} aria-labelledby="pepper-account-heading">
        <div>
          <div className={styles.sectionLabel}>Account</div>
          <h2 id="pepper-account-heading">Your Pepper profile</h2>
          <p>
            Delete this profile and its private Pepper data. Shared family plans remain
            available to the rest of the household. If this is the household&apos;s only
            adult profile, Pepper removes the household instead.
          </p>
        </div>
        {!deleteOpen ? (
          <button
            type="button"
            className={styles.deleteAccountButton}
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 size={16} aria-hidden="true" />
            Delete my Pepper account
          </button>
        ) : (
          <div className={styles.deleteAccountConfirm}>
            <label>
              Type <strong>DELETE MY ACCOUNT</strong> to confirm
              <input
                value={deleteConfirmation}
                onChange={(event) => setDeleteConfirmation(event.target.value)}
                autoComplete="off"
              />
            </label>
            <div>
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={deletingAccount}
                onClick={() => {
                  setDeleteOpen(false);
                  setDeleteConfirmation("");
                }}
              >
                Keep account
              </button>
              <button
                type="button"
                className={styles.deleteAccountButton}
                disabled={
                  deletingAccount || deleteConfirmation !== "DELETE MY ACCOUNT"
                }
                onClick={async () => {
                  const deleted = await onDeleteAccount(deleteConfirmation);
                  if (deleted) setDeleteConfirmation("");
                }}
              >
                <Trash2 size={16} aria-hidden="true" />
                {deletingAccount ? "Deleting…" : "Delete account"}
              </button>
            </div>
          </div>
        )}
      </section>

      {healthSetup ? (
        <section className={styles.healthSetup}>
          <div>
            <div className={styles.sectionLabel}>One-time Shortcut setup</div>
            <h2>Use these in the Pepper Health Shortcut.</h2>
            <p>
              The pairing token is shown once. The Shortcut sends only the
              metrics you approve.
            </p>
          </div>
          <CopyField label="Upload URL" value={healthSetup.ingest_url} />
          <CopyField label="Pepper public key" value={healthSetup.publishable_key} />
          <CopyField label="Pairing token" value={healthSetup.pairing_token} />
        </section>
      ) : null}

      {selectedProvider ? (
        <ConnectionDetailDrawer
          provider={selectedProvider}
          onClose={() => setOpenProvider(null)}
          onAction={() => runProviderAction(selectedProvider)}
        />
      ) : null}
    </>
  );
}

type ConnectionProviderState = "connected" | "available" | "setup" | "builtin";

type ConnectionProviderView = {
  id: string;
  icon: React.ReactNode;
  mark: string;
  group: string;
  title: string;
  identifier: string;
  summary: string;
  state: ConnectionProviderState;
  statusLabel: string;
  owner: string;
  privacy: string;
  coverage: string;
  lastActivity: string;
  reads: string[];
  automatic: string[];
  approval: string[];
  sharing: string;
  feeds: string[];
  action?: string;
  actionDisabled?: boolean;
  actionBusy?: boolean;
  actionIcon?: React.ReactNode;
  onAction?: () => void;
};

function connectionActivity(value?: string | null) {
  if (!value) return "No verified activity yet";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Activity time unavailable";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function ConnectionCard({
  provider,
  onDetails,
  onAction,
}: {
  provider: ConnectionProviderView;
  onDetails: () => void;
  onAction: () => void;
}) {
  const stateClass =
    provider.state === "connected"
      ? styles.connectionStateConnected
      : provider.state === "builtin"
        ? styles.connectionStateBuiltin
        : provider.state === "available"
          ? styles.connectionStateAvailable
          : styles.connectionStateSetup;
  return (
    <article className={styles.connectionProvider}>
      <header>
        <ProviderMark icon={provider.icon} mark={provider.mark} />
        <p>
          <strong>{provider.title}</strong>
          <small>{provider.identifier}</small>
        </p>
        <span className={`${styles.connectionState} ${stateClass}`}>
          {provider.statusLabel}
        </span>
      </header>
      <p className={styles.connectionSummary}>{provider.summary}</p>
      <dl className={styles.connectionMetadata}>
        <div><dt>Owner</dt><dd>{provider.owner}</dd></div>
        <div><dt>Privacy</dt><dd>{provider.privacy}</dd></div>
        <div><dt>Last activity</dt><dd>{provider.lastActivity}</dd></div>
      </dl>
      <footer>
        <span>{provider.coverage}</span>
        <div>
          <button type="button" className={styles.connectionManage} onClick={onDetails}>
            Manage <ChevronRight size={14} aria-hidden="true" />
          </button>
          {provider.action ? (
            <button
              type="button"
              className={styles.connectionAction}
              disabled={provider.actionDisabled}
              onClick={onAction}
            >
              {provider.actionIcon}
              {provider.actionBusy ? "Working…" : provider.action}
            </button>
          ) : null}
        </div>
      </footer>
    </article>
  );
}

function ProviderMark({ icon, mark }: { icon: React.ReactNode; mark: string }) {
  return (
    <span className={styles.providerMark} aria-hidden="true">
      {icon}
      <em>{mark}</em>
    </span>
  );
}

function ConnectionDetailDrawer({
  provider,
  onClose,
  onAction,
}: {
  provider: ConnectionProviderView;
  onClose: () => void;
  onAction: () => void;
}) {
  return (
    <div
      className={styles.connectionBackdrop}
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        className={styles.connectionDrawer}
        role="dialog"
        aria-modal="true"
        aria-labelledby="connection-drawer-title"
      >
        <header className={styles.connectionDrawerHeader}>
          <div>
            <ProviderMark icon={provider.icon} mark={provider.mark} />
            <p>
              <small>{provider.group}</small>
              <strong id="connection-drawer-title">{provider.title}</strong>
              <span>{provider.statusLabel}</span>
            </p>
          </div>
          <button type="button" aria-label="Close connection details" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className={styles.connectionDrawerBody}>
          <p className={styles.connectionDrawerLead}>{provider.summary}</p>
          <dl className={styles.connectionDrawerFacts}>
            <div><dt>Account owner</dt><dd>{provider.owner}</dd></div>
            <div><dt>Visibility</dt><dd>{provider.privacy}</dd></div>
            <div><dt>Covers</dt><dd>{provider.coverage}</dd></div>
            <div><dt>Last activity</dt><dd>{provider.lastActivity}</dd></div>
          </dl>

          <section className={styles.connectionCapabilities}>
            <ConnectionCapability title="What Pepper reads" icon={<Check size={15} />} items={provider.reads} />
            <ConnectionCapability title="What happens automatically" icon={<RefreshCw size={15} />} items={provider.automatic} />
            <ConnectionCapability title="What still needs approval" icon={<LockKeyhole size={15} />} items={provider.approval} />
          </section>

          <p className={styles.connectionSharing}>
            <ShieldCheck size={16} aria-hidden="true" />
            {provider.sharing}
          </p>
          <div className={styles.connectionFeeds}>
            <span>Feeds</span>
            {provider.feeds.map((feed) => <em key={feed}>{feed}</em>)}
          </div>
        </div>

        <footer className={styles.connectionDrawerFooter}>
          <button type="button" className={styles.secondaryButton} onClick={onClose}>
            Done
          </button>
          {provider.action ? (
            <button
              type="button"
              className={styles.primaryButtonSmall}
              disabled={provider.actionDisabled}
              onClick={onAction}
            >
              {provider.actionIcon}
              {provider.actionBusy ? "Working…" : provider.action}
            </button>
          ) : null}
        </footer>
      </section>
    </div>
  );
}

function ConnectionCapability({
  title,
  icon,
  items,
}: {
  title: string;
  icon: React.ReactNode;
  items: string[];
}) {
  return (
    <article>
      <h3>{title}</h3>
      {items.map((item) => (
        <p key={item}><span aria-hidden="true">{icon}</span>{item}</p>
      ))}
    </article>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.copyField}>
      <span>
        <small>{label}</small>
        <code>{value}</code>
      </span>
      <button
        type="button"
        className={styles.iconButton}
        aria-label={`Copy ${label}`}
        title={`Copy ${label}`}
        onClick={() => void navigator.clipboard.writeText(value)}
      >
        <Copy size={17} />
      </button>
    </div>
  );
}

function workPrioritySummary(tasks: FamilyTask[]) {
  const critical = tasks.filter((task) => workPriority(task) === "critical").length;
  const high = tasks.filter((task) => workPriority(task) === "high").length;
  if (critical && high) return `${critical} critical · ${high} high priority`;
  if (critical) return `${critical} critical ${critical === 1 ? "task" : "tasks"}`;
  if (high) return `${high} high-priority ${high === 1 ? "task" : "tasks"}`;
  return tasks.length
    ? `${tasks.length} open work ${tasks.length === 1 ? "task" : "tasks"}`
    : "Work is clear.";
}

type TaskMode = "work" | "personal" | "chores";

function TasksPage({
  state,
  chores,
  isPending,
  onOpen,
  onCreateChore,
  onCreatePersonalTask,
  onToggle,
}: {
  state: PepperState;
  chores: FamilyTask[];
  isPending: (key: string) => boolean;
  onOpen: (task: FamilyTask) => void;
  onCreateChore: (draft: ChoreDraft) => Promise<boolean>;
  onCreatePersonalTask: (draft: PersonalTaskDraft) => Promise<boolean>;
  onToggle: (task: FamilyTask) => void;
}) {
  const actorIsAdult = ["adult_admin", "adult"].includes(state.member.role);
  const [mode, setMode] = useState<TaskMode>(actorIsAdult ? "work" : "personal");
  const [personalComposerOpen, setPersonalComposerOpen] = useState(false);
  const allTasks = Array.from(
    new Map(
      [...(state.familyTasks || []), ...(state.privateTasks || [])].map((task) => [task.id, task]),
    ).values(),
  );
  const personalTasks = allTasks
    .filter(
      (task) =>
        !isWorkTask(task) &&
        !isChore(task) &&
        (task.visibility === "private" || task.owner_member_id === state.member.id),
    )
    .sort(compareWorkTasks);
  const activePersonal = personalTasks.filter(
    (task) => !["completed", "canceled"].includes(task.status),
  );
  const handledPersonal = personalTasks.filter((task) =>
    ["completed", "canceled"].includes(task.status),
  );
  const modes: Array<[TaskMode, string]> = [
    ...(actorIsAdult ? [["work", "Work"] as [TaskMode, string]] : []),
    ["personal", actorIsAdult ? "Personal" : "My tasks"],
    ["chores", "Chores"],
  ];

  return (
    <>
      <section className={`${styles.hero} ${styles.taskHubHero}`}>
        <div className={styles.eyebrow}>{displayName(state.member)} · Responsibilities</div>
        <h1>Tasks</h1>
        <p>Work, personal to-dos, and chores each stay in their proper place.</p>
      </section>

      <div className={styles.taskModeTabs} role="tablist" aria-label="Task list">
        {modes.map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={mode === value}
            className={mode === value ? styles.taskModeActive : styles.taskMode}
            onClick={() => setMode(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "work" && actorIsAdult ? (
        <WorkPage tasks={allTasks} state={state} onOpen={onOpen} showHero={false} />
      ) : null}

      {mode === "personal" ? (
        <section className={styles.taskHubSection}>
          <header className={styles.taskHubHeader}>
            <div>
              <span className={styles.sectionLabel}>My list</span>
              <h2>{activePersonal.length ? `${activePersonal.length} open` : "You are clear"}</h2>
            </div>
            <button type="button" className={styles.textButton} onClick={() => setPersonalComposerOpen(true)}>
              <Plus size={15} aria-hidden="true" /> Add to-do
            </button>
          </header>
          <div className={styles.taskHubList}>
            {activePersonal.length ? activePersonal.map((task) => (
              <TaskActionRow
                key={task.id}
                task={task}
                state={state}
                onOpen={() => onOpen(task)}
              />
            )) : <div className={styles.quietEmpty}>No open personal tasks.</div>}
          </div>
          {handledPersonal.length ? (
            <details className={styles.handledDetails}>
              <summary>{handledPersonal.length} completed or canceled</summary>
              {handledPersonal.map((task) => (
                <TaskActionRow key={task.id} task={task} state={state} onOpen={() => onOpen(task)} />
              ))}
            </details>
          ) : null}
        </section>
      ) : null}

      {mode === "chores" ? (
        <ChoresPage
          chores={chores}
          state={state}
          createBusy={isPending("chore:create")}
          isItemBusy={(id) => isPending(`item:${id}`)}
          onCreate={onCreateChore}
          onOpen={onOpen}
          onToggle={onToggle}
          showHero={false}
          canCreate={actorIsAdult}
        />
      ) : null}

      {personalComposerOpen ? (
        <PersonalTaskComposer
          busy={isPending("personal-task:create")}
          onClose={() => setPersonalComposerOpen(false)}
          onCreate={async (draft) => {
            const created = await onCreatePersonalTask(draft);
            if (created) setPersonalComposerOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

function WorkPage({
  tasks,
  state,
  onOpen,
  showHero = true,
}: {
  tasks: FamilyTask[];
  state: PepperState;
  onOpen: (task: FamilyTask) => void;
  showHero?: boolean;
}) {
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const workTasks = Array.from(
    new Map(tasks.filter(isWorkTask).map((task) => [task.id, task])).values(),
  );
  const active = workTasks.filter(
    (task) => !["completed", "canceled"].includes(task.status),
  );
  const handled = workTasks
    .filter((task) => ["completed", "canceled"].includes(task.status))
    .sort(compareWorkTasks);
  const grouped = WORK_PRIORITY_GROUPS.map((group) => ({
    ...group,
    tasks: active
      .filter((task) => workPriority(task) === group.key)
      .sort(compareWorkTasks),
  })).filter((group) => group.tasks.length > 0);

  return (
    <>
      {showHero ? (
        <section className={`${styles.hero} ${styles.workHero}`}>
          <div className={styles.eyebrow}>C.W. Warren</div>
          <h1>Work</h1>
          <p>{workPrioritySummary(active)}</p>
        </section>
      ) : null}

      <div className={styles.workPriorityStack}>
        {grouped.length ? (
          grouped.map((group) => {
            const initialCount = group.key === "critical" ? group.tasks.length : 8;
            const expanded = Boolean(expandedGroups[group.key]);
            const visibleTasks = expanded
              ? group.tasks
              : group.tasks.slice(0, initialCount);
            return (
              <section className={styles.workPrioritySection} key={group.key}>
                <header className={styles.workPriorityHeader}>
                  <span>
                    <strong>{group.label}</strong>
                    <small>{group.note}</small>
                  </span>
                  <span className={styles.workPriorityCount}>{group.tasks.length}</span>
                </header>
                <div className={styles.workTaskList}>
                  {visibleTasks.map((task) => (
                    <WorkTaskRow
                      key={task.id}
                      task={task}
                      members={state.members}
                      priority={group.key}
                      onOpen={onOpen}
                    />
                  ))}
                </div>
                {group.tasks.length > initialCount ? (
                  <button
                    type="button"
                    className={styles.workReveal}
                    onClick={() =>
                      setExpandedGroups((current) => ({
                        ...current,
                        [group.key]: !expanded,
                      }))
                    }
                  >
                    {expanded
                      ? `Show fewer ${group.label.toLowerCase()} tasks`
                      : `Show all ${group.tasks.length} ${group.label.toLowerCase()} tasks`}
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                ) : null}
              </section>
            );
          })
        ) : (
          <div className={styles.quietEmpty}>
            <p>No open work tasks.</p>
          </div>
        )}
      </div>

      {handled.length ? (
        <details className={`${styles.handledDetails} ${styles.workHandled}`}>
          <summary>{handled.length} completed or canceled</summary>
          <div className={styles.workTaskList}>
            {handled.map((task) => (
              <WorkTaskRow
                key={task.id}
                task={task}
                members={state.members}
                priority={workPriority(task)}
                onOpen={onOpen}
              />
            ))}
          </div>
        </details>
      ) : null}
    </>
  );
}

const WorkTaskRow = memo(function WorkTaskRow({
  task,
  members,
  priority,
  onOpen,
}: {
  task: FamilyTask;
  members: PepperState["members"];
  priority: ReturnType<typeof workPriority>;
  onOpen: (task: FamilyTask) => void;
}) {
  const owner = displayName(
    members.find((member) => member.id === task.owner_member_id),
  );
  return (
    <button type="button" className={styles.workTaskRow} onClick={() => onOpen(task)}>
      <span
        className={styles.workPriorityMark}
        data-priority={priority}
        aria-hidden="true"
      />
      <span className={styles.workTaskBody}>
        <strong>{task.title}</strong>
        <small>
          <span className={!owner ? styles.workOwnerMissing : undefined}>
            {owner || "Needs an owner"}
          </span>
          {task.status === "on_hold" ? " · On hold" : ""}
          {task.project ? ` · ${task.project}` : ""}
          {task.due_at ? ` · ${dateLabel(task.due_at.slice(0, 10))}` : ""}
        </small>
      </span>
      <ChevronRight size={18} aria-hidden="true" />
    </button>
  );
});

type ChoreFilter = "today" | "week" | "all";

function ChoresPage({
  chores,
  state,
  createBusy,
  isItemBusy,
  onCreate,
  onOpen,
  onToggle,
  showHero = true,
  canCreate = true,
}: {
  chores: FamilyTask[];
  state: PepperState;
  createBusy: boolean;
  isItemBusy: (id: string) => boolean;
  onCreate: (draft: ChoreDraft) => Promise<boolean>;
  onOpen: (task: FamilyTask) => void;
  onToggle: (task: FamilyTask) => void;
  showHero?: boolean;
  canCreate?: boolean;
}) {
  const [filter, setFilter] = useState<ChoreFilter>("today");
  const [composerOpen, setComposerOpen] = useState(false);
  const today = localDate();
  const weekEnd = addDateDays(today, 6);
  const matchesFilter = (task: FamilyTask) => {
    if (filter === "all") return true;
    const relevantDate = ["completed", "canceled"].includes(task.status)
      ? localDateFor(task.completed_at || task.updated_at)
      : localDateFor(task.due_at);
    if (!relevantDate) return false;
    return filter === "today"
      ? relevantDate === today
      : relevantDate >= today && relevantDate <= weekEnd;
  };
  const visible = chores.filter(matchesFilter);
  const active = visible.filter(
    (task) => !["completed", "canceled"].includes(task.status),
  );
  const handled = visible.filter((task) =>
    ["completed", "canceled"].includes(task.status),
  );

  return (
    <>
      {showHero ? (
        <section className={`${styles.hero} ${styles.choreHero}`}>
          <div className={styles.eyebrow}>Family</div>
          <h1>Family chores</h1>
          <p>See every chore. Assign it once.</p>
        </section>
      ) : null}

      <div className={styles.choreToolbar}>
        <div className={styles.choreFilters} role="tablist" aria-label="Chore range">
          {([
            ["today", "Today"],
            ["week", "Week"],
            ["all", "All"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={filter === value}
              className={filter === value ? styles.choreFilterActive : styles.choreFilter}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <section className={styles.choreList} aria-label={`${filter} chores`}>
        {active.length ? (
          active.map((task) => (
            <ChoreRow
              key={task.id}
              task={task}
              members={state.members}
              actor={state.member}
              busy={isItemBusy(task.id)}
              onOpen={onOpen}
              onToggle={onToggle}
            />
          ))
        ) : (
          <div className={styles.choreEmpty}>
            <Check size={18} aria-hidden="true" />
            <span>{filter === "today" ? "No chores due today." : filter === "week" ? "No chores due this week." : "No open chores."}</span>
          </div>
        )}
      </section>

      {canCreate ? (
        <button
          type="button"
          className={styles.choreAddButton}
          onClick={() => setComposerOpen(true)}
        >
          <span><Plus size={20} aria-hidden="true" /> Add a chore</span>
          <ChevronRight size={19} aria-hidden="true" />
        </button>
      ) : null}

      <div className={styles.choreSharedNote}>
        <Info size={18} aria-hidden="true" />
        <span>One shared list · updates everyone</span>
      </div>

      {handled.length ? (
        <details className={styles.handledDetails}>
          <summary>{handled.length} completed or canceled</summary>
          {handled.map((task) => (
            <ChoreRow
              key={task.id}
              task={task}
              members={state.members}
              actor={state.member}
              busy={isItemBusy(task.id)}
              quiet
              onOpen={onOpen}
              onToggle={onToggle}
            />
          ))}
        </details>
      ) : null}

      {composerOpen && canCreate ? (
        <ChoreComposer
          members={state.members}
          actor={state.member}
          busy={createBusy}
          onClose={() => setComposerOpen(false)}
          onCreate={async (draft) => {
            const created = await onCreate(draft);
            if (created) setComposerOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

const ChoreRow = memo(function ChoreRow({
  task,
  members,
  actor,
  busy,
  quiet = false,
  onOpen,
  onToggle,
}: {
  task: FamilyTask;
  members: PepperState["members"];
  actor: PepperState["member"];
  busy: boolean;
  quiet?: boolean;
  onOpen: (task: FamilyTask) => void;
  onToggle: (task: FamilyTask) => void;
}) {
  const owner = members.find((member) => member.id === task.owner_member_id);
  const actorIsAdult = ["adult_admin", "adult"].includes(actor.role);
  const canChange =
    actorIsAdult ||
    task.owner_member_id === actor.id ||
    task.creator_member_id === actor.id;
  const completed = task.status === "completed";
  const canceled = task.status === "canceled";
  const schedule = choreSchedule(task);

  return (
    <article className={`${styles.choreRow} ${quiet ? styles.choreRowQuiet : ""}`}>
      <button
        type="button"
        className={`${styles.choreCheck} ${completed ? styles.choreCheckDone : ""}`}
        disabled={busy || !canChange}
        aria-label={completed ? `Restore ${task.title}` : canceled ? `Open ${task.title}` : `Complete ${task.title}`}
        onClick={() => (canceled ? onOpen(task) : onToggle(task))}
      >
        {completed ? <Check size={17} aria-hidden="true" /> : canceled ? <CircleX size={16} aria-hidden="true" /> : null}
      </button>
      <button type="button" className={styles.choreBody} onClick={() => onOpen(task)}>
        <strong>{task.title}</strong>
        <small>{canceled ? "Canceled" : completed ? "Completed" : task.status === "on_hold" ? "On hold" : schedule}</small>
      </button>
      <button
        type="button"
        className={`${styles.choreOwner} ${owner ? "" : styles.choreOwnerEmpty}`}
        data-member={owner?.slug || "unassigned"}
        onClick={() => onOpen(task)}
        aria-label={owner ? `Assigned to ${displayName(owner)}` : `Assign ${task.title}`}
      >
        {owner ? displayName(owner) : <><Plus size={15} aria-hidden="true" /> Assign</>}
      </button>
    </article>
  );
});

function choreSchedule(task: FamilyTask) {
  const due = localDateFor(task.due_at);
  const today = localDate();
  const recurrence = task.recurrence && task.recurrence !== "none"
    ? `${task.recurrence.slice(0, 1).toUpperCase()}${task.recurrence.slice(1)}`
    : "";
  const dueText = due === today
    ? "Today"
    : due === addDateDays(today, 1)
      ? "Tomorrow"
      : due
        ? dateLabel(due)
        : "No due date";
  return recurrence ? `${dueText} · ${recurrence}` : dueText;
}

function ChoreComposer({
  members,
  actor,
  initialOwnerMemberId,
  busy,
  onClose,
  onCreate,
}: {
  members: PepperState["members"];
  actor: PepperState["member"];
  initialOwnerMemberId?: string;
  busy: boolean;
  onClose: () => void;
  onCreate: (draft: ChoreDraft) => Promise<void>;
}) {
  const actorIsAdult = ["adult_admin", "adult"].includes(actor.role);
  const [draft, setDraft] = useState<ChoreDraft>({
    title: "",
    ownerMemberId: actorIsAdult ? initialOwnerMemberId || "" : actor.id,
    dueDate: localDate(),
    recurrence: "none",
  });

  return (
    <div className={styles.sheetBackdrop} role="presentation" onMouseDown={onClose}>
      <form
        className={`${styles.actionSheet} ${styles.choreComposer}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-chore-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (draft.title.trim()) void onCreate({ ...draft, title: draft.title.trim() });
        }}
      >
        <button type="button" className={styles.sheetClose} onClick={onClose} aria-label="Close">
          <X size={19} />
        </button>
        <div className={styles.eyebrow}>Family</div>
        <h2 id="add-chore-title">Add a chore</h2>

        <label className={styles.choreField}>
          Chore
          <input
            autoFocus
            value={draft.title}
            maxLength={240}
            placeholder="What needs doing?"
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          />
        </label>
        <label className={styles.choreField}>
          Assign to
          <select
            value={draft.ownerMemberId}
            disabled={!actorIsAdult || busy}
            onChange={(event) => setDraft({ ...draft, ownerMemberId: event.target.value })}
          >
            {actorIsAdult ? <option value="">Needs an owner</option> : null}
            {members.map((member) => (
              <option key={member.id} value={member.id}>{displayName(member)}</option>
            ))}
          </select>
        </label>
        <div className={styles.choreFieldGrid}>
          <label className={styles.choreField}>
            Due
            <input
              type="date"
              value={draft.dueDate}
              onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })}
            />
          </label>
          <label className={styles.choreField}>
            Repeats
            <select
              value={draft.recurrence}
              onChange={(event) => setDraft({ ...draft, recurrence: event.target.value as ChoreDraft["recurrence"] })}
            >
              <option value="none">Once</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>
        </div>
        <div className={styles.sheetActions}>
          <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="submit" disabled={busy || !draft.title.trim()}>
            <Plus size={17} aria-hidden="true" /> {busy ? "Adding…" : "Add chore"}
          </button>
        </div>
      </form>
    </div>
  );
}

function PersonalTaskComposer({
  busy,
  onClose,
  onCreate,
}: {
  busy: boolean;
  onClose: () => void;
  onCreate: (draft: PersonalTaskDraft) => Promise<void>;
}) {
  const [draft, setDraft] = useState<PersonalTaskDraft>({
    title: "",
    dueDate: "",
    priority: "P2",
  });
  return (
    <div className={styles.sheetBackdrop} role="presentation" onMouseDown={onClose}>
      <form
        className={`${styles.actionSheet} ${styles.choreComposer}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-personal-task-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (draft.title.trim()) void onCreate({ ...draft, title: draft.title.trim() });
        }}
      >
        <button type="button" className={styles.sheetClose} onClick={onClose} aria-label="Close">
          <X size={19} />
        </button>
        <div className={styles.eyebrow}>Private to you</div>
        <h2 id="add-personal-task-title">Add my to-do</h2>
        <label className={styles.choreField}>
          To-do
          <input autoFocus maxLength={240} value={draft.title} placeholder="What do you need to do?" onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
        </label>
        <div className={styles.choreFieldGrid}>
          <label className={styles.choreField}>
            Due
            <input type="date" value={draft.dueDate} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} />
          </label>
          <label className={styles.choreField}>
            Priority
            <select value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value as PersonalTaskDraft["priority"] })}>
              <option value="P0">Critical</option>
              <option value="P1">High</option>
              <option value="P2">Planned</option>
              <option value="P3">Later</option>
            </select>
          </label>
        </div>
        <div className={styles.sheetActions}>
          <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="submit" disabled={busy || !draft.title.trim()}>
            <Plus size={17} aria-hidden="true" /> {busy ? "Adding…" : "Add to-do"}
          </button>
        </div>
      </form>
    </div>
  );
}

function MealsPage({
  meals,
  mealNeeds,
  groceries,
  state,
  isPending,
  onSaveMeal,
  onSaveNeed,
  onRemoveNeed,
  onGenerate,
  onCreateGrocery,
  onChangeGrocery,
}: {
  meals: MealPlanItem[];
  mealNeeds: MealNeed[];
  groceries: GroceryItem[];
  state: PepperState;
  isPending: (key: string) => boolean;
  onSaveMeal: (draft: MealDraft) => Promise<boolean>;
  onSaveNeed: (draft: MealNeedDraft) => Promise<boolean>;
  onRemoveNeed: (id: string) => Promise<void>;
  onGenerate: () => Promise<boolean>;
  onCreateGrocery: (draft: GroceryDraft) => Promise<boolean>;
  onChangeGrocery: (
    id: string,
    operation: "assign" | "attach" | "complete" | "reopen",
    value?: string,
  ) => Promise<void>;
}) {
  const actorIsAdult = ["adult_admin", "adult"].includes(state.member.role);
  const planBusy = isPending("meal-plan");
  const [mealDraft, setMealDraft] = useState<MealDraft | null>(null);
  const [needComposerOpen, setNeedComposerOpen] = useState(false);
  const [groceryComposerOpen, setGroceryComposerOpen] = useState(false);
  const [showAllGroceries, setShowAllGroceries] = useState(false);
  const today = localDate();
  const weekDates = Array.from({ length: 7 }, (_, index) => addDateDays(today, index));
  const weekMeals = weekDates.map((date) => ({
    date,
    meal: meals.find((candidate) => candidate.meal_date === date),
  }));
  const weekMealIds = new Set(weekMeals.flatMap(({ meal }) => (meal ? [meal.id] : [])));
  const weekGroceries = groceries
    .filter((item) => !item.meal_plan_id || weekMealIds.has(item.meal_plan_id))
    .sort((left, right) => {
      if (left.status !== right.status) return left.status === "completed" ? 1 : -1;
      return left.item.localeCompare(right.item);
    });
  const openCount = weekGroceries.filter((item) => item.status !== "completed").length;
  const unassignedCount = weekGroceries.filter(
    (item) => item.status !== "completed" && !item.owner_member_id,
  ).length;
  const displayedGroceries = showAllGroceries
    ? weekGroceries
    : weekGroceries.slice(0, 8);
  const hasPlannedWeek = weekMeals.some(({ meal }) => Boolean(meal));

  return (
    <>
      <section className={`${styles.hero} ${styles.mealHero}`}>
        <div className={styles.eyebrow}>Family table</div>
        <h1>This week&apos;s meals</h1>
        <p>
          Meals, family needs, groceries, and who is handling each item stay in one plan.
        </p>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div>
            <div className={styles.sectionLabel}>Seven-day meal plan</div>
            <p>Generated from saved family needs, then editable day by day.</p>
          </div>
          {actorIsAdult ? (
            <button
              type="button"
              className={styles.generateMealButton}
              disabled={planBusy}
              onClick={() => void onGenerate()}
            >
              <Sparkles size={16} aria-hidden="true" />
              {planBusy ? "Planning…" : hasPlannedWeek ? "Refresh week" : "Plan my week"}
            </button>
          ) : null}
        </div>
        <div className={styles.mealWeek}>
          {weekMeals.map(({ date, meal }) => {
            const cook = memberName(state, meal?.owner_member_id);
            const shopper = memberName(state, meal?.shopping_owner_member_id);
            const linked = meal
              ? weekGroceries.filter((item) => item.meal_plan_id === meal.id).length
              : 0;
            return (
              <button
                type="button"
                className={`${styles.mealDayRow} ${meal ? "" : styles.mealDayEmpty}`}
                key={date}
                disabled={!actorIsAdult}
                onClick={() =>
                  setMealDraft({
                    mealDate: date,
                    mealName: meal?.meal_name || "",
                    ownerMemberId: meal?.owner_member_id || "",
                    shoppingOwnerMemberId: meal?.shopping_owner_member_id || "",
                  })
                }
              >
                <time>{dateLabel(date)}</time>
                <span className={styles.mealDayBody}>
                  <strong>{meal?.meal_name || "Meal not planned"}</strong>
                  <small>
                    {meal
                      ? [cook && `${cook} cooking`, shopper && `${shopper} shopping`, `${linked} ${linked === 1 ? "item" : "items"}`]
                          .filter(Boolean)
                          .join(" · ")
                      : actorIsAdult
                        ? "Tap to plan"
                        : "Not planned yet"}
                  </small>
                </span>
                {actorIsAdult ? <ChevronRight size={18} aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      </section>

      <details className={styles.mealNeedsSection}>
        <summary>
          <span>
            <strong>Family meal needs</strong>
            <small>
              {mealNeeds.length
                ? `${mealNeeds.length} saved for planning`
                : "No needs saved yet"}
            </small>
          </span>
          <ChevronRight size={18} aria-hidden="true" />
        </summary>
        <div className={styles.mealNeedsBody}>
          <div className={styles.sectionHeading}>
            <p>Allergies, preferences, nutrition, and schedule constraints.</p>
            {actorIsAdult ? (
              <button
                type="button"
                className={styles.textButton}
                onClick={() => setNeedComposerOpen(true)}
              >
                <Plus size={15} aria-hidden="true" /> Add need
              </button>
            ) : null}
          </div>
          {mealNeeds.length ? (
            <div className={styles.mealNeedList}>
              {mealNeeds.map((need) => {
                const person = state.members.find((member) => member.id === need.member_id);
                return (
                  <div className={styles.mealNeed} data-type={need.need_type} key={need.id}>
                    <span>
                      <strong>{displayName(person)}</strong>
                      {need.label}
                    </span>
                    <small>{need.need_type}</small>
                    {actorIsAdult ? (
                      <button
                        type="button"
                        aria-label={`Remove ${need.label}`}
                        disabled={isPending(`meal-need:${need.id}`)}
                        onClick={() => void onRemoveNeed(need.id)}
                      >
                        <X size={14} aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className={styles.mealNeedsEmpty}>
              No allergies, avoidances, preferences, nutrition needs, or schedule constraints are saved yet.
            </div>
          )}
        </div>
      </details>

      <section className={styles.section}>
        <div className={styles.groceryHeading}>
          <div>
            <div className={styles.sectionLabel}>Groceries for the plan</div>
            <p>
              {openCount} open{unassignedCount ? ` · ${unassignedCount} need an owner` : " · all assigned"}
            </p>
          </div>
          <button
            type="button"
            className={styles.groceryAdd}
            onClick={() => setGroceryComposerOpen(true)}
          >
            <Plus size={16} aria-hidden="true" /> Add item
          </button>
        </div>
        <div className={styles.groceryList}>
          {weekGroceries.length ? (
            displayedGroceries.map((item) => {
              const groceryBusy = isPending(`grocery:${item.id}`);
              const completed = item.status === "completed";
              const canComplete =
                actorIsAdult || !item.owner_member_id || item.owner_member_id === state.member.id;
              const linkedMeal = meals.find((meal) => meal.id === item.meal_plan_id);
              return (
                <article
                  className={`${styles.groceryRow} ${completed ? styles.groceryRowDone : ""}`}
                  key={item.id}
                >
                  <button
                    type="button"
                    className={`${styles.groceryCheck} ${completed ? styles.groceryCheckDone : ""}`}
                    aria-label={completed ? `Restore ${item.item}` : `Complete ${item.item}`}
                    disabled={groceryBusy || !canComplete}
                    onClick={() =>
                      void onChangeGrocery(item.id, completed ? "reopen" : "complete")
                    }
                  >
                    {completed ? <Check size={16} aria-hidden="true" /> : null}
                  </button>
                  <div className={styles.groceryBody}>
                    <strong>{item.item}</strong>
                    <small>{linkedMeal?.meal_name || "Weekly staples"}</small>
                  </div>
                  {actorIsAdult ? (
                    <div className={styles.groceryControls}>
                      <label>
                        <span>Meal</span>
                        <select
                          value={item.meal_plan_id || ""}
                          disabled={groceryBusy}
                          onChange={(event) =>
                            void onChangeGrocery(item.id, "attach", event.target.value)
                          }
                        >
                          <option value="">Weekly staples</option>
                          {weekMeals.flatMap(({ meal }) =>
                            meal ? [<option key={meal.id} value={meal.id}>{dateLabel(meal.meal_date)} · {meal.meal_name}</option>] : [],
                          )}
                        </select>
                      </label>
                      <label>
                        <span>Owner</span>
                        <select
                          value={item.owner_member_id || ""}
                          disabled={groceryBusy}
                          onChange={(event) =>
                            void onChangeGrocery(item.id, "assign", event.target.value)
                          }
                        >
                          <option value="">Needs an owner</option>
                          {state.members.map((member) => (
                            <option key={member.id} value={member.id}>{displayName(member)}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                  ) : (
                    <span className={item.owner_member_id ? styles.ownerPill : styles.needPill}>
                      {memberName(state, item.owner_member_id) || "Needs an owner"}
                    </span>
                  )}
                </article>
              );
            })
          ) : (
            <div className={styles.groceryEmpty}>
              <ShoppingBasket size={19} aria-hidden="true" />
              <span>No groceries are attached to this week yet.</span>
            </div>
          )}
        </div>
        {weekGroceries.length > 8 ? (
          <button
            type="button"
            className={styles.groceryReveal}
            onClick={() => setShowAllGroceries((current) => !current)}
          >
            {showAllGroceries ? "Show fewer groceries" : `Show all ${weekGroceries.length} groceries`}
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        ) : null}
      </section>

      {mealDraft ? (
        <MealComposer
          draft={mealDraft}
          members={state.members}
          mealNeeds={mealNeeds}
          busy={isPending(`meal:${mealDraft.mealDate}`)}
          onClose={() => setMealDraft(null)}
          onSave={async (draft) => {
            const saved = await onSaveMeal(draft);
            if (saved) setMealDraft(null);
          }}
        />
      ) : null}
      {needComposerOpen ? (
        <MealNeedComposer
          members={state.members}
          busy={isPending("meal-need:create")}
          onClose={() => setNeedComposerOpen(false)}
          onSave={async (draft) => {
            const saved = await onSaveNeed(draft);
            if (saved) setNeedComposerOpen(false);
          }}
        />
      ) : null}
      {groceryComposerOpen ? (
        <GroceryComposer
          meals={weekMeals.flatMap(({ meal }) => (meal ? [meal] : []))}
          members={state.members}
          actor={state.member}
          busy={isPending("grocery:create")}
          onClose={() => setGroceryComposerOpen(false)}
          onSave={async (draft) => {
            const saved = await onCreateGrocery(draft);
            if (saved) setGroceryComposerOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

function MealComposer({
  draft: initialDraft,
  members,
  mealNeeds,
  busy,
  onClose,
  onSave,
}: {
  draft: MealDraft;
  members: PepperState["members"];
  mealNeeds: MealNeed[];
  busy: boolean;
  onClose: () => void;
  onSave: (draft: MealDraft) => Promise<void>;
}) {
  const [draft, setDraft] = useState(initialDraft);
  return (
    <div className={styles.sheetBackdrop} role="presentation" onMouseDown={onClose}>
      <form
        className={`${styles.actionSheet} ${styles.mealComposer}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-meal-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (draft.mealName.trim()) void onSave({ ...draft, mealName: draft.mealName.trim() });
        }}
      >
        <button type="button" className={styles.sheetClose} onClick={onClose} aria-label="Close"><X size={19} /></button>
        <div className={styles.eyebrow}>{dateLabel(draft.mealDate)}</div>
        <h2 id="plan-meal-title">Plan this meal</h2>
        {mealNeeds.length ? (
          <div className={styles.mealComposerNeeds}>
            <strong>Keep in view</strong>
            <span>{mealNeeds.map((need) => `${displayName(members.find((member) => member.id === need.member_id))}: ${need.label}`).join(" · ")}</span>
          </div>
        ) : null}
        <label className={styles.choreField}>
          Meal
          <input autoFocus maxLength={240} value={draft.mealName} placeholder="What are we eating?" onChange={(event) => setDraft({ ...draft, mealName: event.target.value })} />
        </label>
        <div className={styles.choreFieldGrid}>
          <label className={styles.choreField}>
            Cooking
            <select value={draft.ownerMemberId} onChange={(event) => setDraft({ ...draft, ownerMemberId: event.target.value })}>
              <option value="">Needs an owner</option>
              {members.map((member) => <option key={member.id} value={member.id}>{displayName(member)}</option>)}
            </select>
          </label>
          <label className={styles.choreField}>
            Shopping
            <select value={draft.shoppingOwnerMemberId} onChange={(event) => setDraft({ ...draft, shoppingOwnerMemberId: event.target.value })}>
              <option value="">Needs an owner</option>
              {members.map((member) => <option key={member.id} value={member.id}>{displayName(member)}</option>)}
            </select>
          </label>
        </div>
        <div className={styles.sheetActions}>
          <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="submit" disabled={busy || !draft.mealName.trim()}><Utensils size={17} aria-hidden="true" /> {busy ? "Saving…" : "Save meal"}</button>
        </div>
      </form>
    </div>
  );
}

function MealNeedComposer({ members, busy, onClose, onSave }: {
  members: PepperState["members"];
  busy: boolean;
  onClose: () => void;
  onSave: (draft: MealNeedDraft) => Promise<void>;
}) {
  const [draft, setDraft] = useState<MealNeedDraft>({
    memberId: members[0]?.id || "",
    needType: "preference",
    label: "",
    details: "",
  });
  return (
    <div className={styles.sheetBackdrop} role="presentation" onMouseDown={onClose}>
      <form className={`${styles.actionSheet} ${styles.mealComposer}`} role="dialog" aria-modal="true" aria-labelledby="meal-need-title" onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); if (draft.label.trim()) void onSave({ ...draft, label: draft.label.trim() }); }}>
        <button type="button" className={styles.sheetClose} onClick={onClose} aria-label="Close"><X size={19} /></button>
        <div className={styles.eyebrow}>Family table</div>
        <h2 id="meal-need-title">Add a meal need</h2>
        <div className={styles.choreFieldGrid}>
          <label className={styles.choreField}>Person<select value={draft.memberId} onChange={(event) => setDraft({ ...draft, memberId: event.target.value })}>{members.map((member) => <option key={member.id} value={member.id}>{displayName(member)}</option>)}</select></label>
          <label className={styles.choreField}>Type<select value={draft.needType} onChange={(event) => setDraft({ ...draft, needType: event.target.value as MealNeed["need_type"] })}><option value="allergy">Allergy</option><option value="avoidance">Avoidance</option><option value="preference">Preference</option><option value="nutrition">Nutrition</option><option value="schedule">Schedule</option></select></label>
        </div>
        <label className={styles.choreField}>Need<input autoFocus maxLength={160} value={draft.label} placeholder="For example, dairy-free" onChange={(event) => setDraft({ ...draft, label: event.target.value })} /></label>
        <label className={styles.choreField}>Details (optional)<input maxLength={500} value={draft.details} placeholder="Anything Pepper should remember" onChange={(event) => setDraft({ ...draft, details: event.target.value })} /></label>
        <div className={styles.sheetActions}><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" disabled={busy || !draft.memberId || !draft.label.trim()}><Plus size={17} aria-hidden="true" /> {busy ? "Saving…" : "Add need"}</button></div>
      </form>
    </div>
  );
}

function GroceryComposer({ meals, members, actor, busy, onClose, onSave }: {
  meals: MealPlanItem[];
  members: PepperState["members"];
  actor: PepperState["member"];
  busy: boolean;
  onClose: () => void;
  onSave: (draft: GroceryDraft) => Promise<void>;
}) {
  const actorIsAdult = ["adult_admin", "adult"].includes(actor.role);
  const [draft, setDraft] = useState<GroceryDraft>({ item: "", ownerMemberId: actorIsAdult ? "" : actor.id, mealPlanId: "" });
  return (
    <div className={styles.sheetBackdrop} role="presentation" onMouseDown={onClose}>
      <form className={`${styles.actionSheet} ${styles.mealComposer}`} role="dialog" aria-modal="true" aria-labelledby="grocery-title" onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); if (draft.item.trim()) void onSave({ ...draft, item: draft.item.trim() }); }}>
        <button type="button" className={styles.sheetClose} onClick={onClose} aria-label="Close"><X size={19} /></button>
        <div className={styles.eyebrow}>Weekly meal plan</div>
        <h2 id="grocery-title">Add a grocery</h2>
        <label className={styles.choreField}>Item<input autoFocus maxLength={200} value={draft.item} placeholder="What do we need?" onChange={(event) => setDraft({ ...draft, item: event.target.value })} /></label>
        <div className={styles.choreFieldGrid}>
          <label className={styles.choreField}>For meal<select value={draft.mealPlanId} onChange={(event) => setDraft({ ...draft, mealPlanId: event.target.value })}><option value="">Weekly staples</option>{meals.map((meal) => <option key={meal.id} value={meal.id}>{dateLabel(meal.meal_date)} · {meal.meal_name}</option>)}</select></label>
          <label className={styles.choreField}>Assign to<select value={draft.ownerMemberId} disabled={!actorIsAdult} onChange={(event) => setDraft({ ...draft, ownerMemberId: event.target.value })}>{actorIsAdult ? <option value="">Needs an owner</option> : null}{members.map((member) => <option key={member.id} value={member.id}>{displayName(member)}</option>)}</select></label>
        </div>
        <div className={styles.sheetActions}><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" disabled={busy || !draft.item.trim()}><ShoppingBasket size={17} aria-hidden="true" /> {busy ? "Adding…" : "Add grocery"}</button></div>
      </form>
    </div>
  );
}

function MemberAvatar({ name, photoUrl, className }: {
  name: string;
  photoUrl?: string | null;
  className: string;
}) {
  return (
    <span className={className} aria-hidden="true">
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- Private photo URLs expire and are already resized before upload.
        <img src={photoUrl} alt="" loading="lazy" decoding="async" />
      ) : (
        name.slice(0, 1)
      )}
    </span>
  );
}

function ProfilePhotoPicker({
  name,
  photoUrl,
  busy,
  compact = false,
  onSelect,
  onRemove,
}: {
  name: string;
  photoUrl?: string | null;
  busy: boolean;
  compact?: boolean;
  onSelect: (file: File) => void;
  onRemove?: () => void;
}) {
  return (
    <div className={`${styles.profilePhotoControl} ${compact ? styles.profilePhotoPickerCompact : ""}`}>
      <label
        className={styles.profilePhotoPicker}
        aria-label={`${photoUrl ? "Replace" : "Add"} ${name}'s profile photo`}
      >
        <input
          type="file"
          accept="image/*"
          disabled={busy}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) onSelect(file);
          }}
        />
        <span className={styles.profilePhotoVisual}>
          <MemberAvatar
            name={name}
            photoUrl={photoUrl}
            className={styles.memberHeroAvatar}
          />
          <span className={styles.profilePhotoBadge} aria-hidden="true">
            {busy ? <RefreshCw size={15} /> : <Camera size={15} />}
          </span>
        </span>
        {!compact ? (
          <span className={styles.profilePhotoCopy}>
            <strong>Profile photo</strong>
            <small>{photoUrl ? "Choose a new photo" : "Add from this device"}</small>
          </span>
        ) : null}
      </label>
      {photoUrl && onRemove ? (
        <button type="button" className={styles.profilePhotoRemove} disabled={busy} onClick={onRemove}>
          Remove
        </button>
      ) : null}
    </div>
  );
}

function setupDraft(
  member?: PepperState["members"][number],
  profile?: MemberSetupProfile,
): MemberSetupDraft {
  return {
    memberId: member?.id || "",
    displayName: displayName(member),
    role: (member?.role as MemberSetupDraft["role"]) || "child",
    pin: "",
    activities: (profile?.activities || []).join("\n"),
    schoolName: profile?.school_name || "",
    gradeLabel: profile?.grade_label || "",
    dietaryPreferences: (profile?.dietary_preferences || []).join("\n"),
    medications: (profile?.medications || []).join("\n"),
    goals: (profile?.goals || []).join("\n"),
  };
}

function FamilySetupPage({
  state,
  isPending,
  onBack,
  onSave,
  onPhotoUpload,
  onPhotoRemove,
}: {
  state: PepperState;
  isPending: (key: string) => boolean;
  onBack: () => void;
  onSave: (draft: MemberSetupDraft) => Promise<boolean>;
  onPhotoUpload: (memberId: string, file: File) => Promise<boolean>;
  onPhotoRemove: (memberId: string) => Promise<boolean>;
}) {
  const [selectedMemberId, setSelectedMemberId] = useState(
    state.members[0]?.id || "new",
  );
  const selectedMember = state.members.find(
    (member) => member.id === selectedMemberId,
  );
  const selectedProfile = state.memberProfiles?.find(
    (profile) => profile.member_id === selectedMemberId,
  );
  const [draft, setDraft] = useState<MemberSetupDraft>(() =>
    setupDraft(selectedMember, selectedProfile),
  );
  const saveBusy = isPending(`member-setup:${draft.memberId || "new"}`);
  const photoBusy = selectedMember
    ? isPending(`photo:${selectedMember.id}`)
    : false;

  function chooseMember(memberId: string) {
    setSelectedMemberId(memberId);
    if (memberId === "new") {
      setDraft(setupDraft());
      return;
    }
    const member = state.members.find((candidate) => candidate.id === memberId);
    const profile = state.memberProfiles?.find(
      (candidate) => candidate.member_id === memberId,
    );
    setDraft(setupDraft(member, profile));
  }

  return (
    <>
      <button type="button" className={styles.backButton} onClick={onBack}>
        <ArrowLeft size={17} /> Family
      </button>
      <section className={styles.hero}>
        <div className={styles.eyebrow}>Private family setup</div>
        <h1>Help Pepper know each person.</h1>
        <p>These details shape schedules, meals, health context, and personal plans.</p>
      </section>

      <section className={styles.setupSurface}>
        <div className={styles.setupMemberTabs} role="tablist" aria-label="Choose family member">
          {state.members.map((member) => (
            <button
              type="button"
              role="tab"
              aria-selected={selectedMemberId === member.id}
              key={member.id}
              onClick={() => chooseMember(member.id)}
            >
              {displayName(member)}
            </button>
          ))}
          <button
            type="button"
            role="tab"
            aria-selected={selectedMemberId === "new"}
            onClick={() => chooseMember("new")}
          >
            <Plus size={15} aria-hidden="true" /> Add family member
          </button>
        </div>

        <form
          className={styles.setupForm}
          onSubmit={(event) => {
            event.preventDefault();
            if (!draft.displayName.trim()) return;
            void onSave({ ...draft, displayName: draft.displayName.trim() }).then(
              (saved) => {
                if (saved && selectedMemberId === "new") {
                  setDraft(setupDraft());
                }
              },
            );
          }}
        >
          {selectedMember ? (
            <div className={styles.setupPhotoRow}>
              <ProfilePhotoPicker
                name={displayName(selectedMember)}
                photoUrl={selectedProfile?.avatar_url}
                busy={photoBusy}
                onSelect={(file) => void onPhotoUpload(selectedMember.id, file)}
                onRemove={() => void onPhotoRemove(selectedMember.id)}
              />
              <p>Shown only to signed-in members of this family.</p>
            </div>
          ) : null}
          <div className={styles.setupIdentityGrid}>
            <label className={styles.choreField}>
              Name
              <input
                value={draft.displayName}
                maxLength={100}
                onChange={(event) => setDraft({ ...draft, displayName: event.target.value })}
              />
            </label>
            <label className={styles.choreField}>
              Role
              <select
                value={draft.role}
                onChange={(event) =>
                  setDraft({ ...draft, role: event.target.value as MemberSetupDraft["role"] })
                }
              >
                <option value="adult_admin">Adult administrator</option>
                <option value="adult">Adult</option>
                <option value="teen">Teen</option>
                <option value="child">Child</option>
              </select>
            </label>
            <label className={styles.choreField}>
              {draft.memberId ? "New invitation code (optional)" : "Invitation code"}
              <input
                inputMode="numeric"
                type="password"
                value={draft.pin}
                placeholder={draft.memberId ? "Reset first-time access" : "4–12 digits"}
                onChange={(event) =>
                  setDraft({ ...draft, pin: event.target.value.replace(/\D/g, "").slice(0, 12) })
                }
              />
            </label>
          </div>

          <div className={styles.setupIdentityGrid}>
            <label className={styles.choreField}>
              School
              <input
                value={draft.schoolName}
                placeholder="School name"
                onChange={(event) => setDraft({ ...draft, schoolName: event.target.value })}
              />
            </label>
            <label className={styles.choreField}>
              Grade
              <input
                value={draft.gradeLabel}
                placeholder="Grade or year"
                onChange={(event) => setDraft({ ...draft, gradeLabel: event.target.value })}
              />
            </label>
          </div>

          <div className={styles.setupDetailsGrid}>
            <SetupListField label="Activities" value={draft.activities} placeholder="Track\nTheatre" onChange={(activities) => setDraft({ ...draft, activities })} />
            <SetupListField label="Dietary preferences" value={draft.dietaryPreferences} placeholder="No red meat\nFavorite: tacos" onChange={(dietaryPreferences) => setDraft({ ...draft, dietaryPreferences })} />
            <SetupListField label="Medications" value={draft.medications} placeholder="Medication and schedule" privateField onChange={(medications) => setDraft({ ...draft, medications })} />
            <SetupListField label="Goals" value={draft.goals} placeholder="What matters this season?" onChange={(goals) => setDraft({ ...draft, goals })} />
          </div>

          <div className={styles.setupActions}>
            <span><LockKeyhole size={15} aria-hidden="true" /> Medications stay private to the member and adults.</span>
            <button type="submit" disabled={saveBusy || !draft.displayName.trim() || (!draft.memberId && draft.pin.length < 4)}>
              <Check size={17} aria-hidden="true" /> {saveBusy ? "Saving…" : "Save family details"}
            </button>
          </div>
        </form>
      </section>
    </>
  );
}

function SetupListField({ label, value, placeholder, privateField, onChange }: {
  label: string;
  value: string;
  placeholder: string;
  privateField?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className={styles.choreField}>
      <span>{label}{privateField ? <LockKeyhole size={13} aria-label="Private" /> : null}</span>
      <textarea rows={4} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function FamilyDirectory({
  members,
  profiles,
  onOpen,
  canManage,
  onSetup,
}: {
  members: PepperState["members"];
  profiles: MemberSetupProfile[];
  onOpen: (slug: string) => void;
  canManage: boolean;
  onSetup: () => void;
}) {
  return (
    <>
      <section className={styles.hero}>
        <div className={styles.eyebrow}>Family</div>
        <h1>Everyone, in context.</h1>
        <p>Open a person to see their schedule, work, activities, and rides.</p>
      </section>
      {canManage ? (
        <button type="button" className={styles.familySetupLink} onClick={onSetup}>
          <span>
            <UserPlus size={19} aria-hidden="true" />
            <span>
              <strong>Family setup</strong>
              <small>People, activities, schools, food needs, medications, and goals</small>
            </span>
          </span>
          <ChevronRight size={19} aria-hidden="true" />
        </button>
      ) : null}
      <section className={styles.memberDirectory} aria-label="Family members">
        {members.map((member) => (
          <button
            type="button"
            className={styles.memberDirectoryRow}
            key={member.id}
            onClick={() => onOpen(member.slug)}
          >
            <MemberAvatar
              name={displayName(member)}
              photoUrl={profiles.find((profile) => profile.member_id === member.id)?.avatar_url}
              className={styles.avatar}
            />
            <span className={styles.memberDirectoryText}>
              <strong>{displayName(member)}</strong>
              <small>{member.role.replace("_", " ")}</small>
            </span>
            <ChevronRight size={19} />
          </button>
        ))}
      </section>
    </>
  );
}

function isChore(task: FamilyTask) {
  const area = (task.area || "").toLowerCase();
  const classification = (task.classification || "").toLowerCase();
  const project = (task.project || "").toLowerCase();
  const tags = (task.tags || []).map((tag) => tag.toLowerCase());
  const title = task.title.toLowerCase();
  return (
    classification === "chore" ||
    area === "chores" ||
    project === "family chores" ||
    tags.includes("chore") ||
    tags.includes("chores") ||
    /\b(?:empty|unload|load) (?:the )?dishwasher\b|\b(?:wash|put away|fold) (?:the )?laundry\b|\b(?:do|wash) (?:the )?dishes\b|\b(?:take out|empty) (?:the )?trash\b|\b(?:clean|cleanup|tidy|vacuum|sweep|mop)\b|\b(?:feed|walk) (?:maggie|the (?:dog|cat|pet))\b|\bset (?:the )?table\b|\broom reset\b/.test(
      title,
    )
  );
}

function MemberPage({
  state,
  busy,
  isPending,
  household,
  onBack,
  onOpen,
  onCreateChore,
  onCreatePersonalTask,
  onPhotoUpload,
  onPhotoRemove,
}: {
  state: MemberState | null;
  busy: boolean;
  isPending: (key: string) => boolean;
  household: PepperState;
  onBack: () => void;
  onOpen: (item: SelectedItem) => void;
  onCreateChore: (draft: ChoreDraft) => Promise<boolean>;
  onCreatePersonalTask: (draft: PersonalTaskDraft) => Promise<boolean>;
  onPhotoUpload: (memberId: string, file: File) => Promise<boolean>;
  onPhotoRemove: (memberId: string) => Promise<boolean>;
}) {
  const [choreComposerOpen, setChoreComposerOpen] = useState(false);
  const [todoComposerOpen, setTodoComposerOpen] = useState(false);
  if (busy && !state) return <div className={styles.quietEmpty}>Opening family plan…</div>;
  if (!state) return null;
  const actorIsAdult = ["adult_admin", "adult"].includes(household.member.role);
  const activeEvents = state.events.filter(
    (item) => !["completed", "canceled"].includes(item.status),
  );
  const activeTasks = state.tasks.filter(
    (item) => !["completed", "canceled"].includes(item.status),
  );
  const appointments = activeEvents.filter(isMedicalAppointment);
  const scheduleEvents = activeEvents.filter((item) => !isMedicalAppointment(item));
  const chores = activeTasks.filter(isChore);
  const careTasks = activeTasks.filter(isMedicalCareTask);
  const tasks = activeTasks.filter(
    (item) => !isChore(item) && !isMedicalCareTask(item),
  );
  const handled = [
    ...state.events.filter((item) => ["completed", "canceled"].includes(item.status)),
    ...state.tasks.filter((item) => ["completed", "canceled"].includes(item.status)),
  ];
  return (
    <>
      <button type="button" className={styles.backButton} onClick={onBack}>
        <ArrowLeft size={17} /> Family
      </button>
      <section className={styles.memberHero}>
        {actorIsAdult || state.member.id === household.member.id ? (
          <ProfilePhotoPicker
            name={displayName(state.member)}
            photoUrl={state.setup?.avatar_url}
            busy={isPending(`photo:${state.member.id}`)}
            compact
            onSelect={(file) => void onPhotoUpload(state.member.id, file)}
            onRemove={() => void onPhotoRemove(state.member.id)}
          />
        ) : (
          <MemberAvatar
            name={displayName(state.member)}
            photoUrl={state.setup?.avatar_url}
            className={styles.memberHeroAvatar}
          />
        )}
        <div>
          <div className={styles.eyebrow}>{state.member.role.replace("_", " ")}</div>
          <h1>{displayName(state.member)}</h1>
          <p>
            {activeEvents.length || activeTasks.length
              ? `${activeEvents.length} schedule item${activeEvents.length === 1 ? "" : "s"} and ${activeTasks.length} responsibilit${activeTasks.length === 1 ? "y" : "ies"}.`
              : "Nothing needs attention right now."}
          </p>
        </div>
      </section>

      {state.school ? (
        <section className={styles.schoolProfile} aria-label="School schedule">
          <div className={styles.schoolProfileHeader}>
            <div>
              <div className={styles.sectionLabel}>School</div>
              <strong>{state.school.profile.school_name}</strong>
              <p>
                {[state.school.profile.grade_label, state.school.profile.district_name]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <div className={styles.schoolTimes}>
              {state.school.profile.family_arrival_target_local ? (
                <span>
                  Arrive {localTimeLabel(state.school.profile.family_arrival_target_local)}
                </span>
              ) : null}
              <span>
                Normal dismissal {localTimeLabel(state.school.profile.normal_dismissal_local)}
              </span>
            </div>
          </div>
          {state.school.upcoming_changes.length ? (
            <div className={styles.schoolChangeList}>
              {state.school.upcoming_changes.slice(0, 3).map((change) => (
                <div key={`${change.schedule_date}-${change.schedule_kind}`}>
                  <span>{dateLabel(change.schedule_date)}</span>
                  <strong>{change.schedule_title}</strong>
                  <small>
                    {change.schedule_kind === "no_school"
                      ? "No school"
                      : `Dismissal ${time(change.dismissal_at)}`}
                  </small>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {state.setup ? <MemberContext profile={state.setup} /> : null}

      <MemberSection
        title="Appointments & care"
        empty="No upcoming appointments or care tasks."
      >
        {appointments.map((event) => (
          <EventRow
            key={event.id}
            event={event}
            state={household}
            showDate
            onOpen={() => onOpen({ type: "event", item: event })}
          />
        ))}
        {careTasks.map((task) => (
          <TaskActionRow
            key={task.id}
            task={task}
            state={household}
            onOpen={() => onOpen({ type: "task", item: task })}
          />
        ))}
      </MemberSection>

      <MemberSection title="Schedule" empty="No upcoming schedule items.">
        {scheduleEvents.map((event) => (
          <EventRow
            key={event.id}
            event={event}
            state={household}
            showDate
            onOpen={() => onOpen({ type: "event", item: event })}
          />
        ))}
      </MemberSection>

      <MemberSection
        title="Tasks"
        empty="No open tasks."
        action={
          state.member.id === household.member.id ? (
            <button
              type="button"
              className={styles.textButton}
              onClick={() => setTodoComposerOpen(true)}
            >
              <ListTodo size={15} aria-hidden="true" /> Add my to-do
            </button>
          ) : null
        }
      >
        {tasks.map((task) => (
          <TaskActionRow
            key={task.id}
            task={task}
            state={household}
            onOpen={() => onOpen({ type: "task", item: task })}
          />
        ))}
      </MemberSection>

      <MemberSection
        title="Chores"
        empty="No chores assigned."
        action={
          actorIsAdult ? (
            <button
              type="button"
              className={styles.textButton}
              onClick={() => setChoreComposerOpen(true)}
            >
              <Plus size={15} aria-hidden="true" /> Assign a chore
            </button>
          ) : null
        }
      >
        {chores.map((task) => (
          <TaskActionRow
            key={task.id}
            task={task}
            state={household}
            onOpen={() => onOpen({ type: "task", item: task })}
          />
        ))}
      </MemberSection>

      {handled.length ? (
        <details className={styles.handledDetails}>
          <summary>{handled.length} handled or canceled</summary>
          {handled.map((item) => (
            <button
              type="button"
              className={styles.handledRow}
              key={item.id}
              onClick={() =>
                onOpen(
                  "starts_at" in item
                    ? { type: "event", item }
                    : { type: "task", item },
                )
              }
            >
              <span>{item.title}</span>
              <small>{item.status}</small>
            </button>
          ))}
        </details>
      ) : null}

      {choreComposerOpen ? (
        <ChoreComposer
          members={household.members}
          actor={household.member}
          initialOwnerMemberId={state.member.id}
          busy={isPending("chore:create")}
          onClose={() => setChoreComposerOpen(false)}
          onCreate={async (draft) => {
            const created = await onCreateChore(draft);
            if (created) setChoreComposerOpen(false);
          }}
        />
      ) : null}

      {todoComposerOpen ? (
        <PersonalTaskComposer
          busy={isPending("personal-task:create")}
          onClose={() => setTodoComposerOpen(false)}
          onCreate={async (draft) => {
            const created = await onCreatePersonalTask(draft);
            if (created) setTodoComposerOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

function MemberContext({ profile }: { profile: MemberSetupProfile }) {
  const groups = [
    ["Activities", profile.activities],
    ["Food", profile.dietary_preferences],
    ["Medications", profile.medications],
    ["Goals", profile.goals],
  ] as const;
  if (!groups.some(([, values]) => values.length) && !profile.school_name) return null;
  return (
    <section className={styles.memberContext} aria-label="Member details">
      {profile.school_name ? (
        <div>
          <span>School</span>
          <strong>{profile.school_name}</strong>
          {profile.grade_label ? <small>{profile.grade_label}</small> : null}
        </div>
      ) : null}
      {groups.map(([label, values]) =>
        values.length ? (
          <div key={label}>
            <span>{label}</span>
            <strong>{values.join(" · ")}</strong>
          </div>
        ) : null,
      )}
    </section>
  );
}

function MemberSection({
  title,
  empty,
  action,
  children,
}: {
  title: string;
  empty: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children;
  const hasItems = Array.isArray(items) ? items.length > 0 : Boolean(items);
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeading}>
        <div className={styles.sectionLabel}>{title}</div>
        {action}
      </div>
      <div className={styles.memberSectionBody}>
        {hasItems ? items : <div className={styles.empty}>{empty}</div>}
      </div>
    </section>
  );
}

function TaskActionRow({
  task,
  state,
  onOpen,
}: {
  task: FamilyTask;
  state: PepperState;
  onOpen: () => void;
}) {
  const owner = memberName(state, task.owner_member_id);
  return (
    <button type="button" className={styles.taskActionRow} onClick={onOpen}>
      <span className={styles.taskMarker} aria-hidden="true" />
      <span className={styles.taskActionBody}>
        <strong>{task.title}</strong>
        <small>
          {owner || "Needs an owner"}
          {task.status === "on_hold" ? " · On hold" : ""}
          {task.project ? ` · ${task.project}` : ""}
          {task.due_at ? ` · ${dateLabel(task.due_at.slice(0, 10))}` : ""}
        </small>
      </span>
      <ChevronRight size={18} />
    </button>
  );
}

function ItemActionSheet({
  selected,
  state,
  busy,
  onClose,
  onUpdate,
}: {
  selected: SelectedItem;
  state: PepperState;
  busy: boolean;
  onClose: () => void;
  onUpdate: (
    operation: ItemOperation,
    changes?: ItemUpdate,
  ) => Promise<ItemUpdateResult>;
}) {
  const item = selected.item;
  const eventItem = selected.type === "event" ? selected.item : null;
  const taskItem = selected.type === "task" ? selected.item : null;
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pendingOperation, setPendingOperation] = useState<ItemOperation | null>(null);
  const [actionError, setActionError] = useState("");
  const [title, setTitle] = useState(item.title);
  const [taskStatus, setTaskStatus] = useState<"open" | "in_progress" | "on_hold">(
    taskItem?.status === "in_progress" || taskItem?.status === "on_hold"
      ? taskItem.status
      : "open",
  );
  const [dueDate, setDueDate] = useState(localDateFor(taskItem?.due_at));
  const [priority, setPriority] = useState(taskItem?.priority || "");
  const [notes, setNotes] = useState(taskItem?.notes || eventItem?.notes || "");
  const [waitingOn, setWaitingOn] = useState(taskItem?.waiting_on || "");
  const [nextAction, setNextAction] = useState(taskItem?.next_action || "");
  const [startsLocal, setStartsLocal] = useState(
    localDateTimeFor(eventItem?.starts_at),
  );
  const [endsLocal, setEndsLocal] = useState(
    localDateTimeFor(eventItem?.ends_at),
  );
  const [location, setLocation] = useState(eventItem?.location || "");
  const currentOwner = eventItem
    ? eventItem.transport_owner_member_id || ""
    : taskItem?.owner_member_id || "";
  const assignable = eventItem
    ? state.members.filter((member) => ["adult_admin", "adult"].includes(member.role))
    : state.members;
  const actorIsAdult = ["adult_admin", "adult"].includes(state.member.role);
  const canAssign = actorIsAdult && (Boolean(eventItem) || item.visibility === "household");
  const canChangeStatus =
    actorIsAdult ||
    Boolean(
      taskItem &&
        (taskItem.owner_member_id === state.member.id ||
          taskItem.creator_member_id === state.member.id),
    );
  const handled = ["completed", "canceled"].includes(item.status);
  const eventEditorLabel = eventItem && isMedicalAppointment(eventItem)
    ? "Edit appointment"
    : "Edit event";

  async function runUpdate(operation: ItemOperation, changes?: ItemUpdate) {
    setActionError("");
    setPendingOperation(operation);
    const result = await onUpdate(operation, changes);
    if (!result.ok) {
      setActionError(result.error);
      setPendingOperation(null);
    }
    return result.ok;
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (taskItem) {
      await runUpdate("edit", {
        title,
        status: taskStatus,
        due_date: dueDate,
        priority,
        notes,
        waiting_on: waitingOn,
        next_action: nextAction,
      });
      return;
    }
    await runUpdate("edit", {
      title,
      starts_local: startsLocal,
      ends_local: endsLocal,
      location,
      notes,
    });
  }

  return (
    <div className={styles.sheetBackdrop} role="presentation" onMouseDown={onClose}>
      <section
        className={styles.actionSheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby="family-item-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button type="button" className={styles.sheetClose} onClick={onClose} aria-label="Close">
          <X size={19} />
        </button>
        <div className={styles.eyebrow}>
          {eventItem ? "Schedule" : taskItem && isChore(taskItem) ? "Chore" : "Task"}
        </div>
        <h2 id="family-item-title">{item.title}</h2>
        {!editing && eventItem ? (
          <p className={styles.sheetMeta}>
            <CalendarDays size={15} /> {dateLabel(eventItem.starts_at.slice(0, 10))} at {time(eventItem.starts_at)}
            {eventItem.location ? ` · ${eventItem.location}` : ""}
          </p>
        ) : !editing && taskItem?.due_at ? (
          <p className={styles.sheetMeta}>Due {dateLabel(taskItem.due_at.slice(0, 10))}</p>
        ) : null}
        {!editing && taskItem?.status === "on_hold" ? (
          <p className={styles.holdNote}>On hold{taskItem.waiting_on ? ` · ${taskItem.waiting_on}` : ""}</p>
        ) : null}
        {!editing && taskItem?.project ? (
          <p className={styles.sourceNote}>Project: {taskItem.project}</p>
        ) : null}
        {!editing && taskItem?.notes ? <p className={styles.itemNotes}>{taskItem.notes}</p> : null}
        {!editing && eventItem?.notes ? <p className={styles.itemNotes}>{eventItem.notes}</p> : null}
        {!editing && item.source && item.source !== "pepper" ? (
          <p className={styles.sourceNote}>Calendar supplied the evidence. Pepper owns this family plan.</p>
        ) : null}
        {actionError ? (
          <p className={styles.actionError} role="alert">{actionError}</p>
        ) : null}

        {editing ? (
          <form className={styles.itemEditForm} onSubmit={saveEdit}>
            <h3>{taskItem ? "Edit task" : eventEditorLabel}</h3>
            <label className={styles.editField}>
              Title
              <input
                value={title}
                maxLength={240}
                required
                disabled={busy}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            {taskItem ? (
              <>
                <div className={styles.editFieldGrid}>
                  <label className={styles.editField}>
                    Status
                    <select
                      value={taskStatus}
                      disabled={busy}
                      onChange={(event) =>
                        setTaskStatus(event.target.value as typeof taskStatus)
                      }
                    >
                      <option value="open">Open</option>
                      <option value="in_progress">In progress</option>
                      <option value="on_hold">On hold</option>
                    </select>
                  </label>
                  <label className={styles.editField}>
                    Priority
                    <select
                      value={priority}
                      disabled={busy}
                      onChange={(event) => setPriority(event.target.value)}
                    >
                      <option value="">Not set</option>
                      <option value="P0">Critical</option>
                      <option value="P1">High</option>
                      <option value="P2">Planned</option>
                      <option value="P3">Later</option>
                    </select>
                  </label>
                </div>
                <label className={styles.editField}>
                  Due date
                  <input
                    type="date"
                    value={dueDate}
                    disabled={busy}
                    onChange={(event) => setDueDate(event.target.value)}
                  />
                </label>
                <label className={styles.editField}>
                  Waiting on / hold reason
                  <input
                    value={waitingOn}
                    maxLength={1000}
                    disabled={busy}
                    placeholder="For example: On hold until further notice"
                    onChange={(event) => setWaitingOn(event.target.value)}
                  />
                </label>
                <label className={styles.editField}>
                  Next action
                  <input
                    value={nextAction}
                    maxLength={1000}
                    disabled={busy}
                    placeholder="What should happen when this moves again?"
                    onChange={(event) => setNextAction(event.target.value)}
                  />
                </label>
              </>
            ) : (
              <>
                <div className={styles.editFieldGrid}>
                  <label className={styles.editField}>
                    Starts
                    <input
                      type="datetime-local"
                      value={startsLocal}
                      required
                      disabled={busy}
                      onChange={(event) => setStartsLocal(event.target.value)}
                    />
                  </label>
                  <label className={styles.editField}>
                    Ends
                    <input
                      type="datetime-local"
                      value={endsLocal}
                      disabled={busy}
                      onChange={(event) => setEndsLocal(event.target.value)}
                    />
                  </label>
                </div>
                <label className={styles.editField}>
                  Location
                  <input
                    value={location}
                    maxLength={500}
                    disabled={busy}
                    onChange={(event) => setLocation(event.target.value)}
                  />
                </label>
              </>
            )}
            <label className={styles.editField}>
              Notes
              <textarea
                value={notes}
                rows={4}
                maxLength={8000}
                disabled={busy}
                onChange={(event) => setNotes(event.target.value)}
              />
            </label>
            <div className={styles.sheetActions}>
              <button type="button" disabled={busy} onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button type="submit" disabled={busy}>
                <Check size={18} /> {pendingOperation === "edit" ? "Saving…" : "Save changes"}
              </button>
            </div>
          </form>
        ) : null}

        {!editing && canAssign && !item.deleted_at ? (
          <label className={styles.ownerSelect}>
            {eventItem ? "Driver" : "Owner"}
            <select
              value={currentOwner}
              disabled={busy}
              onChange={(event) =>
                void runUpdate("assign", { owner_member_id: event.target.value || null })
              }
            >
              <option value="">{eventItem ? "Needs a driver" : "Needs an owner"}</option>
              {assignable.map((member) => (
                <option value={member.id} key={member.id}>
                  {displayName(member)}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {!editing && canChangeStatus ? (
          <div className={styles.sheetActions}>
            {!item.deleted_at ? (
              <button type="button" disabled={busy} onClick={() => setEditing(true)}>
                <Pencil size={17} /> {taskItem ? "Edit task" : eventEditorLabel}
              </button>
            ) : null}
            {handled ? (
              <button type="button" disabled={busy} onClick={() => void runUpdate(item.deleted_at ? "restore" : "reopen")}>
                <RotateCcw size={17} /> {["reopen", "restore"].includes(pendingOperation || "") ? "Restoring…" : "Restore"}
              </button>
            ) : (
              <>
                <button type="button" disabled={busy} onClick={() => void runUpdate("complete")}>
                  <Check size={18} /> {pendingOperation === "complete" ? "Completing…" : "Complete"}
                </button>
                {eventItem ? (
                  <button type="button" className={styles.cancelAction} disabled={busy} onClick={() => void runUpdate("cancel")}>
                    <CircleX size={18} /> {pendingOperation === "cancel" ? "Canceling…" : "Cancel event"}
                  </button>
                ) : null}
              </>
            )}
          </div>
        ) : !editing ? (
          <p className={styles.permissionNote}>An adult or the current owner can change this item.</p>
        ) : null}

        {!editing && canChangeStatus && !item.deleted_at ? (
          confirmDelete ? (
            <div className={styles.deleteConfirmation} role="alert">
              <div>
                <strong>Delete from Pepper?</strong>
                <p>This removes it from every Pepper view. Its audit history remains.</p>
              </div>
              <div className={styles.deleteConfirmationActions}>
                <button type="button" disabled={busy} onClick={() => setConfirmDelete(false)}>
                  Keep it
                </button>
                <button type="button" disabled={busy} onClick={() => void runUpdate("delete")}>
                  <Trash2 size={17} /> {pendingOperation === "delete" ? "Deleting…" : "Delete item"}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className={styles.deleteButton}
              disabled={busy}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 size={17} /> Delete
            </button>
          )
        ) : null}
      </section>
    </div>
  );
}

function ConflictResolutionSheet({
  item,
  state,
  busy,
  onClose,
  onResolve,
}: {
  item: AttentionItem;
  state: PepperState;
  busy: boolean;
  onClose: () => void;
  onResolve: (keepEventId: string, rejectEventId: string) => Promise<boolean>;
}) {
  const events = [item.primary_event, item.related_event].filter(
    (event): event is FamilyEvent => Boolean(event),
  );
  const [keepEventId, setKeepEventId] = useState("");
  const [declineMessage, setDeclineMessage] = useState("");
  const keepEvent = events.find((event) => event.id === keepEventId);
  const rejectEvent = events.find((event) => event.id !== keepEventId);
  const actorIsAdult = ["adult_admin", "adult"].includes(state.member.role);

  function chooseEvent(event: FamilyEvent) {
    const rejected = events.find((candidate) => candidate.id !== event.id);
    setKeepEventId(event.id);
    setDeclineMessage(
      rejected
        ? `Hi,\n\nOur family will not be able to attend ${rejected.title} on ${dateLabel(
            rejected.starts_at.slice(0, 10),
          )} at ${time(rejected.starts_at)}.\n\nThank you for understanding,\n${displayName(
            state.member,
          )}`
        : "",
    );
  }

  async function confirmResolution() {
    if (!keepEvent || !rejectEvent) return;
    const resolved = await onResolve(keepEvent.id, rejectEvent.id);
    if (!resolved || !rejectEvent.external_organizer_email) return;
    const subject = `Unable to attend: ${rejectEvent.title}`;
    window.location.assign(
      `mailto:${rejectEvent.external_organizer_email}?subject=${encodeURIComponent(
        subject,
      )}&body=${encodeURIComponent(declineMessage)}`,
    );
  }

  return (
    <div className={styles.sheetBackdrop} role="presentation" onMouseDown={onClose}>
      <section
        className={`${styles.actionSheet} ${styles.conflictSheet}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="conflict-resolution-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button type="button" className={styles.sheetClose} onClick={onClose} aria-label="Close">
          <X size={19} />
        </button>
        <div className={styles.eyebrow}>Resolve the double booking</div>
        <h2 id="conflict-resolution-title">Which event are you keeping?</h2>
        <p className={styles.sheetIntro}>
          Pepper will keep one event in the family plan and cancel the other.
        </p>

        <div className={styles.conflictChoices}>
          {events.map((event) => (
            <button
              type="button"
              className={`${styles.conflictChoice} ${
                event.id === keepEventId ? styles.conflictChoiceActive : ""
              }`}
              disabled={busy || !actorIsAdult}
              key={event.id}
              onClick={() => chooseEvent(event)}
            >
              <span className={styles.conflictChoiceMarker} aria-hidden="true" />
              <span>
                <strong>{event.title}</strong>
                <small>
                  {dateLabel(event.starts_at.slice(0, 10))} at {time(event.starts_at)}
                  {event.location ? ` · ${event.location}` : ""}
                </small>
              </span>
              <span className={styles.keepLabel}>
                {event.id === keepEventId ? "Keeping" : "Keep this"}
              </span>
            </button>
          ))}
        </div>

        {!actorIsAdult ? (
          <p className={styles.permissionNote}>An adult can resolve this family conflict.</p>
        ) : keepEvent && rejectEvent ? (
          <div className={styles.conflictReview}>
            <div className={styles.conflictDecision}>
              <span><strong>Keep</strong>{keepEvent.title}</span>
              <span><strong>Cancel</strong>{rejectEvent.title}</span>
            </div>
            {rejectEvent.external_organizer_email ? (
              <label className={styles.declineField}>
                Decline note to {rejectEvent.external_organizer_name || rejectEvent.external_organizer_email}
                <textarea
                  value={declineMessage}
                  maxLength={3000}
                  disabled={busy}
                  onChange={(event) => setDeclineMessage(event.target.value)}
                />
              </label>
            ) : (
              <p className={styles.sourceNote}>
                This calendar event did not include an organizer email. Pepper can cancel it in the family plan, but cannot address a decline draft.
              </p>
            )}
            <button
              type="button"
              className={styles.primaryButton}
              disabled={busy}
              onClick={() => void confirmResolution()}
            >
              {busy
                ? "Updating the family plan…"
                : rejectEvent.external_organizer_email
                  ? "Cancel event and open email draft"
                  : "Cancel conflicting event"}
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
