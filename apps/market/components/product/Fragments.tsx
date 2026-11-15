/**
 * Small live pieces of myPA's widgets for the feature tiles. Each runs one
 * short CSS loop (2.5 to 4 s) showing the widget doing its job, and rests on
 * its finished frame under reduced motion.
 */
import { Bell, Fingerprint, Lock, Sparkles, Video } from "lucide-react";

export function PlannerVisual() {
  const rows = ["9:00", "10:00", "11:00", "12:00"];
  return (
    <div className="frag frag--planner" aria-hidden>
      <div className="pl__top">
        <span className="pl__day">Today · Mon 16 Nov</span>
        <span className="pl__btn">
          <Sparkles size={12} />
          Plan my day
        </span>
      </div>
      <div className="pl__grid">
        {rows.map((r) => (
          <span key={r} className="pl__hour">
            {r}
          </span>
        ))}
        <span className="pl__blk pl__blk--meet" style={{ top: "12.5%", height: "12.5%" }}>
          <Video size={11} />
          Team stand-up
        </span>
        <span className="pl__blk pl__blk--plan pl__blk--1" style={{ top: "25%", height: "37.5%" }}>
          Q4 budget · focus time
        </span>
        <span className="pl__blk pl__blk--plan pl__blk--2" style={{ top: "62.5%", height: "12.5%" }}>
          Reply to the school
        </span>
        <span className="pl__blk pl__blk--meet" style={{ top: "75%", height: "25%" }}>
          <Video size={11} />
          Lunch with the design team
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
      <div className="cap__field">
        <span className="cap__typed">call the garage tomorrow at 10</span>
        <span className="cap__caret" />
      </div>
      <div className="cap__result">
        <Bell size={12} />
        Reminder · Tomorrow, 10:00
      </div>
    </div>
  );
}

export function FlashcardsVisual() {
  return (
    <div className="frag frag--cards" aria-hidden>
      <p className="fc__q">Which gas do plants take in to make sugar?</p>
      <ul className="fc__opts">
        <li>Oxygen</li>
        <li className="fc__right">Carbon dioxide</li>
        <li>Nitrogen</li>
      </ul>
      <p className="fc__next">Right. Back in 3 days.</p>
    </div>
  );
}

export function ExpensesVisual() {
  return (
    <div className="frag frag--money" aria-hidden>
      <div className="ex__top">
        <span>November</span>
        <span className="num">
          <b>412</b> of 600 spent
        </span>
      </div>
      <div className="ex__bar">
        <span />
      </div>
      <ul className="ex__rows num">
        <li>
          <i className="ex__dot ex__dot--a" />
          Groceries<span>186</span>
        </li>
        <li>
          <i className="ex__dot ex__dot--b" />
          Bills<span>152</span>
        </li>
        <li>
          <i className="ex__dot ex__dot--c" />
          Transport<span>74</span>
        </li>
      </ul>
    </div>
  );
}

export function JournalVisual() {
  return (
    <div className="frag frag--journal" aria-hidden>
      <span className="jr__lock">
        <Lock size={16} />
      </span>
      <p className="jr__title">Journal is locked</p>
      <div className="jr__dots">
        <i />
        <i />
        <i />
        <i />
      </div>
      <span className="jr__hello">
        <Fingerprint size={13} />
        Use Windows Hello
      </span>
    </div>
  );
}
