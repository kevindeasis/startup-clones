import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  async rewrites() {
    return [{ source: "/demo-page", destination: "/demo-page.html" }];
  },
};

export default config;
