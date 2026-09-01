export type PepperAtmosphere = {
  top: string;
  middle: string;
  bottom: string;
  glow: string;
};

type AtmosphereStop = PepperAtmosphere & { minute: number };

const atmosphereStops: AtmosphereStop[] = [
  { minute: 0, top: "#132333", middle: "#1F3B50", bottom: "#172432", glow: "#3F718D" },
  { minute: 300, top: "#1F3B50", middle: "#3F718D", bottom: "#9EB7C6", glow: "#D8C7A6" },
  { minute: 420, top: "#F7F4EE", middle: "#C8DCE8", bottom: "#EEEDE9", glow: "#D8C7A6" },
  { minute: 630, top: "#F7F4EE", middle: "#C8DCE8", bottom: "#9EB7C6", glow: "#F7F4EE" },
  { minute: 780, top: "#C8DCE8", middle: "#9EB7C6", bottom: "#6E9DB7", glow: "#F7F4EE" },
  { minute: 960, top: "#C8DCE8", middle: "#9EB7C6", bottom: "#B9D5D1", glow: "#F7F4EE" },
  { minute: 1110, top: "#9EB7C6", middle: "#AFA9C4", bottom: "#D8C7A6", glow: "#C9897D" },
  { minute: 1230, top: "#6E9DB7", middle: "#3F718D", bottom: "#1F3B50", glow: "#AFA9C4" },
  { minute: 1350, top: "#1F3B50", middle: "#132333", bottom: "#132333", glow: "#3F718D" },
  { minute: 1440, top: "#132333", middle: "#1F3B50", bottom: "#172432", glow: "#3F718D" },
];

function channel(value: string, offset: number) {
  return Number.parseInt(value.slice(offset, offset + 2), 16);
}

function interpolateHex(from: string, to: string, amount: number) {
  const value = [1, 3, 5]
    .map((offset) => Math.round(channel(from, offset) + (channel(to, offset) - channel(from, offset)) * amount))
    .map((part) => part.toString(16).padStart(2, "0"))
    .join("");
  return `#${value}`.toUpperCase();
}

export function pepperAtmosphereAt(minutesSinceMidnight: number): PepperAtmosphere {
  const minute = Math.min(1440, Math.max(0, minutesSinceMidnight));
  const upperIndex = atmosphereStops.findIndex((stop) => stop.minute >= minute);
  const upper = atmosphereStops[Math.max(1, upperIndex)];
  const lower = atmosphereStops[Math.max(0, upperIndex - 1)];
  const distance = Math.max(1, upper.minute - lower.minute);
  const amount = (minute - lower.minute) / distance;
  return {
    top: interpolateHex(lower.top, upper.top, amount),
    middle: interpolateHex(lower.middle, upper.middle, amount),
    bottom: interpolateHex(lower.bottom, upper.bottom, amount),
    glow: interpolateHex(lower.glow, upper.glow, amount),
  };
}

export function minutesInTimeZone(timeZone: string, date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  return hour * 60 + minute;
}
