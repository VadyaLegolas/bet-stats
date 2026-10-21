import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Next dev blocks requests whose Origin host differs from the initialization hostname
  // (localhost by default): opening the app via 127.0.0.1 would 403 all dev chunks/HMR.
  // Allow both local hosts so either URL works for users and tooling alike.
  allowedDevOrigins: ["127.0.0.1"],
  // Next 16 refuses a second `next dev` per dist directory (exclusive lockfile),
  // so E2E/CI stacks point NEXT_DIST_DIR at their own directory and never
  // contend with — or kill — the developer's running server on `.next`.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
};

export default nextConfig;
