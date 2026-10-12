import type { MetadataRoute } from "next";

// Lets phones install the site as an app ("Add to Home Screen"). Paths need
// the GitHub Pages subpath, which Next doesn't add inside the manifest.
const base = process.env.BASE_PATH || "";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: `${base}/`,
    name: "Prime Time Lineup Advisor",
    short_name: "PrimeTime",
    description: "Start/sit, waivers, trades and live scoring for your Sleeper fantasy football teams.",
    start_url: `${base}/`,
    scope: `${base}/`,
    display: "standalone",
    orientation: "portrait",
    background_color: "#070a24",
    theme_color: "#070a24",
    categories: ["sports", "utilities"],
    icons: [
      { src: `${base}/icons/icon-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `${base}/icons/icon-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: `${base}/icons/icon-maskable-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
