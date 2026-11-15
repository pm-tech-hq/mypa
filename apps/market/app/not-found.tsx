import Link from "next/link";

export default function NotFound() {
  return (
    <header className="page-head nf">
      <div className="wrap">
        <h1 className="p-h1">This page isn&rsquo;t on the board</h1>
        <p className="page-head__lead">
          The link may be old, or the page has moved. These are the places most people look for.
        </p>
        <div className="p-hero__ctas">
          <Link href="/" className="btn btn--primary btn--lg">
            Go to the home page
          </Link>
          <Link href="/download" className="btn btn--lg">
            Download myPA
          </Link>
          <Link href="/marketplace" className="btn btn--lg">
            Browse widgets
          </Link>
        </div>
      </div>
    </header>
  );
}
