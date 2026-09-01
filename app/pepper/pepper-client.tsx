"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleX,
  Copy,
  HeartPulse,
  Mail,
  Mic,
  RotateCcw,
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
  tags?: string[] | null;
  recurrence?: string | null;
  next_action?: string | null;
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
};

type MemberState = {
  member: Required<Member>;
  events: FamilyEvent[];
  tasks: FamilyTask[];
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
  title: string;
  summary: string;
  status?: string | null;
};

type ReadinessItem = {
  type: string;
  title: string;
  summary: string;
  severity?: string | null;
};

type HorizonRowItem = {
  id: string;
  title: string;
  starts_at: string;
  item_type?: "task" | "watch" | string;
  source?: string | null;
  location?: string | null;
  transport_owner_name?: string | null;
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

type View = "today" | "week" | "ahead" | "family" | "member" | "connections";

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

function time(ts?: string | null) {
  if (!ts) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ts));
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

  useEffect(() => {
    const url = new URL(window.location.href);
    const ritual = url.searchParams.get("ritual");
    const calendarConnected = url.searchParams.get("calendar") === "connected";
    const connection = url.searchParams.get("connection");

    const queryTimer = window.setTimeout(() => {
      if (ritual === "morning" || ritual === "evening") {
        setView("today");
        setRitualOpen(ritual);
      }
      if (calendarConnected) {
        setCalendarConfirmation(
          "Google Calendar connected. Pepper is planning ahead from it.",
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
    if (calendarConnected || connection) {
      url.searchParams.delete("calendar");
      url.searchParams.delete("connection");
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

        <nav className={styles.tabs} aria-label="Pepper planning views">
          {[
            ["today", "Today"],
            ["week", "Next 7"],
            ["ahead", "Ahead"],
            ["family", "Family"],
            ["connections", "Connect"],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={
                view === key || (view === "member" && key === "family")
                  ? styles.tabActive
                  : styles.tab
              }
              onClick={() => setView(key as View)}
            >
              {label}
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
                    <article className={styles.notice} key={item.id}>
                      <strong>{item.title}</strong>
                      <p>{item.summary}</p>
                    </article>
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

            <section
              className={`${styles.confidenceCard} ${
                weekIssueCount ? styles.confidenceNeedsWork : ""
              }`}
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
            </section>

            {readiness.length ? (
              <section className={styles.section}>
                <div className={styles.sectionLabel}>Prepare / decide</div>
                <div className={styles.noticeStack}>
                  {[...coordination, ...prepare].slice(0, 8).map((item, index) => (
                    <article
                      className={
                        item.severity === "prepare"
                          ? styles.prepareCard
                          : styles.notice
                      }
                      key={`${item.type}-${item.title}-${index}`}
                    >
                      <strong>{item.title}</strong>
                      <p>{item.summary}</p>
                    </article>
                  ))}
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
}) {
  const [openProvider, setOpenProvider] = useState<string | null>(null);
  const calendarConnection = calendar?.connection;
  const calendarOwner = displayName(
    members.find(
      (candidate) => candidate.id === calendarConnection?.connected_by_member_id,
    ),
  );
  const familyCoverage = members.map(displayName).join(", ");

  return (
    <>
      <section className={styles.hero}>
        <div className={styles.eyebrow}>Connections</div>
        <h1>Bring the right signals into Pepper.</h1>
        <p>
          Connected services supply evidence. Pepper remains the source of truth
          for the family plan.
        </p>
      </section>

      <section className={styles.connectionGroup}>
        <div className={styles.sectionLabel}>Email and calendars</div>
        <div className={styles.connectionList}>
        <ConnectionRow
          id="calendar"
          icon={<CalendarDays size={22} />}
          title="Google Calendar"
          detail={
            calendar?.connected
              ? `${calendarConnection?.calendar_name || "Calendar"} · synced ${calendarConnection?.last_synced_at ? time(calendarConnection.last_synced_at) : "recently"}`
              : "Read-only calendar evidence for schedules and conflicts."
          }
          connected={Boolean(calendar?.connected)}
          action={calendar?.connected ? "Refresh" : "Connect"}
          expanded={openProvider === "calendar"}
          onToggle={() =>
            setOpenProvider(openProvider === "calendar" ? null : "calendar")
          }
          onAction={onCalendar}
        >
          <ConnectionDetails
            owner={calendarOwner || "Assigned when connected"}
            privacy="Calendar evidence follows each event's household or private visibility."
            coverage={familyCoverage}
            reads="Event title, time, location, and provider changes from the selected calendar."
            automatic="Refresh evidence and check the canonical family plan for conflicts."
            approval="External calendar writes and new commitments."
          />
        </ConnectionRow>
        <ConnectionRow
          id="gmail"
          icon={<Mail size={22} />}
          title="Gmail"
          detail={
            gmail?.connected
              ? gmail.metadata?.email || "Connected for action-needed signals."
              : "Read-only intake for commitments, deadlines, and decisions."
          }
          connected={Boolean(gmail?.connected)}
          action={gmail?.connected ? "Connected" : "Connect"}
          disabled={Boolean(gmail?.connected)}
          expanded={openProvider === "gmail"}
          onToggle={() =>
            setOpenProvider(openProvider === "gmail" ? null : "gmail")
          }
          onAction={onEmail}
        >
          <ConnectionDetails
            owner={displayName(member)}
            privacy="Private source. Only permission-safe family actions may be shared."
            coverage="The connected member; family impact is reconciled through One Brain."
            reads="Read-only Gmail profile today. Message ingestion is not enabled in this preview."
            automatic="Nothing from email is marked handled without a canonical state change."
            approval="Sending email, sharing private content, or creating an external commitment."
          />
        </ConnectionRow>
        </div>
      </section>

      <section className={styles.connectionGroup}>
        <div className={styles.sectionLabel}>Health and personal</div>
        <div className={styles.connectionList}>
        <ConnectionRow
          id="health"
          icon={<HeartPulse size={22} />}
          title="Apple Health"
          detail={
            health?.connected
              ? `Last received ${health.latest?.metric_date || "recently"}.`
              : health?.status === "pending"
                ? "Waiting for the HealthKit Shortcut on this iPhone."
                : "Steps, goals, and active minutes through HealthKit."
          }
          connected={Boolean(health?.connected)}
          action={health?.connected ? "Reconnect" : "Connect on iPhone"}
          expanded={openProvider === "health"}
          onToggle={() =>
            setOpenProvider(openProvider === "health" ? null : "health")
          }
          onAction={onHealth}
        >
          <ConnectionDetails
            owner={displayName(member)}
            privacy="Private to this member. Health metrics are not placed on family pages."
            coverage={displayName(member)}
            reads="Only the daily steps, step goal, and active minutes approved in the iPhone Shortcut."
            automatic="Update the member's Home health summary when a paired device reports."
            approval="Every HealthKit category is selected on the iPhone; Pepper never writes to HealthKit."
          />
        </ConnectionRow>
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
    </>
  );
}

function ConnectionRow({
  id,
  icon,
  title,
  detail,
  connected,
  action,
  disabled,
  expanded,
  onToggle,
  onAction,
  children,
}: {
  id: string;
  icon: React.ReactNode;
  title: string;
  detail: string;
  connected: boolean;
  action: string;
  disabled?: boolean;
  expanded: boolean;
  onToggle: () => void;
  onAction: () => void;
  children: React.ReactNode;
}) {
  return (
    <article className={styles.connectionEntry}>
      <div className={styles.connectionRow}>
      <span className={styles.connectionIcon} aria-hidden="true">
        {icon}
      </span>
      <span className={styles.connectionText}>
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
      <span className={connected ? styles.connectedBadge : styles.readyBadge}>
        {connected ? "Connected" : "Not connected"}
      </span>
      <button
        type="button"
        className={styles.connectionDetailsButton}
        aria-expanded={expanded}
        aria-controls={`connection-${id}`}
        onClick={onToggle}
      >
        Details
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={styles.secondaryButton}
        disabled={disabled}
        onClick={onAction}
      >
        {action}
      </button>
      </div>
      {expanded ? (
        <div className={styles.connectionDetail} id={`connection-${id}`}>
          {children}
        </div>
      ) : null}
    </article>
  );
}

function ConnectionDetails({
  owner,
  privacy,
  coverage,
  reads,
  automatic,
  approval,
}: {
  owner: string;
  privacy: string;
  coverage: string;
  reads: string;
  automatic: string;
  approval: string;
}) {
  return (
    <dl className={styles.connectionFacts}>
      <div>
        <dt>Account owner</dt>
        <dd>{owner}</dd>
      </div>
      <div>
        <dt>Privacy</dt>
        <dd>{privacy}</dd>
      </div>
      <div>
        <dt>Covers</dt>
        <dd>{coverage}</dd>
      </div>
      <div>
        <dt>Pepper can read</dt>
        <dd>{reads}</dd>
      </div>
      <div>
        <dt>Automatic</dt>
        <dd>{automatic}</dd>
      </div>
      <div>
        <dt>Ask first</dt>
        <dd>{approval}</dd>
      </div>
    </dl>
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
  const tags = (task.tags || []).map((tag) => tag.toLowerCase());
  return (
    area === "home" ||
    area === "family" ||
    tags.includes("chore") ||
    Boolean(task.recurrence && task.recurrence !== "none")
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

function HorizonRow({ item }: { item: HorizonRowItem }) {
  const driver = item.transport_owner_name;
  const label =
    item.item_type === "task"
      ? "Task"
      : item.item_type === "watch"
        ? "Coming up"
        : item.source === "routine"
          ? "Routine"
          : "Plan";
  return (
    <div className={styles.horizonRow}>
      <div className={styles.horizonTime}>
        {item.item_type === "watch" ? "—" : time(item.starts_at)}
      </div>
      <div>
        <strong>{item.title}</strong>
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
