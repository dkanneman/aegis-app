"use client";

import {
  ArrowLeft,
  ArrowRight,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  CircleDotDashed,
  CloudOff,
  Download,
  Heart,
  Home,
  LayoutGrid,
  LoaderCircle,
  LockKeyhole,
  Mail,
  Pencil,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Trash2,
  Users,
  Utensils,
  WalletCards,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  DEFAULT_PERMISSIONS,
  type ActionMode,
  type AegisAction,
  type AegisState,
  type ProfileInput,
} from "@/lib/aegis-types";

type User = { email: string; displayName: string };
type ApiResult = { user: User; state: AegisState; error?: string };

const setupSteps = [
  ["Welcome", "A private place to begin"],
  ["Your Heart", "What the day must protect"],
  ["Your Compass", "How you want to move"],
  ["Life Map", "Only the Areas you need"],
  ["Your world", "People, roles and activities"],
  ["Right now", "Pressure and the next seven days"],
  ["Trust", "Sources and permission boundaries"],
  ["Review", "Correct Aegis before it plans"],
] as const;

const compassOptions = [
  "Protect what matters",
  "Tell the truth while it is still small",
  "Family before performance",
  "Move with courage, not urgency",
  "Make room for joy",
  "Do what creates lasting trust",
];

const areaOptions: [string, LucideIcon, string][] = [
  ["Family", Users, "People, school and care"],
  ["Work", BriefcaseBusiness, "Jobs, business and projects"],
  ["Health", Stethoscope, "Care, appointments and energy"],
  ["Finances", WalletCards, "Bills, goals and decisions"],
  ["Meals", Utensils, "Menus, groceries and prep"],
  ["Home", Home, "Maintenance and household life"],
  ["Creative life", Sparkles, "Writing, art and momentum"],
  ["Community", LayoutGrid, "Theater, faith and service"],
];

const modeCopy: Record<ActionMode, { label: string; short: string; help: string }> = {
  complete: {
    label: "Complete the task",
    short: "Complete",
    help: "The underlying commitment is genuinely finished.",
  },
  progress: {
    label: "Log today’s progress",
    short: "Progress",
    help: "Today’s work is recorded; the larger commitment stays open.",
  },
  today_only: {
    label: "Done for today only",
    short: "Today only",
    help: "This daily action is complete without creating a permanent task.",
  },
};

function blankProfile(user: User): ProfileInput {
  return {
    displayName: user.displayName.includes("@")
      ? user.email.split("@")[0]
      : user.displayName.split(" ")[0],
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    heart: ["", "", ""],
    compass: [],
    areas: ["Family", "Work", "Home"],
    people: [],
    roles: [],
    activities: [],
    currentPressure: "",
    sevenDayCommitments: "",
    fearOfForgetting: "",
    permissions: DEFAULT_PERMISSIONS,
    onboardingStep: 0,
  };
}

function localDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function callApi(body?: Record<string, unknown>, method = "POST") {
  const response = await fetch("/api/aegis/state", {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  if (response.status === 204) return null;
  const result = (await response.json()) as ApiResult;
  if (!response.ok) throw new Error(result.error || "Aegis could not save that change.");
  return result;
}

export function AegisClient({ user, signOutPath }: { user: User; signOutPath: string }) {
  const [state, setState] = useState<AegisState | null>(null);
  const [draft, setDraft] = useState<ProfileInput>(() => blankProfile(user));
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    callApi(undefined, "GET")
      .then((result) => {
        if (!active || !result) return;
        setState(result.state);
        if (result.state.profile) {
          const profile = result.state.profile;
          setDraft({
            displayName: profile.displayName,
            timezone: profile.timezone,
            heart: [...profile.heart, "", ""].slice(0, 3),
            compass: profile.compass,
            areas: profile.areas,
            people: profile.people,
            roles: profile.roles,
            activities: profile.activities,
            currentPressure: profile.currentPressure,
            sevenDayCommitments: profile.sevenDayCommitments,
            fearOfForgetting: profile.fearOfForgetting,
            permissions: profile.permissions,
            onboardingStep: profile.onboardingStep,
          });
          setStep(profile.onboardingCompletedAt ? 7 : profile.onboardingStep);
        }
      })
      .catch((cause) => active && setError(cause.message))
      .finally(() => active && setBusy(false));
    return () => {
      active = false;
    };
  }, []);

  if (!state) {
    return (
      <main className="loading-screen">
        <span className="brand-mark"><ShieldCheck size={25} /></span>
        <LoaderCircle className="spin" size={22} />
        <p>{error || "Opening your private Aegis…"}</p>
      </main>
    );
  }

  const complete = Boolean(state.profile?.onboardingCompletedAt && state.plan);

  async function saveDraft(nextStep: number) {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const nextDraft = { ...draft, onboardingStep: nextStep };
      const result = await callApi({ type: "save_profile", profile: nextDraft });
      if (result) setState(result.state);
      setDraft(nextDraft);
      setStep(nextStep);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1600);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That step could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function finishSetup() {
    setBusy(true);
    setError("");
    try {
      const result = await callApi({
        type: "complete_onboarding",
        profile: { ...draft, onboardingStep: 7 },
        planDate: localDate(),
      });
      if (result) setState(result.state);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your first day could not be created.");
    } finally {
      setBusy(false);
    }
  }

  return complete ? (
    <DailyApp
      user={user}
      signOutPath={signOutPath}
      state={state}
      setState={setState}
    />
  ) : (
    <Onboarding
      user={user}
      signOutPath={signOutPath}
      draft={draft}
      setDraft={setDraft}
      step={step}
      busy={busy}
      error={error}
      saved={saved}
      goBack={() => setStep((current) => Math.max(0, current - 1))}
      goNext={() => saveDraft(Math.min(7, step + 1))}
      finish={finishSetup}
    />
  );
}

function Onboarding({
  user,
  signOutPath,
  draft,
  setDraft,
  step,
  busy,
  error,
  saved,
  goBack,
  goNext,
  finish,
}: {
  user: User;
  signOutPath: string;
  draft: ProfileInput;
  setDraft: (profile: ProfileInput) => void;
  step: number;
  busy: boolean;
  error: string;
  saved: boolean;
  goBack: () => void;
  goNext: () => void;
  finish: () => void;
}) {
  const valid =
    (step !== 0 || draft.displayName.trim().length > 0) &&
    (step !== 1 || draft.heart.some((item) => item.trim())) &&
    (step !== 2 || draft.compass.length > 0) &&
    (step !== 3 || draft.areas.length > 0) &&
    (step !== 5 ||
      Boolean(
        draft.currentPressure.trim() ||
          draft.sevenDayCommitments.trim() ||
          draft.fearOfForgetting.trim(),
      ));

  return (
    <main className="setup-shell">
      <aside className="setup-rail">
        <Brand subline="Private Alpha" />
        <section className="rail-promise">
          <span className="eyebrow">New user → first useful day</span>
          <h1>Tell Aegis what this life is trying to protect.</h1>
          <p>Seven short steps. Only what is needed to make today genuinely useful.</p>
        </section>
        <ol className="step-list">
          {setupSteps.slice(1).map(([title, copy], index) => {
            const number = index + 1;
            return (
              <li className={number === step ? "active" : number < step ? "done" : ""} key={title}>
                <span>{number < step ? <Check size={13} /> : number}</span>
                <p><strong>{title}</strong><small>{copy}</small></p>
              </li>
            );
          })}
        </ol>
        <div className="private-note"><LockKeyhole size={16} /><p><strong>Private to this account</strong><span>{user.email}</span></p></div>
      </aside>

      <section className="setup-stage">
        <header className="mobile-setup-head">
          <Brand subline={step === 0 ? "Welcome" : `Step ${step} of 7`} />
          <a href={signOutPath}>Sign out</a>
        </header>
        <div className="setup-card">
          {step > 0 && (
            <div className="progress-track" aria-label={`Step ${step} of 7`}>
              <span style={{ width: `${(step / 7) * 100}%` }} />
            </div>
          )}
          <div className="setup-copy">
            {step === 0 && <Welcome draft={draft} setDraft={setDraft} />}
            {step === 1 && <HeartStep draft={draft} setDraft={setDraft} />}
            {step === 2 && <CompassStep draft={draft} setDraft={setDraft} />}
            {step === 3 && <AreasStep draft={draft} setDraft={setDraft} />}
            {step === 4 && <WorldStep draft={draft} setDraft={setDraft} />}
            {step === 5 && <RealityStep draft={draft} setDraft={setDraft} />}
            {step === 6 && <TrustStep draft={draft} setDraft={setDraft} />}
            {step === 7 && <ReviewStep draft={draft} />}
          </div>
          {error && <div className="error-banner" role="alert">{error}</div>}
          <footer className="setup-actions">
            {step > 0 ? <button className="secondary" onClick={goBack} disabled={busy}><ArrowLeft size={16} /> Back</button> : <span />}
            {saved && <span className="saved"><Save size={13} /> Saved</span>}
            {step < 7 ? (
              <button className="primary" onClick={goNext} disabled={!valid || busy}>
                {busy ? <LoaderCircle className="spin" size={16} /> : null}
                {step === 0 ? "Begin gently" : "Save and continue"}<ArrowRight size={16} />
              </button>
            ) : (
              <button className="primary create-day" onClick={finish} disabled={busy}>
                {busy ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}
                Create my first useful day
              </button>
            )}
          </footer>
        </div>
      </section>
    </main>
  );
}

function Welcome({ draft, setDraft }: StepProps) {
  return (
    <div className="setup-view welcome-view">
      <span className="large-mark"><ShieldCheck size={34} /></span>
      <span className="eyebrow">Welcome to Aegis</span>
      <h2>Less to carry.<br />More of what matters.</h2>
      <p className="lead">Aegis will use only what you enter in this setup. It will not pretend to read calendars, email, health, or financial information that is not connected.</p>
      <label className="field compact-field"><span>What should Aegis call you?</span><input autoFocus value={draft.displayName} onChange={(event) => setDraft({ ...draft, displayName: event.target.value })} placeholder="Your first name" /></label>
      <div className="three-promises">
        <p><CheckCircle2 size={17} /><span><strong>Private</strong>Saved only to your signed-in account.</span></p>
        <p><CheckCircle2 size={17} /><span><strong>Correctable</strong>You review what Aegis understood.</span></p>
        <p><CheckCircle2 size={17} /><span><strong>Permissioned</strong>Nothing external happens without approval.</span></p>
      </div>
    </div>
  );
}

type StepProps = { draft: ProfileInput; setDraft: (profile: ProfileInput) => void };

function HeartStep({ draft, setDraft }: StepProps) {
  return (
    <div className="setup-view">
      <StepHeading icon={Heart} eyebrow="Step 1 · Your Heart" title="What have you promised yourself not to forget?" copy="Name up to three people, relationships, values, or parts of life that still matter when the day gets loud." />
      <div className="heart-fields">
        {draft.heart.map((item, index) => (
          <label className="field" key={index}><span>{index === 0 ? "Most important" : `Heart ${index + 1} · optional`}</span><input value={item} onChange={(event) => { const heart = [...draft.heart]; heart[index] = event.target.value; setDraft({ ...draft, heart }); }} placeholder={index === 0 ? "My children feeling seen and safe" : "A person, promise, or part of your life"} /></label>
        ))}
      </div>
      <p className="gentle-note"><Heart size={15} />The Heart is not another productivity category. It is what productivity must serve.</p>
    </div>
  );
}

function CompassStep({ draft, setDraft }: StepProps) {
  const [custom, setCustom] = useState("");
  function toggle(option: string) {
    const exists = draft.compass.includes(option);
    const compass = exists
      ? draft.compass.filter((item) => item !== option)
      : [...draft.compass, option].slice(0, 5);
    setDraft({ ...draft, compass });
  }
  function addCustom() {
    const value = custom.trim();
    if (!value || draft.compass.includes(value)) return;
    setDraft({ ...draft, compass: [...draft.compass, value].slice(0, 5) });
    setCustom("");
  }
  return (
    <div className="setup-view">
      <StepHeading icon={Sparkles} eyebrow="Step 2 · Your Compass" title="What helps you grow in the right direction?" copy="Choose three to five guiding principles. They should shape recommendations—not decorate the screen." />
      <div className="choice-chips">
        {compassOptions.map((option) => <button className={draft.compass.includes(option) ? "selected" : ""} key={option} onClick={() => toggle(option)}>{draft.compass.includes(option) && <Check size={13} />}{option}</button>)}
      </div>
      <div className="custom-add"><input value={custom} onChange={(event) => setCustom(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addCustom(); } }} placeholder="Add your own principle" /><button onClick={addCustom} disabled={!custom.trim()}>Add</button></div>
      {draft.compass.filter((item) => !compassOptions.includes(item)).map((item) => <button className="custom-value" key={item} onClick={() => toggle(item)}>{item}<X size={13} /></button>)}
      <p className="selection-count">{draft.compass.length} of 5 selected</p>
    </div>
  );
}

function AreasStep({ draft, setDraft }: StepProps) {
  function toggle(area: string) {
    setDraft({ ...draft, areas: draft.areas.includes(area) ? draft.areas.filter((item) => item !== area) : [...draft.areas, area] });
  }
  return (
    <div className="setup-view">
      <StepHeading icon={LayoutGrid} eyebrow="Step 3 · Life Map" title="Which parts of life need a place here?" copy="Select only what is real for you now. Activities and projects will live inside these Areas instead of becoming permanent clutter." />
      <div className="area-choices">
        {areaOptions.map(([area, Icon, copy]) => <button className={draft.areas.includes(area) ? "selected" : ""} key={area} onClick={() => toggle(area)}><span><Icon size={18} /></span><p><strong>{area}</strong><small>{copy}</small></p>{draft.areas.includes(area) ? <CheckCircle2 size={17} /> : <Circle size={17} />}</button>)}
      </div>
    </div>
  );
}

function WorldStep({ draft, setDraft }: StepProps) {
  return (
    <div className="setup-view">
      <StepHeading icon={Users} eyebrow="Step 4 · Your world" title="Give Aegis the shape—not the census." copy="One item per line is enough. Add only details that change planning, ownership, or timing." />
      <LineField label="People you plan around" hint="Maya — daughter\nSam — partner" values={draft.people} change={(people) => setDraft({ ...draft, people })} />
      <LineField label="Jobs, businesses, or major roles" hint="Operations manager — weekdays\nCaregiver for Mum" values={draft.roles} change={(roles) => setDraft({ ...draft, roles })} />
      <LineField label="Activities and extracurriculars" hint="Soccer — Maya — Tuesday evenings\nBook draft — Saturday mornings" values={draft.activities} change={(activities) => setDraft({ ...draft, activities })} />
      <p className="privacy-line"><LockKeyhole size={13} />Avoid medical, banking, or children’s identifying details during early Alpha testing.</p>
    </div>
  );
}

function RealityStep({ draft, setDraft }: StepProps) {
  return (
    <div className="setup-view">
      <StepHeading icon={CalendarDays} eyebrow="Step 5 · Right now" title="What would make Aegis useful today?" copy="Messy is welcome. Aegis needs the pressure and the consequence—not a perfectly organized list." />
      <label className="field"><span>What is weighing on you right now?</span><textarea value={draft.currentPressure} onChange={(event) => setDraft({ ...draft, currentPressure: event.target.value })} placeholder="I need to resolve a work issue, but family logistics keep interrupting…" /></label>
      <label className="field"><span>What must happen in the next seven days?</span><textarea value={draft.sevenDayCommitments} onChange={(event) => setDraft({ ...draft, sevenDayCommitments: event.target.value })} placeholder={'One commitment per line\nSchool form due Friday\nCall the dentist'} /></label>
      <label className="field"><span>What are you afraid you will forget?</span><input value={draft.fearOfForgetting} onChange={(event) => setDraft({ ...draft, fearOfForgetting: event.target.value })} placeholder="The small thing that keeps following you around" /></label>
    </div>
  );
}

function TrustStep({ draft, setDraft }: StepProps) {
  function toggle(area: string) {
    const enabled = draft.permissions.sensitiveAreasEnabled;
    setDraft({ ...draft, permissions: { ...draft.permissions, sensitiveAreasEnabled: enabled.includes(area) ? enabled.filter((item) => item !== area) : [...enabled, area] } });
  }
  return (
    <div className="setup-view">
      <StepHeading icon={ShieldCheck} eyebrow="Step 6 · Trust" title="Aegis should never sound more connected than it is." copy="These are the real source and permission boundaries for your first day." />
      <div className="connection-list">
        <Connection icon={CalendarDays} name="Calendar" status="Not connected" tone="off" copy="No calendar events are being read." />
        <Connection icon={Mail} name="Email" status="Not connected" tone="off" copy="No messages are being read." />
        <Connection icon={Pencil} name="This setup" status="Current" tone="current" copy="Only information you enter manually will shape the plan." />
      </div>
      <div className="locked-rule"><LockKeyhole size={17} /><p><strong>Approval is always required</strong><span>Aegis may prepare a suggestion, but cannot send, schedule, share, delete, pay, or contact anyone from this Alpha.</span></p></div>
      <fieldset className="sensitive-choice"><legend>Sensitive Areas to include in this first plan</legend>{["Health", "Finances"].map((area) => <button className={draft.permissions.sensitiveAreasEnabled.includes(area) ? "selected" : ""} key={area} onClick={() => toggle(area)}>{draft.permissions.sensitiveAreasEnabled.includes(area) ? <CheckCircle2 size={16} /> : <Circle size={16} />}{area}<small>{draft.permissions.sensitiveAreasEnabled.includes(area) ? "Allowed from manual input" : "Off by default"}</small></button>)}</fieldset>
    </div>
  );
}

function ReviewStep({ draft }: { draft: ProfileInput }) {
  return (
    <div className="setup-view review-view">
      <StepHeading icon={CheckCircle2} eyebrow="Step 7 · Review" title={`Here is what I understand, ${draft.displayName}.`} copy="Correct anything by going back. Aegis will build from this truth—not from assumptions." />
      <div className="review-grid">
        <ReviewCard title="Heart" items={draft.heart.filter(Boolean)} />
        <ReviewCard title="Compass" items={draft.compass} />
        <ReviewCard title="Life Areas" items={draft.areas} />
        <ReviewCard title="People" items={draft.people.length ? draft.people : ["None added yet"]} />
        <ReviewCard title="Roles" items={draft.roles.length ? draft.roles : ["None added yet"]} />
        <ReviewCard title="Activities" items={draft.activities.length ? draft.activities : ["None added yet"]} />
      </div>
      <article className="reality-review"><span>Current reality</span><p><strong>Pressure</strong>{draft.currentPressure || "None entered"}</p><p><strong>Next seven days</strong>{draft.sevenDayCommitments || "None entered"}</p><p><strong>Do not forget</strong>{draft.fearOfForgetting || "None entered"}</p></article>
      <div className="review-trust"><ShieldCheck size={18} /><p><strong>Manual information only</strong><span>Calendar and email are not connected. External actions are disabled.</span></p></div>
    </div>
  );
}

function DailyApp({ user, signOutPath, state, setState }: { user: User; signOutPath: string; state: AegisState; setState: (state: AegisState) => void }) {
  const [busyAction, setBusyAction] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [trustOpen, setTrustOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const profile = state.profile!;
  const plan = state.plan!;
  const acted = plan.actions.filter((action) => action.status !== "open").length;
  const date = new Date(`${plan.planDate}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  async function update(action: AegisAction, operation: "edit" | "apply", changes: { title?: string; mode?: ActionMode } = {}) {
    setBusyAction(action.id);
    setError("");
    try {
      const result = await callApi({ type: "update_action", actionId: action.id, operation, ...changes });
      if (result) setState(result.state);
      setEditing("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That change could not be saved.");
    } finally {
      setBusyAction("");
    }
  }

  async function undo(action: AegisAction) {
    setBusyAction(action.id);
    setError("");
    try {
      const result = await callApi({ type: "undo_action", actionId: action.id });
      if (result) setState(result.state);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That change could not be undone.");
    } finally {
      setBusyAction("");
    }
  }

  async function deleteData() {
    setBusyAction("delete");
    try {
      await callApi(undefined, "DELETE");
      setDeleted(true);
      window.setTimeout(() => window.location.reload(), 900);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your data could not be deleted.");
    } finally {
      setBusyAction("");
    }
  }

  return (
    <main className="daily-shell">
      <aside className="daily-rail">
        <Brand subline="Alpha · Working loop" />
        <nav className="daily-nav"><button className="active"><Sparkles size={17} />Today</button><button onClick={() => setTrustOpen(true)}><ShieldCheck size={17} />Trust & data</button></nav>
        <div className="heart-card"><span><Heart size={17} /></span><p><small>Your Heart</small><strong>{profile.heart[0]}</strong></p></div>
        <div className="compass-card"><span>Your Compass</span><p>“{profile.compass[0]}”</p></div>
        <div className="source-status"><strong>Sources used today</strong><p><Pencil size={14} />Your setup <em>Current</em></p><p><CalendarDays size={14} />Calendar <em className="off">Not connected</em></p><p><Mail size={14} />Email <em className="off">Not connected</em></p></div>
        <p className="account-line"><LockKeyhole size={13} />Private to {user.email}<a href={signOutPath}>Sign out</a></p>
      </aside>

      <section className="daily-main">
        <header className="daily-head"><Brand subline="First useful day" /><button onClick={() => setTrustOpen(true)} aria-label="Open trust and data controls"><LockKeyhole size={17} /></button></header>
        <div className="day-intro"><span className="eyebrow">{date}</span><h1>Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}, {profile.displayName}.</h1><p>Here is what today can honestly protect—from the information you gave me.</p></div>
        <div className="truth-banner"><ShieldCheck size={19} /><p><strong>No hidden sources. No invented certainty.</strong><span>This plan uses manual setup only. Calendar and email remain unconnected.</span></p></div>
        <div className="outcome-heading"><p><span className="eyebrow">Must protect</span><strong>Exactly three outcomes</strong></p><div aria-label={`${acted} of 3 acted on`}><span style={{ width: `${(acted / 3) * 100}%` }} />{acted} / 3</div></div>
        <div className="outcome-list">
          {plan.actions.map((action, index) => {
            const latest = state.audit.find((event) => event.entityId === action.id && !event.undoneAt);
            const isBusy = busyAction === action.id;
            return (
              <article className={`outcome ${action.status !== "open" ? "acted" : ""}`} key={action.id}>
                <button className="outcome-check" disabled={isBusy || action.status !== "open"} onClick={() => update(action, "apply", { mode: action.mode })} aria-label={`${modeCopy[action.mode].label}: ${action.title}`}>
                  {isBusy ? <LoaderCircle className="spin" size={19} /> : action.status === "progress" ? <CircleDotDashed size={20} /> : action.status === "done" ? <Check size={20} /> : <span>{index + 1}</span>}
                </button>
                <div className="outcome-body">
                  <div className="outcome-meta"><span>{action.area}</span><em>{action.status === "progress" ? "Progress logged" : action.status === "done" ? action.mode === "today_only" ? "Today-only done" : "Completed" : modeCopy[action.mode].short}</em></div>
                  {editing === action.id ? (
                    <div className="inline-edit"><input autoFocus value={editTitle} onChange={(event) => setEditTitle(event.target.value)} /><button onClick={() => update(action, "edit", { title: editTitle })} disabled={editTitle.trim().length < 3}>Save</button><button onClick={() => setEditing("")}><X size={15} /></button></div>
                  ) : <h2>{action.title}<button onClick={() => { setEditing(action.id); setEditTitle(action.title); }} aria-label={`Edit ${action.title}`}><Pencil size={13} /></button></h2>}
                  <p className="why"><strong>Why Aegis chose it</strong>{action.why}</p>
                  <div className="action-controls">
                    <label><span>What the check means</span><select value={action.mode} disabled={action.status !== "open" || isBusy} onChange={(event) => update(action, "edit", { mode: event.target.value as ActionMode })}>{Object.entries(modeCopy).map(([value, copy]) => <option key={value} value={value}>{copy.label}</option>)}</select><ChevronDown size={14} /></label>
                    <p>{modeCopy[action.mode].help}</p>
                  </div>
                  <div className="source-line"><Pencil size={12} />{action.sourceLabel}<span>Manual</span></div>
                  {latest && <button className="undo" onClick={() => undo(action)} disabled={isBusy}><RotateCcw size={13} />Undo last change</button>}
                </div>
              </article>
            );
          })}
        </div>
        {error && <div className="error-banner" role="alert">{error}</div>}
        <section className="proof-card"><div><CheckCircle2 size={22} /><p><strong>Your first useful day is saved.</strong><span>Refresh, close the app, or return on this account. The profile, plan, action meaning, and history remain in one canonical record.</span></p></div><p className="proof-metrics"><span><strong>3</strong>Personalized outcomes</span><span><strong>{acted}</strong>Truthful actions</span><span><strong>{state.audit.length}</strong>History events</span></p></section>
      </section>

      {trustOpen && <TrustPanel profile={profile} signOutPath={signOutPath} close={() => setTrustOpen(false)} deleteData={() => setDeleteOpen(true)} />}
      {deleteOpen && <DeleteDialog busy={busyAction === "delete"} deleted={deleted} cancel={() => setDeleteOpen(false)} confirm={deleteData} />}
    </main>
  );
}

function TrustPanel({ profile, signOutPath, close, deleteData }: { profile: NonNullable<AegisState["profile"]>; signOutPath: string; close: () => void; deleteData: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.currentTarget === event.target && close()}>
      <section className="trust-panel" role="dialog" aria-modal="true" aria-labelledby="trust-title">
        <div className="panel-head"><p><span className="eyebrow">Trust & data</span><h2 id="trust-title">Your record stays explainable.</h2></p><button onClick={close} aria-label="Close"><X size={19} /></button></div>
        <div className="connection-list"><Connection icon={CalendarDays} name="Calendar" status="Not connected" tone="off" copy="No events were used to make this plan." /><Connection icon={Mail} name="Email" status="Not connected" tone="off" copy="No messages were used to make this plan." /><Connection icon={Pencil} name="Manual setup" status="Current" tone="current" copy={`Last saved ${new Date(profile.updatedAt).toLocaleString()}.`} /></div>
        <div className="data-actions"><a className="data-button" href="/api/aegis/export" download><Download size={17} /><p><strong>Export my information</strong><span>Download profile, plan, actions, and history as JSON.</span></p><ArrowRight size={16} /></a><button className="data-button destructive" onClick={deleteData}><Trash2 size={17} /><p><strong>Delete my Aegis information</strong><span>Permanently remove this account’s Aegis profile and records.</span></p><ArrowRight size={16} /></button></div>
        <a className="signout-link" href={signOutPath}>Sign out of this account</a>
      </section>
    </div>
  );
}

function DeleteDialog({ busy, deleted, cancel, confirm }: { busy: boolean; deleted: boolean; cancel: () => void; confirm: () => void }) {
  return (
    <div className="confirm-layer"><section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-title"><span className="danger-icon"><Trash2 size={22} /></span><h2 id="delete-title">Delete everything in Aegis?</h2><p>This removes your onboarding profile, first-day plan, actions, and audit history for this signed-in account. This cannot be undone.</p>{deleted ? <div className="deleted-note"><Check size={16} />Deleted. Returning to setup…</div> : <div><button className="secondary" onClick={cancel} disabled={busy}>Keep my information</button><button className="danger" onClick={confirm} disabled={busy}>{busy ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}Delete permanently</button></div>}</section></div>
  );
}

function Brand({ subline }: { subline: string }) { return <div className="brand"><span className="brand-mark"><ShieldCheck size={21} /></span><p><strong>Aegis</strong><small>{subline}</small></p></div>; }
function StepHeading({ icon: Icon, eyebrow, title, copy }: { icon: LucideIcon; eyebrow: string; title: string; copy: string }) { return <div className="step-heading"><span><Icon size={21} /></span><p><em className="eyebrow">{eyebrow}</em><h2>{title}</h2><small>{copy}</small></p></div>; }
function LineField({ label, hint, values, change }: { label: string; hint: string; values: string[]; change: (values: string[]) => void }) { return <label className="field"><span>{label}</span><textarea value={values.join("\n")} onChange={(event) => change(event.target.value.split("\n").slice(0, 20))} placeholder={hint} /></label>; }
function Connection({ icon: Icon, name, status, tone, copy }: { icon: LucideIcon; name: string; status: string; tone: "off" | "current"; copy: string }) { return <article className="connection"><span><Icon size={17} /></span><p><strong>{name}</strong><small>{copy}</small></p><em className={tone}>{tone === "off" && <CloudOff size={11} />}{status}</em></article>; }
function ReviewCard({ title, items }: { title: string; items: string[] }) { return <article className="review-card"><span>{title}</span>{items.slice(0, 5).map((item) => <p key={item}><Check size={12} />{item}</p>)}</article>; }
