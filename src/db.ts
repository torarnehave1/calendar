import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.resolve(process.cwd(), 'calendar.db');
console.log("Database path:", dbPath);

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    name TEXT DEFAULT 'My Schedule',
    bio TEXT DEFAULT 'Book a meeting with me!',
    primary_color TEXT DEFAULT '#4f46e5',
    availability_start TEXT DEFAULT '09:00',
    availability_end TEXT DEFAULT '17:00',
    timezone TEXT DEFAULT 'UTC',
    google_refresh_token TEXT
  );

  CREATE TABLE IF NOT EXISTS availability_days (
    day_of_week INTEGER PRIMARY KEY, -- 0 (Sunday) to 6 (Saturday)
    is_available INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS meeting_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    duration INTEGER NOT NULL, -- in minutes
    description TEXT,
    is_special INTEGER DEFAULT 0 -- 1 for Free Information Meeting
  );
`);

// Migration: Add is_special column if it doesn't exist
const tableInfo = db.prepare("PRAGMA table_info(meeting_types)").all() as any[];
const hasIsSpecial = tableInfo.some(col => col.name === 'is_special');
if (!hasIsSpecial) {
  db.exec("ALTER TABLE meeting_types ADD COLUMN is_special INTEGER DEFAULT 0");
}

db.exec(`
  CREATE TABLE IF NOT EXISTS group_meetings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    start_time TEXT NOT NULL,
    zoom_link TEXT NOT NULL,
    description TEXT,
    recurrence TEXT -- e.g., 'Weekly', 'Monthly', 'None'
  );

  CREATE TABLE IF NOT EXISTS group_meeting_registrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_meeting_id INTEGER,
    guest_email TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (group_meeting_id) REFERENCES group_meetings(id)
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guest_name TEXT NOT NULL,
    guest_email TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    meeting_type_id INTEGER,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (meeting_type_id) REFERENCES meeting_types(id)
  );
`);

// Migration: Add recurrence column to group_meetings if it doesn't exist
const groupTableInfo = db.prepare("PRAGMA table_info(group_meetings)").all() as any[];
const hasRecurrence = groupTableInfo.some(col => col.name === 'recurrence');
if (!hasRecurrence) {
  try {
    db.exec("ALTER TABLE group_meetings ADD COLUMN recurrence TEXT DEFAULT 'None'");
  } catch (e) {
    console.log("Recurrence column already exists or table not ready");
  }
}

// Seed default availability if empty
const dayCount = db.prepare('SELECT COUNT(*) as count FROM availability_days').get() as { count: number };
if (dayCount.count === 0) {
  const insertDay = db.prepare('INSERT INTO availability_days (day_of_week, is_available) VALUES (?, ?)');
  for (let i = 0; i < 7; i++) {
    // Default: Mon-Fri available (1-5), Sat-Sun not (0, 6)
    insertDay.run(i, (i >= 1 && i <= 5) ? 1 : 0);
  }
}

// Seed default settings if empty
const settingsCount = db.prepare('SELECT COUNT(*) as count FROM settings').get() as { count: number };
if (settingsCount.count === 0) {
  db.prepare('INSERT INTO settings (id) VALUES (1)').run();
}

// Seed meeting types individually to avoid duplicates
const seedTypes = [
  { name: 'Check in', duration: 15, description: 'Quick sync or check-in', is_special: 0 },
  { name: 'Short meeting', duration: 30, description: 'Brief discussion or follow-up', is_special: 0 },
  { name: 'Standard Meeting', duration: 45, description: 'Regular meeting or deep dive', is_special: 0 },
  { name: 'Double Meeting', duration: 90, description: 'Extended session or workshop', is_special: 0 },
  { name: 'Free Information Meeting', duration: 0, description: 'Get an invitation or join a group Zoom session', is_special: 1 }
];

const insertType = db.prepare('INSERT OR IGNORE INTO meeting_types (name, duration, description, is_special) VALUES (?, ?, ?, ?)');
const checkType = db.prepare('SELECT COUNT(*) as count FROM meeting_types WHERE name = ?');

for (const type of seedTypes) {
  const exists = checkType.get(type.name) as { count: number };
  if (exists.count === 0) {
    insertType.run(type.name, type.duration, type.description, type.is_special);
  }
}

// Seed group meetings if empty
const groupMeetingsCount = db.prepare('SELECT COUNT(*) as count FROM group_meetings').get() as { count: number };
if (groupMeetingsCount.count === 0) {
  const insertGroupMeeting = db.prepare('INSERT INTO group_meetings (title, start_time, zoom_link, description, recurrence) VALUES (?, ?, ?, ?, ?)');
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(10, 0, 0, 0);
  
  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 7);
  nextWeek.setHours(14, 0, 0, 0);

  insertGroupMeeting.run('Regular Information Meeting', tomorrow.toISOString(), 'https://zoom.us/j/123456789', 'General introduction to our services.', 'Weekly');
  insertGroupMeeting.run('Advanced Workshop Q&A', nextWeek.toISOString(), 'https://zoom.us/j/987654321', 'Deep dive into advanced features.', 'Monthly');
}

export default db;
