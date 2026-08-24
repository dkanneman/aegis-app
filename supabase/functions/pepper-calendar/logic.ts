export type CalendarEventLike = {
  visibility?: string;
};

export type MemberLike = {
  slug: string;
  display_name: string;
};

export type EventDateLike = {
  dateTime?: string;
  date?: string;
  timeZone?: string;
};

export function stripHtml(value: unknown) {
  return String(value || '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function normalizeText(value: unknown) {
  return stripHtml(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function zonedMidnight(dateString: string, timeZone: string) {
  const [year, month, day] = dateString.split('-').map(Number);
  const target = Date.UTC(year, month - 1, day, 0, 0, 0);
  let guess = target;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(guess)).map((part) => [part.type, part.value]),
    );
    const rendered = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    guess -= rendered - target;
  }
  return new Date(guess).toISOString();
}

export function eventTime(value: EventDateLike | undefined, fallbackTimeZone: string) {
  if (value?.dateTime) {
    const parsed = new Date(value.dateTime);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  if (value?.date) return zonedMidnight(value.date, value.timeZone || fallbackTimeZone);
  return null;
}

export function inferPerson(text: string, members: MemberLike[]) {
  const normalized = ` ${normalizeText(text)} `;
  return members.find((member) => {
    const names = [member.slug, member.display_name].map(normalizeText).filter(Boolean);
    return names.some((name) => normalized.includes(` ${name} `));
  })?.slug || null;
}

export function activityKey(text: string) {
  const normalized = normalizeText(text);
  if (/\b(xc|cross country|track|run|running|runner)\b/.test(normalized)) return 'run';
  if (/\b(soccer|football)\b/.test(normalized)) return 'soccer';
  if (/\b(dance|ballet)\b/.test(normalized)) return 'dance';
  if (/\b(rehearsal|theatre|theater|play|musical)\b/.test(normalized)) return 'theatre';
  if (/\b(dentist|doctor|appointment|therapy)\b/.test(normalized)) return 'appointment';
  const words = normalized
    .split(' ')
    .filter((word) => word.length > 3 && !['chloe', 'lyra', 'posey', 'elle', 'matt', 'team'].includes(word));
  return words.slice(0, 3).join('-') || 'event';
}

export function kindFor(text: string) {
  const normalized = normalizeText(text);
  if (/\b(dinner|lunch|breakfast)\b/.test(normalized)) return 'meal';
  if (/\b(pickup|pick up|dropoff|drop off|ride|driver)\b/.test(normalized)) return 'transport';
  if (/\b(work|meeting|shift)\b/.test(normalized)) return 'work';
  return 'activity';
}

export function requirementFor(text: string) {
  const normalized = normalizeText(text);
  const adultRunner = /\badult runner (is )?required\b/.test(normalized);
  const adultRequired = adultRunner || /\b(adult|parent|guardian)\b.{0,32}\b(required|needed|must attend|must run|volunteer)\b/.test(normalized);
  if (!adultRequired) return { required: false, label: null };
  if (adultRunner) return { required: true, label: 'Adult runner required' };
  if (/\bparent\b/.test(normalized)) return { required: true, label: 'Parent required' };
  return { required: true, label: 'Adult required' };
}

export function sharedWithHousehold(
  event: CalendarEventLike,
  personSlug: string | null,
  combinedText: string,
) {
  if (event.visibility === 'private' || event.visibility === 'confidential') return false;
  if (personSlug) return true;
  return /\b(family|kids?|children|daughter|son|school|pickup|pick up|dropoff|drop off|parent)\b/.test(
    normalizeText(combinedText),
  );
}

export function canonicalDedupeKey(personSlug: string | null, startsAt: string, text: string) {
  const minute = Math.floor(new Date(startsAt).getTime() / 60000);
  return `${personSlug || 'family'}|${minute}|${activityKey(text)}`;
}
