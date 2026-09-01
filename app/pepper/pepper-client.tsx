"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Cable,
  CalendarDays,
  CalendarRange,
  Check,
  ChevronRight,
  CircleX,
  ClipboardCheck,
  Copy,
  HeartPulse,
  House,
  Info,
  LockKeyhole,
  Mail,
  Mic,
  Plus,
  RefreshCw,
  RotateCcw,
  School,
  ShieldCheck,
  Telescope,
  UsersRound,
  X,
} from "lucide-react";
import { minutesInTimeZone, pepperAtmosphereAt } from "./pepper-atmosphere";
import styles from "./pepper.module.css";

const API =
  process.env.NEXT_PUBLIC_PEPPER_API_URL ||
  "https://mfgyeolvfthxacrqwwtc.supabase.co/functions/v1/pepper-family-api";
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1mZ3llb2x2ZnRoeGFjcnF3d3RjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgxNDMyMDAsImV4cCI6MjEwMzcxOTIwMH0.uW9_dqKw8txaJxb7ysxMS0b0-nMmxg6XCk41Bhc4e9o";
const TZ = "America/Los_Angeles";

const FAMILY_CHOICES: Member[] = [
  { slug: "elle", display_name: "Danielle", role: "adult_admin" },
  { slug: "matt", display_name: "Matt", role: "adult" },
  { slug: "chloe", display_name: "Chloe", role: "teen" },
  { slug: "lyra", display_name: "Lyra", role: "teen" },
  { slug: "posey", display_name: "Posey", role: "child" },
];

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
  status: "open" | "in_progress" | "completed" | "canceled";
  due_at?: string | null;
  source?: string | null;
  area?: string | null;
  project?: string | null;
  classification?: string | null;
  tags?: string[] | null;
  recurrence?: string | null;
  next_action?: string | null;
  completed_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
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
};

type SelectedItem =
  | { type: "task"; item: FamilyTask }
  | { type: "event"; item: FamilyEvent };

type Ritual = "morning" | "evening";

type PreparationItem = {
  id: string;
  title: string;
  summary?: string | null;
};

type Capture = {
  id?: string | number;
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

type ReflectionEvidence = {
  id: string;
  reflection_date: string;
  original_text: string;
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
  today_events?: unknown[] | null;
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
  preparation?: unknown[] | null;
  preparation_count?: number | null;
  tomorrow?: { headline?: string | null } | null;
  tomorrow_headline?: string | null;
};

type EveningRitual = {
  headline?: string | null;
  reflection_prompt?: string | null;
  prompt?: string | null;
  tomorrow_headline?: string | null;
};

type PepperState = {
  member: { id: string; slug: string; display_name: string; role: string };
  members: Array<{ id: string; slug: string; display_name: string; role: string }>;
  events: FamilyEvent[];
  familyTasks: FamilyTask[];
  privateTasks: FamilyTask[];
  chores?: FamilyTask[];
  groceries: GroceryItem[];
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
};

type View =
  | "today"
  | "week"
  | "ahead"
  | "chores"
  | "family"
  | "member"
  | "connections";

type ChoreDraft = {
  title: string;
  ownerMemberId: string;
  dueDate: string;
  recurrence: "none" | "daily" | "weekly" | "monthly";
};

type HealthSetup = {
  pairing_token: string;
  publishable_key: string;
  ingest_url: string;
  requires: string;
};

function displayName(member?: Pick<Member, "slug" | "display_name"> | null) {
  if (!member) return "";
  return member.slug === "elle" ? "Danielle" : member.display_name;
}

function localDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function localDateFor(value?: string | null) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(parsed);
}

function addDateDays(date: string, amount: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + amount))
    .toISOString()
    .slice(0, 10);
}

function time(ts?: string | null) {
  if (!ts) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ts));
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
  if (!date) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(`${date}T12:00:00Z`));
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

function dueTodayText(morning?: MorningRitual) {
  const provided =
    morning?.due_today_information || morning?.due_today_summary || "";
  if (provided) return provided;

  const due = morning?.due_today;
  if (typeof due === "string") return due;
  if (typeof due === "number") {
    return countLabel(due, "thing due today", "things due today");
  }
  if (Array.isArray(due)) {
    if (!due.length) return "Nothing is due today.";
    const titles = due
      .map((item) =>
        typeof item === "string"
          ? item
          : item && typeof item === "object" && "title" in item
            ? String(item.title)
            : "",
      )
      .filter(Boolean);
    return titles.length
      ? titles.join(" · ")
      : countLabel(due.length, "thing due today", "things due today");
  }
  if (due && typeof due === "object") {
    const detail = due as Record<string, unknown>;
    const text = detail.headline || detail.summary || detail.label;
    if (typeof text === "string") return text;
    if (typeof detail.count === "number") {
      return countLabel(
        detail.count,
        "thing due today",
        "things due today",
      );
    }
  }
  if (typeof morning?.due_today_count === "number") {
    return countLabel(
      morning.due_today_count,
      "thing due today",
      "things due today",
    );
  }
  return "";
}

function captureText(capture: Capture) {
  return (
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

export function PepperClient() {
  const [members, setMembers] = useState<Member[]>(FAMILY_CHOICES);
  const [selected, setSelected] = useState("elle");
  const [pin, setPin] = useState("");
  const [token, setToken] = useState("");
  const [state, setState] = useState<PepperState | null>(null);
  const [view, setView] = useState<View>("today");
  const [memberState, setMemberState] = useState<MemberState | null>(null);
  const [memberBusy, setMemberBusy] = useState(false);
  const [selectedItem, setSelectedItem] = useState<SelectedItem | null>(null);
  const [conflictResolution, setConflictResolution] =
    useState<AttentionItem | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [atmosphere, setAtmosphere] = useState(() =>
    pepperAtmosphereAt(minutesInTimeZone(TZ)),
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [tell, setTell] = useState("");
  const [reflection, setReflection] = useState("");
  const [reflectionSaved, setReflectionSaved] = useState(false);
  const [ritualOpen, setRitualOpen] = useState<Ritual | null>(null);
  const [ritualBusy, setRitualBusy] = useState(false);
  const [handlingPreparation, setHandlingPreparation] = useState("");
  const [calendarConfirmation, setCalendarConfirmation] = useState("");
  const [healthSetup, setHealthSetup] = useState<HealthSetup | null>(null);
  const [insightOpen, setInsightOpen] = useState(false);
  const [insightRefs, setInsightRefs] = useState<ReflectionEvidence[]>([]);

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
      throw new Error(data.error || "Pepper could not complete that.");
    }
    return data;
  }

  async function load(session = token) {
    if (!session) return;
    try {
      const result = await call({ action: "state" }, session);
      setState(result.state);
      setMembers(result.state?.members || FAMILY_CHOICES);
    } catch (error) {
      const text =
        error instanceof Error ? error.message : "Pepper could not load.";
      if (/unlock|session/i.test(text)) {
        localStorage.removeItem("pepper_family_session");
        setToken("");
        setState(null);
      }
      setMessage(text);
    }
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
    operation: "assign" | "complete" | "cancel" | "reopen",
    ownerMemberId?: string,
  ) {
    setActionBusy(true);
    try {
      await call({
        action: "item_update",
        item_type: item.type,
        id: item.item.id,
        operation,
        owner_member_id: ownerMemberId || null,
      });
      setMessage(
        operation === "assign"
          ? "Assigned. Pepper updated the family plan."
          : operation === "reopen"
            ? "Restored. Pepper updated every view."
            : `${operation === "complete" ? "Completed" : "Canceled"}. Pepper updated every view.`,
      );
      setSelectedItem(null);
      await load();
      if (memberState?.member.slug) await loadMember(memberState.member.slug);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Pepper could not update that.",
      );
    } finally {
      setActionBusy(false);
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
    setActionBusy(true);
    try {
      await call({
        action: "conflict_resolve",
        consequence_id: consequenceId,
        keep_event_id: keepEventId,
        reject_event_id: rejectEventId,
      });
      setMessage("Conflict resolved. Pepper updated the family plan.");
      setConflictResolution(null);
      await load();
      if (memberState?.member.slug) await loadMember(memberState.member.slug);
      return true;
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Pepper could not resolve that conflict.",
      );
      return false;
    } finally {
      setActionBusy(false);
    }
  }

  function revealWeekDecisions() {
    const target = document.getElementById("week-decisions");
    if (!target) {
      setMessage("Pepper is refreshing the decisions that need you.");
      void load();
      return;
    }
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    target.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "start",
    });
    target.focus({ preventScroll: true });
  }

  async function createChore(draft: ChoreDraft) {
    setActionBusy(true);
    try {
      await call({
        action: "chore_create",
        title: draft.title,
        owner_member_id: draft.ownerMemberId || null,
        due_date: draft.dueDate || null,
        recurrence: draft.recurrence,
      });
      setMessage("Chore added. Pepper updated everyone’s plan.");
      await load();
      return true;
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Pepper could not add that chore.",
      );
      return false;
    } finally {
      setActionBusy(false);
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
        setCalendarConfirmation("Gmail connected for action-needed signals.");
      } else if (connection === "gmail_error") {
        setView("connections");
        setCalendarConfirmation("Gmail did not connect. Try again.");
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
    if (!saved) return;
    const timer = window.setTimeout(() => {
      setToken(saved);
      void load(saved);
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!token) return;
    const timer = window.setInterval(() => load(token), 30000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const nowEvents = useMemo(() => activeNow(state?.events || []), [state]);
  const nextEvents = useMemo(
    () => upcomingToday(state?.events || []).slice(0, 5),
    [state],
  );
  const openConsequences = (state?.consequences || []).filter(
    (item) => !item.status || item.status === "open",
  );
  const preparationNow = state?.preparation?.now || [];
  const morning = state?.rituals?.morning;
  const evening = state?.rituals?.evening;
  const todayEventCount = Array.isArray(morning?.today_events)
    ? morning.today_events.length
    : morning?.today_event_count ?? morning?.event_count;
  const dueToday = dueTodayText(morning);
  const preparationCount = Array.isArray(morning?.preparation)
    ? morning.preparation.length
    : morning?.preparation_count;
  const morningTomorrowHeadline =
    morning?.tomorrow?.headline || morning?.tomorrow_headline || "";
  const eveningTomorrowHeadline =
    evening?.tomorrow_headline || morningTomorrowHeadline;
  const tomorrowHeadline =
    morningTomorrowHeadline || eveningTomorrowHeadline;
  const rhythmPhase =
    currentHour() < 12
      ? "morning"
      : currentHour() < 18
        ? "tomorrow"
        : "evening";
  const horizon = state?.horizon;
  const readiness = horizon?.readiness || [];
  const futureWatch = horizon?.ahead?.future_watch || [];
  const routineSummaries = horizon?.ahead?.routine_summaries || [];
  const coordination = readiness.filter(
    (item) =>
      item.severity === "urgent" || item.severity === "needs_attention",
  );
  const prepare = readiness.filter((item) => item.severity === "prepare");
  const activeFamilyTasks = (state?.familyTasks || []).filter(
    (task) => !["completed", "canceled"].includes(task.status),
  );
  const activePrivateTasks = (state?.privateTasks || []).filter(
    (task) => !["completed", "canceled"].includes(task.status),
  );
  const activeGroceries = (state?.groceries || []).filter(
    (item) => item.status !== "completed",
  );
  const recentCaptures = [...(state?.captures || [])]
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
    if (!selected || !pin) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await call(
        {
          action: "login",
          member_slug: selected,
          pin,
          device_label: "Pepper family web",
        },
        "",
      );
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

  async function logout() {
    try {
      if (token) await call({ action: "logout" });
    } catch {
      // Local sign-out should still work.
    }
    localStorage.removeItem("pepper_family_session");
    setToken("");
    setState(null);
    setPin("");
  }

  async function sendTell(text = tell) {
    const clean = text.trim();
    if (!clean) return;
    setBusy(true);
    setMessage("Pepper is updating the plan…");
    try {
      const result = await call({
        action: "tell",
        text: clean,
        source: "text",
      });
      setTell("");
      setMessage(result.reply || "Updated.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Pepper hit an error.");
    } finally {
      setBusy(false);
    }
  }

  async function updateTask(id: string, complete: boolean) {
    const item = [...(state?.familyTasks || []), ...(state?.privateTasks || [])]
      .find((task) => task.id === id);
    if (!item) return;
    await updateItem(
      { type: "task", item },
      complete ? "complete" : "reopen",
    );
  }

  async function updateGrocery(id: string, complete: boolean) {
    await call({
      action: "grocery",
      id,
      status: complete ? "completed" : "open",
    });
    await load();
  }

  async function handlePreparation(id: string) {
    setHandlingPreparation(id);
    try {
      await call({ action: "preparation_handle", id });
      setMessage("Handled. Pepper updated the plan.");
      await load();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Pepper could not mark that handled.",
      );
    } finally {
      setHandlingPreparation("");
    }
  }

  async function saveReflection() {
    const clean = reflection.trim();
    if (!clean) return;
    setRitualBusy(true);
    try {
      await call({ action: "reflect", type: "reflection", text: clean });
      setReflection("");
      setReflectionSaved(true);
      setMessage("Saved privately.");
      await load();
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
    if (ritual === "evening") setReflectionSaved(false);
  }

  async function exploreInsight() {
    const insight = state?.weeklyInsight;
    if (!insight?.id) return;
    if (insightOpen) {
      setInsightOpen(false);
      return;
    }
    try {
      const result = (await call({
        action: "reflection_explore",
        insight_id: insight.id,
      })) as { reflections?: ReflectionEvidence[] };
      setInsightRefs(result.reflections || []);
      setInsightOpen(true);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Pepper could not open that.",
      );
    }
  }

  async function connectCalendar() {
    try {
      const result = await call({ action: "calendar_start" });
      if (result.authorization_url) {
        window.location.assign(result.authorization_url);
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Calendar setup is not ready yet.",
      );
    }
  }

  async function syncCalendar() {
    try {
      setMessage("Pepper is refreshing your calendar…");
      await call({ action: "calendar_sync" });
      await load();
      setMessage("Calendar refreshed.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Calendar refresh failed.",
      );
    }
  }

  async function connectEmail() {
    try {
      const result = await call({ action: "email_start" });
      if (result.authorization_url) window.location.assign(result.authorization_url);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Email setup is not ready yet.",
      );
    }
  }

  async function pairHealth() {
    try {
      const result = await call({ action: "health_pair" });
      setHealthSetup(result);
      setMessage("HealthKit pairing is ready for this iPhone.");
      await load();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Apple Health setup failed.",
      );
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
          <div className={styles.eyebrow}>Private family access</div>
          <div className={styles.wordmark}>Pepper</div>
          <h1>Your family, handled.</h1>
          <p>
            Choose who you are, enter your family PIN, and Pepper will open your
            shared plan.
          </p>

          <div className={styles.memberGrid}>
            {members.map((member) => (
              <button
                key={member.slug}
                type="button"
                className={`${styles.memberChoice} ${
                  selected === member.slug ? styles.memberChoiceActive : ""
                }`}
                onClick={() => setSelected(member.slug)}
              >
                <span>{displayName(member)}</span>
                <small>{member.role.replace("_", " ")}</small>
              </button>
            ))}
          </div>

          <label className={styles.pinLabel}>
            Family PIN
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              value={pin}
              onChange={(event) =>
                setPin(event.target.value.replace(/\D/g, "").slice(0, 12))
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") void login();
              }}
              placeholder="••••"
            />
          </label>
          <button
            type="button"
            className={styles.primaryButton}
            disabled={busy || !pin}
            onClick={() => void login()}
          >
            {busy ? "Opening Pepper…" : "Open Pepper"}
          </button>
          {message ? <div className={styles.loginMessage}>{message}</div> : null}
        </section>
      </main>
    );
  }

  const calendar = state.calendarStatus;
  const calendarConfigured = Boolean(calendar?.configured);
  const calendarConnected = Boolean(calendar?.connected);
  const coverage = horizon?.coverage;
  const weekIssueCount =
    coverage?.coordination_issues ?? coordination.length ?? 0;

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
            <button type="button" className={styles.quietButton} onClick={logout}>
              Switch
            </button>
          </div>
        </header>

        <nav className={styles.tabs} aria-label="Pepper primary navigation">
          {([
            ["today", "Today", House],
            ["week", "Next 7", CalendarRange],
            ["chores", "Chores", ClipboardCheck],
            ["ahead", "Ahead", Telescope],
            ["family", "Family", UsersRound],
            ["connections", "Connect", Cable],
          ] as const).map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              aria-current={
                view === key || (view === "member" && key === "family")
                  ? "page"
                  : undefined
              }
              className={
                view === key || (view === "member" && key === "family")
                  ? styles.tabActive
                  : styles.tab
              }
              onClick={() => setView(key as View)}
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
                  {openConsequences.slice(0, 4).map((item) => (
                    <AttentionCard
                      item={item}
                      key={item.id}
                      onOpen={() => openAttention(item)}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            {preparationNow.length ? (
              <section className={styles.section}>
                <div className={styles.sectionLabel}>
                  Prepare before it becomes urgent
                </div>
                <div className={styles.noticeStack}>
                  {preparationNow.map((item) => (
                    <article
                      className={`${styles.prepareCard} ${styles.preparationAction}`}
                      key={item.id}
                    >
                      <div>
                        <strong>{item.title}</strong>
                        {item.summary ? <p>{item.summary}</p> : null}
                      </div>
                      <button
                        type="button"
                        className={styles.secondaryButton}
                        disabled={handlingPreparation === item.id}
                        onClick={() => void handlePreparation(item.id)}
                      >
                        {handlingPreparation === item.id
                          ? "Handling…"
                          : "Handled"}
                      </button>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

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
                        "A calm look at what matters today and what is coming next."}
                    </p>
                  </div>
                  <span className={styles.arrow}>→</span>
                </button>
              ) : rhythmPhase === "tomorrow" ? (
                <article
                  className={`${styles.lookAhead} ${styles.rhythmQuiet}`}
                >
                  <div>
                    <span className={styles.sectionLabel}>
                      A quiet look ahead
                    </span>
                    <strong>Tomorrow check</strong>
                    <p>
                      {tomorrowHeadline ||
                        "Pepper is keeping tomorrow in view without asking anything of you yet."}
                    </p>
                  </div>
                </article>
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
                    <>
                      <div className={styles.eyebrow}>Morning Brief</div>
                      <h2>
                        {morning?.headline || "Here is the shape of today."}
                      </h2>
                      <div
                        className={`${styles.evidence} ${styles.briefFacts}`}
                      >
                        {typeof todayEventCount === "number" ? (
                          <p>
                            <strong>
                              {countLabel(todayEventCount, "event")}
                            </strong>{" "}
                            on today&apos;s calendar.
                          </p>
                        ) : null}
                        {dueToday ? <p>{dueToday}</p> : null}
                        {typeof preparationCount === "number" ? (
                          <p>
                            <strong>
                              {countLabel(preparationCount, "preparation")}
                            </strong>{" "}
                            ready to handle before it becomes urgent.
                          </p>
                        ) : null}
                      </div>
                      {morningTomorrowHeadline ? (
                        <div
                          className={`${styles.prepareCard} ${styles.tomorrowPreview}`}
                        >
                          <span className={styles.sectionLabel}>Tomorrow</span>
                          <p>{morningTomorrowHeadline}</p>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <div className={styles.eyebrow}>Evening Reflection</div>
                      <h2>What is worth carrying forward?</h2>
                      <p>
                        {evening?.reflection_prompt ||
                          evening?.prompt ||
                          "What do you want to remember about today?"}
                      </p>
                      <textarea
                        value={reflection}
                        onChange={(event) => {
                          setReflection(event.target.value);
                          setReflectionSaved(false);
                        }}
                        placeholder={
                          evening?.reflection_prompt ||
                          evening?.prompt ||
                          "Write a private reflection…"
                        }
                        rows={4}
                        autoFocus
                      />
                      <button
                        type="button"
                        className={styles.secondaryButton}
                        disabled={ritualBusy || !reflection.trim()}
                        onClick={() => void saveReflection()}
                      >
                        {ritualBusy ? "Saving…" : "Save privately"}
                      </button>
                      {reflectionSaved && eveningTomorrowHeadline ? (
                        <div
                          className={`${styles.prepareCard} ${styles.tomorrowPreview}`}
                        >
                          <span className={styles.sectionLabel}>Tomorrow</span>
                          <p>{eveningTomorrowHeadline}</p>
                        </div>
                      ) : null}
                    </>
                  )}
                </article>
              ) : null}
            </section>

            <section className={styles.section}>
              <div className={styles.sectionLabel}>Now</div>
              <div className={styles.nowCard}>
                {nowEvents.length ? (
                  nowEvents.map((event) => (
                    <EventRow
                      key={event.id}
                      event={event}
                      state={state}
                      onOpen={() => setSelectedItem({ type: "event", item: event })}
                    />
                  ))
                ) : (
                  <div className={styles.empty}>
                    Nothing needs you right this minute.
                  </div>
                )}
              </div>
            </section>

            <HealthSummary
              health={state.integrations?.apple_health}
              onOpen={() => setView("connections")}
            />

            <section className={styles.section}>
              <div className={styles.sectionLabel}>Next</div>
              <div className={styles.timeline}>
                {nextEvents.length ? (
                  nextEvents.map((event) => (
                    <EventRow
                      key={event.id}
                      event={event}
                      state={state}
                      onOpen={() => setSelectedItem({ type: "event", item: event })}
                    />
                  ))
                ) : (
                  <div className={styles.empty}>The rest of today is clear.</div>
                )}
              </div>
            </section>

            {coverage ? (
              <section className={styles.section}>
                <button
                  type="button"
                  className={styles.lookAhead}
                  onClick={() => setView("week")}
                >
                  <div>
                    <span className={styles.sectionLabel}>Looking ahead</span>
                    <strong>
                      {weekIssueCount
                        ? `${weekIssueCount} ${
                            weekIssueCount === 1 ? "decision" : "decisions"
                          } still need attention.`
                        : "Pepper is looking after next week, too."}
                    </strong>
                    <p>{coverage.headline}</p>
                  </div>
                  <span className={styles.arrow}>→</span>
                </button>
              </section>
            ) : null}

            <section className={styles.section}>
              <div className={styles.sectionHeading}>
                <div className={styles.sectionLabel}>Family</div>
                <button
                  type="button"
                  className={styles.textButton}
                  onClick={() => setView("family")}
                >
                  Everyone
                </button>
              </div>
              <div className={styles.familyRail}>
                {state.members.map((member) => (
                  <button
                    type="button"
                    className={styles.familyPerson}
                    key={member.id}
                    onClick={() => void openMember(member.slug)}
                  >
                    <span className={styles.avatar} aria-hidden="true">
                      {displayName(member).slice(0, 1)}
                    </span>
                    <span>{displayName(member)}</span>
                  </button>
                ))}
              </div>
            </section>

            {state.weeklyInsight ? (
              <section className={styles.section}>
                <div className={styles.sectionLabel}>For you</div>
                <article className={styles.insight}>
                  <h2>Something Pepper noticed this week…</h2>
                  <p>{state.weeklyInsight.observation}</p>
                  <button
                    type="button"
                    className={styles.textButton}
                    onClick={() => void exploreInsight()}
                  >
                    {insightOpen ? "Close" : "Explore why →"}
                  </button>
                  {insightOpen ? (
                    <div className={styles.evidence}>
                      {insightRefs.map((item) => (
                        <blockquote key={item.id}>
                          <time>{dateLabel(item.reflection_date)}</time>
                          {item.original_text}
                        </blockquote>
                      ))}
                    </div>
                  ) : null}
                </article>
              </section>
            ) : null}

            <section className={styles.details}>
              <details>
                <summary>Family tasks</summary>
                {activeFamilyTasks.map((task) => (
                  <CheckRow
                    key={task.id}
                    label={task.title}
                    checked={false}
                    onChange={(checked) => void updateTask(task.id, checked)}
                  />
                ))}
              </details>
              <details>
                <summary>My private tasks</summary>
                {activePrivateTasks.map((task) => (
                  <CheckRow
                    key={task.id}
                    label={task.title}
                    checked={false}
                    onChange={(checked) => void updateTask(task.id, checked)}
                  />
                ))}
              </details>
              <details>
                <summary>Groceries</summary>
                {activeGroceries.map((item) => (
                  <CheckRow
                    key={item.id}
                    label={item.item}
                    checked={false}
                    onChange={(checked) => void updateGrocery(item.id, checked)}
                  />
                ))}
              </details>
              {recentCaptures.length ? (
                <details>
                  <summary>Recent Pepper updates</summary>
                  <div className={styles.evidence}>
                    {recentCaptures.map((capture, index) => (
                      <blockquote
                        key={capture.id || `capture-${index}`}
                      >
                        {captureTime(capture) ? (
                          <time>{captureTime(capture)}</time>
                        ) : null}
                        {captureText(capture)}
                      </blockquote>
                    ))}
                  </div>
                </details>
              ) : null}
            </section>
          </>
        ) : null}

        {view === "week" ? (
          <>
            <section className={styles.hero}>
              <div className={styles.eyebrow}>Planning horizon</div>
              <h1>Your next seven days.</h1>
              <p>
                {coverage?.headline ||
                  "Pepper is building the family plan it currently knows about."}
              </p>
            </section>

            <button
              type="button"
              className={`${styles.confidenceCard} ${styles.confidenceAction} ${
                weekIssueCount ? styles.confidenceNeedsWork : ""
              }`}
              disabled={!weekIssueCount}
              aria-controls={weekIssueCount ? "week-decisions" : undefined}
              onClick={revealWeekDecisions}
            >
              <div className={styles.confidenceIcon}>
                {weekIssueCount ? "!" : "✓"}
              </div>
              <div>
                <strong>
                  {weekIssueCount
                    ? `${weekIssueCount} ${
                        weekIssueCount === 1 ? "thing needs" : "things need"
                      } a decision.`
                    : "The known plan looks covered."}
                </strong>
                <p>
                  {calendarConnected
                    ? "Pepper is checking this against your connected calendar and family state."
                    : "This is based on Pepper's current family state. Connect Google Calendar to improve coverage."}
                </p>
              </div>
              {weekIssueCount ? (
                <span className={styles.confidenceActionLabel}>
                  View decisions <ChevronRight size={19} aria-hidden="true" />
                </span>
              ) : null}
            </button>

            {readiness.length ? (
              <section
                className={styles.section}
                id="week-decisions"
                tabIndex={-1}
              >
                <div className={styles.sectionLabel}>Prepare / decide</div>
                <div className={styles.noticeStack}>
                  {[...coordination, ...prepare].slice(0, 8).map((item, index) =>
                    item.severity === "prepare" ? (
                      <article
                        className={styles.prepareCard}
                        key={`${item.type}-${item.title}-${index}`}
                      >
                        <strong>{item.title}</strong>
                        <p>{item.summary}</p>
                      </article>
                    ) : (
                      <AttentionCard
                        item={item}
                        key={`${item.type}-${item.title}-${index}`}
                        onOpen={() => openAttention(item)}
                      />
                    ),
                  )}
                </div>
              </section>
            ) : null}

            <section className={styles.section}>
              <div className={styles.sectionLabel}>The week</div>
              <div className={styles.weekStack}>
                {(horizon?.days || []).map((day) => (
                  <article className={styles.dayCard} key={day.date}>
                    <div className={styles.dayHeading}>
                      <strong>{day.label}</strong>
                      <span>
                        {(day.items?.length || 0) +
                          (day.tasks?.length || 0) +
                          (day.watch?.length || 0)}{" "}
                        known
                      </span>
                    </div>
                    {day.items?.map((item) => (
                      <HorizonRow key={item.id} item={item} />
                    ))}
                    {day.watch?.map((item) => (
                      <HorizonRow
                        key={`watch-${item.id}`}
                        item={{
                          ...item,
                          starts_at: `${item.date}T12:00:00Z`,
                          title: item.title,
                          item_type: "watch",
                        }}
                      />
                    ))}
                    {day.tasks?.map((item) => (
                      <HorizonRow
                        key={`task-${item.id}`}
                        item={{
                          ...item,
                          starts_at: item.due_at || `${day.date}T12:00:00Z`,
                          item_type: "task",
                        }}
                      />
                    ))}
                    {!day.items?.length &&
                    !day.tasks?.length &&
                    !day.watch?.length ? (
                      <div className={styles.emptyDay}>Open.</div>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>

            <CalendarCard
              configured={calendarConfigured}
              connected={calendarConnected}
              status={calendar}
              onConnect={() => void connectCalendar()}
              onSync={() => void syncCalendar()}
            />
          </>
        ) : null}

        {view === "ahead" ? (
          <>
            <section className={styles.hero}>
              <div className={styles.eyebrow}>30-day foresight</div>
              <h1>What could sneak up on us?</h1>
              <p>
                Pepper keeps normal routines quiet here and surfaces exceptions,
                deadlines, preparation and important dates.
              </p>
            </section>

            {futureWatch.length ? (
              <section className={styles.section}>
                <div className={styles.sectionLabel}>Coming up</div>
                <div className={styles.aheadStack}>
                  {futureWatch.map((item, index) => (
                    <article
                      className={styles.aheadCard}
                      key={`${item.type}-${item.date}-${item.title}-${index}`}
                    >
                      <div className={styles.aheadDate}>{item.when}</div>
                      <div>
                        <strong>{item.title}</strong>
                        {item.preparation_summary ? (
                          <p>{item.preparation_summary}</p>
                        ) : item.location ? (
                          <p>{item.location}</p>
                        ) : null}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ) : (
              <section className={styles.quietEmpty}>
                <strong>No exceptions are loaded yet.</strong>
                <p>
                  As calendar, school dates and family deadlines flow into
                  Pepper, this is where the things worth preparing for will
                  appear.
                </p>
              </section>
            )}

            {routineSummaries.length ? (
              <section className={styles.section}>
                <div className={styles.sectionLabel}>Still running normally</div>
                <div className={styles.routineSummary}>
                  {routineSummaries.map((item) => (
                    <div key={item.id}>
                      <strong>{item.title}</strong>
                      <span>{item.summary}</span>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            <CalendarCard
              configured={calendarConfigured}
              connected={calendarConnected}
              status={calendar}
              onConnect={() => void connectCalendar()}
              onSync={() => void syncCalendar()}
            />
          </>
        ) : null}

        {view === "chores" ? (
          <ChoresPage
            chores={state.chores || []}
            state={state}
            busy={actionBusy}
            onCreate={createChore}
            onOpen={(task) => setSelectedItem({ type: "task", item: task })}
            onToggle={(task) =>
              void updateItem(
                { type: "task", item: task },
                task.status === "completed" ? "reopen" : "complete",
              )
            }
          />
        ) : null}

        {view === "family" ? (
          <FamilyDirectory
            members={state.members}
            onOpen={(slug) => void openMember(slug)}
          />
        ) : null}

        {view === "member" ? (
          <MemberPage
            state={memberState}
            busy={memberBusy}
            household={state}
            onBack={() => setView("family")}
            onOpen={setSelectedItem}
          />
        ) : null}

        {view === "connections" ? (
          <ConnectionsPage
            calendar={calendar}
            gmail={state.integrations?.gmail}
            health={state.integrations?.apple_health}
            healthSetup={healthSetup}
            member={state.member}
            members={state.members}
            onCalendar={() =>
              void (calendarConnected ? syncCalendar() : connectCalendar())
            }
            onEmail={() => void connectEmail()}
            onHealth={() => void pairHealth()}
            onFamily={() => setView("family")}
          />
        ) : null}
      </div>

      {selectedItem ? (
        <ItemActionSheet
          selected={selectedItem}
          state={state}
          busy={actionBusy}
          onClose={() => setSelectedItem(null)}
          onUpdate={(operation, ownerMemberId) =>
            void updateItem(selectedItem, operation, ownerMemberId)
          }
        />
      ) : null}

      {conflictResolution ? (
        <ConflictResolutionSheet
          item={conflictResolution}
          state={state}
          busy={actionBusy}
          onClose={() => setConflictResolution(null)}
          onResolve={(keepEventId, rejectEventId) =>
            resolveConflict(conflictResolution, keepEventId, rejectEventId)
          }
        />
      ) : null}

      <div className={styles.composer}>
        {message ? <div className={styles.toast}>{message}</div> : null}
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
            placeholder="Tell Pepper what changed…"
          />
          <button
            type="button"
            className={styles.send}
            disabled={busy || !tell.trim()}
            onClick={() => void sendTell()}
            aria-label="Send to Pepper"
          >
            ↑
          </button>
        </div>
      </div>
    </main>
  );
}

function memberName(state: PepperState, id?: string | null) {
  return displayName(state.members?.find((member) => member.id === id));
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
        <strong>{item.title}</strong>
        <p>{item.summary}</p>
        {canResolve ? <small className={styles.noticeAction}>{action}</small> : null}
      </span>
      {canResolve ? <ChevronRight size={19} aria-hidden="true" /> : null}
    </button>
  );
}

function EventRow({
  event,
  state,
  onOpen,
}: {
  event: FamilyEvent;
  state: PepperState;
  onOpen?: () => void;
}) {
  const driver = memberName(state, event.transport_owner_member_id);
  return (
    <button type="button" className={styles.eventRow} onClick={onOpen}>
      <div className={styles.eventTime}>{time(event.starts_at)}</div>
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
              : health?.status === "pending"
                ? "Finish the HealthKit Shortcut on your iPhone."
                : "Connect HealthKit to bring steps and goals into Pepper."}
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
  member,
  members,
  onCalendar,
  onEmail,
  onHealth,
  onFamily,
}: {
  calendar?: CalendarStatus;
  gmail?: NonNullable<PepperState["integrations"]>["gmail"];
  health?: NonNullable<PepperState["integrations"]>["apple_health"];
  healthSetup: HealthSetup | null;
  member: PepperState["member"];
  members: PepperState["members"];
  onCalendar: () => void;
  onEmail: () => void;
  onHealth: () => void;
  onFamily: () => void;
}) {
  const [openProvider, setOpenProvider] = useState<string | null>(null);
  const calendarConnection = calendar?.connection;
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
      feeds: ["Today", "Next 7", "Family schedules"],
      action: calendar?.connected
        ? "Refresh"
        : calendar?.configured
          ? "Connect"
          : "Setup pending",
      actionDisabled: !calendar?.configured,
      actionIcon: calendar?.connected ? <RefreshCw size={15} /> : <Plus size={15} />,
      onAction: onCalendar,
    },
    {
      id: "gmail",
      group: "Email and calendars",
      icon: <Mail size={21} />,
      mark: "M",
      title: "Gmail",
      identifier: gmail?.metadata?.email || "Private inbox",
      summary: gmail?.connected
        ? "The account is linked for permission-safe, action-needed signals."
        : "Private intake for commitments, deadlines, and decisions.",
      state: gmail?.connected
        ? "connected"
        : gmail?.configured
          ? "available"
          : "setup",
      statusLabel: gmail?.connected
        ? "Connected"
        : gmail?.configured
          ? "Ready to connect"
          : "Setup pending",
      owner: displayName(member),
      privacy: "Private source",
      coverage: displayName(member),
      lastActivity: gmail?.connected ? "Account linked" : "No verified activity yet",
      reads: [
        "Google account identity for the connected member",
        "Message ingestion remains off in this preview",
      ],
      automatic: [
        "Nothing is marked handled without a canonical One Brain change",
      ],
      approval: [
        "Sending email or sharing private content",
        "Creating any new external commitment",
      ],
      sharing:
        "Private by default. Only permission-safe family actions may leave the member's private context.",
      feeds: ["Private intake", "Future action-needed signals"],
      action: gmail?.connected
        ? undefined
        : gmail?.configured
          ? "Connect"
          : "Setup pending",
      actionDisabled: !gmail?.configured,
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
      feeds: ["Today", "Next 7", "Family pages"],
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
        : health?.status === "pending"
          ? "HealthKit Shortcut waiting"
          : "This iPhone",
      summary: health?.connected
        ? "Approved daily steps, goals, and active minutes are reaching Pepper."
        : "A private iPhone pathway for steps, goals, and active minutes.",
      state: health?.connected
        ? "connected"
        : health?.status === "pending"
          ? "available"
          : "setup",
      statusLabel: health?.connected
        ? "Connected"
        : health?.status === "pending"
          ? "Pairing ready"
          : "Not connected",
      owner: displayName(member),
      privacy: "Private",
      coverage: displayName(member),
      lastActivity: health?.latest?.metric_date
        ? dateLabel(health.latest.metric_date)
        : "No verified activity yet",
      reads: [
        "Only daily steps, step goal, and active minutes approved in the iPhone Shortcut",
      ],
      automatic: [
        "Update this member's private Home health summary when the paired device reports",
      ],
      approval: [
        "Every HealthKit category is selected on the iPhone",
        "Pepper never writes data back to HealthKit",
      ],
      sharing:
        "Private to this member. Health details do not appear on other family pages.",
      feeds: ["Private Home health"],
      action: health?.connected ? "Reconnect" : "Connect on iPhone",
      actionIcon: <Plus size={15} />,
      onAction: onHealth,
    },
  ];
  const groups = ["Email and calendars", "Schools and activities", "Health and personal"];
  const activeCount = providers.filter((provider) =>
    ["connected", "builtin"].includes(provider.state),
  ).length;
  const selectedProvider =
    providers.find((provider) => provider.id === openProvider) || null;

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

      {healthSetup ? (
        <section className={styles.healthSetup}>
          <div>
            <div className={styles.sectionLabel}>One-time HealthKit setup</div>
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
              {provider.action}
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
              {provider.action}
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

type ChoreFilter = "today" | "week" | "all";

function ChoresPage({
  chores,
  state,
  busy,
  onCreate,
  onOpen,
  onToggle,
}: {
  chores: FamilyTask[];
  state: PepperState;
  busy: boolean;
  onCreate: (draft: ChoreDraft) => Promise<boolean>;
  onOpen: (task: FamilyTask) => void;
  onToggle: (task: FamilyTask) => void;
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
      <section className={`${styles.hero} ${styles.choreHero}`}>
        <div className={styles.eyebrow}>Family</div>
        <h1>Family chores</h1>
        <p>See every chore. Assign it once.</p>
      </section>

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
              state={state}
              busy={busy}
              onOpen={() => onOpen(task)}
              onToggle={() => onToggle(task)}
            />
          ))
        ) : (
          <div className={styles.choreEmpty}>
            <Check size={18} aria-hidden="true" />
            <span>{filter === "today" ? "No chores due today." : filter === "week" ? "No chores due this week." : "No open chores."}</span>
          </div>
        )}
      </section>

      <button
        type="button"
        className={styles.choreAddButton}
        onClick={() => setComposerOpen(true)}
      >
        <span><Plus size={20} aria-hidden="true" /> Add a chore</span>
        <ChevronRight size={19} aria-hidden="true" />
      </button>

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
              state={state}
              busy={busy}
              quiet
              onOpen={() => onOpen(task)}
              onToggle={() => onToggle(task)}
            />
          ))}
        </details>
      ) : null}

      {composerOpen ? (
        <ChoreComposer
          members={state.members}
          actor={state.member}
          busy={busy}
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

function ChoreRow({
  task,
  state,
  busy,
  quiet = false,
  onOpen,
  onToggle,
}: {
  task: FamilyTask;
  state: PepperState;
  busy: boolean;
  quiet?: boolean;
  onOpen: () => void;
  onToggle: () => void;
}) {
  const owner = state.members.find((member) => member.id === task.owner_member_id);
  const actorIsAdult = ["adult_admin", "adult"].includes(state.member.role);
  const canChange =
    actorIsAdult ||
    task.owner_member_id === state.member.id ||
    task.creator_member_id === state.member.id;
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
        onClick={canceled ? onOpen : onToggle}
      >
        {completed ? <Check size={17} aria-hidden="true" /> : canceled ? <CircleX size={16} aria-hidden="true" /> : null}
      </button>
      <button type="button" className={styles.choreBody} onClick={onOpen}>
        <strong>{task.title}</strong>
        <small>{canceled ? "Canceled" : completed ? "Completed" : schedule}</small>
      </button>
      <button
        type="button"
        className={`${styles.choreOwner} ${owner ? "" : styles.choreOwnerEmpty}`}
        data-member={owner?.slug || "unassigned"}
        onClick={onOpen}
        aria-label={owner ? `Assigned to ${displayName(owner)}` : `Assign ${task.title}`}
      >
        {owner ? displayName(owner) : <><Plus size={15} aria-hidden="true" /> Assign</>}
      </button>
    </article>
  );
}

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
  busy,
  onClose,
  onCreate,
}: {
  members: PepperState["members"];
  actor: PepperState["member"];
  busy: boolean;
  onClose: () => void;
  onCreate: (draft: ChoreDraft) => Promise<void>;
}) {
  const actorIsAdult = ["adult_admin", "adult"].includes(actor.role);
  const [draft, setDraft] = useState<ChoreDraft>({
    title: "",
    ownerMemberId: actorIsAdult ? "" : actor.id,
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

function FamilyDirectory({
  members,
  onOpen,
}: {
  members: PepperState["members"];
  onOpen: (slug: string) => void;
}) {
  return (
    <>
      <section className={styles.hero}>
        <div className={styles.eyebrow}>Family</div>
        <h1>Everyone, in context.</h1>
        <p>Open a person to see their schedule, work, activities, and rides.</p>
      </section>
      <section className={styles.memberDirectory} aria-label="Family members">
        {members.map((member) => (
          <button
            type="button"
            className={styles.memberDirectoryRow}
            key={member.id}
            onClick={() => onOpen(member.slug)}
          >
            <span className={styles.avatar} aria-hidden="true">
              {displayName(member).slice(0, 1)}
            </span>
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
  return (
    classification === "chore" ||
    area === "chores" ||
    project === "family chores" ||
    tags.includes("chore") ||
    tags.includes("chores")
  );
}

function MemberPage({
  state,
  busy,
  household,
  onBack,
  onOpen,
}: {
  state: MemberState | null;
  busy: boolean;
  household: PepperState;
  onBack: () => void;
  onOpen: (item: SelectedItem) => void;
}) {
  if (busy && !state) return <div className={styles.quietEmpty}>Opening family plan…</div>;
  if (!state) return null;
  const activeEvents = state.events.filter(
    (item) => !["completed", "canceled"].includes(item.status),
  );
  const activeTasks = state.tasks.filter(
    (item) => !["completed", "canceled"].includes(item.status),
  );
  const chores = activeTasks.filter(isChore);
  const tasks = activeTasks.filter((item) => !isChore(item));
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
        <span className={styles.memberHeroAvatar} aria-hidden="true">
          {displayName(state.member).slice(0, 1)}
        </span>
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

      <MemberSection title="Schedule" empty="No upcoming schedule items.">
        {activeEvents.map((event) => (
          <EventRow
            key={event.id}
            event={event}
            state={household}
            onOpen={() => onOpen({ type: "event", item: event })}
          />
        ))}
      </MemberSection>

      <MemberSection title="Tasks" empty="No open tasks.">
        {tasks.map((task) => (
          <TaskActionRow
            key={task.id}
            task={task}
            state={household}
            onOpen={() => onOpen({ type: "task", item: task })}
          />
        ))}
      </MemberSection>

      <MemberSection title="Chores" empty="No chores assigned.">
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
    </>
  );
}

function MemberSection({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: React.ReactNode;
}) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children;
  const hasItems = Array.isArray(items) ? items.length > 0 : Boolean(items);
  return (
    <section className={styles.section}>
      <div className={styles.sectionLabel}>{title}</div>
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
    operation: "assign" | "complete" | "cancel" | "reopen",
    ownerMemberId?: string,
  ) => void;
}) {
  const item = selected.item;
  const eventItem = selected.type === "event" ? selected.item : null;
  const taskItem = selected.type === "task" ? selected.item : null;
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
        {eventItem ? (
          <p className={styles.sheetMeta}>
            <CalendarDays size={15} /> {dateLabel(eventItem.starts_at.slice(0, 10))} at {time(eventItem.starts_at)}
            {eventItem.location ? ` · ${eventItem.location}` : ""}
          </p>
        ) : taskItem?.due_at ? (
          <p className={styles.sheetMeta}>Due {dateLabel(taskItem.due_at.slice(0, 10))}</p>
        ) : null}
        {taskItem?.project ? (
          <p className={styles.sourceNote}>Project: {taskItem.project}</p>
        ) : null}
        {item.source && item.source !== "pepper" ? (
          <p className={styles.sourceNote}>Calendar supplied the evidence. Pepper owns this family plan.</p>
        ) : null}

        {canAssign ? (
          <label className={styles.ownerSelect}>
            {eventItem ? "Driver" : "Owner"}
            <select
              value={currentOwner}
              disabled={busy}
              onChange={(event) => onUpdate("assign", event.target.value)}
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

        {canChangeStatus ? (
          <div className={styles.sheetActions}>
            {handled ? (
              <button type="button" disabled={busy} onClick={() => onUpdate("reopen")}>
                <RotateCcw size={17} /> Restore
              </button>
            ) : (
              <>
                <button type="button" disabled={busy} onClick={() => onUpdate("complete")}>
                  <Check size={18} /> Complete
                </button>
                <button type="button" disabled={busy} onClick={() => onUpdate("cancel")}>
                  <CircleX size={18} /> Cancel
                </button>
              </>
            )}
          </div>
        ) : (
          <p className={styles.permissionNote}>An adult or the current owner can change this item.</p>
        )}
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

function HorizonRow({ item }: { item: HorizonRowItem }) {
  const driver = item.transport_owner_name;
  const label =
    item.item_type === "task"
      ? "Task"
      : item.item_type === "watch"
        ? "Coming up"
        : item.item_type === "school_schedule"
          ? item.schedule_kind === "no_school"
            ? "No school"
            : item.resolution_level === "dated_exception"
              ? "School schedule change"
              : "Weekly school rule"
        : item.source === "routine"
          ? "Routine"
          : "Plan";
  return (
    <div
      className={`${styles.horizonRow} ${
        item.resolution_level === "dated_exception" ? styles.horizonRowAlert : ""
      }`}
    >
      <div className={styles.horizonTime}>
        {item.item_type === "watch"
          ? "—"
          : item.all_day
            ? "All day"
            : time(item.starts_at)}
      </div>
      <div>
        <strong>{item.title}</strong>
        {item.detail ? <p className={styles.horizonDetail}>{item.detail}</p> : null}
        <div className={styles.horizonMeta}>
          <span>{label}</span>
          {item.location ? <span>{item.location}</span> : null}
          {driver ? <span>{driver} owns it</span> : null}
        </div>
      </div>
    </div>
  );
}

function CheckRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={styles.checkRow}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

function CalendarCard({
  configured,
  connected,
  status,
  onConnect,
  onSync,
}: {
  configured: boolean;
  connected: boolean;
  status?: CalendarStatus;
  onConnect: () => void;
  onSync: () => void;
}) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionLabel}>Calendar coverage</div>
      <article className={styles.calendarCard}>
        <div>
          <strong>
            {connected
              ? status?.connection?.calendar_name || "Google Calendar connected"
              : configured
                ? "Add Google Calendar"
                : "Google Calendar setup pending"}
          </strong>
          <p>
            {connected
              ? `Last scan ${
                  status?.connection?.last_synced_at
                    ? new Intl.DateTimeFormat("en-US", {
                        timeZone: TZ,
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      }).format(
                        new Date(status.connection.last_synced_at),
                      )
                    : "has not completed yet"
                }.`
              : configured
                ? "Connect your primary calendar so Pepper can compare the next two weeks with the family plan."
                : "The Pepper calendar engine is built, but Google OAuth credentials still need to be configured before connection can begin."}
          </p>
        </div>
        {connected ? (
          <button type="button" className={styles.secondaryButton} onClick={onSync}>
            Refresh
          </button>
        ) : configured ? (
          <button
            type="button"
            className={styles.primaryButtonSmall}
            onClick={onConnect}
          >
            Connect
          </button>
        ) : (
          <span className={styles.setupPill}>Backend setup</span>
        )}
      </article>
    </section>
  );
}
