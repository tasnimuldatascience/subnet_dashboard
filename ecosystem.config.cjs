const path = require("node:path");

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
      max_memory_restart: "700M",
      listen_timeout: 30000,
      kill_timeout: 10000,
      merge_logs: true,
      env: {
        NODE_ENV: "production",
        NODE_OPTIONS: "--max-old-space-size=512",
      },
    },
  ],
};
