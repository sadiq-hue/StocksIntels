import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Video, Clock } from "lucide-react";
import { api, type Booking, type Lead } from "../../../lib/api";
import { useBusiness } from "../../../lib/business-context";

type Meeting = { id: number; title: string; company: string; time: string; duration: string; type: string };

const timeSlots = [
  "09:00 AM", "10:00 AM", "11:00 AM", "12:00 PM",
  "01:00 PM", "02:00 PM", "03:00 PM", "04:00 PM", "05:00 PM",
];

const defaultMeetings: Meeting[] = [
  { id: 1, title: "Demo with Sarah Chen", company: "TechCorp", time: "10:00 AM", duration: "30 min", type: "Demo" },
  { id: 2, title: "Discovery call with Michael Rodriguez", company: "StartupXYZ", time: "02:00 PM", duration: "30 min", type: "Discovery" },
  { id: 3, title: "Follow-up with Emma Williams", company: "Enterprise Co", time: "03:30 PM", duration: "30 min", type: "Follow-up" },
];

type UpcomingMeeting = { id: number; name: string; company: string; date: string; time: string; avatar: string };

const defaultUpcoming: UpcomingMeeting[] = [
  { id: 1, name: "Sarah Chen", company: "TechCorp", date: "Today", time: "10:00 AM", avatar: "SC" },
  {
    id: 2,
    name: "Michael Rodriguez",
    company: "StartupXYZ",
    date: "Today",
    time: "2:00 PM",
    avatar: "MR",
  },
  {
    id: 3,
    name: "Emma Williams",
    company: "Enterprise Co",
    date: "Tomorrow",
    time: "11:00 AM",
    avatar: "EW",
  },
  {
    id: 4,
    name: "David Park",
    company: "Growth Inc",
    date: "Apr 13",
    time: "3:00 PM",
    avatar: "DP",
  },
];

export function Calendar() {
  const { business } = useBusiness();
  const [meetings, setMeetings] = useState<Meeting[]>(defaultMeetings);
  const [upcomingMeetings, setUpcoming] = useState<UpcomingMeeting[]>(defaultUpcoming);

  useEffect(() => {
    if (!business) return;
    api.bookings.list({ business_id: business.id })
      .then(res => {
        if (res.rows.length > 0) {
          const mapped = res.rows.slice(0, 5).map((b: Booking, idx: number) => ({
            id: idx + 1,
            title: `Booking at ${new Date(b.scheduled_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
            company: '',
            time: new Date(b.scheduled_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            duration: `${b.duration_minutes} min`,
            type: b.status,
          }));
          setMeetings(mapped);

          setUpcoming(
            res.rows.slice(0, 3).map((b: Booking, idx: number) => ({
              id: idx + 1,
              name: `Booking #${b.id.slice(0, 6)}`,
              company: b.status,
              date: new Date(b.scheduled_at).toLocaleDateString('en', { weekday: 'long' }),
              time: new Date(b.scheduled_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              avatar: 'Bk',
            }))
          );
        }
      })
      .catch(() => {});
  }, [business]);

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex-1 p-8 space-y-6 overflow-y-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1>Calendar</h1>
            <p className="text-muted-foreground">Manage your scheduled meetings</p>
          </div>
          <div className="flex items-center gap-2">
            <button className="p-2 hover:bg-accent rounded-lg transition-colors">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="px-4 py-2">{new Date().toLocaleDateString('en', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
            <button className="p-2 hover:bg-accent rounded-lg transition-colors">
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="border border-border rounded-xl overflow-hidden">
          <div className="grid grid-cols-7 border-b border-border bg-muted/50">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
              <div key={day} className="p-3 text-center text-sm font-medium">
                {day}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {Array.from({ length: 35 }, (_, i) => {
              const day = i - 5;
              const isToday = day === 11;
              const isCurrentMonth = day > 0 && day <= 30;
              return (
                <button
                  key={i}
                  className={`aspect-square p-2 border-r border-b border-border hover:bg-accent transition-colors ${
                    !isCurrentMonth ? "text-muted-foreground bg-muted/20" : ""
                  } ${isToday ? "bg-primary/10" : ""}`}
                >
                  <div className="flex flex-col items-start h-full">
                    <span className={`text-sm ${isToday ? "font-semibold text-primary" : ""}`}>
                      {day > 0 && day <= 30 ? day : day <= 0 ? 30 + day : day - 30}
                    </span>
                    {isToday && (
                      <div className="mt-auto space-y-1 w-full">
                        <div className="w-full h-1 bg-blue-500 rounded-full" />
                        <div className="w-full h-1 bg-purple-500 rounded-full" />
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <h3 className="mb-4">Available Time Slots</h3>
          <div className="grid grid-cols-5 gap-3">
            {timeSlots.map((slot) => {
              const isBooked = meetings.some((m) => m.time === slot);
              return (
                <button
                  key={slot}
                  disabled={isBooked}
                  className={`px-4 py-3 rounded-lg border transition-colors ${
                    isBooked
                      ? "border-border bg-muted text-muted-foreground cursor-not-allowed"
                      : "border-border hover:border-primary hover:bg-primary/5"
                  }`}
                >
                  {slot}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="w-96 border-l border-border bg-background p-6 space-y-6 overflow-y-auto">
        <div>
          <h3 className="mb-4">Upcoming Meetings</h3>
          <div className="space-y-3">
            {upcomingMeetings.map((meeting) => (
              <div key={meeting.id} className="p-4 border border-border rounded-lg hover:bg-accent/50 transition-colors">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center flex-shrink-0">
                    {meeting.avatar}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{meeting.name}</p>
                    <p className="text-sm text-muted-foreground truncate">{meeting.company}</p>
                    <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="w-4 h-4" />
                        {meeting.time}
                      </span>
                      <span>{meeting.date}</span>
                    </div>
                  </div>
                  <button className="p-2 hover:bg-accent rounded-lg transition-colors flex-shrink-0">
                    <Video className="w-5 h-5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
