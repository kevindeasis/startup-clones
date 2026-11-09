import type { NextConfig } from 'next';

const config: NextConfig = {
  serverExternalPackages: ['unpdf'],
  // The SQLite files live in ./data; without this, every DB write triggers a dev-server
  // recompile that can transiently 500 in-flight requests.
  webpack: (cfg) => {
    cfg.watchOptions = { ...cfg.watchOptions, ignored: ['**/node_modules/**', '**/.next/**', '**/data/**'] };
    return cfg;
  },
};
export default config;
