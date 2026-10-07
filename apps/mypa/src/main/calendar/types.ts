/** Common shape every provider (Google, Outlook, ICS) normalizes its events into. */
export interface NormalizedEvent {
  title: string;
  location: string;
  notes: string;
  start: number;
  end: number;
  allDay: boolean;
  htmlLink: string | null;
}
