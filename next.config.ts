import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // F-07 fix: Do not ignore build errors — type safety is a release gate.
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: true,
};

export default nextConfig;
