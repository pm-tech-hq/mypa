/** The share card for every page: the headline beside a sketch of the board, in the app's look. */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

export const alt = "myPA: a personal assistant that runs on your own computer. Free for Windows.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const font = (w: number) => readFile(join(process.cwd(), `assets/fonts/poppins-latin-${w}-normal.woff`));

const ACCENT = "#234be9";
const BORDER = "#e3e3e3";

function Widget({ title, rows, w, h }: { title: string; rows: (string | [string, boolean])[]; w: number; h: number }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: w,
        height: h,
        background: "#fff",
        border: `1px solid ${BORDER}`,
        borderRadius: 16,
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", padding: "12px 16px", borderBottom: `1px solid ${BORDER}`, fontSize: 16, fontWeight: 600 }}>
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", padding: "8px 16px", gap: 10, fontSize: 15, color: "#333" }}>
        {rows.map((r) => {
          const [text, done] = typeof r === "string" ? [r, false] : r;
          return (
            <div key={text} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div
                style={{
                  display: "flex",
                  width: 16,
                  height: 16,
                  borderRadius: 5,
                  border: `2px solid ${done ? ACCENT : "#c9c9c9"}`,
                  background: done ? ACCENT : "transparent",
                }}
              />
              <span style={{ color: done ? "#aaa" : "#222", textDecoration: done ? "line-through" : "none" }}>{text}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default async function Image() {
  const [w500, w600] = await Promise.all([font(500), font(600)]);
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          background: "#f2f2f2",
          fontFamily: "Poppins",
          padding: "64px 0 64px 72px",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: 560 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 30, fontWeight: 600 }}>
            <div
              style={{
                display: "flex",
                width: 44,
                height: 44,
                borderRadius: 11,
                background: "#000",
                padding: 8,
                gap: 4,
              }}
            >
              <div style={{ display: "flex", width: 11, height: 28, background: "#fff", borderRadius: 3 }} />
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ display: "flex", width: 14, height: 12, background: "#fff", borderRadius: 3 }} />
                <div style={{ display: "flex", width: 14, height: 12, background: "#fff", borderRadius: 3 }} />
              </div>
            </div>
            myPA
          </div>
          <div style={{ display: "flex", fontSize: 60, fontWeight: 500, lineHeight: 1.06, letterSpacing: -2.4 }}>
            A personal assistant that runs on your own computer
          </div>
          <div style={{ display: "flex", fontSize: 24, color: "#555", fontWeight: 500 }}>
            Free for Windows 10 and 11 · my-pa.xyz
          </div>
        </div>
        <div
          style={{
            display: "flex",
            marginLeft: 56,
            marginTop: 8,
            padding: 20,
            gap: 16,
            background: "#ececec",
            border: `1px solid ${BORDER}`,
            borderRadius: 24,
            width: 620,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Widget title="Daily Briefing" rows={["Three meetings today", "Two tasks due", "Rent is due Friday"]} w={260} h={190} />
            <Widget title="Calendar" rows={["9:30  Team stand-up", "12:00  Lunch", "15:30  Dentist"]} w={260} h={260} />
          </div>
          <Widget
            title="To-do"
            rows={[["Send the Q4 budget", true], ["Book the dentist", true], "Revise chapter 4", "Renew car insurance", "Call the garage"]}
            w={300}
            h={466}
          />
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Poppins", data: w500, weight: 500, style: "normal" },
        { name: "Poppins", data: w600, weight: 600, style: "normal" },
      ],
    },
  );
}
