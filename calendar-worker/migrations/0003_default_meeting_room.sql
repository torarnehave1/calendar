-- Add default meeting room URL per user (used as the Google Calendar event location)
ALTER TABLE settings ADD COLUMN default_meeting_room TEXT;
