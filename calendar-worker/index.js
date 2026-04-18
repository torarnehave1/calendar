/**
 * Calendar Worker — API for the calendar booking app
 * Replaces Express server.ts with Cloudflare Worker + D1
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
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

async function fetchGoogleCalendarEvents(accessToken, timeMin, timeMax) {
  try {
    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: 'true',
      orderBy: 'startTime',
    })
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    if (!res.ok) {
      console.error('Google Calendar fetch error:', await res.text())
      return []
    }
    const data = await res.json()
    return (data.items || [])
      .filter(e => e.start?.dateTime && e.end?.dateTime) // skip all-day events
      .map(e => ({ start_time: e.start.dateTime, end_time: e.end.dateTime, source: 'google' }))
  } catch (err) {
    console.error('Google Calendar fetch error:', err.message)
    return []
  }
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

async function updateGoogleCalendarEvent(accessToken, eventId, updates) {
  try {
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}?sendUpdates=all`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updates),
      }
    )
    if (!res.ok) {
      console.error('Google Calendar update error:', await res.text())
      return false
    }
    return true
  } catch (err) {
    console.error('Google Calendar update error:', err.message)
    return false
  }
}

// Returns rich event details for admin view (includes summary, attendees, gcal id)
async function fetchGoogleCalendarEventsDetailed(accessToken, timeMin, timeMax) {
  try {
    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '200',
    })
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    if (!res.ok) {
      console.error('Google Calendar detailed fetch error:', await res.text())
      return []
    }
    const data = await res.json()
    return (data.items || [])
      .filter(e => e.start?.dateTime && e.end?.dateTime)
      .map(e => ({
        id: null,
        google_event_id: e.id,
        guest_name: e.summary || '(No title)',
        guest_email: (e.attendees || []).filter(a => !a.self).map(a => a.email).join(', '),
        start_time: e.start.dateTime,
        end_time: e.end.dateTime,
        description: e.description || '',
        meeting_type_name: null,
        meeting_type_duration: null,
        created_at: e.created,
        source: 'google',
      }))
  } catch (err) {
    console.error('Google Calendar detailed fetch error:', err.message)
    return []
  }
}

async function deleteGoogleCalendarEvent(accessToken, eventId) {
  try {
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}?sendUpdates=all`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    )
    if (!res.ok && res.status !== 410) {
      console.error('Google Calendar delete error:', await res.text())
      return false
    }
    return true
  } catch (err) {
    console.error('Google Calendar delete error:', err.message)
    return false
  }
}

// ── Fetch all calendars the user has access to ──
async function fetchCalendarList(accessToken) {
  try {
    const res = await fetch(
      'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=50',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    if (!res.ok) return []
    const data = await res.json()
    return (data.items || []).map(c => ({
      id: c.id,
      summary: c.summary,
      backgroundColor: c.backgroundColor || '#4f6df5',
      foregroundColor: c.foregroundColor || '#ffffff',
      accessRole: c.accessRole,
      primary: c.primary || false,
    }))
  } catch (err) {
    console.error('calendarList error:', err.message)
    return []
  }
}

// ── Fetch events from all calendars for a day range ──
async function fetchAllCalendarEvents(accessToken, timeMin, timeMax) {
  const calendars = await fetchCalendarList(accessToken)
  if (!calendars.length) return { events: [], calendars: [] }

  const results = await Promise.all(
    calendars.map(async (cal) => {
      try {
        const params = new URLSearchParams({
          timeMin,
          timeMax,
          singleEvents: 'true',
          orderBy: 'startTime',
          maxResults: '250',
        })
        const res = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?${params}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        )
        if (!res.ok) return []
        const data = await res.json()
        return (data.items || []).map(e => ({
          id: e.id,
          summary: e.summary || '(No title)',
          description: e.description || '',
          location: e.location || '',
          start_time: e.start?.dateTime || e.start?.date,
          end_time: e.end?.dateTime || e.end?.date,
          all_day: !e.start?.dateTime,
          calendar_id: cal.id,
          calendar_color: cal.backgroundColor,
          calendar_name: cal.summary,
          attendees: (e.attendees || []).map(a => a.email),
          html_link: e.htmlLink || '',
          created: e.created,
          updated: e.updated,
        }))
      } catch {
        return []
      }
    })
  )

  const events = results.flat().sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
  return { events, calendars }
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

      // ── OpenAPI spec ──
      if (path === '/openapi.json') {
        return json({
          openapi: '3.0.3',
          info: {
            title: 'Calendar Worker API',
            version: '1.0.0',
            description: 'API for the calendar booking app. Public endpoints require a user query param. Admin endpoints require an X-User-Email header.',
          },
          servers: [{ url: '/' }],
          paths: {
            '/api/health': {
              get: {
                summary: 'Health check',
                operationId: 'getHealth',
                tags: ['Health'],
                responses: {
                  '200': {
                    description: 'Worker is healthy',
                    content: { 'application/json': { schema: {
                      type: 'object',
                      properties: {
                        status: { type: 'string', example: 'ok' },
                        time: { type: 'string', format: 'date-time' },
                      },
                    } } },
                  },
                },
              },
            },
            '/api/public/settings': {
              get: {
                summary: 'Get public settings, availability, meeting types, and group meetings for a user',
                operationId: 'getPublicSettings',
                tags: ['Public'],
                parameters: [
                  { name: 'user', in: 'query', required: true, schema: { type: 'string' }, description: 'Owner email address' },
                ],
                responses: {
                  '200': {
                    description: 'User settings and availability',
                    content: { 'application/json': { schema: {
                      type: 'object',
                      properties: {
                        settings: {
                          type: 'object',
                          properties: {
                            name: { type: 'string' },
                            bio: { type: 'string' },
                            primary_color: { type: 'string' },
                            availability_start: { type: 'string' },
                            availability_end: { type: 'string' },
                            timezone: { type: 'string' },
                          },
                        },
                        availability: {
                          type: 'array',
                          items: {
                            type: 'object',
                            properties: {
                              day_of_week: { type: 'integer', minimum: 0, maximum: 6 },
                              is_available: { type: 'integer', enum: [0, 1] },
                            },
                          },
                        },
                        meetingTypes: {
                          type: 'array',
                          items: {
                            type: 'object',
                            properties: {
                              id: { type: 'integer' },
                              name: { type: 'string' },
                              duration: { type: 'integer' },
                              description: { type: 'string' },
                              is_special: { type: 'integer', enum: [0, 1] },
                            },
                          },
                        },
                        groupMeetings: {
                          type: 'array',
                          items: { $ref: '#/components/schemas/GroupMeeting' },
                        },
                      },
                    } } },
                  },
                  '400': { $ref: '#/components/responses/BadRequest' },
                  '404': { description: 'User not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
                },
              },
            },
            '/api/public/bookings': {
              get: {
                summary: 'Get booked slots for a user on a given date (D1 + Google Calendar)',
                operationId: 'getPublicBookings',
                tags: ['Public'],
                parameters: [
                  { name: 'user', in: 'query', required: true, schema: { type: 'string' }, description: 'Owner email address' },
                  { name: 'date', in: 'query', required: true, schema: { type: 'string', format: 'date' }, description: 'Date in YYYY-MM-DD format' },
                ],
                responses: {
                  '200': {
                    description: 'List of booked time slots',
                    content: { 'application/json': { schema: {
                      type: 'object',
                      properties: {
                        bookings: {
                          type: 'array',
                          items: {
                            type: 'object',
                            properties: {
                              start_time: { type: 'string', format: 'date-time' },
                              end_time: { type: 'string', format: 'date-time' },
                              source: { type: 'string', enum: ['d1', 'google'] },
                            },
                          },
                        },
                      },
                    } } },
                  },
                  '400': { $ref: '#/components/responses/BadRequest' },
                },
              },
            },
            '/api/bookings': {
              post: {
                summary: 'Create a new booking (public)',
                operationId: 'createBooking',
                tags: ['Public'],
                requestBody: {
                  required: true,
                  content: { 'application/json': { schema: {
                    type: 'object',
                    required: ['owner_email', 'guest_name', 'guest_email', 'start_time', 'end_time'],
                    properties: {
                      owner_email: { type: 'string', description: 'Calendar owner email' },
                      guest_name: { type: 'string' },
                      guest_email: { type: 'string' },
                      start_time: { type: 'string', format: 'date-time' },
                      end_time: { type: 'string', format: 'date-time' },
                      description: { type: 'string' },
                      meeting_type_id: { type: 'integer', nullable: true },
                    },
                  } } },
                },
                responses: {
                  '201': {
                    description: 'Booking created',
                    content: { 'application/json': { schema: {
                      type: 'object',
                      properties: {
                        success: { type: 'boolean' },
                        bookingId: { type: 'integer' },
                        google_synced: { type: 'boolean' },
                      },
                    } } },
                  },
                  '400': { $ref: '#/components/responses/BadRequest' },
                  '409': { description: 'Time slot conflict', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
                },
              },
            },
            '/api/group-meetings/join': {
              post: {
                summary: 'Join a group meeting as a guest',
                operationId: 'joinGroupMeeting',
                tags: ['Public'],
                requestBody: {
                  required: true,
                  content: { 'application/json': { schema: {
                    type: 'object',
                    required: ['group_meeting_id', 'guest_email'],
                    properties: {
                      group_meeting_id: { type: 'integer' },
                      guest_email: { type: 'string' },
                    },
                  } } },
                },
                responses: {
                  '200': { description: 'Joined successfully', content: { 'application/json': { schema: { $ref: '#/components/schemas/Success' } } } },
                  '400': { $ref: '#/components/responses/BadRequest' },
                },
              },
            },
            '/api/invitation-request': {
              post: {
                summary: 'Request an information session invitation',
                operationId: 'requestInvitation',
                tags: ['Public'],
                requestBody: {
                  required: true,
                  content: { 'application/json': { schema: {
                    type: 'object',
                    required: ['guest_email', 'owner_email'],
                    properties: {
                      guest_email: { type: 'string' },
                      owner_email: { type: 'string' },
                    },
                  } } },
                },
                responses: {
                  '200': { description: 'Invitation sent', content: { 'application/json': { schema: { $ref: '#/components/schemas/Success' } } } },
                  '400': { $ref: '#/components/responses/BadRequest' },
                },
              },
            },
            '/api/admin/setup': {
              post: {
                summary: 'Seed default settings, availability, and meeting types for the authenticated user',
                operationId: 'adminSetup',
                tags: ['Admin'],
                parameters: [{ $ref: '#/components/parameters/XUserEmail' }],
                responses: {
                  '200': {
                    description: 'Defaults seeded',
                    content: { 'application/json': { schema: {
                      type: 'object',
                      properties: {
                        success: { type: 'boolean' },
                        message: { type: 'string' },
                      },
                    } } },
                  },
                  '401': { $ref: '#/components/responses/Unauthorized' },
                },
              },
            },
            '/api/admin/bookings': {
              get: {
                summary: 'List all bookings for the authenticated user',
                operationId: 'adminGetBookings',
                tags: ['Admin'],
                parameters: [{ $ref: '#/components/parameters/XUserEmail' }],
                responses: {
                  '200': {
                    description: 'List of bookings',
                    content: { 'application/json': { schema: {
                      type: 'object',
                      properties: {
                        bookings: {
                          type: 'array',
                          items: {
                            type: 'object',
                            properties: {
                              id: { type: 'integer' },
                              guest_name: { type: 'string' },
                              guest_email: { type: 'string' },
                              start_time: { type: 'string', format: 'date-time' },
                              end_time: { type: 'string', format: 'date-time' },
                              description: { type: 'string' },
                              google_event_id: { type: 'string', nullable: true },
                              created_at: { type: 'string', format: 'date-time' },
                              meeting_type_name: { type: 'string', nullable: true },
                              meeting_type_duration: { type: 'integer', nullable: true },
                            },
                          },
                        },
                      },
                    } } },
                  },
                  '401': { $ref: '#/components/responses/Unauthorized' },
                },
              },
              patch: {
                summary: 'Reschedule a booking',
                operationId: 'adminRescheduleBooking',
                tags: ['Admin'],
                parameters: [{ $ref: '#/components/parameters/XUserEmail' }],
                requestBody: {
                  required: true,
                  content: { 'application/json': { schema: {
                    type: 'object',
                    required: ['id', 'start_time', 'end_time'],
                    properties: {
                      id: { type: 'integer' },
                      start_time: { type: 'string', format: 'date-time' },
                      end_time: { type: 'string', format: 'date-time' },
                    },
                  } } },
                },
                responses: {
                  '200': {
                    description: 'Booking rescheduled',
                    content: { 'application/json': { schema: {
                      type: 'object',
                      properties: {
                        success: { type: 'boolean' },
                        bookingId: { type: 'integer' },
                        google_updated: { type: 'boolean' },
                      },
                    } } },
                  },
                  '400': { $ref: '#/components/responses/BadRequest' },
                  '401': { $ref: '#/components/responses/Unauthorized' },
                  '404': { description: 'Booking not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
                  '409': { description: 'Time slot conflict', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
                },
              },
              delete: {
                summary: 'Cancel and delete a booking',
                operationId: 'adminDeleteBooking',
                tags: ['Admin'],
                parameters: [
                  { $ref: '#/components/parameters/XUserEmail' },
                  { name: 'id', in: 'query', required: true, schema: { type: 'integer' }, description: 'Booking ID to delete' },
                ],
                responses: {
                  '200': {
                    description: 'Booking deleted',
                    content: { 'application/json': { schema: {
                      type: 'object',
                      properties: {
                        success: { type: 'boolean' },
                        google_deleted: { type: 'boolean' },
                      },
                    } } },
                  },
                  '400': { $ref: '#/components/responses/BadRequest' },
                  '401': { $ref: '#/components/responses/Unauthorized' },
                  '404': { description: 'Booking not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
                },
              },
            },
            '/api/admin/settings': {
              post: {
                summary: 'Update user settings (name, bio, colors, availability window, timezone)',
                operationId: 'adminUpdateSettings',
                tags: ['Admin'],
                parameters: [{ $ref: '#/components/parameters/XUserEmail' }],
                requestBody: {
                  required: true,
                  content: { 'application/json': { schema: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      bio: { type: 'string' },
                      primary_color: { type: 'string' },
                      availability_start: { type: 'string', description: 'HH:MM format' },
                      availability_end: { type: 'string', description: 'HH:MM format' },
                      timezone: { type: 'string', description: 'IANA timezone, e.g. Europe/Oslo' },
                    },
                  } } },
                },
                responses: {
                  '200': { description: 'Settings updated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Success' } } } },
                  '401': { $ref: '#/components/responses/Unauthorized' },
                },
              },
            },
            '/api/admin/availability': {
              post: {
                summary: 'Update weekly availability days',
                operationId: 'adminUpdateAvailability',
                tags: ['Admin'],
                parameters: [{ $ref: '#/components/parameters/XUserEmail' }],
                requestBody: {
                  required: true,
                  content: { 'application/json': { schema: {
                    type: 'object',
                    required: ['days'],
                    properties: {
                      days: {
                        type: 'array',
                        items: {
                          type: 'object',
                          required: ['day_of_week', 'is_available'],
                          properties: {
                            day_of_week: { type: 'integer', minimum: 0, maximum: 6, description: '0=Sunday, 6=Saturday' },
                            is_available: { type: 'integer', enum: [0, 1] },
                          },
                        },
                      },
                    },
                  } } },
                },
                responses: {
                  '200': { description: 'Availability updated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Success' } } } },
                  '400': { $ref: '#/components/responses/BadRequest' },
                  '401': { $ref: '#/components/responses/Unauthorized' },
                },
              },
            },
            '/api/admin/group-meetings': {
              get: {
                summary: 'List all group meetings for the authenticated user',
                operationId: 'adminGetGroupMeetings',
                tags: ['Admin'],
                parameters: [{ $ref: '#/components/parameters/XUserEmail' }],
                responses: {
                  '200': {
                    description: 'List of group meetings',
                    content: { 'application/json': { schema: {
                      type: 'object',
                      properties: {
                        groupMeetings: {
                          type: 'array',
                          items: { $ref: '#/components/schemas/GroupMeeting' },
                        },
                      },
                    } } },
                  },
                  '401': { $ref: '#/components/responses/Unauthorized' },
                },
              },
              post: {
                summary: 'Create or update a group meeting',
                operationId: 'adminUpsertGroupMeeting',
                tags: ['Admin'],
                parameters: [{ $ref: '#/components/parameters/XUserEmail' }],
                requestBody: {
                  required: true,
                  content: { 'application/json': { schema: {
                    type: 'object',
                    required: ['title', 'start_time', 'zoom_link'],
                    properties: {
                      id: { type: 'integer', nullable: true, description: 'If provided, updates existing meeting; otherwise creates new' },
                      title: { type: 'string' },
                      start_time: { type: 'string', format: 'date-time' },
                      zoom_link: { type: 'string', format: 'uri' },
                      description: { type: 'string' },
                      recurrence: { type: 'string', enum: ['None', 'Weekly', 'Biweekly', 'Monthly'], default: 'None' },
                    },
                  } } },
                },
                responses: {
                  '200': { description: 'Group meeting saved', content: { 'application/json': { schema: { $ref: '#/components/schemas/Success' } } } },
                  '401': { $ref: '#/components/responses/Unauthorized' },
                },
              },
              delete: {
                summary: 'Delete a group meeting',
                operationId: 'adminDeleteGroupMeeting',
                tags: ['Admin'],
                parameters: [
                  { $ref: '#/components/parameters/XUserEmail' },
                  { name: 'id', in: 'query', required: true, schema: { type: 'integer' }, description: 'Group meeting ID' },
                ],
                responses: {
                  '200': { description: 'Group meeting deleted', content: { 'application/json': { schema: { $ref: '#/components/schemas/Success' } } } },
                  '400': { $ref: '#/components/responses/BadRequest' },
                  '401': { $ref: '#/components/responses/Unauthorized' },
                },
              },
            },
            '/api/auth/calendar-status': {
              get: {
                summary: 'Check if Google Calendar is connected',
                operationId: 'getCalendarStatus',
                tags: ['Auth'],
                parameters: [{ $ref: '#/components/parameters/XUserEmail' }],
                responses: {
                  '200': {
                    description: 'Connection status',
                    content: { 'application/json': { schema: {
                      type: 'object',
                      properties: {
                        connected: { type: 'boolean' },
                      },
                    } } },
                  },
                  '401': { $ref: '#/components/responses/Unauthorized' },
                },
              },
            },
            '/api/auth/calendar-disconnect': {
              post: {
                summary: 'Disconnect Google Calendar integration',
                operationId: 'disconnectCalendar',
                tags: ['Auth'],
                parameters: [{ $ref: '#/components/parameters/XUserEmail' }],
                responses: {
                  '200': { description: 'Calendar disconnected', content: { 'application/json': { schema: { $ref: '#/components/schemas/Success' } } } },
                  '401': { $ref: '#/components/responses/Unauthorized' },
                },
              },
            },
          },
          components: {
            parameters: {
              XUserEmail: {
                name: 'X-User-Email',
                in: 'header',
                required: true,
                schema: { type: 'string', format: 'email' },
                description: 'Authenticated user email address',
              },
            },
            schemas: {
              Error: {
                type: 'object',
                properties: {
                  error: { type: 'string' },
                },
              },
              Success: {
                type: 'object',
                properties: {
                  success: { type: 'boolean', example: true },
                },
              },
              GroupMeeting: {
                type: 'object',
                properties: {
                  id: { type: 'integer' },
                  title: { type: 'string' },
                  start_time: { type: 'string', format: 'date-time' },
                  zoom_link: { type: 'string' },
                  description: { type: 'string' },
                  recurrence: { type: 'string' },
                },
              },
            },
            responses: {
              BadRequest: {
                description: 'Bad request — missing or invalid parameters',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
              },
              Unauthorized: {
                description: 'Unauthorized — missing X-User-Email header',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
              },
            },
          },
          tags: [
            { name: 'Health', description: 'Health check' },
            { name: 'Public', description: 'Public booking endpoints (no auth required)' },
            { name: 'Admin', description: 'Admin endpoints (X-User-Email header required)' },
            { name: 'Auth', description: 'Google Calendar auth management' },
          ],
        })
      }

      // ── Public: Look up owner email by public slug ──
      if (path === '/api/public/lookup-slug' && request.method === 'GET') {
        const slug = (url.searchParams.get('slug') || '').trim().toLowerCase()
        if (!slug) return json({ error: 'slug query param required' }, 400)

        const row = await db.prepare(
          'SELECT user_email FROM settings WHERE public_slug = ?'
        ).bind(slug).first()

        if (!row) return json({ error: 'Slug not found' }, 404)
        return json({ slug, email: row.user_email })
      }

      // ── Public: List published booking pages (those with a public_slug) ──
      if (path === '/api/public/pages' && request.method === 'GET') {
        const rows = await db.prepare(
          "SELECT public_slug AS slug, user_email AS email, name, bio FROM settings WHERE public_slug IS NOT NULL AND public_slug != '' ORDER BY public_slug"
        ).all()
        return json({ pages: rows.results || [] })
      }

      // ── Public: Get settings + availability + meeting types + group meetings ──
      if (path === '/api/public/settings' && request.method === 'GET') {
        const userEmail = url.searchParams.get('user')
        if (!userEmail) return json({ error: 'user query param required' }, 400)

        const settings = await db.prepare(
          'SELECT name, bio, primary_color, availability_start, availability_end, timezone, public_slug, default_meeting_room FROM settings WHERE user_email = ?'
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

      // ── Public: Get booked slots for a date (D1 + Google Calendar) ──
      if (path === '/api/public/bookings' && request.method === 'GET') {
        const userEmail = url.searchParams.get('user')
        const date = url.searchParams.get('date') // YYYY-MM-DD
        if (!userEmail || !date) return json({ error: 'user and date query params required' }, 400)

        const dayStart = `${date}T00:00:00.000Z`
        const dayEnd = `${date}T23:59:59.999Z`

        // Fetch D1 bookings and Google Calendar events in parallel
        const [d1Result, accessToken] = await Promise.all([
          db.prepare(
            'SELECT start_time, end_time FROM bookings WHERE user_email = ? AND start_time < ? AND end_time > ?'
          ).bind(userEmail, dayEnd, dayStart).all(),
          getCalendarToken(env, userEmail),
        ])

        const d1Bookings = (d1Result.results || []).map(b => ({ ...b, source: 'd1' }))

        let googleEvents = []
        if (accessToken) {
          googleEvents = await fetchGoogleCalendarEvents(accessToken, dayStart, dayEnd)
        }

        // Merge and deduplicate (Google events that match D1 bookings by overlapping times are kept — frontend filters all)
        const allBookings = [...d1Bookings, ...googleEvents]

        return json({ bookings: allBookings })
      }

      // ── Public: Create booking ──
      if (path === '/api/bookings' && request.method === 'POST') {
        const body = await request.json()
        const { owner_email, guest_name, guest_email, start_time, end_time, description, meeting_type_id } = body

        if (!owner_email || !guest_name || !guest_email || !start_time || !end_time) {
          return json({ error: 'owner_email, guest_name, guest_email, start_time, end_time are required' }, 400)
        }

        // Check for overlapping bookings in D1
        const conflict = await db.prepare(
          `SELECT id FROM bookings WHERE user_email = ? AND start_time < ? AND end_time > ?`
        ).bind(owner_email, end_time, start_time).first()

        if (conflict) {
          return json({ error: 'This time slot is already booked. Please choose a different time.' }, 409)
        }

        // Also check Google Calendar for conflicts (events created outside this app)
        const preCheckToken = await getCalendarToken(env, owner_email)
        if (preCheckToken) {
          const gcalConflicts = await fetchGoogleCalendarEvents(preCheckToken, start_time, end_time)
          const overlapping = gcalConflicts.find(e => e.start_time < end_time && e.end_time > start_time)
          if (overlapping) {
            return json({ error: 'This time slot conflicts with an existing calendar event. Please choose a different time.' }, 409)
          }
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
          const ownerSettings = await db.prepare(
            'SELECT default_meeting_room FROM settings WHERE user_email = ?'
          ).bind(owner_email).first()
          const meetingRoom = ownerSettings?.default_meeting_room || ''
          const eventDescription = meetingRoom
            ? `${description || ''}${description ? '\n\n' : ''}Join the meeting: ${meetingRoom}`
            : (description || '')
          const gcalEvent = await createGoogleCalendarEvent(accessToken, {
            summary,
            description: eventDescription,
            location: meetingRoom || undefined,
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

      // ── Day View: All calendars for a date range ──
      if (path === '/api/calendar/day-view' && request.method === 'GET') {
        if (!userEmail) return json({ error: 'Unauthorized' }, 401)
        // date param = YYYY-MM-DD; if omitted, use today
        const dateParam = url.searchParams.get('date') || new Date().toISOString().slice(0, 10)
        const daysParam = parseInt(url.searchParams.get('days') || '1', 10)
        // Allow a viewer to view the owner's calendar by passing ?owner=EMAIL
        const ownerParam = url.searchParams.get('owner') || userEmail

        let calendarOwnerEmail = ownerParam
        if (ownerParam !== userEmail) {
          // Verify the requester is an authorized viewer
          const viewerRow = await db.prepare(
            'SELECT 1 FROM calendar_viewers WHERE viewer_email = ? AND owner_email = ?'
          ).bind(userEmail, ownerParam).first()
          if (!viewerRow) return json({ error: 'Not authorized to view this calendar' }, 403)
        }

        const startDate = new Date(`${dateParam}T00:00:00.000Z`)
        const endDate = new Date(startDate.getTime() + daysParam * 24 * 60 * 60 * 1000)

        const accessToken = await getCalendarToken(env, calendarOwnerEmail)
        if (!accessToken) return json({ error: 'Google Calendar not connected', events: [], calendars: [] }, 200)

        const { events, calendars } = await fetchAllCalendarEvents(
          accessToken,
          startDate.toISOString(),
          endDate.toISOString()
        )

        // Also fetch D1 bookings for this range
        const d1Result = await db.prepare(
          'SELECT id, guest_name, guest_email, start_time, end_time, description, google_event_id FROM bookings WHERE user_email = ? AND start_time < ? AND end_time > ?'
        ).bind(calendarOwnerEmail, endDate.toISOString(), startDate.toISOString()).all()

        const googleIds = new Set(events.map(e => e.id))
        const appEvents = (d1Result.results || [])
          .filter(b => !googleIds.has(b.google_event_id))
          .map(b => ({
            id: `app-${b.id}`,
            summary: `Meeting: ${b.guest_name}`,
            description: b.description || '',
            location: '',
            start_time: b.start_time,
            end_time: b.end_time,
            all_day: false,
            calendar_id: 'app',
            calendar_color: '#6366f1',
            calendar_name: 'CalSync App',
            attendees: [b.guest_email],
            html_link: '',
          }))

        return json({
          date: dateParam,
          owner: calendarOwnerEmail,
          events: [...events, ...appEvents].sort((a, b) => new Date(a.start_time) - new Date(b.start_time)),
          calendars: [
            ...calendars,
            { id: 'app', summary: 'CalSync App', backgroundColor: '#6366f1', foregroundColor: '#ffffff', primary: false },
          ],
        })
      }

      // ── Calendar Viewers: List ──
      if (path === '/api/calendar/viewers' && request.method === 'GET') {
        if (!userEmail) return json({ error: 'Unauthorized' }, 401)
        const rows = await db.prepare(
          'SELECT viewer_email, added_at FROM calendar_viewers WHERE owner_email = ? ORDER BY added_at DESC'
        ).bind(userEmail).all()
        return json({ viewers: rows.results || [] })
      }

      // ── Calendar Viewers: Add ──
      if (path === '/api/calendar/viewers' && request.method === 'POST') {
        if (!userEmail) return json({ error: 'Unauthorized' }, 401)
        const { viewer_email } = await request.json()
        if (!viewer_email) return json({ error: 'viewer_email required' }, 400)
        const normalized = viewer_email.trim().toLowerCase()
        if (normalized === userEmail.toLowerCase()) return json({ error: 'Cannot add yourself as a viewer' }, 400)
        await db.prepare(
          'INSERT OR IGNORE INTO calendar_viewers (viewer_email, owner_email, added_at) VALUES (?, ?, ?)'
        ).bind(normalized, userEmail, Date.now()).run()
        return json({ success: true, viewer_email: normalized })
      }

      // ── Calendar Viewers: Remove ──
      if (path === '/api/calendar/viewers' && request.method === 'DELETE') {
        if (!userEmail) return json({ error: 'Unauthorized' }, 401)
        const emailToRemove = url.searchParams.get('email')
        if (!emailToRemove) return json({ error: 'email param required' }, 400)
        await db.prepare(
          'DELETE FROM calendar_viewers WHERE viewer_email = ? AND owner_email = ?'
        ).bind(emailToRemove, userEmail).run()
        return json({ success: true })
      }

      // ── Admin: Setup / seed defaults ──
      if (path === '/api/admin/setup' && request.method === 'POST') {
        if (!userEmail) return json({ error: 'Unauthorized' }, 401)
        await seedUserDefaults(db, userEmail)
        return json({ success: true, message: 'Defaults seeded' })
      }

      // ── Admin: Get bookings (D1 + Google Calendar) ──
      if (path === '/api/admin/bookings' && request.method === 'GET') {
        if (!userEmail) return json({ error: 'Unauthorized' }, 401)
        const result = await db.prepare(
          `SELECT b.id, b.guest_name, b.guest_email, b.start_time, b.end_time, b.description, b.google_event_id, b.created_at,
                  mt.name as meeting_type_name, mt.duration as meeting_type_duration
           FROM bookings b LEFT JOIN meeting_types mt ON b.meeting_type_id = mt.id
           WHERE b.user_email = ? ORDER BY b.start_time ASC`
        ).bind(userEmail).all()

        const d1Bookings = (result.results || []).map(b => ({ ...b, source: 'app' }))
        const syncedGoogleIds = new Set(d1Bookings.filter(b => b.google_event_id).map(b => b.google_event_id))

        // Fetch Google Calendar events: 30 days back → 60 days forward
        const accessToken = await getCalendarToken(env, userEmail)
        let googleNativeEvents = []
        if (accessToken) {
          const timeMin = new Date()
          timeMin.setDate(timeMin.getDate() - 30)
          const timeMax = new Date()
          timeMax.setDate(timeMax.getDate() + 60)
          const allGoogleEvents = await fetchGoogleCalendarEventsDetailed(accessToken, timeMin.toISOString(), timeMax.toISOString())
          // Exclude events already tracked in D1 via google_event_id
          googleNativeEvents = allGoogleEvents.filter(e => !syncedGoogleIds.has(e.google_event_id))
        }

        const combined = [...d1Bookings, ...googleNativeEvents]
          .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))

        return json({ bookings: combined })
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

        // Optional: update default_meeting_room if provided (empty string clears it).
        if (Object.prototype.hasOwnProperty.call(body, 'default_meeting_room')) {
          const raw = (body.default_meeting_room ?? '').toString().trim()
          if (raw === '') {
            await db.prepare('UPDATE settings SET default_meeting_room = NULL WHERE user_email = ?').bind(userEmail).run()
          } else {
            if (!/^https?:\/\//i.test(raw)) {
              return json({ error: 'Default meeting room must be a valid http(s) URL.' }, 400)
            }
            if (raw.length > 500) {
              return json({ error: 'Default meeting room URL is too long.' }, 400)
            }
            await db.prepare(
              `UPDATE settings SET default_meeting_room = ?, updated_at = datetime('now') WHERE user_email = ?`
            ).bind(raw, userEmail).run()
          }
        }

        // Optional: update public_slug if provided. Validate format and uniqueness separately.
        if (Object.prototype.hasOwnProperty.call(body, 'public_slug')) {
          const rawSlug = (body.public_slug ?? '').toString().trim().toLowerCase()

          if (rawSlug === '') {
            await db.prepare('UPDATE settings SET public_slug = NULL WHERE user_email = ?').bind(userEmail).run()
          } else {
            if (!/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(rawSlug)) {
              return json({ error: 'Invalid slug. Use 1-40 lowercase letters, numbers, or hyphens; cannot start or end with a hyphen.' }, 400)
            }
            const RESERVED = new Set(['api', 'auth', 'admin', 'public', 'login', 'signup', 'settings', 'day-view', 'dayview'])
            if (RESERVED.has(rawSlug)) {
              return json({ error: 'This slug is reserved. Please choose another.' }, 400)
            }
            const taken = await db.prepare(
              'SELECT 1 FROM settings WHERE public_slug = ? AND user_email != ?'
            ).bind(rawSlug, userEmail).first()
            if (taken) {
              return json({ error: 'This slug is already in use by another user.' }, 409)
            }
            await db.prepare(
              `UPDATE settings SET public_slug = ?, updated_at = datetime('now') WHERE user_email = ?`
            ).bind(rawSlug, userEmail).run()
          }
        }

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

      // ── Admin: Reschedule booking ──
      if (path === '/api/admin/bookings' && request.method === 'PATCH') {
        if (!userEmail) return json({ error: 'Unauthorized' }, 401)
        const body = await request.json()
        const { id, start_time, end_time } = body

        if (!id || !start_time || !end_time) {
          return json({ error: 'id, start_time, and end_time are required' }, 400)
        }

        // Verify booking belongs to this user
        const booking = await db.prepare(
          'SELECT id, google_event_id, guest_name, guest_email FROM bookings WHERE id = ? AND user_email = ?'
        ).bind(id, userEmail).first()

        if (!booking) return json({ error: 'Booking not found' }, 404)

        // Check for conflicts at the new time (exclude the booking being rescheduled)
        const conflict = await db.prepare(
          'SELECT id FROM bookings WHERE user_email = ? AND id != ? AND start_time < ? AND end_time > ?'
        ).bind(userEmail, id, end_time, start_time).first()

        if (conflict) {
          return json({ error: 'The new time slot conflicts with an existing booking.' }, 409)
        }

        // Also check Google Calendar (skip the current booking's own event)
        const rescheduleToken = await getCalendarToken(env, userEmail)
        if (rescheduleToken) {
          const gcalConflicts = await fetchGoogleCalendarEvents(rescheduleToken, start_time, end_time)
          const overlapping = gcalConflicts.find(e => e.start_time < end_time && e.end_time > start_time)
          if (overlapping) {
            return json({ error: 'The new time slot conflicts with an existing calendar event.' }, 409)
          }
        }

        // Update D1
        await db.prepare(
          'UPDATE bookings SET start_time = ?, end_time = ? WHERE id = ?'
        ).bind(start_time, end_time, id).run()

        // Update Google Calendar event if synced
        let googleUpdated = false
        if (booking.google_event_id) {
          const accessToken = await getCalendarToken(env, userEmail)
          if (accessToken) {
            googleUpdated = await updateGoogleCalendarEvent(accessToken, booking.google_event_id, {
              start: { dateTime: start_time },
              end: { dateTime: end_time },
            })
          }
        }

        return json({ success: true, bookingId: id, google_updated: googleUpdated })
      }

      // ── Admin: Delete/cancel booking ──
      if (path === '/api/admin/bookings' && request.method === 'DELETE') {
        if (!userEmail) return json({ error: 'Unauthorized' }, 401)
        const id = url.searchParams.get('id')
        if (!id) return json({ error: 'id query param required' }, 400)

        // Get booking details for Google Calendar cleanup
        const booking = await db.prepare(
          'SELECT id, google_event_id FROM bookings WHERE id = ? AND user_email = ?'
        ).bind(id, userEmail).first()

        if (!booking) return json({ error: 'Booking not found' }, 404)

        // Delete from D1
        await db.prepare('DELETE FROM bookings WHERE id = ?').bind(id).run()

        // Delete from Google Calendar if synced
        let googleDeleted = false
        if (booking.google_event_id) {
          const accessToken = await getCalendarToken(env, userEmail)
          if (accessToken) {
            googleDeleted = await deleteGoogleCalendarEvent(accessToken, booking.google_event_id)
          }
        }

        return json({ success: true, google_deleted: googleDeleted })
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
