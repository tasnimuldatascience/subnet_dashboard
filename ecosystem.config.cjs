const path = require("node:path");

const nextDistDir = process.env.NEXT_DIST_DIR || ".next";

module.exports = {
  apps: [
    {
      name: "subnet-dashboard",
      cwd: __dirname,
      script: path.join(__dirname, "node_modules/next/dist/bin/next"),
      args: "start -p 3000",
      exec_mode: "cluster",
      instances: 1,
      autorestart: true,
      // The Next.js worker normally holds roughly 1 GB RSS after warming the
      // dashboard caches. The old 700 MB limit monitored only an `npm` wrapper;
      // after migrating PM2 to the real Next.js process it caused a restart loop.
      max_memory_restart: "1400M",
      listen_timeout: 30000,
      kill_timeout: 10000,
      merge_logs: true,
      env: {
        NODE_ENV: "production",
        NODE_OPTIONS: "--max-old-space-size=512",
        NEXT_DIST_DIR: nextDistDir,
      },
    },
  ],
};
