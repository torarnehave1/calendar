-- Settings per user (multi-tenant)
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email TEXT NOT NULL UNIQUE,
  name TEXT DEFAULT 'My Schedule',
  bio TEXT DEFAULT 'Book a meeting with me!',
  primary_color TEXT DEFAULT '#4f46e5',
  availability_start TEXT DEFAULT '09:00',
  availability_end TEXT DEFAULT '17:00',
  timezone TEXT DEFAULT 'UTC',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS availability_days (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email TEXT NOT NULL,
  day_of_week INTEGER NOT NULL,
  is_available INTEGER DEFAULT 1,
  UNIQUE(user_email, day_of_week)
);

CREATE TABLE IF NOT EXISTS meeting_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email TEXT NOT NULL,
  name TEXT NOT NULL,
  duration INTEGER NOT NULL,
  description TEXT,
  is_special INTEGER DEFAULT 0,
  UNIQUE(user_email, name)
);

CREATE TABLE IF NOT EXISTS group_meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email TEXT NOT NULL,
  title TEXT NOT NULL,
  start_time TEXT NOT NULL,
  zoom_link TEXT NOT NULL,
  description TEXT,
  recurrence TEXT DEFAULT 'None',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS group_meeting_registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_meeting_id INTEGER NOT NULL,
  guest_email TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (group_meeting_id) REFERENCES group_meetings(id)
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email TEXT NOT NULL,
  guest_name TEXT NOT NULL,
  guest_email TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  meeting_type_id INTEGER,
  description TEXT,
  google_event_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (meeting_type_id) REFERENCES meeting_types(id)
);

CREATE INDEX IF NOT EXISTS idx_settings_user ON settings(user_email);
CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_email);
CREATE INDEX IF NOT EXISTS idx_bookings_start ON bookings(start_time);
CREATE INDEX IF NOT EXISTS idx_availability_user ON availability_days(user_email);
CREATE INDEX IF NOT EXISTS idx_meeting_types_user ON meeting_types(user_email);
CREATE INDEX IF NOT EXISTS idx_group_meetings_user ON group_meetings(user_email);
