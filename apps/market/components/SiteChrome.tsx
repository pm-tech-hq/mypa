import Link from "next/link";

import { authConfigured, signIn, signOut, viewer } from "@/lib/auth";

import { BrandMark } from "./BrandMark";

export async function SiteHeader() {
  const me = await viewer();
  const canSignIn = authConfigured();
  return (
    <header className="site-head">
      <div className="wrap site-head__row">
        <Link href="/" className="brand" aria-label="myPA Marketplace home">
          <BrandMark size={26} />
          <span>
            myPA <span className="brand__sub">Marketplace</span>
          </span>
        </Link>
        <nav className="site-nav" aria-label="Main">
          <Link href="/#widgets">Widgets</Link>
          <Link href="/developers">Build a widget</Link>
          {me ? (
            <>
              {me.isAdmin && <Link href="/admin">Review</Link>}
              <Link href="/dashboard" className="keep">
                Dashboard
              </Link>
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/" });
                }}
              >
                <button type="submit" className="user-chip" title="Sign out">
                  {me.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={me.image} alt="" className="avatar" width={28} height={28} />
                  ) : null}
                  {me.login}
                </button>
              </form>
            </>
          ) : canSignIn ? (
            <form
              action={async () => {
                "use server";
                await signIn("github", { redirectTo: "/dashboard" });
              }}
            >
              <button type="submit" className="btn btn--sm">
                Sign in to publish
              </button>
            </form>
          ) : null}
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-foot">
      <div className="wrap site-foot__row">
        <span>
          Widgets for <strong>myPA</strong>, the board-based personal assistant.
        </span>
        <nav aria-label="Footer">
          <Link href="/#widgets">Widgets</Link>
          <Link href="/developers">Developers</Link>
          <Link href="/registry.json">Registry</Link>
        </nav>
      </div>
    </footer>
  );
}
