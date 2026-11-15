/**
 * myPA itself, drawn as live HTML in the app's own chrome (same tokens as the
 * desktop app): the board in the hero, the Assistant over an inbox below it.
 * Presentational only; each window is one image to assistive tech.
 */
import {
  Archive,
  BookOpen,
  Briefcase,
  CalendarDays,
  Check,
  Inbox,
  ListTodo,
  Plus,
  Settings,
  Sparkles,
  Sunrise,
  Undo2,
  Video,
  Wallet,
  X,
} from "lucide-react";

import { BrandMark } from "../BrandMark";

function Chrome({ page, icon }: { page: string; icon: React.ReactNode }) {
  return (
    <div className="win__bar">
      <span className="win__brand">
        <BrandMark size={16} />
        myPA
      </span>
      <span className="win__sep">/</span>
      <span className="win__crumb">
        {icon}
        {page}
      </span>
      <span className="win__grow" />
      <span className="win__ghost">
        <Sparkles size={13} />
        Assistant
      </span>
      <span className="win__add">
        <Plus size={13} />
        Add widget
      </span>
    </div>
  );
}

function WidgetHead({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="wd__head">
      {icon}
      <span className="wd__title">{title}</span>
      <Settings size={12} className="wd__tool" />
      <X size={12} className="wd__tool" />
    </div>
  );
}

export function BoardWindow() {
  return (
    <div
      className="win win--board"
      role="img"
      aria-label="The myPA board with the Daily Briefing, To-do and Calendar widgets"
    >
      <Chrome page="Home" icon={<Sparkles size={13} />} />
      <div className="win__body">
        <div className="win__side" aria-hidden>
          <span className="win__page is-on">
            <Sparkles size={15} />
          </span>
          <span className="win__page">
            <Briefcase size={15} />
          </span>
          <span className="win__page">
            <BookOpen size={15} />
          </span>
          <span className="win__page">
            <Wallet size={15} />
          </span>
        </div>
        <div className="win__board">
          <div className="wd wd--brief">
            <WidgetHead icon={<Sunrise size={13} />} title="Daily Briefing" />
            <div className="wd__body">
              <p className="br__day">Monday, 16 November</p>
              <p className="br__hello">Good morning</p>
              <ul className="br__list">
                <li>
                  <CalendarDays size={13} />
                  Three meetings today, the first at 9:30
                </li>
                <li>
                  <ListTodo size={13} />
                  Two tasks due, one of them late
                </li>
                <li>
                  <Wallet size={13} />
                  Rent is due on Friday
                </li>
              </ul>
            </div>
          </div>

          <div className="wd wd--todo">
            <WidgetHead icon={<ListTodo size={13} />} title="To-do" />
            <div className="wd__body">
              <div className="td__tabs">
                <span className="is-on">Tasks</span>
                <span>Goals</span>
              </div>
              <p className="td__group">
                Today <span className="muted">2 left</span>
              </p>
              <ul className="td__list">
                <li className="is-done">
                  <span className="td__box">
                    <Check size={10} strokeWidth={3} />
                  </span>
                  Send the Q4 budget
                </li>
                <li className="td__loop">
                  <span className="td__box">
                    <Check size={10} strokeWidth={3} />
                  </span>
                  Book the dentist
                  <span className="td__due td__due--late">Late</span>
                </li>
                <li>
                  <span className="td__box" />
                  Revise chapter 4<span className="td__due">Today</span>
                </li>
                <li>
                  <span className="td__box" />
                  Renew car insurance<span className="td__due">Fri</span>
                </li>
              </ul>
              <p className="td__group td__group--closed">
                Backlog <span className="muted">6 left</span>
              </p>
            </div>
          </div>

          <div className="wd wd--cal">
            <WidgetHead icon={<CalendarDays size={13} />} title="Calendar" />
            <div className="wd__body">
              <ul className="cal__list">
                <li>
                  <span className="cal__t">9:30</span>
                  <span className="cal__bar cal__bar--a" />
                  <span>
                    Team stand-up
                    <span className="cal__join">
                      <Video size={11} />
                      Join
                    </span>
                  </span>
                </li>
                <li>
                  <span className="cal__t">12:00</span>
                  <span className="cal__bar cal__bar--b" />
                  <span>Lunch with the design team</span>
                </li>
                <li className="is-next">
                  <span className="cal__t">15:30</span>
                  <span className="cal__bar cal__bar--c" />
                  <span>Dentist</span>
                </li>
                <li>
                  <span className="cal__t">17:00</span>
                  <span className="cal__bar cal__bar--a" />
                  <span>Call with the bank</span>
                </li>
                <li>
                  <span className="cal__t">18:30</span>
                  <span className="cal__bar cal__bar--b" />
                  <span>Running club</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const MAIL: { from: string; subject: string; when: string; tag: string; picked?: boolean }[] = [
  { from: "Running club", subject: "Saturday's routes and times", when: "08:12", tag: "Newsletters", picked: true },
  { from: "Your bank", subject: "Your October statement is ready", when: "07:40", tag: "Receipts" },
  { from: "Finance team", subject: "Q4 budget: final numbers", when: "Mon", tag: "Work" },
  { from: "Recipe box", subject: "Five dinners for this week", when: "Mon", tag: "Newsletters", picked: true },
  { from: "School office", subject: "Parents' evening on 26 November", when: "Sun", tag: "Personal" },
  { from: "Bookshop", subject: "New this week in fiction", when: "Sun", tag: "Newsletters", picked: true },
  { from: "Landlord", subject: "Boiler check on Thursday", when: "Sat", tag: "Personal" },
  { from: "Airline", subject: "Your trip on 4 December", when: "Sat", tag: "Receipts" },
  { from: "Local paper", subject: "The week in your town", when: "Fri", tag: "Newsletters", picked: true },
  { from: "Design team", subject: "Feedback on the new layout", when: "Fri", tag: "Work" },
];

export function AssistantFrame() {
  return (
    <div
      className="win win--app"
      role="img"
      aria-label="The Assistant beside the inbox: asked to archive this week's newsletters, it lists four and waits for approval"
    >
      <Chrome page="Work" icon={<Briefcase size={13} />} />
      <div className="app">
        <div className="app__list">
          <div className="mail__head">
            <Inbox size={14} />
            <span className="wd__title">Inbox</span>
            <span className="mail__count">4 unread</span>
          </div>
          <ul className="mail">
            {MAIL.map((m) => (
              <li key={m.subject} className={m.picked ? "is-picked" : undefined}>
                <span className="mail__from">{m.from}</span>
                <span className="mail__when">{m.when}</span>
                <span className="mail__sub">{m.subject}</span>
                <span className={`mail__tag mail__tag--${m.tag.toLowerCase()}`}>{m.tag}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="app__open">
          <div className="chat__head">
            <Sparkles size={14} />
            <span className="wd__title">Assistant</span>
            <span className="chat__model">Built-in · Qwen 2.5 1.5B</span>
          </div>
          <div className="chat">
            <p className="chat__me">Archive this week&rsquo;s newsletters</p>
            <p className="chat__tool">
              <Check size={12} />
              Searched the inbox: 4 newsletters since Monday
            </p>
            <div className="chat__ai">
              <p>
                I found 4 newsletters from this week. I&rsquo;ll move them to Archive, so you can still
                find them later.
              </p>
              <ul className="chat__picks">
                <li>Running club · Saturday&rsquo;s routes and times</li>
                <li>Recipe box · Five dinners for this week</li>
                <li>Bookshop · New this week in fiction</li>
                <li>Local paper · The week in your town</li>
              </ul>
              <div className="chat__actions">
                <span className="chat__go">
                  <Archive size={13} />
                  Archive 4 emails
                </span>
                <span className="chat__no">Not now</span>
              </div>
              <p className="chat__done">
                <Check size={12} />
                Done. 4 emails archived.
                <span className="chat__undo">
                  <Undo2 size={12} />
                  Undo
                </span>
              </p>
            </div>
          </div>
          <div className="chat__box">Ask myPA to plan, find or tidy something…</div>
        </div>
      </div>
    </div>
  );
}
