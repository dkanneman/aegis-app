export type WorkPriority =
  | "critical"
  | "high"
  | "planned"
  | "later"
  | "unprioritized";

export type WorkTaskLike = {
  title: string;
  area?: string | null;
  project?: string | null;
  priority?: string | null;
  classification?: string | null;
  tags?: string[] | null;
  due_at?: string | null;
  status?: string | null;
};

export const WORK_PRIORITY_GROUPS: Array<{
  key: WorkPriority;
  label: string;
  note: string;
}> = [
  { key: "critical", label: "Critical", note: "Do first" },
  { key: "high", label: "High priority", note: "Protect next" },
  { key: "planned", label: "Planned", note: "Keep moving" },
  { key: "later", label: "Later", note: "Not urgent" },
  {
    key: "unprioritized",
    label: "Needs priority",
    note: "Decide where it belongs",
  },
];

function normalized(value?: string | null) {
  return (value || "").trim().toLowerCase();
}

export function isWorkTask(task: WorkTaskLike) {
  const area = normalized(task.area);
  const classification = normalized(task.classification);
  const project = normalized(task.project);
  const tags = (task.tags || []).map(normalized);

  return (
    area === "work" ||
    classification === "work" ||
    tags.includes("work") ||
    project === "work" ||
    /(^|\s)c\.?\s*w\.?\s*warren(\s|$)/.test(project)
  );
}

export function workPriority(task: WorkTaskLike): WorkPriority {
  const value = normalized(task.priority).replace(/[\s_-]+/g, "");
  if (["p0", "critical", "urgent", "highest"].includes(value)) {
    return "critical";
  }
  if (["p1", "high"].includes(value)) return "high";
  if (["p2", "medium", "normal", "planned"].includes(value)) {
    return "planned";
  }
  if (["p3", "low", "later", "someday"].includes(value)) return "later";
  return "unprioritized";
}

export function compareWorkTasks(a: WorkTaskLike, b: WorkTaskLike) {
  const statusRank = (task: WorkTaskLike) => {
    if (task.status === "in_progress") return 0;
    if (task.status === "on_hold") return 2;
    return 1;
  };
  const statusDifference = statusRank(a) - statusRank(b);
  if (statusDifference) return statusDifference;

  if (a.due_at && b.due_at) {
    const dueDifference = a.due_at.localeCompare(b.due_at);
    if (dueDifference) return dueDifference;
  } else if (a.due_at) {
    return -1;
  } else if (b.due_at) {
    return 1;
  }

  return a.title.localeCompare(b.title);
}
