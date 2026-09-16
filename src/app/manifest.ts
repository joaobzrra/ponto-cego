import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/brand";

/**
 * PWA manifest — installable web app (the 80/20 of "we should have an app"
 * until the core justifies a native build). Monochromatic rule holds here
 * too: charcoal canvas, no decorative color.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND.name,
    short_name: BRAND.name,
    description: BRAND.tagline,
    start_url: "/",
    display: "standalone",
    background_color: "#1c1917",
    theme_color: "#1c1917",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
