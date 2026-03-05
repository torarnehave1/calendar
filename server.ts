import express from "express";
import { createServer as createViteServer } from "vite";
import db from "./src/db.ts";
import { google } from "googleapis";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());
const PORT = 3000;

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `${process.env.APP_URL}/auth/callback`
);

// --- API Routes ---

// Get public settings and availability
app.get("/api/public/settings", (req, res) => {
  const settings = db.prepare('SELECT name, bio, primary_color, availability_start, availability_end, timezone FROM settings WHERE id = 1').get();
  const availability = db.prepare('SELECT * FROM availability_days').all();
  const meetingTypes = db.prepare('SELECT * FROM meeting_types').all();
  const groupMeetings = db.prepare('SELECT * FROM group_meetings WHERE start_time > ?').all(new Date().toISOString());
  res.json({ settings, availability, meetingTypes, groupMeetings });
});

// Get bookings (for admin)
app.get("/api/admin/bookings", (req, res) => {
  const bookings = db.prepare(`
    SELECT b.*, m.name as meeting_type_name 
    FROM bookings b 
    LEFT JOIN meeting_types m ON b.meeting_type_id = m.id 
    ORDER BY start_time ASC
  `).all();
  res.json(bookings);
});

// Update settings
app.post("/api/admin/settings", (req, res) => {
  const { name, bio, primary_color, availability_start, availability_end, timezone } = req.body;
  db.prepare(`
    UPDATE settings 
    SET name = ?, bio = ?, primary_color = ?, availability_start = ?, availability_end = ?, timezone = ?
    WHERE id = 1
  `).run(name, bio, primary_color, availability_start, availability_end, timezone);
  res.json({ success: true });
});

// Update availability days
app.post("/api/admin/availability", (req, res) => {
  const { days } = req.body; // Array of { day_of_week, is_available }
  const update = db.prepare('UPDATE availability_days SET is_available = ? WHERE day_of_week = ?');
  const transaction = db.transaction((data) => {
    for (const item of data) {
      update.run(item.is_available ? 1 : 0, item.day_of_week);
    }
  });
  transaction(days);
  res.json({ success: true });
});

// Create a booking
app.post("/api/bookings", async (req, res) => {
  const { guest_name, guest_email, start_time, end_time, description, meeting_type_id } = req.body;
  
  // 1. Save to local DB
  db.prepare(`
    INSERT INTO bookings (guest_name, guest_email, start_time, end_time, description, meeting_type_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(guest_name, guest_email, start_time, end_time, description, meeting_type_id);

  // 2. Try to sync with Google Calendar if connected
  const settings = db.prepare('SELECT google_refresh_token FROM settings WHERE id = 1').get() as any;
  const meetingType = db.prepare('SELECT name FROM meeting_types WHERE id = ?').get(meeting_type_id) as any;
  const summary = meetingType ? `${meetingType.name} with ${guest_name}` : `Meeting with ${guest_name}`;

  if (settings?.google_refresh_token) {
    try {
      oauth2Client.setCredentials({ refresh_token: settings.google_refresh_token });
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
      await calendar.events.insert({
        calendarId: 'primary',
        requestBody: {
          summary: summary,
          description: description,
          start: { dateTime: start_time },
          end: { dateTime: end_time },
          attendees: [{ email: guest_email }],
        },
      });
    } catch (error) {
      console.error("Failed to sync with Google Calendar:", error);
    }
  }

  res.json({ success: true });
});

// Join a group meeting
app.post("/api/group-meetings/join", async (req, res) => {
  const { group_meeting_id, guest_email } = req.body;
  
  db.prepare(`
    INSERT INTO group_meeting_registrations (group_meeting_id, guest_email)
    VALUES (?, ?)
  `).run(group_meeting_id, guest_email);

  // Sync with Google Calendar if connected
  const settings = db.prepare('SELECT google_refresh_token FROM settings WHERE id = 1').get() as any;
  const groupMeeting = db.prepare('SELECT * FROM group_meetings WHERE id = ?').get(group_meeting_id) as any;

  if (settings?.google_refresh_token && groupMeeting) {
    try {
      oauth2Client.setCredentials({ refresh_token: settings.google_refresh_token });
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
      await calendar.events.insert({
        calendarId: 'primary',
        requestBody: {
          summary: `Group Meeting: ${groupMeeting.title}`,
          description: `Zoom Link: ${groupMeeting.zoom_link}\n\n${groupMeeting.description}`,
          start: { dateTime: groupMeeting.start_time },
          end: { dateTime: new Date(new Date(groupMeeting.start_time).getTime() + 60 * 60 * 1000).toISOString() },
          attendees: [{ email: guest_email }],
          location: groupMeeting.zoom_link
        },
      });
    } catch (error) {
      console.error("Failed to sync group meeting with Google Calendar:", error);
    }
  }

  res.json({ success: true });
});

// Request general invitation
app.post("/api/invitation-request", async (req, res) => {
  const { guest_email } = req.body;
  
  // In a real app, you might send an email here. 
  // For this demo, we'll just log it or sync a generic event.
  
  const settings = db.prepare('SELECT google_refresh_token FROM settings WHERE id = 1').get() as any;
  if (settings?.google_refresh_token) {
    try {
      oauth2Client.setCredentials({ refresh_token: settings.google_refresh_token });
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
      // Create a "Tentative" invite for tomorrow
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(12, 0, 0, 0);
      
      await calendar.events.insert({
        calendarId: 'primary',
        requestBody: {
          summary: `Information Session Invitation`,
          description: `You requested information. Here is a placeholder for our next session.`,
          start: { dateTime: tomorrow.toISOString() },
          end: { dateTime: new Date(tomorrow.getTime() + 30 * 60 * 1000).toISOString() },
          attendees: [{ email: guest_email }],
        },
      });
    } catch (error) {
      console.error("Failed to sync invitation with Google Calendar:", error);
    }
  }

  res.json({ success: true });
});

// Get all group meetings (including past ones for admin)
app.get("/api/admin/group-meetings", (req, res) => {
  const meetings = db.prepare('SELECT * FROM group_meetings ORDER BY start_time DESC').all();
  res.json(meetings);
});

// Create/Update group meeting
app.post("/api/admin/group-meetings", (req, res) => {
  const { id, title, start_time, zoom_link, description, recurrence } = req.body;
  if (id) {
    db.prepare('UPDATE group_meetings SET title = ?, start_time = ?, zoom_link = ?, description = ?, recurrence = ? WHERE id = ?')
      .run(title, start_time, zoom_link, description, recurrence || 'None', id);
  } else {
    db.prepare('INSERT INTO group_meetings (title, start_time, zoom_link, description, recurrence) VALUES (?, ?, ?, ?, ?)')
      .run(title, start_time, zoom_link, description, recurrence || 'None');
  }
  res.json({ success: true });
});

// Delete group meeting
app.delete("/api/admin/group-meetings/:id", (req, res) => {
  db.prepare('DELETE FROM group_meetings WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// --- OAuth Routes ---

app.get("/api/auth/url", (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.readonly'],
    prompt: 'consent'
  });
  res.json({ url });
});

app.get("/auth/callback", async (req, res) => {
  const { code } = req.query;
  try {
    const { tokens } = await oauth2Client.getToken(code as string);
    if (tokens.refresh_token) {
      db.prepare('UPDATE settings SET google_refresh_token = ? WHERE id = 1').run(tokens.refresh_token);
    }
    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
              window.close();
            } else {
              window.location.href = '/settings';
            }
          </script>
          <p>Connected! You can close this window.</p>
        </body>
      </html>
    `);
  } catch (error) {
    res.status(500).send("Authentication failed");
  }
});

app.get("/api/auth/status", (req, res) => {
  const settings = db.prepare('SELECT google_refresh_token FROM settings WHERE id = 1').get() as any;
  res.json({ connected: !!settings?.google_refresh_token });
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
