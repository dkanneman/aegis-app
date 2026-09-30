"use client";

import { useState } from "react";
import { CalendarDays, Mail, RefreshCw } from "lucide-react";

export type PrivateSource = {
  email?: string;
  status?: string;
  last_success_at?: string | null;
  last_error?: string | null;
  selected_calendars?: Array<{ id: string; summary: string }>;
};
type Calendar = { id: string; summary: string };
export function PrivateSources({ sources, call, ios, onChanged }: {
  sources?: Record<string, PrivateSource>;
  call: (body: Record<string, unknown>) => Promise<Record<string, unknown>>;
  ios: boolean;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [calendars, setCalendars] = useState<Calendar[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  async function run(action: () => Promise<void>) {
    setBusy(true); setMessage("");
    try { await action(); } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Source retrieval failed. Retry."); }
    finally { setBusy(false); }
  }
  async function connect(capability: string) {
    const result = await call({ action: capability === "gmail" ? "email_start" : "calendar_read_start", return_target: ios ? "pepper_ios" : "web" });
    if (typeof result.authorization_url !== "string") throw new Error("Google authorization did not start.");
    window.location.assign(result.authorization_url);
  }
  async function sync(capability: string) {
    try {
      const result = await call({ action: "source_sync", capability });
      setMessage(`Sync completed. ${String(result.coverage || "")}`);
    } finally { await onChanged(); }
  }
  return <section aria-label="Private planning sources">
    <h2>Private planning sources</h2>
    {(["calendar_read", "gmail"] as const).map(capability => {
      const source = sources?.[capability];
      const connected = Boolean(source?.email && source.status !== "disconnected");
      return <section key={capability}>
        <h3>{capability === "gmail" ? <Mail size={18} /> : <CalendarDays size={18} />} {capability === "gmail" ? "Your email" : "Your existing calendars"}</h3>
        <p>{source?.email || "Not connected"} · {source?.status || "not connected"}</p>
        <p>Only you · Read only</p>
        <p>Last successful sync: {source?.last_success_at ? new Date(source.last_success_at).toLocaleString() : "Not yet verified"}</p>
        {source?.last_error ? <p role="alert">{source.last_error}</p> : null}
        {capability === "gmail" ? <p>Coverage: latest 30 messages from the past 7 days. Suggested actions require your review.</p> : <p>{source?.selected_calendars?.map(c => c.summary).join(", ") || "No calendars selected"}</p>}
        <button type="button" disabled={busy} onClick={() => void run(() => connect(capability))}>{connected ? "Reconnect" : "Connect"}</button>
        {connected ? <button type="button" disabled={busy} onClick={() => void run(() => sync(capability))}><RefreshCw size={16} /> Sync now</button> : null}
        {connected ? <button type="button" disabled={busy} onClick={() => void run(async () => {
          await call({ action: "source_disconnect", capability });
          setCalendars(null); await onChanged();
        })}>Disconnect read access</button> : null}
        {capability === "calendar_read" && connected ? <button type="button" disabled={busy} onClick={() => void run(async () => {
          const result = await call({ action: "source_calendars" });
          setCalendars(result.calendars as Calendar[]); setSelected(result.selected as string[]);
        })}>Choose calendars</button> : null}
      </section>;
    })}
    {calendars ? <fieldset disabled={busy}>
      <legend>Calendars included in your plan</legend>
      {calendars.map(calendar => <label key={calendar.id} style={{ display: "block" }}>
        <input type="checkbox" checked={selected.includes(calendar.id)} onChange={event => setSelected(previous => event.target.checked ? [...previous, calendar.id] : previous.filter(id => id !== calendar.id))} /> {calendar.summary}
      </label>)}
      <button type="button" onClick={() => void run(async () => {
        await call({ action: "source_select", calendar_ids: selected });
        await sync("calendar_read"); setCalendars(null);
      })}>Save selection and sync</button>
    </fieldset> : null}
    {message ? <p role="status">{message}</p> : null}
  </section>;
}
