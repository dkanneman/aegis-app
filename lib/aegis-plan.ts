import type { ActionMode, ProfileInput } from "./aegis-types";

export type GeneratedAction = {
  title: string;
  area: string;
  why: string;
  mode: ActionMode;
  sourceLabel: string;
};

function cleanLine(value: string) {
  return value
    .replace(/^[-*\d.)\s]+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.]+$/, "");
}

function lines(value: string) {
  return value
    .split(/\n|;|•/)
    .map(cleanLine)
    .filter((item) => item.length > 2);
}

function short(value: string, max = 92) {
  const normalized = cleanLine(value);
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1).trim()}…`;
}

function asOutcome(value: string, fallbackVerb: string) {
  const normalized = short(value);
  const beginsWithVerb = /^(call|confirm|complete|finish|send|submit|schedule|book|pay|prepare|protect|resolve|review|make|choose|decide|take|ask|buy|return|pick|drop|write|organize|clean|start|update|check|help|attend|meet)\b/i.test(
    normalized,
  );
  return beginsWithVerb ? normalized : `${fallbackVerb}: ${normalized}`;
}

function inferArea(value: string, areas: string[]) {
  const text = value.toLowerCase();
  const aliases: Record<string, string[]> = {
    Family: ["child", "kid", "school", "family", "pickup", "drop-off", "practice"],
    Work: ["work", "client", "payroll", "meeting", "project", "business", "job"],
    Health: ["doctor", "health", "medicine", "appointment", "exercise", "sleep"],
    Finances: ["bill", "pay", "money", "bank", "budget", "finance", "rent"],
    Meals: ["dinner", "meal", "grocery", "lunch", "breakfast", "food"],
    Home: ["home", "house", "repair", "clean", "organize"],
    "Creative life": ["write", "book", "photo", "creative", "art"],
    Community: ["volunteer", "community", "church", "theater"],
  };

  let best: { area: string; position: number } | null = null;
  for (const [area, terms] of Object.entries(aliases)) {
    if (!areas.includes(area)) continue;
    for (const term of terms) {
      const position = text.indexOf(term);
      if (position >= 0 && (!best || position < best.position)) best = { area, position };
    }
  }
  return best?.area || areas[0] || "Personal";
}

function distinct(actions: GeneratedAction[]) {
  const seen = new Set<string>();
  return actions.filter((action) => {
    const key = action.title.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function generateFirstDay(profile: ProfileInput): GeneratedAction[] {
  const pressure = lines(profile.currentPressure);
  const commitments = lines(profile.sevenDayCommitments);
  const heart = profile.heart.filter(Boolean);
  const compass = profile.compass.filter(Boolean);
  const areas = profile.areas
    .filter(Boolean)
    .filter(
      (area) =>
        !["Health", "Finances"].includes(area) ||
        profile.permissions.sensitiveAreasEnabled.includes(area),
    );
  const candidates: GeneratedAction[] = [];

  if (pressure[0]) {
    candidates.push({
      title: asOutcome(pressure[0], "Make one clear move on"),
      area: inferArea(pressure[0], areas),
      why: "You said this is carrying the most mental weight right now. A defined next move creates relief without pretending the whole problem ends today.",
      mode: "progress",
      sourceLabel: "Current reality · entered by you",
    });
  }

  if (commitments[0]) {
    candidates.push({
      title: asOutcome(commitments[0], "Protect this commitment"),
      area: inferArea(commitments[0], areas),
      why: "This sits inside the next seven days and has a real consequence if it stays vague. Today needs one finished, visible result.",
      mode: "complete",
      sourceLabel: "Next seven days · entered by you",
    });
  }

  if (profile.fearOfForgetting.trim()) {
    candidates.push({
      title: asOutcome(profile.fearOfForgetting, "Protect"),
      area: inferArea(profile.fearOfForgetting, areas),
      why: "You specifically asked Aegis not to let this disappear. Naming it makes the promise visible instead of leaving it in your head.",
      mode: "complete",
      sourceLabel: "Do not forget · entered by you",
    });
  }

  for (const item of commitments.slice(1)) {
    candidates.push({
      title: asOutcome(item, "Take the next step on"),
      area: inferArea(item, areas),
      why: "This is an upcoming commitment. A small deliberate step now reduces later urgency.",
      mode: "progress",
      sourceLabel: "Next seven days · entered by you",
    });
  }

  if (heart[0]) {
    candidates.push({
      title: `Give ${short(heart[0], 48)} ten undistracted minutes`,
      area: areas.includes("Family") ? "Family" : areas[0] || "Personal",
      why: `You named ${short(heart[0], 52)} as part of your Heart. Aegis protects that promise alongside urgent work—not after everything else is done.`,
      mode: "today_only",
      sourceLabel: "Your Heart · entered by you",
    });
  }

  if (compass[0]) {
    candidates.push({
      title: `Practice today’s Compass: ${short(compass[0], 58)}`,
      area: "Personal",
      why: "Your Compass is meant to shape the day in a concrete way, not live as decorative inspiration.",
      mode: "today_only",
      sourceLabel: "Your Compass · entered by you",
    });
  }

  candidates.push(
    {
      title: "Choose the smallest honest next step",
      area: areas[0] || "Personal",
      why: "A useful first day needs one action that can actually be done, even when the full situation is still uncertain.",
      mode: "progress",
      sourceLabel: "Aegis setup · manual information only",
    },
    {
      title: "Protect one calm pause before adding more",
      area: "Personal",
      why: "Aegis is designed to reduce mental load. Capacity is part of the plan, not a reward for finishing it.",
      mode: "today_only",
      sourceLabel: "Aegis setup · manual information only",
    },
  );

  return distinct(candidates).slice(0, 3);
}
