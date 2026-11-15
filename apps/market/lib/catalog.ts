/** The built-in widgets, as the desktop app ships them (apps/mypa widgetKinds and README). */
export interface BuiltIn {
  name: string;
  line: string;
}
export interface Area {
  id: string;
  title: string;
  line: string;
  widgets: BuiltIn[];
}

export const AREAS: Area[] = [
  {
    id: "work",
    title: "Work and the week ahead",
    line: "Your tasks, meetings and inboxes on one page, so the next thing to do is always in view.",
    widgets: [
      { name: "To-do list", line: "Today and backlog lists, goals with timelines, steps inside tasks and due dates that count down." },
      { name: "Daily Planner", line: "Lays your tasks into the free time between meetings. Approve the plan, or move blocks yourself." },
      { name: "Calendar", line: "Google, Zoho, iCloud, Fastmail and any CalDAV account together, plus read-only Outlook feeds. Join a call in one click." },
      { name: "Email", line: "Gmail, Zoho Mail and any IMAP inbox in one list. AI can sort, summarise and draft replies; sending is always yours." },
      { name: "Meetings", line: "Records a call, then gives you the transcript and the notes." },
      { name: "Project Tracker", line: "Projects on a board, with progress, health and the tasks behind them." },
      { name: "Daily Briefing", line: "Your day at a glance each morning: schedule, what needs you, and what comes next." },
      { name: "Reminders", line: "Alerts at the time you ask for, once or on repeat, such as every day at 9." },
    ],
  },
  {
    id: "study",
    title: "Study and learning",
    line: "Turn lectures, videos and pages into text, then learn from them in the same window.",
    widgets: [
      { name: "Transcribe", line: "Audio, video, a media link or a web page to searchable text. Whisper runs on your computer." },
      { name: "Tutor", line: "Explains your transcripts, quizzes you, and gives short spoken lessons in the style you pick." },
      { name: "Flashcards", line: "Cards from your notes, on a spaced-repetition schedule, with progress charts." },
      { name: "Study Planner", line: "Subjects, exam dates and study sessions that fit around your calendar." },
      { name: "Typing", line: "Practise typing on the text you are learning, and get faster at both." },
    ],
  },
  {
    id: "home",
    title: "Home and money",
    line: "The small jobs of the week, from the shopping to the budget.",
    widgets: [
      { name: "Shopping Lists", line: "Lists sorted by aisle, with the things you buy often one tap away." },
      { name: "Expenses", line: "Spending, budgets and monthly bills, month by month." },
      { name: "Timer & Stopwatch", line: "Countdown timers that ring wherever you are, and a stopwatch with laps." },
      { name: "Unit Converter", line: "Exact conversions for length, weight, cooking, temperature and more." },
      { name: "Calculator", line: "Exact sums with a tape you can reuse, plus percentages and scientific keys." },
    ],
  },
  {
    id: "you",
    title: "Notes and private pages",
    line: "Somewhere to think, and somewhere nobody else looks.",
    widgets: [
      { name: "Journal", line: "A private page for each day, with prompts and moods, locked with a passcode." },
      { name: "Note", line: "Markdown notes with checklists you can tick." },
      { name: "Quick Capture", line: "Press Ctrl+Shift+Space in any app, type a thought, and it lands in the right widget." },
      { name: "Personal Memory", line: "What the Assistant knows about you. Check it, fix it, hide it or delete it." },
    ],
  },
];

export const BUILT_IN_COUNT = AREAS.reduce((n, a) => n + a.widgets.length, 0);
