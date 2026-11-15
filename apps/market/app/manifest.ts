import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "myPA",
    short_name: "myPA",
    description: "A personal assistant that runs on your own computer. Free for Windows.",
    start_url: "/",
    display: "browser",
    background_color: "#f2f2f2",
    theme_color: "#f2f2f2",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
