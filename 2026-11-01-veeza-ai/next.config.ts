import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native / font-file-reading packages must stay external to the server bundle.
  serverExternalPackages: ["pdf-parse", "pdfkit", "@libsql/client", "libsql", "pdfjs-dist"],
};

export default nextConfig;
