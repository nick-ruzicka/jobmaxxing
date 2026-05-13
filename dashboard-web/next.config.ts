import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Root / → /today (the daily-agent surface). Done at the framework level so
  // the browser gets a real 308 with Location: /today instead of the
  // server-component fallback (meta-refresh / inline-rendered target page).
  // app/page.tsx still calls redirect("/today") as a belt-and-suspenders for
  // any path where this config isn't honored.
  async redirects() {
    return [
      { source: "/", destination: "/today", permanent: true },
    ];
  },
};

export default nextConfig;
