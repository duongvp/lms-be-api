export type TeamsCalendarEventType = 'created' | 'updated' | 'cancelled' | 'deleted';

export type TeamsNotificationActor = {
  userId?: number | null;
  username?: string | null;
};

export type TeamsWebhookDestination = {
  name: string;
  url: string;
  token?: string;
};

export type CalendarChangeItem = {
  label: string;
  before: string;
  after: string;
};

export type CalendarNotificationPayload = {
  eventType: TeamsCalendarEventType;
  calendarId: number | null;
  before: Record<string, any> | null;
  after: Record<string, any> | null;
  actor: TeamsNotificationActor | null;
  changedAt: string;
  changes: CalendarChangeItem[];
};

export type TeamsStudentSyncSummaryPayload = {
  type: 'student_sync_summary';
  completedAt: string;
  registeredAt: string;
  calendars: number;
  programs: number;
  inserted: number;
  skipped: number;
  failed: number;
  errors: Array<{ code: string; message: string }> ;
};

export type TeamsNotificationPayload = CalendarNotificationPayload | TeamsStudentSyncSummaryPayload;
