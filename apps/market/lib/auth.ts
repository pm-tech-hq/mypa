import "server-only";

import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

import { sql } from "./db";

/** GitHub logins allowed into /admin (comma separated). */
function admins(): string[] {
  return (process.env.ADMIN_GITHUB_LOGINS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function authConfigured(): boolean {
  return Boolean(process.env.AUTH_SECRET && process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET);
}

interface GitHubProfile {
  id: number | string;
  login: string;
  name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [GitHub],
  session: { strategy: "jwt" },
  trustHost: true,
  pages: { signIn: "/signin" },
  callbacks: {
    async jwt({ token, profile }) {
      // First sign-in: record the user and keep our own id on the token.
      if (profile) {
        const gh = profile as unknown as GitHubProfile;
        const rows = await sql()`
          INSERT INTO users (github_id, login, name, email, avatar_url)
          VALUES (${String(gh.id)}, ${gh.login}, ${gh.name ?? null}, ${gh.email ?? null}, ${gh.avatar_url ?? null})
          ON CONFLICT (github_id) DO UPDATE
            SET login = EXCLUDED.login, name = EXCLUDED.name,
                email = COALESCE(EXCLUDED.email, users.email), avatar_url = EXCLUDED.avatar_url
          RETURNING id`;
        token.userId = String(rows[0]!.id);
        token.login = gh.login;
      }
      return token;
    },
    session({ session, token }) {
      const login = String(token.login ?? "");
      session.user.id = String(token.userId ?? "");
      session.user.login = login;
      session.user.isAdmin = admins().includes(login.toLowerCase());
      return session;
    },
  },
});

export interface Viewer {
  id: string;
  login: string;
  name: string | null;
  image: string | null;
  isAdmin: boolean;
}

/** The signed-in user, or null (also null when sign-in isn't configured). */
export async function viewer(): Promise<Viewer | null> {
  if (!authConfigured()) return null;
  const session = await auth();
  if (!session?.user?.id) return null;
  return {
    id: session.user.id,
    login: session.user.login,
    name: session.user.name ?? null,
    image: session.user.image ?? null,
    isAdmin: session.user.isAdmin,
  };
}
