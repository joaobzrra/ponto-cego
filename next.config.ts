import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // No framework fingerprint in responses (security audit 2026-09-04).
  poweredByHeader: false,
  // sharp and pg are used by server code only; keep them external to the bundle
  serverExternalPackages: ["sharp", "pg", "@node-rs/argon2", "undici"],
  // Dev servers set NEXT_DIST_DIR so they never touch the .next directory a
  // running production `next start` (the soak admin) is serving from.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  async headers() {
    const contentSecurityPolicy = [
      "default-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline'",
      "connect-src 'self'",
      "upgrade-insecure-requests",
    ].join("; ");
    return [
      {
        // middleware.ts excludes /admin from its matcher, so its robots header
        // never reaches the panel; robots.txt alone is advisory.
        source: "/admin/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }],
      },
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
    ];
  },
  async redirects() {
    return [
      // Consolidated into /sobre (was a runtime redirect page); 308 preserves
      // any link equity once the site is indexable.
      { source: "/metodologia", destination: "/sobre", permanent: true },
      // /topicos retired 2026-07-18: its cluster cards became the front page
      // (Final-Wireframe). Kept forever for old shares.
      { source: "/topicos", destination: "/", permanent: true },
    ];
  },
};

export default nextConfig;
