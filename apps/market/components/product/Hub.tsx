/**
 * A hub diagram: myPA in the middle, the services it connects to around it,
 * a pulse running along each line in turn. Real logos, in their own colours.
 */
import { BrandMark } from "../BrandMark";

const NODES = [
  { name: "Google Calendar", src: "/icons/google-calendar.svg" },
  { name: "Gmail", src: "/icons/gmail.svg" },
  { name: "Zoho", src: "/icons/zoho.svg", wide: true },
  { name: "iCloud", src: "/icons/icloud.svg" },
  { name: "Outlook", src: "/icons/outlook.svg" },
  { name: "OpenAI", src: "/icons/openai.svg" },
  { name: "Anthropic", src: "/icons/anthropic.svg" },
  { name: "Hugging Face", src: "/icons/hugging-face.svg" },
];

export function Hub() {
  const r = 41; // ring radius, % of the box
  const pts = NODES.map((n, i) => {
    const a = (i / NODES.length) * Math.PI * 2 - Math.PI / 2;
    return { ...n, x: 50 + r * Math.cos(a), y: 50 + r * Math.sin(a), i };
  });
  return (
    <div className="hub" role="img" aria-label={`myPA connects to ${NODES.map((n) => n.name).join(", ")}`}>
      <svg className="hub__lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        {pts.map((p) => (
          <g key={p.name}>
            <line x1="50" y1="50" x2={p.x} y2={p.y} className="hub__line" />
            <line
              x1="50"
              y1="50"
              x2={p.x}
              y2={p.y}
              className="hub__pulse"
              pathLength={100}
              style={{ animationDelay: `${p.i * 0.4}s` }}
            />
          </g>
        ))}
      </svg>
      <span className="hub__core" aria-hidden>
        <BrandMark size={44} />
      </span>
      {pts.map((p) => (
        <span
          key={p.name}
          className="hub__node"
          style={{ left: `${p.x}%`, top: `${p.y}%` }}
          title={p.name}
          aria-hidden
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.src} alt="" width={p.wide ? 40 : 26} height={26} />
        </span>
      ))}
    </div>
  );
}
