import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["jsdom", "rss-parser", "unpdf"],
};

export default nextConfig;
