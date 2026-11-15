import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "myPA",
    short_name: "myPA",
    description: "A free Windows app for your tasks, calendar, email and notes, with an AI assistant on your own PC.",
    start_url: "/",
    display: "browser",
    background_color: "#f2f2f2",
    theme_color: "#f2f2f2",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
