/**
 * Live pieces of myPA's widgets for the feature tiles. Each runs one CSS loop
 * that shows the widget doing its whole job (the planner placing tasks, a
 * captured thought becoming a reminder, a card flipping), and rests on its
 * finished frame under reduced motion. Styles: site.css, "widget visuals".
 */
import { Bell, Check, Fingerprint, Lock, LockOpen, Sparkles, Video } from "lucide-react";

const HOURS = ["9:00", "10:00", "11:00", "12:00", "13:00", "14:00"];

export function PlannerVisual() {
  return (
    <div className="frag frag--planner" aria-hidden>
      <div className="pl__side">
        <p className="pl__label">To fit in today</p>
        <ul className="pl__todo">
          <li className="pl__t pl__t--1">Q4 budget</li>
          <li className="pl__t pl__t--2">Reply to the school</li>
          <li className="pl__t pl__t--3">Book the MOT</li>
        </ul>
        <span className="pl__btn">
          <Sparkles size={14} />
          Plan my day
        </span>
      </div>
      <div className="pl__day">
        {HOURS.map((h) => (
          <span key={h} className="pl__hour">
            {h}
          </span>
        ))}
        <span className="pl__blk pl__blk--meet" style={{ top: "0%", height: "16.66%" }}>
          <Video size={13} />
          Team stand-up
        </span>
        <span className="pl__blk pl__blk--plan pl__blk--1" style={{ top: "16.66%", height: "33.33%" }}>
          Q4 budget
          <small>Focus · 2 h</small>
        </span>
        <span className="pl__blk pl__blk--plan pl__blk--2" style={{ top: "50%", height: "16.66%" }}>
          Reply to the school
        </span>
        <span className="pl__blk pl__blk--meet" style={{ top: "66.66%", height: "16.66%" }}>
          <Video size={13} />
          Lunch with the design team
        </span>
        <span className="pl__blk pl__blk--plan pl__blk--3" style={{ top: "83.33%", height: "16.66%" }}>
          Book the MOT
        </span>
      </div>
    </div>
  );
}

export function CaptureVisual() {
  return (
    <div className="frag frag--capture" aria-hidden>
      <div className="cap__keys">
        <kbd>Ctrl</kbd>
        <kbd>Shift</kbd>
        <kbd>Space</kbd>
      </div>
      <div className="cap__bar">
        <span className="cap__typed">call the garage tomorrow at 10</span>
        <span className="cap__caret" />
        <kbd className="cap__enter">Enter</kbd>
      </div>
      <ul className="cap__list">
        <li className="cap__new">
          <Bell size={14} />
          <span>
            Call the garage
            <small>Tomorrow, 10:00</small>
          </span>
        </li>
        <li>
          <Bell size={14} />
          <span>
            Pay the council tax
            <small>Friday, 9:00</small>
          </span>
        </li>
        <li>
          <Bell size={14} />
          <span>
            Mum&rsquo;s birthday card
            <small>Sunday</small>
          </span>
        </li>
      </ul>
    </div>
  );
}

export function FlashcardsVisual() {
  return (
    <div className="frag frag--cards" aria-hidden>
      <div className="fc__deck">
        <span className="fc__under" />
        <div className="fc__card">
          <div className="fc__face fc__face--front">
            <small>Biology · 12 of 30</small>
            <p>Which gas do plants take in to make sugar?</p>
          </div>
          <div className="fc__face fc__face--back">
            <small>Answer</small>
            <p>Carbon dioxide</p>
          </div>
        </div>
      </div>
      <div className="fc__rate">
        <span>Again</span>
        <span className="fc__good">Good</span>
        <span>Easy</span>
      </div>
      <p className="fc__next">
        <Check size={14} />
        Back in 3 days
      </p>
    </div>
  );
}

const SPEND = [
  { name: "Groceries", v: 186, w: "62%", c: "a" },
  { name: "Bills", v: 152, w: "51%", c: "b" },
  { name: "Transport", v: 74, w: "25%", c: "c" },
];

export function ExpensesVisual() {
  return (
    <div className="frag frag--money" aria-hidden>
      <div className="ex__top">
        <span className="muted">November</span>
        <span className="num ex__total">
          <b>£412</b> of £600
        </span>
      </div>
      <div className="ex__bar">
        <span />
      </div>
      <ul className="ex__rows num">
        {SPEND.map((s, i) => (
          <li key={s.name} style={{ "--d": `${i * 120}ms` } as React.CSSProperties}>
            <span className="ex__name">{s.name}</span>
            <span className="ex__track">
              <i className={`ex__fill ex__fill--${s.c}`} style={{ width: s.w }} />
            </span>
            <span className="ex__v">£{s.v}</span>
          </li>
        ))}
      </ul>
      <p className="ex__left">£188 left for 15 days</p>
    </div>
  );
}

export function JournalVisual() {
  return (
    <div className="frag frag--journal" aria-hidden>
      <div className="jr__page">
        <small>Sunday 15 November</small>
        <p className="jr__h">A slow morning, finally</p>
        <i className="jr__line" />
        <i className="jr__line" />
        <i className="jr__line jr__line--short" />
        <i className="jr__line" />
        <i className="jr__line jr__line--mid" />
        <div className="jr__foot">
          <span className="jr__mood">Calm</span>
          <small>214 words</small>
        </div>
      </div>
      <div className="jr__lockscreen">
        <span className="jr__lock">
          <Lock size={18} className="jr__icon jr__icon--shut" />
          <LockOpen size={18} className="jr__icon jr__icon--open" />
        </span>
        <p className="jr__title">Journal is locked</p>
        <div className="jr__dots">
          <i />
          <i />
          <i />
          <i />
        </div>
        <span className="jr__hello">
          <Fingerprint size={15} />
          Use Windows Hello
        </span>
      </div>
    </div>
  );
}
