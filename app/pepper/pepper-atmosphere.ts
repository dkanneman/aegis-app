export type PepperAtmosphere = {
  top: string;
  middle: string;
  bottom: string;
  glow: string;
};

type AtmosphereStop = PepperAtmosphere & { minute: number };

const atmosphereStops: AtmosphereStop[] = [
  { minute: 0, top: "#1E2A46", middle: "#33436B", bottom: "#294239", glow: "#6F79A7" },
  { minute: 300, top: "#33436B", middle: "#6473A4", bottom: "#8FA993", glow: "#BDB7DA" },
  { minute: 420, top: "#F3F1F8", middle: "#D9DEF2", bottom: "#E3EEE6", glow: "#F8F5ED" },
  { minute: 630, top: "#EEF0F8", middle: "#D4DAEE", bottom: "#C6DCCB", glow: "#F8F7FB" },
  { minute: 780, top: "#E0E5F4", middle: "#BEC7E4", bottom: "#AFC8B5", glow: "#F7F5EE" },
  { minute: 960, top: "#D6DDEF", middle: "#B6C0DE", bottom: "#A9C5B1", glow: "#F3F1F8" },
  { minute: 1110, top: "#B4BDD9", middle: "#A69FC8", bottom: "#92AE99", glow: "#D8B9C8" },
  { minute: 1230, top: "#707AA3", middle: "#55628A", bottom: "#415E53", glow: "#BDB7DA" },
  { minute: 1350, top: "#33436B", middle: "#1E2A46", bottom: "#223A34", glow: "#6473A4" },
  { minute: 1440, top: "#1E2A46", middle: "#33436B", bottom: "#294239", glow: "#6F79A7" },
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
