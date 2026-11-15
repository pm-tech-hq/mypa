import { Fragment } from "react";

/** A headline whose words rise out of their own masks on load (site.css, [data-enter] .p-h1). */
export function Rise({ text }: { text: string }) {
  const words = text.split(" ");
  return (
    <>
      {words.map((w, i) => (
        <Fragment key={i}>
          <span className="w">
            <span style={{ "--i": Math.min(i, 6) } as React.CSSProperties}>{w}</span>
          </span>
          {i < words.length - 1 ? " " : null}
        </Fragment>
      ))}
    </>
  );
}
