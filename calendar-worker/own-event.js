/**
 * own-event.js — one plain event in the caller's OWN primary Google calendar (2026-11-16).
 *
 * For POST /api/calendar/events. Asked for by the VEGR Flow «Stillerom»: when the invitation has
 * gone out, the session should stand in the organiser's own calendar without anyone typing it in.
 *
 * What it will not do, on purpose:
 *   - no guests. The event has no attendees, so Google sends nothing to anybody. Inviting people
 *     is a message to them, and messages go through the flow's own approval, not through here;
 *   - no other calendar than `primary`, and nobody else's calendar: the caller is whoever
 *     resolveCaller() in index.js verified;
 *   - no second copy. An event with the same title starting at the same instant is returned as it
 *     is (created: false), so running a flow twice leaves one entry.
 *
 * Pure helpers here; the route in index.js does the fetching. Plain Node:
 *   node --test calendar-worker/test/*.test.mjs
 */

export const DEFAULT_TIME_ZONE = 'Europe/Oslo'
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/

function validZone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** The wall clock of an instant in a time zone, as the UTC-ms number those digits would be in UTC. */
function wallClockMs(instant, timeZone) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(instant).map((x) => [x.type, x.value]),
  )
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second)
}

/**
 * "2026-11-19T12:00" in Europe/Oslo → the Date of that instant. Null when the text is not a local
 * date-time, or names a time that does not exist (a 31st of November).
 */
export function localToInstant(local, timeZone = DEFAULT_TIME_ZONE) {
  const m = String(local || '').trim().match(LOCAL)
  if (!m) return null
  const want = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0))
  const back = new Date(want)
  if (back.getUTCMonth() !== +m[2] - 1 || back.getUTCDate() !== +m[3] || +m[4] > 23 || +m[5] > 59) return null
  // Two rounds: the offset at the first guess can differ from the offset at the answer (DST).
  let guess = want
  for (let i = 0; i < 2; i += 1) guess = want - (wallClockMs(new Date(guess), timeZone) - guess)
  return new Date(guess)
}

/** An instant as local date-time text in a zone: "2026-11-19T12:20:00". */
export function instantToLocal(instant, timeZone = DEFAULT_TIME_ZONE) {
  return new Date(wallClockMs(instant, timeZone)).toISOString().slice(0, 19)
}

/**
 * Check a request body and turn it into what Google wants.
 *   { ok: true, event, startInstant, endInstant }   or   { ok: false, error }
 * `start` is local time in `timeZone` (default Oslo). The end is `end` (same form) or
 * `durationMinutes` after the start (default 60).
 */
export function buildOwnEvent(body) {
  const b = body && typeof body === 'object' ? body : {}
  const summary = String(b.summary || '').trim()
  if (!summary) return { ok: false, error: 'summary (the title) is required.' }
  if (summary.length > 200) return { ok: false, error: 'summary is longer than 200 characters.' }
  const timeZone = b.timeZone ? String(b.timeZone) : DEFAULT_TIME_ZONE
  if (!validZone(timeZone)) return { ok: false, error: `timeZone "${timeZone}" is not a time zone name like Europe/Oslo.` }
  if (Array.isArray(b.attendees) && b.attendees.length) {
    return { ok: false, error: 'This route adds an event to your own calendar only; it takes no attendees.' }
  }
  const startInstant = localToInstant(b.start, timeZone)
  if (!startInstant) return { ok: false, error: 'start must be local time like 2026-11-19T12:00.' }

  let endInstant
  if (b.end !== undefined && b.end !== null && b.end !== '') {
    endInstant = localToInstant(b.end, timeZone)
    if (!endInstant) return { ok: false, error: 'end must be local time like 2026-11-19T12:20.' }
  } else {
    const mins = b.durationMinutes === undefined || b.durationMinutes === null ? 60 : Number(b.durationMinutes)
    if (!Number.isInteger(mins) || mins < 1 || mins > 1440) return { ok: false, error: 'durationMinutes must be a whole number from 1 to 1440.' }
    endInstant = new Date(startInstant.getTime() + mins * 60_000)
  }
  if (endInstant <= startInstant) return { ok: false, error: 'The event must end after it starts.' }
  if (endInstant - startInstant > 24 * 60 * 60_000) return { ok: false, error: 'The event is longer than 24 hours.' }

  const text = (v, max) => (v == null || String(v).trim() === '' ? undefined : String(v).trim().slice(0, max))
  const event = {
    summary,
    start: { dateTime: instantToLocal(startInstant, timeZone), timeZone },
    end: { dateTime: instantToLocal(endInstant, timeZone), timeZone },
  }
  const location = text(b.location, 500)
  const description = text(b.description, 4000)
  if (location) event.location = location
  if (description) event.description = description
  return { ok: true, event, startInstant, endInstant, timeZone }
}

/** Among Google events, the one that already is this event: same title, same starting instant. */
export function findSameEvent(items, summary, startInstant) {
  const want = String(summary).trim().toLowerCase()
  return (Array.isArray(items) ? items : []).find((e) => {
    if (e?.status === 'cancelled' || !e?.start?.dateTime) return false
    const s = new Date(e.start.dateTime)
    return !Number.isNaN(s.getTime()) && s.getTime() === startInstant.getTime() && String(e.summary || '').trim().toLowerCase() === want
  }) || null
}

/** What the route answers with: no description back, only what identifies the entry. */
export function shapeOwnEvent(e, created) {
  return {
    success: true,
    created,
    id: e.id || null,
    summary: e.summary || null,
    start: e.start?.dateTime || null,
    end: e.end?.dateTime || null,
    timeZone: e.start?.timeZone || null,
    location: e.location || null,
    htmlLink: e.htmlLink || null,
  }
}
