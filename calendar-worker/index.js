/**
 * Calendar Worker — API for the calendar booking app
 * Replaces Express server.ts with Cloudflare Worker + D1
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-User-Email',
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

// ── Google Calendar helpers ──

async function getCalendarToken(env, userEmail) {
  const res = await env.AUTH_WORKER.fetch('https://auth.vegvisr.org/calendar/get-credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_email: userEmail }),
  })
  const data = await res.json()
  if (!data.success) return null
  return data.access_token
}

async function createGoogleCalendarEvent(accessToken, event) {
  try {
    const res = await fetch(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(event),
      }
    )
    if (!res.ok) {
      const err = await res.text()
      console.error('Google Calendar API error:', err)
      return null
    }
    return await res.json()
  } catch (err) {
    console.error('Google Calendar sync error:', err.message)
    return null
  }
}

// ── Seed default data for new user ──

async function seedUserDefaults(db, userEmail) {
  // Settings
  await db.prepare(
    `INSERT OR IGNORE INTO settings (user_email) VALUES (?)`
  ).bind(userEmail).run()

  // Availability days (Mon-Fri available, Sat-Sun off)
  for (let day = 0; day < 7; day++) {
    const available = day >= 1 && day <= 5 ? 1 : 0
    await db.prepare(
      `INSERT OR IGNORE INTO availability_days (user_email, day_of_week, is_available) VALUES (?, ?, ?)`
    ).bind(userEmail, day, available).run()
  }

  // Default meeting types
  const types = [
    { name: 'Check in', duration: 15, description: 'Quick check-in session' },
    { name: 'Short meeting', duration: 30, description: 'Brief discussion' },
    { name: 'Standard Meeting', duration: 45, description: 'Standard session' },
    { name: 'Double Meeting', duration: 90, description: 'Extended session' },
    { name: 'Free Information Meeting', duration: 0, description: 'Free introductory session', is_special: 1 },
  ]
  for (const t of types) {
    await db.prepare(
      `INSERT OR IGNORE INTO meeting_types (user_email, name, duration, description, is_special) VALUES (?, ?, ?, ?, ?)`
    ).bind(userEmail, t.name, t.duration, t.description || '', t.is_special || 0).run()
  }
}

// ── Worker entry ──

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders })
    }

    const url = new URL(request.url)
    const path = url.pathname

    try {
      const db = env.CALENDAR_DB

      // ── Health ──
      if (path === '/api/health') {
        return json({ status: 'ok', time: new Date().toISOString() })
      }

      // ── Public: Get settings + availability + meeting types + group meetings ──
      if (path === '/api/public/settings' && request.method === 'GET') {
        const userEmail = url.searchParams.get('user')
        if (!userEmail) return json({ error: 'user query param required' }, 400)

        const settings = await db.prepare(
          'SELECT name, bio, primary_color, availability_start, availability_end, timezone FROM settings WHERE user_email = ?'
        ).bind(userEmail).first()

        if (!settings) return json({ error: 'User not found' }, 404)

        const availability = await db.prepare(
          'SELECT day_of_week, is_available FROM availability_days WHERE user_email = ? ORDER BY day_of_week'
        ).bind(userEmail).all()

        const meetingTypes = await db.prepare(
          'SELECT id, name, duration, description, is_special FROM meeting_types WHERE user_email = ? ORDER BY duration'
        ).bind(userEmail).all()

        const groupMeetings = await db.prepare(
          'SELECT id, title, start_time, zoom_link, description, recurrence FROM group_meetings WHERE user_email = ? AND start_time > ? ORDER BY start_time'
        ).bind(userEmail, new Date().toISOString()).all()

        return json({
          settings,
          availability: availability.results,
          meetingTypes: meetingTypes.results,
          groupMeetings: groupMeetings.results,
        })
      }

      // ── Public: Create booking ──
      if (path === '/api/bookings' && request.method === 'POST') {
        const body = await request.json()
        const { owner_email, guest_name, guest_email, start_time, end_time, description, meeting_type_id } = body

        if (!owner_email || !guest_name || !guest_email || !start_time || !end_time) {
          return json({ error: 'owner_email, guest_name, guest_email, start_time, end_time are required' }, 400)
        }

        const result = await db.prepare(
          'INSERT INTO bookings (user_email, guest_name, guest_email, start_time, end_time, description, meeting_type_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).bind(owner_email, guest_name, guest_email, start_time, end_time, description || '', meeting_type_id || null).run()

        // Sync to Google Calendar
        let googleSynced = false
        const accessToken = await getCalendarToken(env, owner_email)
        if (accessToken) {
          let summary = `Meeting with ${guest_name}`
          if (meeting_type_id) {
            const mt = await db.prepare('SELECT name FROM meeting_types WHERE id = ?').bind(meeting_type_id).first()
            if (mt) summary = `${mt.name} with ${guest_name}`
          }
          const gcalEvent = await createGoogleCalendarEvent(accessToken, {
            summary,
            description: description || '',
            start: { dateTime: start_time },
            end: { dateTime: end_time },
            attendees: [{ email: guest_email }],
          })
          if (gcalEvent?.id) {
            googleSynced = true
            await db.prepare('UPDATE bookings SET google_event_id = ? WHERE id = ?')
              .bind(gcalEvent.id, result.meta.last_row_id).run()
          }
        }

        return json({ success: true, bookingId: result.meta.last_row_id, google_synced: googleSynced }, 201)
      }

      // ── Public: Join group meeting ──
      if (path === '/api/group-meetings/join' && request.method === 'POST') {
        const body = await request.json()
        const { group_meeting_id, guest_email } = body

        if (!group_meeting_id || !guest_email) {
          return json({ error: 'group_meeting_id and guest_email are required' }, 400)
        }

        await db.prepare(
          'INSERT INTO group_meeting_registrations (group_meeting_id, guest_email) VALUES (?, ?)'
        ).bind(group_meeting_id, guest_email).run()

        // Sync to Google Calendar
        const meeting = await db.prepare('SELECT * FROM group_meetings WHERE id = ?').bind(group_meeting_id).first()
        if (meeting) {
          const accessToken = await getCalendarToken(env, meeting.user_email)
          if (accessToken) {
            const startDate = new Date(meeting.start_time)
            const endDate = new Date(startDate.getTime() + 60 * 60 * 1000) // 1 hour
            await createGoogleCalendarEvent(accessToken, {
              summary: `Group Meeting: ${meeting.title}`,
              description: `${meeting.description || ''}\n\nZoom: ${meeting.zoom_link}`,
              start: { dateTime: startDate.toISOString() },
              end: { dateTime: endDate.toISOString() },
              attendees: [{ email: guest_email }],
              location: meeting.zoom_link,
            })
          }
        }

        return json({ success: true })
      }

      // ── Public: Invitation request ──
      if (path === '/api/invitation-request' && request.method === 'POST') {
        const body = await request.json()
        const { guest_email, owner_email } = body

        if (!guest_email || !owner_email) {
          return json({ error: 'guest_email and owner_email are required' }, 400)
        }

        const accessToken = await getCalendarToken(env, owner_email)
        if (accessToken) {
          const tomorrow = new Date()
          tomorrow.setDate(tomorrow.getDate() + 1)
          tomorrow.setHours(12, 0, 0, 0)
          const endTime = new Date(tomorrow.getTime() + 30 * 60 * 1000)

          await createGoogleCalendarEvent(accessToken, {
            summary: 'Information Session Invitation',
            description: `Information session requested by ${guest_email}`,
            start: { dateTime: tomorrow.toISOString() },
            end: { dateTime: endTime.toISOString() },
            attendees: [{ email: guest_email }],
          })
        }

        return json({ success: true })
      }

      // ── Admin: Get user email from header ──
      const userEmail = request.headers.get('X-User-Email')

      // ── Admin: Setup / seed defaults ──
      if (path === '/api/admin/setup' && request.method === 'POST') {
        if (!userEmail) return json({ error: 'Unauthorized' }, 401)
        await seedUserDefaults(db, userEmail)
        return json({ success: true, message: 'Defaults seeded' })
      }

      // ── Admin: Get bookings ──
      if (path === '/api/admin/bookings' && request.method === 'GET') {
        if (!userEmail) return json({ error: 'Unauthorized' }, 401)
        const bookings = await db.prepare(
          `SELECT b.id, b.guest_name, b.guest_email, b.start_time, b.end_time, b.description, b.google_event_id, b.created_at,
                  mt.name as meeting_type_name, mt.duration as meeting_type_duration
           FROM bookings b LEFT JOIN meeting_types mt ON b.meeting_type_id = mt.id
           WHERE b.user_email = ? ORDER BY b.start_time ASC`
        ).bind(userEmail).all()
        return json({ bookings: bookings.results })
      }

      // ── Admin: Update settings ──
      if (path === '/api/admin/settings' && request.method === 'POST') {
        if (!userEmail) return json({ error: 'Unauthorized' }, 401)
        const body = await request.json()
        const { name, bio, primary_color, availability_start, availability_end, timezone } = body

        await db.prepare(
          `UPDATE settings SET name = ?, bio = ?, primary_color = ?, availability_start = ?, availability_end = ?, timezone = ?, updated_at = datetime('now')
           WHERE user_email = ?`
        ).bind(name, bio, primary_color, availability_start, availability_end, timezone, userEmail).run()

        return json({ success: true })
      }

      // ── Admin: Update availability ──
      if (path === '/api/admin/availability' && request.method === 'POST') {
        if (!userEmail) return json({ error: 'Unauthorized' }, 401)
        const body = await request.json()
        const { days } = body

        if (!Array.isArray(days)) return json({ error: 'days array required' }, 400)

        for (const day of days) {
          await db.prepare(
            'INSERT INTO availability_days (user_email, day_of_week, is_available) VALUES (?, ?, ?) ON CONFLICT(user_email, day_of_week) DO UPDATE SET is_available = ?'
          ).bind(userEmail, day.day_of_week, day.is_available, day.is_available).run()
        }

        return json({ success: true })
      }

      // ── Admin: List group meetings ──
      if (path === '/api/admin/group-meetings' && request.method === 'GET') {
        if (!userEmail) return json({ error: 'Unauthorized' }, 401)
        const meetings = await db.prepare(
          'SELECT * FROM group_meetings WHERE user_email = ? ORDER BY start_time DESC'
        ).bind(userEmail).all()
        return json({ groupMeetings: meetings.results })
      }

      // ── Admin: Create/update group meeting ──
      if (path === '/api/admin/group-meetings' && request.method === 'POST') {
        if (!userEmail) return json({ error: 'Unauthorized' }, 401)
        const body = await request.json()
        const { id, title, start_time, zoom_link, description, recurrence } = body

        if (id) {
          await db.prepare(
            'UPDATE group_meetings SET title = ?, start_time = ?, zoom_link = ?, description = ?, recurrence = ? WHERE id = ? AND user_email = ?'
          ).bind(title, start_time, zoom_link, description || '', recurrence || 'None', id, userEmail).run()
        } else {
          await db.prepare(
            'INSERT INTO group_meetings (user_email, title, start_time, zoom_link, description, recurrence) VALUES (?, ?, ?, ?, ?, ?)'
          ).bind(userEmail, title, start_time, zoom_link, description || '', recurrence || 'None').run()
        }

        return json({ success: true })
      }

      // ── Admin: Delete group meeting ──
      if (path === '/api/admin/group-meetings' && request.method === 'DELETE') {
        if (!userEmail) return json({ error: 'Unauthorized' }, 401)
        const id = url.searchParams.get('id')
        if (!id) return json({ error: 'id required' }, 400)

        await db.prepare('DELETE FROM group_meetings WHERE id = ? AND user_email = ?')
          .bind(id, userEmail).run()

        return json({ success: true })
      }

      // ── Admin: Calendar connection status ──
      if (path === '/api/auth/calendar-status' && request.method === 'GET') {
        if (!userEmail) return json({ error: 'Unauthorized' }, 401)
        const accessToken = await getCalendarToken(env, userEmail)
        return json({ connected: !!accessToken })
      }

      // ── Admin: Disconnect calendar ──
      if (path === '/api/auth/calendar-disconnect' && request.method === 'POST') {
        if (!userEmail) return json({ error: 'Unauthorized' }, 401)
        await env.AUTH_WORKER.fetch('https://auth.vegvisr.org/calendar/delete-credentials', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_email: userEmail }),
        })
        return json({ success: true })
      }

      return json({ error: 'Not found' }, 404)
    } catch (err) {
      console.error('Calendar worker error:', err)
      return json({ error: err.message }, 500)
    }
  },
}
