"use client";

import { useEffect } from "react";

/**
 * Starts the page's dealt moments (public/assets/moments, from the taste kit):
 * every [data-moment] inside the page. Mounted per page so client-side
 * navigation starts the new page's moments and stops the old one's.
 */
interface MomentsModule {
  mountAll: (root: ParentNode) => Promise<unknown>;
  unmountAll: (root: ParentNode) => void;
}

export function Moments() {
  useEffect(() => {
    const w = window as unknown as { __momentsManual?: boolean };
    w.__momentsManual = true;
    let mod: MomentsModule | null = null;
    let gone = false;
    const root = document.querySelector("main") ?? document.body;
    const url = "/assets/moments/moments.js";
    import(/* webpackIgnore: true */ /* @vite-ignore */ url)
      .then((m: MomentsModule) => {
        if (gone) return;
        mod = m;
        void m.mountAll(root);
      })
      .catch(() => {
        // without the module every moment shows as written
        document.querySelectorAll("[data-moment]").forEach((el) => el.classList.add("mo-safe"));
      });
    return () => {
      gone = true;
      mod?.unmountAll(root);
    };
  }, []);
  return null;
}
