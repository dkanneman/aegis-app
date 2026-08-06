import {
  completeOnboarding,
  deleteAegisData,
  getAegisState,
  saveProfileDraft,
  undoOwnedAction,
  updateOwnedAction,
} from "@/lib/aegis-db";
import { getAegisApiUser } from "@/lib/aegis-auth";
import {
  DEFAULT_PERMISSIONS,
  type AegisPermissions,
  type ProfileInput,
} from "@/lib/aegis-types";

export const dynamic = "force-dynamic";

function clean(value: unknown, max = 1500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function list(value: unknown, maxItems = 20) {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().slice(0, 140))
        .filter(Boolean)
        .slice(0, maxItems)
    : [];
}

function profileFromPayload(payload: Record<string, unknown>): ProfileInput {
  const rawPermissions =
    payload.permissions && typeof payload.permissions === "object"
      ? (payload.permissions as Partial<AegisPermissions>)
      : {};
  return {
    displayName: clean(payload.displayName, 80),
    timezone: clean(payload.timezone, 80) || "UTC",
    heart: list(payload.heart, 3),
    compass: list(payload.compass, 5),
    areas: list(payload.areas, 12),
    people: list(payload.people, 20),
    roles: list(payload.roles, 12),
    activities: list(payload.activities, 20),
    currentPressure: clean(payload.currentPressure),
    sevenDayCommitments: clean(payload.sevenDayCommitments),
    fearOfForgetting: clean(payload.fearOfForgetting),
    permissions: {
      ...DEFAULT_PERMISSIONS,
      sensitiveAreasEnabled: list(rawPermissions.sensitiveAreasEnabled, 4),
    },
    onboardingStep:
      typeof payload.onboardingStep === "number"
        ? Math.min(7, Math.max(0, Math.round(payload.onboardingStep)))
        : 0,
  };
}

function message(error: unknown) {
  const value = error instanceof Error ? error.message : "Unexpected error";
  if (value.includes("no such table")) {
    return "Aegis storage is being prepared. Please try again after the current update finishes.";
  }
  return value;
}

export async function GET(request: Request) {
  const user = getAegisApiUser(request);
  if (!user) return Response.json({ error: "Sign in is required." }, { status: 401 });
  try {
    return Response.json({ user, state: await getAegisState(user.email) });
  } catch (error) {
    return Response.json({ error: message(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = getAegisApiUser(request);
  if (!user) return Response.json({ error: "Sign in is required." }, { status: 401 });

  try {
    const payload = (await request.json()) as Record<string, unknown>;
    const type = clean(payload.type, 40);
    let state;

    if (type === "save_profile") {
      state = await saveProfileDraft(user.email, profileFromPayload(payload.profile as Record<string, unknown>));
    } else if (type === "complete_onboarding") {
      const profile = profileFromPayload(payload.profile as Record<string, unknown>);
      if (!profile.displayName || profile.heart.length === 0 || profile.compass.length === 0 || profile.areas.length === 0) {
        return Response.json(
          { error: "Name, Heart, Compass, and at least one Life Area are required." },
          { status: 400 },
        );
      }
      const planDate = /^\d{4}-\d{2}-\d{2}$/.test(clean(payload.planDate, 10))
        ? clean(payload.planDate, 10)
        : new Date().toISOString().slice(0, 10);
      state = await completeOnboarding(user.email, profile, planDate);
    } else if (type === "update_action") {
      const operation = payload.operation === "apply" ? "apply" : "edit";
      const mode = ["complete", "progress", "today_only"].includes(String(payload.mode))
        ? (payload.mode as "complete" | "progress" | "today_only")
        : undefined;
      state = await updateOwnedAction(user.email, clean(payload.actionId, 80), {
        operation,
        title: clean(payload.title, 160) || undefined,
        mode,
      });
    } else if (type === "undo_action") {
      state = await undoOwnedAction(user.email, clean(payload.actionId, 80));
    } else {
      return Response.json({ error: "Unknown Aegis action." }, { status: 400 });
    }

    return Response.json({ user, state });
  } catch (error) {
    return Response.json({ error: message(error) }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const user = getAegisApiUser(request);
  if (!user) return Response.json({ error: "Sign in is required." }, { status: 401 });
  try {
    await deleteAegisData(user.email);
    return new Response(null, { status: 204 });
  } catch (error) {
    return Response.json({ error: message(error) }, { status: 500 });
  }
}
