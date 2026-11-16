// POST /api/calendar/events — helpers and the route, with Google and auth-worker faked.
// Plain Node: node --test calendar-worker/test/*.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildOwnEvent, findSameEvent, localToInstant, instantToLocal } from '../own-event.js'
import worker from '../index.js'

test('local Oslo time becomes the right instant, in winter and in summer', () => {
  assert.equal(localToInstant('2026-11-19T12:00').toISOString(), '2026-11-19T11:00:00.000Z')
  assert.equal(localToInstant('2026-07-02T12:00').toISOString(), '2026-07-02T10:00:00.000Z')
  assert.equal(localToInstant('2026-11-19T12:00', 'America/New_York').toISOString(), '2026-11-19T17:00:00.000Z')
  assert.equal(instantToLocal(new Date('2026-11-19T11:20:00Z')), '2026-11-19T12:20:00')
  for (const bad of ['torsdag kl. 12', '2026-11-31T12:00', '2026-11-19T25:00', '2026-11-19', '', null]) assert.equal(localToInstant(bad), null, String(bad))
})

test('a body becomes a Google event without guests; the end is `end` or a duration', () => {
  const a = buildOwnEvent({ summary: ' Stillerom ', start: '2026-11-19T12:00', durationMinutes: 20, location: 'https://realtime.vegvisr.org/?openroom' })
  assert.equal(a.ok, true, a.error)
  assert.deepEqual(a.event, {
    summary: 'Stillerom',
    start: { dateTime: '2026-11-19T12:00:00', timeZone: 'Europe/Oslo' },
    end: { dateTime: '2026-11-19T12:20:00', timeZone: 'Europe/Oslo' },
    location: 'https://realtime.vegvisr.org/?openroom',
  })
  assert.equal(buildOwnEvent({ summary: 'x', start: '2026-11-19T12:00' }).event.end.dateTime, '2026-11-19T13:00:00', 'one hour by default')
  assert.equal(buildOwnEvent({ summary: 'x', start: '2026-11-19T12:00', end: '2026-11-19T12:45' }).event.end.dateTime, '2026-11-19T12:45:00')
})

test('what is refused: no title, no time, guests, a bad zone, an end before the start', () => {
  for (const [body, why] of [
    [{ start: '2026-11-19T12:00' }, /summary/],
    [{ summary: 'x' }, /start must be local time/],
    [{ summary: 'x', start: '2026-11-19T12:00', attendees: [{ email: 'a@b.no' }] }, /takes no attendees/],
    [{ summary: 'x', start: '2026-11-19T12:00', timeZone: 'Oslo/Nowhere' }, /time zone/],
    [{ summary: 'x', start: '2026-11-19T12:00', end: '2026-11-19T11:00' }, /end after it starts/],
    [{ summary: 'x', start: '2026-11-19T12:00', durationMinutes: 0 }, /durationMinutes/],
    [null, /summary/],
  ]) {
    const r = buildOwnEvent(body)
    assert.equal(r.ok, false)
    assert.match(r.error, why)
  }
})

test('the same title at the same instant is the same event — however Google writes the time', () => {
  const start = localToInstant('2026-11-19T12:00')
  const items = [
    { id: 'a', summary: 'Stillerom', status: 'cancelled', start: { dateTime: '2026-11-19T12:00:00+01:00' } },
    { id: 'b', summary: 'Noe annet', start: { dateTime: '2026-11-19T12:00:00+01:00' } },
    { id: 'c', summary: 'stillerom ', start: { dateTime: '2026-11-19T11:00:00Z' } },
    { id: 'd', summary: 'Stillerom', start: { date: '2026-11-19' } },
  ]
  assert.equal(findSameEvent(items, 'Stillerom', start).id, 'c')
  assert.equal(findSameEvent(items.slice(0, 2), 'Stillerom', start), null)
})

/** The worker with auth-worker and Google faked. `existing` = what the calendar already holds. */
function world({ existing = [], connected = true, googleSays = 200 } = {}) {
  const google = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url)
    google.push({ method: init.method || 'GET', path: u.pathname, query: Object.fromEntries(u.searchParams), body: init.body ? JSON.parse(init.body) : null, auth: init.headers?.Authorization })
    if ((init.method || 'GET') === 'GET') return new Response(JSON.stringify({ items: existing }), { status: 200 })
    if (googleSays !== 200) return new Response('{"error":"nope"}', { status: googleSays })
    const b = JSON.parse(init.body)
    return new Response(JSON.stringify({ id: 'new1', htmlLink: 'https://calendar.google.com/x', ...b, start: { dateTime: '2026-11-19T12:00:00+01:00', timeZone: 'Europe/Oslo' }, end: { dateTime: '2026-11-19T12:20:00+01:00', timeZone: 'Europe/Oslo' } }), { status: 200 })
  }
  const env = {
    CALENDAR_DB: {},
    CALENDAR_ENFORCE_TOKEN: 'true',
    AUTH_WORKER: { fetch: async (_u, init) => new Response(JSON.stringify(connected ? { success: true, access_token: `tok-${JSON.parse(init.body).user_email}` } : { success: false }), { status: 200 }) },
  }
  const post = (body, { host = 'calendar-worker', email = 'tor@example.no' } = {}) =>
    worker.fetch(new Request(`https://${host}/api/calendar/events`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(email ? { 'X-User-Email': email } : {}) }, body: JSON.stringify(body) }), env)
      .then(async (r) => ({ status: r.status, body: await r.json() }))
  return { post, google, restore: () => { globalThis.fetch = realFetch } }
}
const STILLE = { summary: 'Stillerom', start: '2026-11-19T12:00', durationMinutes: 20, location: 'https://realtime.vegvisr.org/?openroom' }

test('the route adds the event to the caller\'s own primary calendar and mails nobody', async () => {
  const w = world()
  try {
    const r = await w.post(STILLE)
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal(r.body.created, true)
    assert.equal(r.body.id, 'new1')
    assert.equal(r.body.htmlLink, 'https://calendar.google.com/x')
    assert.equal(w.google.length, 2)
    assert.deepEqual([w.google[0].method, w.google[0].path, w.google[0].query.timeMin], ['GET', '/calendar/v3/calendars/primary/events', '2026-11-19T11:00:00.000Z'])
    assert.deepEqual([w.google[1].method, w.google[1].path, w.google[1].query.sendUpdates], ['POST', '/calendar/v3/calendars/primary/events', 'none'])
    assert.equal(w.google[1].auth, 'Bearer tok-tor@example.no', 'the calendar is the verified caller\'s')
    assert.equal(w.google[1].body.attendees, undefined)
  } finally { w.restore() }
})

test('an event that is already there is answered as it is, and nothing is added', async () => {
  const w = world({ existing: [{ id: 'old', summary: 'Stillerom', htmlLink: 'https://calendar.google.com/old', start: { dateTime: '2026-11-19T12:00:00+01:00' }, end: { dateTime: '2026-11-19T12:20:00+01:00' } }] })
  try {
    const r = await w.post(STILLE)
    assert.equal(r.status, 200)
    assert.deepEqual([r.body.created, r.body.id], [false, 'old'])
    assert.ok(!w.google.some((c) => c.method === 'POST'))
  } finally { w.restore() }
})

test('no caller, a public call that only names an e-mail, guests, no Google, or Google saying no: nothing is added', async () => {
  for (const [why, opts, body, call, status] of [
    ['no caller', {}, STILLE, { email: null }, 401],
    ['a public request naming someone', {}, STILLE, { host: 'calendar.vegvisr.org' }, 401],
    ['guests', {}, { ...STILLE, attendees: [{ email: 'a@b.no' }] }, {}, 400],
    ['no title', {}, { start: STILLE.start }, {}, 400],
    ['calendar not connected', { connected: false }, STILLE, {}, 409],
    ['Google refuses', { googleSays: 403 }, STILLE, {}, 502],
  ]) {
    const w = world(opts)
    try {
      const r = await w.post(body, call)
      assert.equal(r.status, status, why)
      if (status !== 502) assert.ok(!w.google.some((c) => c.method === 'POST'), why)
      assert.notEqual(r.body.created, true, why)
    } finally { w.restore() }
  }
})
