/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("node:path");

const nextDistDir = process.env.NEXT_DIST_DIR || ".next";
const runtimeSecretKeys = [
  "SUPABASE_SECRET_KEY",
  "OPENROUTER_KEY",
  "ADMIN_USER",
  "ADMIN_PASS",
  "ADMIN_SESSION_SECRET",
  "RESEARCH_LAB_ALERT_DISCORD_WEBHOOK_URL",
  "RESEARCH_LAB_IMPROVEMENT_DISCORD_WEBHOOK_URL",
  "RESEARCH_LAB_ALERT_RESEND_API_KEY",
  "RESEARCH_LAB_ALERT_EMAIL_FROM",
  "RESEARCH_LAB_ALERT_EMAIL_TO",
  "RESEARCH_LAB_ALERT_EMAIL_REPLY_TO",
];

module.exports = {
  apps: [
    {
      name: "subnet-dashboard",
      cwd: __dirname,
      script: path.join(__dirname, "scripts/start-production.mjs"),
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
      // The launcher retrieves these after PM2 creates the worker. Excluding
      // them here prevents an older CLI-injected copy from surviving in PM2's
      // process metadata or its reboot snapshot.
      filter_env: runtimeSecretKeys,
      env: {
        NODE_ENV: "production",
        NODE_OPTIONS: "--max-old-space-size=512",
        NEXT_DIST_DIR: nextDistDir,
        AWS_REGION: "us-east-1",
        AWS_DEFAULT_REGION: "us-east-1",
        SUBNET_DASHBOARD_SECRET_ID: "leadpoet/prod/subnet-dashboard/env",
        RESEARCH_LAB_ALERT_MONITOR_ENABLED: "true",
        RESEARCH_LAB_ALERT_MONITOR_INTERVAL_MS: "60000",
        RESEARCH_LAB_ALERT_SIGNALS: "pcr0_mismatch,pcr0_missing,pcr0_stale,offchain_weight_bundle_missing,offchain_weight_bundle_stale,benchmark_failed,benchmark_stalled,active_run_stale,active_run_blocked,transparency_checkpoint_stale,maintenance_pause_overrun",
        OPS_MONITORED_VALIDATOR_HOTKEYS: "5FNVgRnrxMibhcBGEAaajGrYjsaCn441a5HuGUBUNnxEBLo9",
        RESEARCH_LAB_ALERT_DASHBOARD_URL: "https://subnet71.com/admin",
        RESEARCH_LAB_ALERT_MINIMUM_SEVERITY: "warning",
        RESEARCH_LAB_ALERT_TIMEOUT_MS: "10000",
        RESEARCH_LAB_ALERT_DISCORD_USERNAME: "Leadpoet Bug Watch",
        RESEARCH_LAB_EVENT_MONITOR_ENABLED: "true",
        RESEARCH_LAB_EVENT_MONITOR_INTERVAL_MS: "60000",
        RESEARCH_LAB_IMPROVEMENT_DISCORD_USERNAME: "Leadpoet Lab Watch",
        RESEARCH_LAB_IMPROVEMENT_ANALYSIS_TIMEOUT_MS: "600000",
      },
    },
  ],
};
