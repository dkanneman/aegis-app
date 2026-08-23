"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./pepper.module.css";

const API =
  "https://olgyfgqlqrhfaujkfjtj.supabase.co/functions/v1/pepper-family-api";
const TZ = "America/Los_Angeles";

type Member = {
  slug: string;
  display_name: string;
  role: string;
};

type PepperState = {
  member: { id: string; slug: string; display_name: string; role: string };
  members: Array<{ id: string; slug: string; display_name: string }>;
  events: any[];
  familyTasks: any[];
  privateTasks: any[];
  groceries: any[];
  captures: any[];
  metrics?: any;
  consequences?: any[];
  weeklyInsight?: any;
  horizon?: any;
  calendarStatus?: any;
};

type View = "today" | "week" | "ahead";

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
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      hour: "numeric",
      hour12: false,
    }).format(new Date()),
  );
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function activeNow(events: any[]) {
  const now = Date.now();
  return (events || []).filter((event) => {
    const start = new Date(event.starts_at).getTime();
    const end = event.ends_at
      ? new Date(event.ends_at).getTime()
      : start + 60 * 60 * 1000;
    return start <= now && end > now;
  });
}

function upcomingToday(events: any[]) {
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
  const [members, setMembers] = useState<Member[]>([]);
  const [selected, setSelected] = useState("elle");
  const [pin, setPin] = useState("");
  const [token, setToken] = useState("");
  const [state, setState] = useState<PepperState | null>(null);
  const [view, setView] = useState<View>("today");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [tell, setTell] = useState("");
  const [reflection, setReflection] = useState("");
  const [insightOpen, setInsightOpen] = useState(false);
  const [insightRefs, setInsightRefs] = useState<any[]>([]);

  async function call(body: Record<string, unknown>, session = token) {
    const response = await fetch(API, {
      method: "POST",
      headers: {
        "content-type": "application/json",
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

  useEffect(() => {
    call({ action: "members" }, "")
      .then((result) => setMembers(result.members || []))
      .catch((error) =>
        setMessage(error instanceof Error ? error.message : "Pepper is offline."),
      );

    const saved = localStorage.getItem("pepper_family_session") || "";
    if (saved) {
      setToken(saved);
      load(saved);
    }
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
  const horizon = state?.horizon;
  const readiness = horizon?.readiness || [];
  const coordination = readiness.filter(
    (item: any) =>
      item.severity === "urgent" || item.severity === "needs_attention",
  );
  const prepare = readiness.filter((item: any) => item.severity === "prepare");
  const openTasks = [
    ...(state?.familyTasks || []),
    ...(state?.privateTasks || []),
  ].filter((task) => !["completed", "canceled"].includes(task.status)).length;
  const openGroceries = (state?.groceries || []).filter(
    (item) => item.status !== "completed",
  ).length;

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
    await call({
      action: "task",
      id,
      status: complete ? "completed" : "open",
    });
    await load();
  }

  async function updateGrocery(id: string, complete: boolean) {
    await call({
      action: "grocery",
      id,
      status: complete ? "completed" : "open",
    });
    await load();
  }

  async function saveReflection() {
    const clean = reflection.trim();
    if (!clean) return;
    await call({ action: "reflect", type: "reflection", text: clean });
    setReflection("");
    setMessage("Saved privately.");
    await load();
  }

  async function exploreInsight() {
    const insight = state?.weeklyInsight;
    if (!insight?.id) return;
    if (insightOpen) {
      setInsightOpen(false);
      return;
    }
    try {
      const result = await call({
        action: "reflection_explore",
        insight_id: insight.id,
      });
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

  function listen() {
    const w = window as any;
    const SpeechRecognition = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setMessage("Use the iPhone keyboard microphone in the message field.");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.onresult = (event: any) => {
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
      <main className={styles.loginPage}>
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
                <span>{member.display_name}</span>
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
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.topbar}>
          <div>
            <div className={styles.wordmark}>Pepper</div>
            <div className={styles.familyLine}>
              Eriksen family · {state.member.display_name}
            </div>
          </div>
          <button type="button" className={styles.quietButton} onClick={logout}>
            Switch
          </button>
        </header>

        <nav className={styles.tabs} aria-label="Pepper planning views">
          {[
            ["today", "Today"],
            ["week", "Next 7"],
            ["ahead", "Ahead"],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={view === key ? styles.tabActive : styles.tab}
              onClick={() => setView(key as View)}
            >
              {label}
            </button>
          ))}
        </nav>

        {view === "today" ? (
          <>
            <section className={styles.hero}>
              <div className={styles.eyebrow}>{longDate()}</div>
              <h1>
                {greeting()}, {state.member.display_name}.
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

            <section className={styles.section}>
              <div className={styles.sectionLabel}>Now</div>
              <div className={styles.nowCard}>
                {nowEvents.length ? (
                  nowEvents.map((event) => (
                    <EventRow key={event.id} event={event} state={state} />
                  ))
                ) : (
                  <div className={styles.empty}>
                    Nothing needs you right this minute.
                  </div>
                )}
              </div>
            </section>

            <section className={styles.section}>
              <div className={styles.sectionLabel}>Next</div>
              <div className={styles.timeline}>
                {nextEvents.length ? (
                  nextEvents.map((event) => (
                    <EventRow key={event.id} event={event} state={state} />
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
              <div className={styles.sectionLabel}>At a glance</div>
              <div className={styles.glance}>
                <Stat value={openTasks} label="open tasks" />
                <Stat value={openGroceries} label="groceries" />
                <Stat
                  value={state.metrics?.completed || 0}
                  label="handled today"
                />
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
                {(state.familyTasks || []).map((task) => (
                  <CheckRow
                    key={task.id}
                    label={task.title}
                    checked={task.status === "completed"}
                    onChange={(checked) => void updateTask(task.id, checked)}
                  />
                ))}
              </details>
              <details>
                <summary>My private tasks</summary>
                {(state.privateTasks || []).map((task) => (
                  <CheckRow
                    key={task.id}
                    label={task.title}
                    checked={task.status === "completed"}
                    onChange={(checked) => void updateTask(task.id, checked)}
                  />
                ))}
              </details>
              <details>
                <summary>Groceries</summary>
                {(state.groceries || []).map((item) => (
                  <CheckRow
                    key={item.id}
                    label={item.item}
                    checked={item.status === "completed"}
                    onChange={(checked) => void updateGrocery(item.id, checked)}
                  />
                ))}
              </details>
              <details>
                <summary>Reflect privately</summary>
                <textarea
                  value={reflection}
                  onChange={(event) => setReflection(event.target.value)}
                  placeholder="What do you want to remember about today?"
                  rows={4}
                />
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => void saveReflection()}
                >
                  Save privately
                </button>
              </details>
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
                {(horizon?.days || []).map((day: any) => (
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
                    {day.items?.map((item: any) => (
                      <HorizonRow key={item.id} item={item} />
                    ))}
                    {day.watch?.map((item: any) => (
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
                    {day.tasks?.map((item: any) => (
                      <HorizonRow
                        key={`task-${item.id}`}
                        item={{
                          ...item,
                          starts_at: item.due_at,
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

            {(horizon?.ahead?.future_watch || []).length ? (
              <section className={styles.section}>
                <div className={styles.sectionLabel}>Coming up</div>
                <div className={styles.aheadStack}>
                  {horizon.ahead.future_watch.map((item: any, index: number) => (
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

            {(horizon?.ahead?.routine_summaries || []).length ? (
              <section className={styles.section}>
                <div className={styles.sectionLabel}>Still running normally</div>
                <div className={styles.routineSummary}>
                  {horizon.ahead.routine_summaries.map((item: any) => (
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
      </div>

      <div className={styles.composer}>
        {message ? <div className={styles.toast}>{message}</div> : null}
        <div className={styles.composeInner}>
          <button
            type="button"
            className={styles.mic}
            onClick={listen}
            aria-label="Talk to Pepper"
          >
            ◉
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
  return state.members?.find((member) => member.id === id)?.display_name || "";
}

function EventRow({ event, state }: { event: any; state: PepperState }) {
  const driver = memberName(state, event.transport_owner_member_id);
  return (
    <div className={styles.eventRow}>
      <div className={styles.eventTime}>{time(event.starts_at)}</div>
      <div>
        <strong>{event.title}</strong>
        {event.location ? <p>{event.location}</p> : null}
        {driver ? (
          <span className={styles.ownerPill}>{driver} driving</span>
        ) : event.kind === "transport" ? (
          <span className={styles.needPill}>Driver needed</span>
        ) : null}
      </div>
    </div>
  );
}

function HorizonRow({ item }: { item: any }) {
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

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className={styles.stat}>
      <strong>{value}</strong>
      <span>{label}</span>
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
  status: any;
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
