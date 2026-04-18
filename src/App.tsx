import React, { useState, useEffect, useRef } from 'react';
import { 
  Calendar as CalendarIcon, 
  Settings as SettingsIcon, 
  Clock, 
  User, 
  Mail, 
  CheckCircle2, 
  ChevronLeft, 
  ChevronRight,
  Globe,
  Palette,
  Link as LinkIcon,
  ExternalLink,
  Users,
  Plus,
  Trash2,
  Edit2
} from 'lucide-react';
import { 
  format, 
  addMonths, 
  subMonths, 
  startOfMonth, 
  endOfMonth, 
  startOfWeek, 
  endOfWeek, 
  isSameMonth, 
  isSameDay, 
  addDays, 
  eachDayOfInterval,
  isBefore,
  startOfDay,
  parse,
  addMinutes,
  isWithinInterval,
  parseISO,
  isToday,
  differenceInMinutes,
} from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';
import { EcosystemNav } from 'vegvisr-ui-kit';
import {
  readStoredUser,
  sendMagicLink as sendMagicLinkApi,
  verifyMagicToken,
  fetchUserContext,
  setAuthCookie,
  clearAuthCookie,
  type AuthUser,
} from './lib/auth';

// --- Types ---

interface CalendarEvent {
  id: string;
  summary: string;
  description: string;
  location: string;
  start_time: string;
  end_time: string;
  all_day: boolean;
  calendar_id: string;
  calendar_color: string;
  calendar_name: string;
  attendees: string[];
  html_link: string;
}

interface CalendarMeta {
  id: string;
  summary: string;
  backgroundColor: string;
  foregroundColor: string;
  primary: boolean;
}

interface Settings {
  name: string;
  bio: string;
  primary_color: string;
  availability_start: string;
  availability_end: string;
  timezone: string;
  public_slug?: string | null;
}

interface AvailabilityDay {
  day_of_week: number;
  is_available: number;
}

interface MeetingType {
  id: number;
  name: string;
  duration: number;
  description: string;
  is_special?: number;
}

interface GroupMeeting {
  id: number;
  title: string;
  start_time: string;
  zoom_link: string;
  description: string;
  recurrence?: string;
}

interface Booking {
  id: number | null;
  guest_name: string;
  guest_email: string;
  start_time: string;
  end_time: string;
  description: string;
  meeting_type_name?: string;
  source?: 'app' | 'google';
  google_event_id?: string;
}

interface PublicBookingPage {
  slug: string;
  email: string;
  title: string;
  description: string;
}

const normalizePublicBookingValue = (value: string) => decodeURIComponent(value).trim().toLowerCase();

const getPublicBookingPath = (slugOrEmail: string) => {
  const normalized = slugOrEmail.trim().toLowerCase();
  if (!normalized) return '/';
  return `/${encodeURIComponent(normalized)}`;
};

const getPublicBookingLink = (slugOrEmail: string) => `${window.location.origin}${getPublicBookingPath(slugOrEmail)}`;

const getPrivateViewerLink = (email: string) => `${window.location.origin}/?view=${encodeURIComponent(email)}`;

const RESERVED_SLUGS = new Set(['api', 'auth', 'admin', 'public', 'login', 'signup', 'settings', 'day-view', 'dayview']);
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

// --- Components ---

const Button = ({ className, variant = 'primary', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'outline' }) => {
  const variants = {
    primary: 'bg-indigo-600 text-white hover:bg-indigo-700',
    secondary: 'bg-slate-100 text-slate-900 hover:bg-slate-200',
    outline: 'border border-slate-200 text-slate-600 hover:bg-slate-50'
  };
  return (
    <button 
      className={cn('px-4 py-2 rounded-lg font-medium transition-all active:scale-95 disabled:opacity-50', variants[variant], className)} 
      {...props} 
    />
  );
};

const Input = ({ label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label?: string }) => (
  <div className="space-y-1">
    {label && <label className="text-sm font-medium text-slate-700">{label}</label>}
    <input 
      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all" 
      {...props} 
    />
  </div>
);

// Helper: build headers for admin API calls (includes X-User-Email for auth)
const adminHeaders = (email: string, contentType?: string): Record<string, string> => {
  const h: Record<string, string> = { 'X-User-Email': email };
  if (contentType) h['Content-Type'] = contentType;
  return h;
};

const RootLandingPage = ({
  authUser,
  pages,
  pagesLoading,
  onOpenMyBookingPage,
  onOpenDayView,
  onOpenAdmin,
  onOpenLogin,
  unknownBookingPath,
}: {
  authUser: AuthUser | null;
  pages: PublicBookingPage[];
  pagesLoading: boolean;
  onOpenMyBookingPage: () => void;
  onOpenDayView: () => void;
  onOpenAdmin: () => void;
  onOpenLogin: () => void;
  unknownBookingPath?: string;
}) => (
  <div className="max-w-6xl mx-auto px-4 md:px-8">
    <div className="rounded-[2rem] border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="bg-[radial-gradient(circle_at_top_left,_rgba(99,102,241,0.18),_transparent_35%),linear-gradient(135deg,_#0f172a,_#1e293b_55%,_#312e81)] px-8 py-14 md:px-12 text-white">
        <div className="max-w-3xl space-y-5">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-indigo-100">
            <Globe className="w-4 h-4" />
            Public booking pages
          </div>
          <h1 className="text-4xl md:text-5xl font-bold leading-tight">Book time without exposing the private calendar.</h1>
          <p className="text-base md:text-lg text-slate-200 max-w-2xl">
            Public visitors get booking pages only. Private calendar access stays limited to approved viewers inside Day View.
          </p>
          {unknownBookingPath && (
            <div className="inline-flex items-center rounded-2xl bg-amber-400/15 px-4 py-3 text-sm text-amber-100 border border-amber-300/20">
              No public booking page was found for <span className="font-semibold mx-1">/{unknownBookingPath}</span>. Use one of the pages below instead.
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-8 px-8 py-10 md:px-12 lg:grid-cols-[1.4fr_1fr]">
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-2xl font-bold text-slate-900">Available booking pages</h2>
              <p className="text-sm text-slate-500">Open a public page to see available meeting types and book directly.</p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {pagesLoading ? (
              <div className="col-span-full text-sm text-slate-500">Loading public booking pages…</div>
            ) : pages.length === 0 ? (
              <div className="col-span-full rounded-3xl border border-dashed border-slate-200 p-6 text-sm text-slate-500">
                No public booking pages have been published yet. Sign in and pick a public path in admin to publish yours.
              </div>
            ) : (
              pages.map(page => (
                <button
                  key={page.slug}
                  onClick={() => window.location.assign(getPublicBookingPath(page.slug))}
                  className="group rounded-3xl border border-slate-200 bg-slate-50 p-6 text-left transition-all hover:-translate-y-0.5 hover:border-indigo-200 hover:bg-white hover:shadow-lg"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-lg font-semibold text-slate-900">{page.title}</p>
                      <p className="mt-2 text-sm leading-6 text-slate-600">{page.description}</p>
                    </div>
                    <div className="rounded-2xl bg-indigo-100 p-3 text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                      <CalendarIcon className="w-5 h-5" />
                    </div>
                  </div>
                  <div className="mt-6 flex items-center justify-between text-sm">
                    <span className="font-mono text-slate-500">{window.location.host}/{page.slug}</span>
                    <span className="font-semibold text-indigo-600">Open</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </section>

        <aside className="rounded-3xl border border-slate-200 bg-slate-50 p-6 space-y-4">
          <div className="space-y-1">
            <h2 className="text-2xl font-bold text-slate-900">Admin</h2>
            <p className="text-sm text-slate-500">
              {authUser ? 'Manage your own calendar, availability, and sharing settings.' : 'Sign in to manage your booking page and private calendar.'}
            </p>
          </div>

          {authUser ? (
            <div className="space-y-3">
              <Button onClick={onOpenMyBookingPage} className="w-full justify-center">Open my booking page</Button>
              <Button onClick={onOpenDayView} variant="outline" className="w-full justify-center">Open day view</Button>
              <Button onClick={onOpenAdmin} variant="secondary" className="w-full justify-center">Open admin</Button>
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
                Signed in as <span className="font-medium text-slate-700">{authUser.email}</span>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <Button onClick={onOpenLogin} className="w-full justify-center">Sign in to manage calendar</Button>
              <p className="text-xs leading-5 text-slate-500">
                Private calendar visibility is still restricted. Only approved viewers can open another person's day view.
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  </div>
);

// --- Views ---

const PublicBookingView = ({ settings, availability, meetingTypes, groupMeetings, ownerEmail }: { settings: Settings, availability: AvailabilityDay[], meetingTypes: MeetingType[], groupMeetings: GroupMeeting[], ownerEmail: string }) => {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedMeetingType, setSelectedMeetingType] = useState<MeetingType | null>(null);
  const [selectedGroupMeeting, setSelectedGroupMeeting] = useState<GroupMeeting | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [bookingStep, setBookingStep] = useState<'type' | 'special_options' | 'calendar' | 'details' | 'success'>('type');
  const [formData, setFormData] = useState({ name: '', email: '', note: '' });
  const [specialMode, setSpecialMode] = useState<'invite' | 'group' | null>(null);
  const [bookingError, setBookingError] = useState('');
  const [existingBookings, setExistingBookings] = useState<{start_time: string, end_time: string}[]>([]);

  // Fetch existing bookings when a date is selected
  useEffect(() => {
    if (!selectedDate || !ownerEmail) { setExistingBookings([]); return; }
    const dateStr = format(selectedDate, 'yyyy-MM-dd');
    fetch(`/api/public/bookings?user=${encodeURIComponent(ownerEmail)}&date=${dateStr}`)
      .then(r => r.json())
      .then(d => setExistingBookings(d.bookings || []))
      .catch(() => setExistingBookings([]));
  }, [selectedDate, ownerEmail]);

  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(currentMonth)),
    end: endOfWeek(endOfMonth(currentMonth))
  });

  const isDayAvailable = (date: Date) => {
    const dayOfWeek = date.getDay();
    const config = availability.find(a => a.day_of_week === dayOfWeek);
    return config?.is_available === 1 && !isBefore(date, startOfDay(new Date()));
  };

  const getTimeSlots = (): { time: string; busy: boolean }[] => {
    if (!selectedDate || !selectedMeetingType) return [];
    const slots: { time: string; busy: boolean }[] = [];
    let current = parse(settings.availability_start, 'HH:mm', selectedDate);
    const end = parse(settings.availability_end, 'HH:mm', selectedDate);
    const duration = selectedMeetingType.duration || 30;

    while (isBefore(current, end)) {
      const slotStart = current;
      const slotEnd = addMinutes(slotStart, duration);

      const hasConflict = existingBookings.some(b => {
        const bStart = new Date(b.start_time);
        const bEnd = new Date(b.end_time);
        return slotStart < bEnd && slotEnd > bStart;
      });

      slots.push({ time: format(current, 'HH:mm'), busy: hasConflict });
      current = addMinutes(current, 30);
    }
    return slots;
  };

  const handleBooking = async () => {
    setBookingError('');
    if (selectedMeetingType?.is_special) {
      if (specialMode === 'invite') {
        const res = await fetch('/api/invitation-request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guest_email: formData.email, owner_email: ownerEmail })
        });
        if (res.ok) setBookingStep('success');
        else { const d = await res.json().catch(() => ({})); setBookingError(d.error || 'Failed to send invitation'); }
      } else if (specialMode === 'group' && selectedGroupMeeting) {
        const res = await fetch('/api/group-meetings/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            group_meeting_id: selectedGroupMeeting.id,
            guest_email: formData.email,
            owner_email: ownerEmail
          })
        });
        if (res.ok) setBookingStep('success');
        else { const d = await res.json().catch(() => ({})); setBookingError(d.error || 'Failed to join group meeting'); }
      }
      return;
    }

    if (!selectedDate || !selectedTime || !selectedMeetingType) return;

    const startTime = parse(selectedTime, 'HH:mm', selectedDate);
    const endTime = addMinutes(startTime, selectedMeetingType.duration);

    const res = await fetch('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guest_name: formData.name,
        guest_email: formData.email,
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
        description: formData.note,
        meeting_type_id: selectedMeetingType.id,
        owner_email: ownerEmail
      })
    });

    if (res.ok) {
      setBookingStep('success');
    } else {
      const d = await res.json().catch(() => ({}));
      setBookingError(d.error || 'Failed to create booking');
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-8">
      <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-slate-100 flex flex-col md:flex-row min-h-[600px]">
        {/* Sidebar */}
        <div className="md:w-1/3 bg-slate-50 p-8 border-r border-slate-100">
          <div className="w-16 h-16 rounded-full bg-indigo-100 flex items-center justify-center mb-6">
            <User className="text-indigo-600 w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">{settings.name}</h1>
          <p className="text-slate-600 mb-6">{settings.bio}</p>
          
          <div className="space-y-4">
            {selectedMeetingType && (
              <div className="flex items-center text-indigo-600 text-sm font-bold">
                <CheckCircle2 className="w-4 h-4 mr-2" />
                <span>{selectedMeetingType.name}</span>
              </div>
            )}
            <div className="flex items-center text-slate-500 text-sm">
              <Clock className="w-4 h-4 mr-2" />
              <span>{selectedMeetingType ? `${selectedMeetingType.duration} min meeting` : 'Select duration'}</span>
            </div>
            <div className="flex items-center text-slate-500 text-sm">
              <Globe className="w-4 h-4 mr-2" />
              <span>{settings.timezone}</span>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 p-8">
          <AnimatePresence mode="wait">
            {bookingStep === 'type' && (
              <motion.div 
                key="type"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <h2 className="text-2xl font-bold">Select Meeting Type</h2>
                <div className="grid grid-cols-1 gap-4">
                  {meetingTypes.map(type => (
                    <button
                      key={type.id}
                      onClick={() => {
                        setSelectedMeetingType(type);
                        if (type.is_special) {
                          setBookingStep('special_options');
                        } else {
                          setBookingStep('calendar');
                        }
                      }}
                      className="p-6 border border-slate-100 rounded-2xl text-left hover:border-indigo-600 hover:bg-indigo-50 transition-all group"
                    >
                      <div className="flex justify-between items-center mb-2">
                        <h3 className="font-bold text-lg group-hover:text-indigo-600">{type.name}</h3>
                        {!type.is_special && <span className="text-sm font-medium text-slate-500 bg-slate-100 px-2 py-1 rounded-md">{type.duration} min</span>}
                        {type.is_special && <span className="text-sm font-medium text-indigo-600 bg-indigo-50 px-2 py-1 rounded-md">Free</span>}
                      </div>
                      <p className="text-sm text-slate-500">{type.description}</p>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}

            {bookingStep === 'special_options' && (
              <motion.div 
                key="special"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <button onClick={() => setBookingStep('type')} className="text-indigo-600 text-sm font-medium flex items-center hover:underline mb-4">
                  <ChevronLeft className="w-4 h-4 mr-1" /> Back to Meeting Types
                </button>
                <h2 className="text-2xl font-bold">Choose an Option</h2>
                <div className="grid grid-cols-1 gap-4">
                  <button
                    onClick={() => {
                      setSpecialMode('invite');
                      setBookingStep('details');
                    }}
                    className="p-6 border border-slate-100 rounded-2xl text-left hover:border-indigo-600 hover:bg-indigo-50 transition-all group"
                  >
                    <h3 className="font-bold text-lg group-hover:text-indigo-600">Request an Invitation</h3>
                    <p className="text-sm text-slate-500">Just enter your email and we'll send you an invite to our next session.</p>
                  </button>
                  
                  <div className="space-y-3">
                    <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Join a Group Meeting</h3>
                    {groupMeetings.map(meeting => (
                      <button
                        key={meeting.id}
                        onClick={() => {
                          setSpecialMode('group');
                          setSelectedGroupMeeting(meeting);
                          setBookingStep('details');
                        }}
                        className="w-full p-6 border border-slate-100 rounded-2xl text-left hover:border-indigo-600 hover:bg-indigo-50 transition-all group"
                      >
                        <div className="flex justify-between items-center mb-2">
                          <h4 className="font-bold group-hover:text-indigo-600">{meeting.title}</h4>
                          <span className="text-xs font-medium text-slate-500">{format(new Date(meeting.start_time), 'MMM d, HH:mm')}</span>
                        </div>
                        <p className="text-xs text-slate-500 line-clamp-1">{meeting.description}</p>
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

            {bookingStep === 'calendar' && (
              <motion.div 
                key="calendar"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
              >
                <button onClick={() => setBookingStep('type')} className="text-indigo-600 text-sm font-medium flex items-center hover:underline mb-4">
                  <ChevronLeft className="w-4 h-4 mr-1" /> Back to Meeting Types
                </button>
                <div className="flex items-center justify-between mb-8">
                  <h2 className="text-xl font-semibold">Select a Date & Time</h2>
                  <div className="flex gap-2">
                    <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="p-2 hover:bg-slate-100 rounded-full"><ChevronLeft className="w-5 h-5" /></button>
                    <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="p-2 hover:bg-slate-100 rounded-full"><ChevronRight className="w-5 h-5" /></button>
                  </div>
                </div>

                <div className="grid grid-cols-7 gap-2 mb-8">
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                    <div key={d} className="text-center text-xs font-bold text-slate-400 uppercase py-2">{d}</div>
                  ))}
                  {days.map((day, idx) => {
                    const available = isDayAvailable(day);
                    const isSelected = selectedDate && isSameDay(day, selectedDate);
                    return (
                      <button
                        key={idx}
                        disabled={!available || !isSameMonth(day, currentMonth)}
                        onClick={() => setSelectedDate(day)}
                        className={cn(
                          "h-12 rounded-lg flex items-center justify-center text-sm transition-all",
                          !isSameMonth(day, currentMonth) && "opacity-0 pointer-events-none",
                          available ? "hover:bg-indigo-50 text-slate-900" : "text-slate-300 cursor-not-allowed",
                          isSelected && "bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg shadow-indigo-200"
                        )}
                      >
                        {format(day, 'd')}
                      </button>
                    );
                  })}
                </div>

                {selectedDate && (
                  <div className="space-y-4">
                    <h3 className="font-medium text-slate-900">{format(selectedDate, 'EEEE, MMMM do')}</h3>
                    <div className="grid grid-cols-3 gap-2">
                      {getTimeSlots().map(slot => (
                        <button
                          key={slot.time}
                          disabled={slot.busy}
                          onClick={() => !slot.busy && setSelectedTime(slot.time)}
                          className={cn(
                            "py-3 border rounded-lg text-sm font-medium transition-all",
                            slot.busy
                              ? "bg-red-50 text-red-400 border-red-200 cursor-not-allowed"
                              : selectedTime === slot.time
                                ? "bg-indigo-600 text-white border-indigo-600"
                                : "border-indigo-100 text-indigo-600 hover:border-indigo-600"
                          )}
                        >
                          {slot.time}
                        </button>
                      ))}
                    </div>
                    {selectedTime && (
                      <Button className="w-full mt-4" onClick={() => setBookingStep('details')}>Confirm Time</Button>
                    )}
                  </div>
                )}
              </motion.div>
            )}

            {bookingStep === 'details' && (
              <motion.div 
                key="details"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <button onClick={() => selectedMeetingType?.is_special ? setBookingStep('special_options') : setBookingStep('calendar')} className="text-indigo-600 text-sm font-medium flex items-center hover:underline">
                  <ChevronLeft className="w-4 h-4 mr-1" /> Back
                </button>
                <h2 className="text-2xl font-bold">
                  {selectedMeetingType?.is_special ? 'Join Session' : 'Enter Details'}
                </h2>
                <div className="space-y-4">
                  {(!selectedMeetingType?.is_special || specialMode === 'group') && (
                    <Input 
                      label="Name" 
                      placeholder="John Doe" 
                      value={formData.name} 
                      onChange={e => setFormData({...formData, name: e.target.value})} 
                    />
                  )}
                  <Input 
                    label="Email" 
                    type="email" 
                    placeholder="john@example.com" 
                    value={formData.email} 
                    onChange={e => setFormData({...formData, email: e.target.value})} 
                  />
                  {!selectedMeetingType?.is_special && (
                    <div className="space-y-1">
                      <label className="text-sm font-medium text-slate-700">Notes (Optional)</label>
                      <textarea 
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none min-h-[100px]"
                        placeholder="Anything you'd like to share?"
                        value={formData.note}
                        onChange={e => setFormData({...formData, note: e.target.value})}
                      />
                    </div>
                  )}
                  <Button className="w-full py-4 text-lg" onClick={handleBooking}>
                    {selectedMeetingType?.is_special ? 'Get Invitation' : 'Schedule Event'}
                  </Button>
                  {bookingError && <p className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">{bookingError}</p>}
                </div>
              </motion.div>
            )}

            {bookingStep === 'success' && (
              <motion.div 
                key="success"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-center py-12"
              >
                <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                  <CheckCircle2 className="text-green-600 w-10 h-10" />
                </div>
                <h2 className="text-3xl font-bold mb-2">You're All Set!</h2>
                <p className="text-slate-600 mb-8">
                  {selectedMeetingType?.is_special 
                    ? "Check your email for the invitation and Zoom details." 
                    : "A calendar invitation has been sent to your email."}
                </p>
                {(!selectedMeetingType?.is_special || (specialMode === 'group' && selectedGroupMeeting)) && (
                  <div className="bg-slate-50 rounded-xl p-6 text-left max-w-sm mx-auto">
                    <div className="flex items-center gap-3 mb-4">
                      <CalendarIcon className="text-slate-400 w-5 h-5" />
                      <div>
                        <p className="text-sm font-bold text-slate-900">
                          {selectedMeetingType?.is_special 
                            ? selectedGroupMeeting?.title 
                            : format(selectedDate!, 'EEEE, MMMM do')}
                        </p>
                        <p className="text-xs text-slate-500">
                          {selectedMeetingType?.is_special 
                            ? format(new Date(selectedGroupMeeting!.start_time), 'HH:mm') 
                            : `${selectedTime} - ${format(addMinutes(parse(selectedTime!, 'HH:mm', selectedDate!), selectedMeetingType!.duration), 'HH:mm')}`}
                        </p>
                      </div>
                    </div>
                    {specialMode === 'group' && selectedGroupMeeting && (
                      <div className="flex items-center gap-3 mb-4">
                        <LinkIcon className="text-slate-400 w-5 h-5" />
                        <a href={selectedGroupMeeting.zoom_link} target="_blank" className="text-xs text-indigo-600 hover:underline truncate">
                          Join Zoom Meeting
                        </a>
                      </div>
                    )}
                    <div className="flex items-center gap-3">
                      <Globe className="text-slate-400 w-5 h-5" />
                      <p className="text-xs text-slate-500">{settings.timezone}</p>
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};

// ─── DayView Component ────────────────────────────────────────────────────────

const HOUR_HEIGHT = 60; // px per hour on the time grid
const DAY_START_HOUR = 6;
const DAY_END_HOUR = 23;

function eventTopPx(start: Date): number {
  const mins = (start.getHours() - DAY_START_HOUR) * 60 + start.getMinutes();
  return Math.max(0, (mins / 60) * HOUR_HEIGHT);
}
function eventHeightPx(start: Date, end: Date): number {
  const mins = differenceInMinutes(end, start);
  return Math.max(18, (mins / 60) * HOUR_HEIGHT);
}
function darkenHex(hex: string): string {
  try {
    const n = parseInt(hex.replace('#', ''), 16);
    const r = Math.max(0, (n >> 16) - 50);
    const g = Math.max(0, ((n >> 8) & 0xff) - 50);
    const b = Math.max(0, (n & 0xff) - 50);
    return `#${[r, g, b].map(x => x.toString(16).padStart(2, '0')).join('')}`;
  } catch { return hex; }
}

const DayView = ({ userEmail, ownerEmail }: { userEmail: string; ownerEmail: string }) => {
  const [currentDate, setCurrentDate] = useState<Date>(startOfDay(new Date()));
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [calendars, setCalendars] = useState<CalendarMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const totalHours = DAY_END_HOUR - DAY_START_HOUR;

  const fetchDay = async (date: Date) => {
    setLoading(true);
    setError(null);
    const dateStr = format(date, 'yyyy-MM-dd');
    const ownerParam = ownerEmail !== userEmail ? `&owner=${encodeURIComponent(ownerEmail)}` : '';
    try {
      const res = await fetch(`/api/calendar/day-view?date=${dateStr}&days=1${ownerParam}`, {
        headers: { 'X-User-Email': userEmail },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setEvents(data.events || []);
      setCalendars(data.calendars || []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Could not load calendar: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchDay(currentDate); }, [currentDate]);

  // Scroll to 08:00 on first mount
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = (8 - DAY_START_HOUR) * HOUR_HEIGHT;
    }
  }, []);

  const goDay = (delta: number) => setCurrentDate(d => addDays(d, delta));
  const goToday = () => setCurrentDate(startOfDay(new Date()));

  const timedEvents = events.filter(e => !e.all_day && e.start_time && e.start_time.includes('T'));
  const allDayEvents = events.filter(e => e.all_day || !e.start_time?.includes('T'));

  // Simple column-overlap layout
  function layoutTimedEvents(evts: CalendarEvent[]) {
    const sorted = [...evts].sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
    const cols: CalendarEvent[][] = [];
    const info = new Map<string, { col: number; total: number }>();

    for (const evt of sorted) {
      const s = new Date(evt.start_time); const e2 = new Date(evt.end_time);
      let col = 0;
      while (cols[col]?.some(prev => {
        const ps = new Date(prev.start_time); const pe = new Date(prev.end_time);
        return s < pe && e2 > ps;
      })) col++;
      if (!cols[col]) cols[col] = [];
      cols[col].push(evt);
      info.set(evt.id, { col, total: col + 1 });
    }
    // second pass: set total = max col+1 among conflicting events
    for (const evt of sorted) {
      const entry = info.get(evt.id)!;
      const s = new Date(evt.start_time); const e2 = new Date(evt.end_time);
      let maxCol = entry.col;
      for (let c = 0; c < cols.length; c++) {
        if (cols[c]?.some(prev => {
          const ps = new Date(prev.start_time); const pe = new Date(prev.end_time);
          return s < pe && e2 > ps;
        })) maxCol = Math.max(maxCol, c);
      }
      info.set(evt.id, { col: entry.col, total: maxCol + 1 });
    }
    return info;
  }

  const layout = layoutTimedEvents(timedEvents);

  return (
    <div className="flex flex-col bg-white" style={{ minHeight: '100vh' }}>
      {/* ── Header ─────────────────────────────────────── */}
      <div className="sticky top-0 z-20 bg-white border-b border-slate-200 shadow-sm px-4 py-2 flex flex-wrap items-center gap-2">
        <button
          onClick={goToday}
          className="px-3 py-1.5 text-sm font-medium border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
        >
          Today
        </button>
        <button onClick={() => goDay(-1)} className="p-2 hover:bg-slate-100 rounded-full transition-colors" aria-label="Previous day">
          <ChevronLeft className="w-5 h-5 text-slate-600" />
        </button>
        <button onClick={() => goDay(1)} className="p-2 hover:bg-slate-100 rounded-full transition-colors" aria-label="Next day">
          <ChevronRight className="w-5 h-5 text-slate-600" />
        </button>

        <div className="flex items-center gap-2 min-w-0">
          <span className={cn('text-xl font-bold', isToday(currentDate) ? 'text-indigo-600' : 'text-slate-900')}>
            {format(currentDate, 'EEEE')}
          </span>
          <span className="text-slate-500 text-base hidden sm:inline">{format(currentDate, 'MMMM d, yyyy')}</span>
          {isToday(currentDate) && (
            <span className="px-2 py-0.5 text-[11px] font-bold bg-indigo-600 text-white rounded-full">Today</span>
          )}
        </div>

        {loading && <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />}

        {/* Calendar legend */}
        {calendars.length > 0 && (
          <div className="ml-auto flex items-center gap-3 flex-wrap justify-end max-w-xs">
            {calendars.map(cal => (
              <div key={cal.id} className="flex items-center gap-1">
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: cal.backgroundColor }} />
                <span className="text-xs text-slate-500 truncate max-w-[90px]" title={cal.summary}>{cal.summary}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Error ──────────────────────────────────────── */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2">{error}</div>
      )}

      {/* ── Viewing-as banner ──────────────────────────── */}
      {ownerEmail !== userEmail && (
        <div className="bg-indigo-50 border-b border-indigo-100 px-4 py-2 text-sm text-indigo-700 flex items-center gap-2">
          <CalendarIcon className="w-4 h-4" />
          Viewing <span className="font-semibold">{ownerEmail}</span>'s calendar
        </div>
      )}

      {/* ── All-day events strip ────────────────────────── */}
      {allDayEvents.length > 0 && (
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 flex items-start gap-2 flex-wrap">
          <span className="text-xs text-slate-400 pt-1 w-12 flex-shrink-0">All-day</span>
          {allDayEvents.map(evt => (
            <button
              key={evt.id}
              onClick={() => setSelectedEvent(evt === selectedEvent ? null : evt)}
              className="px-2.5 py-0.5 rounded-full text-white text-xs font-medium truncate max-w-[180px] hover:opacity-90"
              style={{ backgroundColor: evt.calendar_color || '#6366f1' }}
              title={evt.summary}
            >
              {evt.summary}
            </button>
          ))}
        </div>
      )}

      {/* ── Scrollable time grid ────────────────────────── */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="relative flex" style={{ height: `${totalHours * HOUR_HEIGHT}px` }}>
          {/* Hour labels column */}
          <div className="w-14 flex-shrink-0 relative select-none">
            {Array.from({ length: totalHours }, (_, i) => (
              <div
                key={i}
                className="absolute right-2 text-xs text-slate-400 leading-none"
                style={{ top: `${i * HOUR_HEIGHT - 7}px` }}
              >
                {`${String(DAY_START_HOUR + i).padStart(2, '0')}:00`}
              </div>
            ))}
          </div>

          {/* Event area */}
          <div className="flex-1 relative border-l border-slate-200">
            {/* Horizontal hour/half-hour lines */}
            {Array.from({ length: totalHours }, (_, i) => (
              <React.Fragment key={i}>
                <div className="absolute left-0 right-0 border-t border-slate-100" style={{ top: `${i * HOUR_HEIGHT}px` }} />
                <div className="absolute left-0 right-0 border-t border-slate-50" style={{ top: `${i * HOUR_HEIGHT + HOUR_HEIGHT / 2}px` }} />
              </React.Fragment>
            ))}

            {/* Current-time indicator */}
            {isToday(currentDate) && (() => {
              const now = new Date();
              const mins = (now.getHours() - DAY_START_HOUR) * 60 + now.getMinutes();
              if (mins < 0 || mins > totalHours * 60) return null;
              const top = (mins / 60) * HOUR_HEIGHT;
              return (
                <div className="absolute left-0 right-0 z-10 flex items-center pointer-events-none" style={{ top }}>
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500 -ml-1.5 flex-shrink-0" />
                  <div className="flex-1 h-px bg-red-500" />
                </div>
              );
            })()}

            {/* Timed events */}
            {timedEvents.map(evt => {
              const start = new Date(evt.start_time);
              const end = new Date(evt.end_time);
              const top = eventTopPx(start);
              const height = eventHeightPx(start, end);
              const { col, total } = layout.get(evt.id) || { col: 0, total: 1 };
              const pct = 100 / total;
              const bg = evt.calendar_color || '#6366f1';
              const border = darkenHex(bg);
              const isSelected = selectedEvent?.id === evt.id;

              return (
                <button
                  key={evt.id}
                  onClick={() => setSelectedEvent(isSelected ? null : evt)}
                  className="absolute rounded-md text-left text-white text-xs shadow-sm hover:opacity-95 transition-opacity focus:outline-none focus:ring-2 focus:ring-white/50 overflow-hidden"
                  style={{
                    top,
                    height,
                    left: `calc(${col * pct}% + 3px)`,
                    width: `calc(${pct}% - 6px)`,
                    backgroundColor: bg,
                    borderLeft: `3px solid ${border}`,
                    zIndex: isSelected ? 15 : 5,
                  }}
                  title={evt.summary}
                >
                  <div className="px-1.5 py-1 h-full flex flex-col overflow-hidden">
                    <span className="font-semibold leading-tight truncate">{evt.summary}</span>
                    {height > 28 && (
                      <span className="opacity-80 text-[10px]">{format(start, 'HH:mm')}–{format(end, 'HH:mm')}</span>
                    )}
                    {height > 48 && evt.attendees?.length > 0 && (
                      <span className="opacity-75 text-[10px] truncate">{evt.attendees.join(', ')}</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Event detail modal ──────────────────────────── */}
      {selectedEvent && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={() => setSelectedEvent(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 relative"
            onClick={e => e.stopPropagation()}
          >
            <button
              onClick={() => setSelectedEvent(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 text-xl leading-none"
              aria-label="Close"
            >✕</button>

            <div className="flex items-start gap-3 mb-4">
              <div className="w-3 h-3 rounded-full mt-1.5 flex-shrink-0" style={{ backgroundColor: selectedEvent.calendar_color || '#6366f1' }} />
              <div className="min-w-0">
                <h3 className="text-lg font-bold text-slate-900 leading-snug">{selectedEvent.summary}</h3>
                <p className="text-xs text-slate-500 mt-0.5">{selectedEvent.calendar_name}</p>
              </div>
            </div>

            <div className="space-y-2 text-sm text-slate-700">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-slate-400 flex-shrink-0" />
                <span>
                  {selectedEvent.all_day
                    ? 'All day'
                    : `${format(parseISO(selectedEvent.start_time), 'HH:mm')} – ${format(parseISO(selectedEvent.end_time), 'HH:mm')}`
                  }
                </span>
              </div>
              {selectedEvent.location && (
                <div className="flex items-start gap-2">
                  <Globe className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
                  <span className="break-words">{selectedEvent.location}</span>
                </div>
              )}
              {selectedEvent.attendees?.length > 0 && (
                <div className="flex items-start gap-2">
                  <Users className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
                  <div className="flex flex-col gap-0.5">
                    {selectedEvent.attendees.map(a => (
                      <span key={a} className="text-slate-600 text-xs">{a}</span>
                    ))}
                  </div>
                </div>
              )}
              {selectedEvent.description && (
                <div className="mt-2 p-3 bg-slate-50 rounded-lg text-xs text-slate-600 whitespace-pre-wrap max-h-28 overflow-y-auto">
                  {selectedEvent.description}
                </div>
              )}
              {selectedEvent.html_link && (
                <a
                  href={selectedEvent.html_link}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 text-indigo-600 hover:underline text-xs mt-2"
                >
                  <ExternalLink className="w-3 h-3" /> Open in Google Calendar
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const AdminSettingsView = ({
  settings,
  availability,
  onUpdateSettings,
  onUpdateAvailability,
  userEmail
}: {
  settings: Settings,
  availability: AvailabilityDay[],
  onUpdateSettings: (s: Settings) => void,
  onUpdateAvailability: (a: AvailabilityDay[]) => void,
  userEmail: string
}) => {
  const [localSettings, setLocalSettings] = useState(settings);
  const [localAvailability, setLocalAvailability] = useState(availability);
  const [isGoogleConnected, setIsGoogleConnected] = useState(false);
  const [activeTab, setActiveTab] = useState<'profile' | 'availability' | 'integrations' | 'bookings' | 'group-meetings'>('profile');
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [groupMeetings, setGroupMeetings] = useState<GroupMeeting[]>([]);
  const [editingGroupMeeting, setEditingGroupMeeting] = useState<Partial<GroupMeeting> | null>(null);

  // Calendar sharing (viewers)
  const [viewers, setViewers] = useState<{ viewer_email: string; added_at: number }[]>([]);
  const [newViewerEmail, setNewViewerEmail] = useState('');
  const [viewerSaving, setViewerSaving] = useState(false);
  const [viewerError, setViewerError] = useState('');
  const publicBookingLink = getPublicBookingLink(localSettings.public_slug || userEmail);
  const viewerShareLink = getPrivateViewerLink(userEmail);

  const authH = adminHeaders(userEmail);
  const authHJson = adminHeaders(userEmail, 'application/json');

  const fetchViewers = () => {
    fetch('/api/calendar/viewers', { headers: authH })
      .then(r => r.json())
      .then(d => setViewers(d.viewers || []))
      .catch(() => {});
  };

  const addViewer = async () => {
    if (!newViewerEmail.trim()) return;
    setViewerSaving(true);
    setViewerError('');
    try {
      const res = await fetch('/api/calendar/viewers', {
        method: 'POST',
        headers: authHJson,
        body: JSON.stringify({ viewer_email: newViewerEmail.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setViewerError(data.error || 'Failed to add viewer'); return; }
      setNewViewerEmail('');
      fetchViewers();
    } catch {
      setViewerError('Network error');
    } finally {
      setViewerSaving(false);
    }
  };

  const removeViewer = async (email: string) => {
    await fetch(`/api/calendar/viewers?email=${encodeURIComponent(email)}`, { method: 'DELETE', headers: authH });
    fetchViewers();
  };

  useEffect(() => {
    fetch('/api/auth/calendar-status', { headers: authH }).then(r => r.json()).then(d => setIsGoogleConnected(d.connected)).catch(() => {});
    fetch('/api/admin/bookings', { headers: authH }).then(r => r.json()).then(d => setBookings(d.bookings || d)).catch(() => {});
    if (activeTab === 'group-meetings') {
      fetch('/api/admin/group-meetings', { headers: authH }).then(r => r.json()).then(d => setGroupMeetings(d.groupMeetings || d)).catch(() => {});
    }
    if (activeTab === 'integrations') {
      fetchViewers();
    }
  }, [activeTab]);

  const saveGroupMeeting = async () => {
    if (!editingGroupMeeting?.title || !editingGroupMeeting?.start_time || !editingGroupMeeting?.zoom_link) return;
    const res = await fetch('/api/admin/group-meetings', {
      method: 'POST',
      headers: authHJson,
      body: JSON.stringify(editingGroupMeeting)
    });
    if (res.ok) {
      setEditingGroupMeeting(null);
      fetch('/api/admin/group-meetings', { headers: authH }).then(r => r.json()).then(setGroupMeetings);
    }
  };

  const deleteGroupMeeting = async (id: number) => {
    if (!confirm('Are you sure you want to delete this group meeting?')) return;
    const res = await fetch(`/api/admin/group-meetings?id=${id}`, { method: 'DELETE', headers: authH });
    if (res.ok) {
      fetch('/api/admin/group-meetings', { headers: authH }).then(r => r.json()).then(setGroupMeetings);
    }
  };

  const handleConnectGoogle = () => {
    window.location.href = 'https://auth.vegvisr.org/calendar/auth';
  };

  const [profileError, setProfileError] = useState<string>('');
  const [profileStatus, setProfileStatus] = useState<string>('');

  const slugValue = (localSettings.public_slug || '').toLowerCase();
  const slugIsEmpty = slugValue === '';
  const slugIsValid = slugIsEmpty || (SLUG_PATTERN.test(slugValue) && !RESERVED_SLUGS.has(slugValue));

  const saveProfile = async () => {
    setProfileError('');
    setProfileStatus('');
    if (!slugIsValid) {
      setProfileError('Public path must be 1-40 lowercase letters, numbers, or hyphens, and not a reserved word.');
      return;
    }
    const payload = { ...localSettings, public_slug: slugIsEmpty ? null : slugValue };
    const res = await fetch('/api/admin/settings', {
      method: 'POST',
      headers: authHJson,
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setProfileError(data?.error || 'Failed to save profile.');
      return;
    }
    onUpdateSettings({ ...localSettings, public_slug: payload.public_slug });
    setProfileStatus('Profile saved.');
  };

  const saveAvailability = async () => {
    await fetch('/api/admin/availability', {
      method: 'POST',
      headers: authHJson,
      body: JSON.stringify({ days: localAvailability })
    });
    onUpdateAvailability(localAvailability);
  };

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-8">
      <div className="flex flex-col md:flex-row gap-8">
        {/* Sidebar Nav */}
        <div className="md:w-64 space-y-1">
          <button 
            onClick={() => setActiveTab('profile')}
            className={cn("w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all", activeTab === 'profile' ? "bg-indigo-600 text-white shadow-lg shadow-indigo-100" : "text-slate-600 hover:bg-slate-100")}
          >
            <User className="w-5 h-5" /> Profile Settings
          </button>
          <button 
            onClick={() => setActiveTab('availability')}
            className={cn("w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all", activeTab === 'availability' ? "bg-indigo-600 text-white shadow-lg shadow-indigo-100" : "text-slate-600 hover:bg-slate-100")}
          >
            <Clock className="w-5 h-5" /> Availability
          </button>
          <button 
            onClick={() => setActiveTab('integrations')}
            className={cn("w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all", activeTab === 'integrations' ? "bg-indigo-600 text-white shadow-lg shadow-indigo-100" : "text-slate-600 hover:bg-slate-100")}
          >
            <LinkIcon className="w-5 h-5" /> Integrations
          </button>
          <button 
            onClick={() => setActiveTab('bookings')}
            className={cn("w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all", activeTab === 'bookings' ? "bg-indigo-600 text-white shadow-lg shadow-indigo-100" : "text-slate-600 hover:bg-slate-100")}
          >
            <CalendarIcon className="w-5 h-5" /> All Bookings
          </button>
          <button 
            onClick={() => setActiveTab('group-meetings')}
            className={cn("w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all", activeTab === 'group-meetings' ? "bg-indigo-600 text-white shadow-lg shadow-indigo-100" : "text-slate-600 hover:bg-slate-100")}
          >
            <Users className="w-5 h-5" /> Group Meetings
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 bg-white rounded-2xl border border-slate-100 p-8 shadow-sm">
          {activeTab === 'profile' && (
            <div className="space-y-6">
              <h2 className="text-2xl font-bold">Profile Settings</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Input label="Display Name" value={localSettings.name} onChange={e => setLocalSettings({...localSettings, name: e.target.value})} />
                <Input label="Timezone" value={localSettings.timezone} onChange={e => setLocalSettings({...localSettings, timezone: e.target.value})} />
                <div className="md:col-span-2">
                  <label className="text-sm font-medium text-slate-700">Bio / Description</label>
                  <textarea 
                    className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none min-h-[100px]"
                    value={localSettings.bio}
                    onChange={e => setLocalSettings({...localSettings, bio: e.target.value})}
                  />
                </div>
                <div className="flex items-center gap-4">
                  <Palette className="text-slate-400" />
                  <Input type="color" label="Primary Color" className="h-10 w-20 p-1" value={localSettings.primary_color} onChange={e => setLocalSettings({...localSettings, primary_color: e.target.value})} />
                </div>
                <div className="md:col-span-2 space-y-1">
                  <label className="text-sm font-medium text-slate-700">Public booking path</label>
                  <div className="flex items-stretch rounded-lg border border-slate-200 focus-within:ring-2 focus-within:ring-indigo-500 focus-within:border-indigo-500 overflow-hidden">
                    <span className="px-3 py-2 bg-slate-50 text-sm text-slate-500 font-mono">{window.location.host}/</span>
                    <input
                      type="text"
                      className="flex-1 px-3 py-2 outline-none text-sm font-mono"
                      placeholder="your-name"
                      value={localSettings.public_slug || ''}
                      onChange={e => setLocalSettings({...localSettings, public_slug: e.target.value.toLowerCase()})}
                    />
                  </div>
                  <p className="text-xs text-slate-500">Lowercase letters, numbers, and hyphens. Leave empty to disable the public path.</p>
                  {!slugIsValid && <p className="text-xs text-red-600">Invalid path. Use 1-40 lowercase letters, numbers, or hyphens, and avoid reserved words.</p>}
                </div>
              </div>
              {profileError && <p className="text-sm text-red-600">{profileError}</p>}
              {profileStatus && <p className="text-sm text-green-600">{profileStatus}</p>}
              <Button onClick={saveProfile}>Save Changes</Button>
            </div>
          )}

          {activeTab === 'availability' && (
            <div className="space-y-6">
              <h2 className="text-2xl font-bold">Availability</h2>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <Input type="time" label="Start Time" value={localSettings.availability_start} onChange={e => setLocalSettings({...localSettings, availability_start: e.target.value})} />
                  <Input type="time" label="End Time" value={localSettings.availability_end} onChange={e => setLocalSettings({...localSettings, availability_end: e.target.value})} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Available Days</label>
                  <div className="grid grid-cols-7 gap-2">
                    {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, idx) => {
                      const isAvail = localAvailability.find(a => a.day_of_week === idx)?.is_available === 1;
                      return (
                        <button
                          key={idx}
                          onClick={() => {
                            const next = [...localAvailability];
                            const item = next.find(a => a.day_of_week === idx);
                            if (item) item.is_available = isAvail ? 0 : 1;
                            setLocalAvailability(next);
                          }}
                          className={cn(
                            "h-12 rounded-lg font-bold transition-all",
                            isAvail ? "bg-indigo-600 text-white shadow-md" : "bg-slate-100 text-slate-400 hover:bg-slate-200"
                          )}
                        >
                          {day}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
              <Button onClick={saveAvailability}>Save Availability</Button>
            </div>
          )}

          {activeTab === 'integrations' && (
            <div className="space-y-6">
              <h2 className="text-2xl font-bold">Integrations</h2>

              {/* Google Calendar connect */}
              <div className="p-6 border border-slate-100 rounded-2xl flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-slate-50 rounded-xl flex items-center justify-center">
                    <img src="https://www.gstatic.com/images/branding/product/1x/calendar_48dp.png" className="w-8 h-8" alt="Google Calendar" />
                  </div>
                  <div>
                    <h3 className="font-bold">Google Calendar</h3>
                    <p className="text-sm text-slate-500">
                      {isGoogleConnected
                        ? `Connected as ${userEmail} — includes all linked calendars`
                        : 'Sync bookings and view all your linked calendars'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {isGoogleConnected && (
                    <div className="flex items-center gap-2 text-green-600 bg-green-50 px-3 py-1 rounded-full text-sm font-medium">
                      <CheckCircle2 className="w-4 h-4" /> Connected
                    </div>
                  )}
                  <Button variant="outline" onClick={handleConnectGoogle} className="flex items-center gap-2">
                    {isGoogleConnected ? 'Reconnect' : 'Connect'} <ExternalLink className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {/* Calendar Sharing */}
              <div className="p-6 border border-slate-100 rounded-2xl space-y-4">
                <div className="flex items-center gap-3">
                  <Globe className="w-5 h-5 text-indigo-500" />
                  <div>
                    <h3 className="font-bold">Public booking page</h3>
                    <p className="text-sm text-slate-500">Share this public page when someone should book time with you.</p>
                  </div>
                </div>

                <div className="bg-slate-50 rounded-xl p-3 flex items-center gap-2">
                  <code className="text-xs text-slate-600 flex-1 truncate">{publicBookingLink}</code>
                  <button
                    onClick={() => navigator.clipboard.writeText(publicBookingLink)}
                    className="text-xs text-indigo-600 hover:underline flex-shrink-0"
                  >
                    Copy link
                  </button>
                </div>

                <div className="h-px bg-slate-100" />

                <div className="flex items-center gap-3">
                  <Users className="w-5 h-5 text-indigo-500" />
                  <div>
                    <h3 className="font-bold">Calendar Sharing</h3>
                    <p className="text-sm text-slate-500">Allow other users (e.g. Superadmins) to view your calendar in Day View</p>
                  </div>
                </div>

                {/* Shareable link */}
                <div className="bg-slate-50 rounded-xl p-3 flex items-center gap-2">
                  <code className="text-xs text-slate-600 flex-1 truncate">{viewerShareLink}</code>
                  <button
                    onClick={() => navigator.clipboard.writeText(viewerShareLink)}
                    className="text-xs text-indigo-600 hover:underline flex-shrink-0"
                  >
                    Copy link
                  </button>
                </div>
                <p className="text-xs text-slate-400">Share this link with users you've added as viewers below. They must sign in first.</p>

                {/* Add viewer */}
                <div className="flex gap-2">
                  <input
                    type="email"
                    placeholder="viewer@email.com"
                    value={newViewerEmail}
                    onChange={e => setNewViewerEmail(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addViewer()}
                    className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                  />
                  <Button onClick={addViewer} disabled={viewerSaving || !newViewerEmail.trim()}>
                    {viewerSaving ? 'Adding…' : 'Add viewer'}
                  </Button>
                </div>
                {viewerError && <p className="text-sm text-red-600">{viewerError}</p>}

                {/* Viewer list */}
                {viewers.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-4">No viewers yet.</p>
                ) : (
                  <div className="space-y-2">
                    {viewers.map(v => (
                      <div key={v.viewer_email} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-600 text-xs font-bold flex items-center justify-center">
                            {v.viewer_email[0].toUpperCase()}
                          </div>
                          <span className="text-sm text-slate-700">{v.viewer_email}</span>
                        </div>
                        <button
                          onClick={() => removeViewer(v.viewer_email)}
                          className="text-xs text-red-400 hover:text-red-600 transition-colors"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'bookings' && (
            <div className="space-y-6">
              <h2 className="text-2xl font-bold">All Bookings</h2>
              <div className="space-y-3">
                {bookings.length === 0 ? (
                  <div className="text-center py-12 text-slate-400">No bookings yet.</div>
                ) : (
                  bookings.map(booking => (
                    <div key={booking.id ?? booking.google_event_id} className="p-4 border border-slate-100 rounded-xl flex items-center justify-between hover:bg-slate-50 transition-all">
                      <div className="flex items-center gap-4">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${
                          booking.source === 'google' ? 'bg-blue-50 text-blue-600' : 'bg-indigo-50 text-indigo-600'
                        }`}>
                          {(booking.guest_name || '?')[0].toUpperCase()}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-bold text-slate-900">{booking.guest_name}</p>
                            {booking.source === 'google' && (
                              <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                                <img src="https://www.gstatic.com/images/branding/product/1x/calendar_48dp.png" className="w-3 h-3" alt="" />
                                Google
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500">
                            {booking.guest_email}
                            {booking.meeting_type_name ? ` • ${booking.meeting_type_name}` : ''}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium text-slate-900">{format(new Date(booking.start_time), 'MMM d, yyyy')}</p>
                        <p className="text-xs text-slate-500">{format(new Date(booking.start_time), 'HH:mm')} - {format(new Date(booking.end_time), 'HH:mm')}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {activeTab === 'group-meetings' && (
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold">Group Meetings</h2>
                <Button onClick={() => setEditingGroupMeeting({ title: '', start_time: format(new Date(), "yyyy-MM-dd'T'HH:mm"), zoom_link: '', description: '' })} className="flex items-center gap-2">
                  <Plus className="w-4 h-4" /> Add Meeting
                </Button>
              </div>

              {editingGroupMeeting && (
                <div className="p-6 border-2 border-indigo-100 rounded-2xl bg-indigo-50/30 space-y-4">
                  <h3 className="font-bold text-indigo-900">{editingGroupMeeting.id ? 'Edit' : 'New'} Group Meeting</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Input 
                      label="Title" 
                      value={editingGroupMeeting.title} 
                      onChange={e => setEditingGroupMeeting({...editingGroupMeeting, title: e.target.value})} 
                    />
                    <Input 
                      label="Start Time" 
                      type="datetime-local"
                      value={editingGroupMeeting.start_time} 
                      onChange={e => setEditingGroupMeeting({...editingGroupMeeting, start_time: e.target.value})} 
                    />
                    <Input 
                      label="Zoom Link" 
                      value={editingGroupMeeting.zoom_link} 
                      onChange={e => setEditingGroupMeeting({...editingGroupMeeting, zoom_link: e.target.value})} 
                    />
                    <div className="space-y-1">
                      <label className="text-sm font-medium text-slate-700">Recurrence</label>
                      <select 
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                        value={editingGroupMeeting.recurrence || 'None'}
                        onChange={e => setEditingGroupMeeting({...editingGroupMeeting, recurrence: e.target.value})}
                      >
                        <option value="None">None</option>
                        <option value="Weekly">Weekly</option>
                        <option value="Bi-Weekly">Bi-Weekly</option>
                        <option value="Monthly">Monthly</option>
                      </select>
                    </div>
                    <div className="md:col-span-2">
                      <Input 
                        label="Description" 
                        value={editingGroupMeeting.description} 
                        onChange={e => setEditingGroupMeeting({...editingGroupMeeting, description: e.target.value})} 
                      />
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <Button onClick={saveGroupMeeting}>Save Meeting</Button>
                    <Button variant="outline" onClick={() => setEditingGroupMeeting(null)}>Cancel</Button>
                  </div>
                </div>
              )}

              <div className="space-y-3">
                {groupMeetings.length === 0 ? (
                  <div className="text-center py-12 text-slate-400">No group meetings scheduled.</div>
                ) : (
                  groupMeetings.map(meeting => (
                    <div key={meeting.id} className="p-4 border border-slate-100 rounded-xl flex items-center justify-between hover:bg-slate-50 transition-all">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-indigo-50 rounded-full flex items-center justify-center text-indigo-600">
                          <Users className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="font-bold text-slate-900">{meeting.title}</p>
                          <div className="flex items-center gap-2">
                            <p className="text-xs text-slate-500">{meeting.zoom_link}</p>
                            {meeting.recurrence && meeting.recurrence !== 'None' && (
                              <span className="text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider">
                                {meeting.recurrence}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-6">
                        <div className="text-right">
                          <p className="text-sm font-medium text-slate-900">{format(new Date(meeting.start_time), 'MMM d, yyyy')}</p>
                          <p className="text-xs text-slate-500">{format(new Date(meeting.start_time), 'HH:mm')}</p>
                        </div>
                        <div className="flex gap-2">
                          <button 
                            onClick={() => setEditingGroupMeeting(meeting)}
                            className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => deleteGroupMeeting(meeting.id)}
                            className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default function App() {
  const currentUrl = new URL(window.location.href);
  const urlParams = currentUrl.searchParams;
  const pathSegments = currentUrl.pathname.split('/').filter(Boolean);
  const publicPathSegment = pathSegments[0] || '';
  const initialOwnerFromQuery = urlParams.get('user') || '';
  // Email-shaped path is treated as direct owner; slugs require backend lookup.
  const initialOwnerFromPath = publicPathSegment && publicPathSegment.includes('@')
    ? normalizePublicBookingValue(publicPathSegment)
    : '';

  // If ?view=EMAIL is present, a Superadmin can view another user's calendar
  const viewAsEmail = urlParams.get('view') || '';

  const [view, setView] = useState<'public' | 'admin' | 'day-view'>(viewAsEmail ? 'day-view' : 'public');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [availability, setAvailability] = useState<AvailabilityDay[]>([]);
  const [meetingTypes, setMeetingTypes] = useState<MeetingType[]>([]);
  const [groupMeetings, setGroupMeetings] = useState<GroupMeeting[]>([]);
  const [loading, setLoading] = useState(true);

  // Resolution of the public owner from path/query (email is sync, slug is async via backend lookup).
  const [explicitPublicOwnerEmail, setExplicitPublicOwnerEmail] = useState<string>(
    initialOwnerFromQuery || initialOwnerFromPath
  );
  const [unknownPublicPath, setUnknownPublicPath] = useState<boolean>(false);
  const [resolvingPublicPath, setResolvingPublicPath] = useState<boolean>(
    Boolean(publicPathSegment) && !initialOwnerFromQuery && !initialOwnerFromPath
  );

  // Public booking pages list for the root landing page
  const [publicPages, setPublicPages] = useState<PublicBookingPage[]>([]);
  const [publicPagesLoading, setPublicPagesLoading] = useState<boolean>(false);

  // Auth state
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authStatus, setAuthStatus] = useState<'checking' | 'authed' | 'anonymous'>('checking');
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginStatus, setLoginStatus] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  const openMyPublicBookingPage = () => {
    if (!authUser?.email) return;
    const target = settings?.public_slug || authUser.email;
    window.location.assign(getPublicBookingPath(target));
  };

  // Persist user to localStorage
  const persistUser = (user: { email: string; role?: string; user_id?: string | null; emailVerificationToken?: string | null }) => {
    const payload = {
      email: user.email,
      role: user.role || 'user',
      user_id: user.user_id || user.email,
      oauth_id: user.user_id || user.email,
      emailVerificationToken: user.emailVerificationToken || null,
    };
    localStorage.setItem('user', JSON.stringify(payload));
    if (user.emailVerificationToken) setAuthCookie(user.emailVerificationToken);
    sessionStorage.setItem('email_session_verified', '1');
    setAuthUser({ userId: payload.user_id || '', email: payload.email, role: payload.role });
    setAuthStatus('authed');
  };

  const handleLogout = () => {
    localStorage.removeItem('user');
    sessionStorage.removeItem('email_session_verified');
    clearAuthCookie();
    setAuthUser(null);
    setAuthStatus('anonymous');
    setView('public');
  };

  const handleSendMagicLink = async () => {
    if (!loginEmail.trim()) return;
    setLoginError('');
    setLoginStatus('');
    setLoginLoading(true);
    try {
      const redirectUrl = `${window.location.origin}${window.location.pathname}`;
      await sendMagicLinkApi(loginEmail.trim(), redirectUrl);
      setLoginStatus('Magic link sent! Check your email.');
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Failed to send magic link.');
    } finally {
      setLoginLoading(false);
    }
  };

  // Bootstrap auth: check magic token in URL, then localStorage
  useEffect(() => {
    const url = new URL(window.location.href);
    const magic = url.searchParams.get('magic');
    if (magic) {
      setAuthStatus('checking');
      verifyMagicToken(magic)
        .then(async (email) => {
          try {
            const ctx = await fetchUserContext(email);
            persistUser(ctx);
          } catch {
            persistUser({ email, role: 'user', user_id: email });
          }
          url.searchParams.delete('magic');
          window.history.replaceState({}, '', url.toString());
        })
        .catch(() => setAuthStatus('anonymous'));
      return;
    }

    // Handle Google Calendar auth return
    const calendarSuccess = url.searchParams.get('calendar_auth_success');
    if (calendarSuccess) {
      url.searchParams.delete('calendar_auth_success');
      url.searchParams.delete('user_email');
      window.history.replaceState({}, '', url.toString());
    }

    // Check localStorage
    const stored = readStoredUser();
    if (stored) {
      setAuthUser(stored);
      setAuthStatus('authed');
    } else {
      setAuthStatus('anonymous');
    }
  }, []);

  // Resolve a slug-style public path to an owner email via the backend.
  useEffect(() => {
    if (!publicPathSegment) {
      setUnknownPublicPath(false);
      setResolvingPublicPath(false);
      return;
    }
    if (initialOwnerFromQuery || initialOwnerFromPath) {
      setUnknownPublicPath(false);
      setResolvingPublicPath(false);
      return;
    }

    const slug = normalizePublicBookingValue(publicPathSegment);
    setResolvingPublicPath(true);
    fetch(`/api/public/lookup-slug?slug=${encodeURIComponent(slug)}`)
      .then(async r => {
        if (!r.ok) {
          setExplicitPublicOwnerEmail('');
          setUnknownPublicPath(true);
          return;
        }
        const data = await r.json();
        if (data?.email) {
          setExplicitPublicOwnerEmail(data.email);
          setUnknownPublicPath(false);
        } else {
          setExplicitPublicOwnerEmail('');
          setUnknownPublicPath(true);
        }
      })
      .catch(() => {
        setExplicitPublicOwnerEmail('');
        setUnknownPublicPath(true);
      })
      .finally(() => setResolvingPublicPath(false));
  }, [publicPathSegment, initialOwnerFromQuery, initialOwnerFromPath]);

  // Load published booking pages for the root landing page when no specific page is requested.
  useEffect(() => {
    if (publicPathSegment || initialOwnerFromQuery) return;
    setPublicPagesLoading(true);
    fetch('/api/public/pages')
      .then(r => (r.ok ? r.json() : { pages: [] }))
      .then(data => {
        const rows: Array<{ slug?: string; email?: string; name?: string; bio?: string }> = data?.pages || [];
        setPublicPages(
          rows
            .filter(p => p.slug && p.email)
            .map(p => ({
              slug: p.slug as string,
              email: p.email as string,
              title: p.name && p.name.trim() ? p.name : (p.slug as string),
              description: p.bio && p.bio.trim() ? p.bio : 'Open this public page to see meeting types and book a time.',
            }))
        );
      })
      .catch(() => setPublicPages([]))
      .finally(() => setPublicPagesLoading(false));
  }, [publicPathSegment, initialOwnerFromQuery]);

  // Load public settings when owner email is known
  useEffect(() => {
    if (!explicitPublicOwnerEmail) {
      if (!resolvingPublicPath) setLoading(false);
      return;
    }
    fetch(`/api/public/settings?user=${encodeURIComponent(explicitPublicOwnerEmail)}`)
      .then(r => r.json())
      .then(data => {
        if (data.settings) {
          setSettings(data.settings);
          setAvailability(data.availability || []);
          setMeetingTypes(data.meetingTypes || []);
          setGroupMeetings(data.groupMeetings || []);
        } else {
          setSettings(null);
          setAvailability([]);
          setMeetingTypes([]);
          setGroupMeetings([]);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [explicitPublicOwnerEmail]);

  // Auto-setup defaults for new user on first login
  useEffect(() => {
    if (authStatus === 'authed' && authUser?.email && !settings) {
      fetch('/api/admin/setup', { method: 'POST', headers: { 'X-User-Email': authUser.email } })
        .then(() => fetch(`/api/public/settings?user=${encodeURIComponent(authUser.email)}`))
        .then(r => r.json())
        .then(data => {
          if (data.settings) {
            setSettings(data.settings);
            setAvailability(data.availability || []);
            setMeetingTypes(data.meetingTypes || []);
            setGroupMeetings(data.groupMeetings || []);
          }
        })
        .catch(() => {});
    }
  }, [authStatus, authUser?.email]);

  if (authStatus === 'checking') return <div className="min-h-screen flex items-center justify-center">Loading...</div>;

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      <div className="bg-slate-900 px-4 py-1.5">
        <EcosystemNav showRecorder={false} className="max-w-7xl mx-auto" />
      </div>
      <nav className="bg-white border-b border-slate-100 px-8 py-4 flex justify-between items-center sticky top-0 z-50">
        <div className="flex items-center">
          <img
            src="https://favicons.vegvisr.org/favicons/1774599151506-1-1774599160672-512x512.png"
            alt="CalSync"
            className="w-[200px] h-[200px] object-contain"
          />
        </div>
        <div className="flex items-center gap-4">
          {authStatus === 'authed' && authUser ? (
            <>
              <span className="text-sm text-slate-500">{authUser.email}</span>
              <button
                onClick={openMyPublicBookingPage}
                className={cn("px-4 py-2 rounded-lg text-sm font-medium transition-all", view === 'public' ? "bg-indigo-50 text-indigo-600" : "text-slate-600 hover:bg-slate-50")}
              >
                Public View
              </button>
              <button
                onClick={() => setView('day-view')}
                className={cn("px-4 py-2 rounded-lg text-sm font-medium transition-all", view === 'day-view' ? "bg-indigo-50 text-indigo-600" : "text-slate-600 hover:bg-slate-50")}
              >
                <CalendarIcon className="w-4 h-4 inline mr-1" /> Day View
              </button>
              <button
                onClick={() => setView('admin')}
                className={cn("px-4 py-2 rounded-lg text-sm font-medium transition-all", view === 'admin' ? "bg-indigo-50 text-indigo-600" : "text-slate-600 hover:bg-slate-50")}
              >
                <SettingsIcon className="w-4 h-4 inline mr-1" /> Admin
              </button>
              <button onClick={handleLogout} className="px-3 py-2 text-sm text-slate-500 hover:text-red-600 transition-colors">
                Log out
              </button>
            </>
          ) : (
            <button
              onClick={() => setLoginOpen(true)}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 transition-all"
            >
              Sign in
            </button>
          )}
        </div>
      </nav>

      {/* Magic link login modal */}
      {loginOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100]" onClick={() => setLoginOpen(false)}>
          <div className="bg-white rounded-2xl p-8 w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-xl font-bold text-slate-900 mb-4">Sign in with email</h2>
            <div className="space-y-4">
              <Input
                label="Email address"
                type="email"
                value={loginEmail}
                onChange={(e) => setLoginEmail((e.target as HTMLInputElement).value)}
                placeholder="you@example.com"
              />
              <Button onClick={handleSendMagicLink} disabled={loginLoading} className="w-full">
                {loginLoading ? 'Sending...' : 'Send magic link'}
              </Button>
              {loginStatus && <p className="text-sm text-green-600">{loginStatus}</p>}
              {loginError && <p className="text-sm text-red-600">{loginError}</p>}
            </div>
          </div>
        </div>
      )}

      <main className="py-12">
        {loading || resolvingPublicPath ? (
          <div className="flex items-center justify-center py-20">Loading...</div>
        ) : view === 'public' && settings && explicitPublicOwnerEmail ? (
          <PublicBookingView
            settings={settings}
            availability={availability}
            meetingTypes={meetingTypes}
            groupMeetings={groupMeetings}
            ownerEmail={explicitPublicOwnerEmail}
          />
        ) : view === 'public' ? (
          <RootLandingPage
            authUser={authUser}
            pages={publicPages}
            pagesLoading={publicPagesLoading}
            onOpenMyBookingPage={openMyPublicBookingPage}
            onOpenDayView={() => setView('day-view')}
            onOpenAdmin={() => setView('admin')}
            onOpenLogin={() => setLoginOpen(true)}
            unknownBookingPath={unknownPublicPath ? publicPathSegment : undefined}
          />
        ) : view === 'day-view' && authStatus === 'authed' ? (
          <DayView
            userEmail={authUser!.email}
            ownerEmail={viewAsEmail || authUser!.email}
          />
        ) : view === 'admin' && authStatus === 'authed' && settings ? (
          <AdminSettingsView
            settings={settings}
            availability={availability}
            onUpdateSettings={setSettings}
            onUpdateAvailability={setAvailability}
            userEmail={authUser!.email}
          />
        ) : (
          <div className="text-center py-20 text-slate-500">
            <p>Please sign in to access admin settings.</p>
          </div>
        )}
      </main>
    </div>
  );
}
