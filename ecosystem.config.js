// PM2 process manager config for production VPS deployment
// Usage: pm2 start ecosystem.config.js
// Reload:  pm2 reload all
// Logs:    pm2 logs

const env = {
  NODE_ENV: "production",
  // All secrets come from .env file loaded via --env-file flag
};

module.exports = {
  apps: [
    {
      name: "gateway",
      cwd: "apps/gateway",
      script: "../../node_modules/.bin/nest",
      args: "start",
      interpreter: "none",
      env,
      max_memory_restart: "512M",
      restart_delay: 3000,
    },
    {
      name: "crm-service",
      cwd: "apps/crm-service",
      script: "../../node_modules/.bin/nest",
      args: "start",
      interpreter: "none",
      env,
      max_memory_restart: "512M",
      restart_delay: 3000,
    },
    {
      name: "calls-service",
      cwd: "apps/calls-service",
      script: "../../node_modules/.bin/nest",
      args: "start",
      interpreter: "none",
      env,
      max_memory_restart: "512M",
      restart_delay: 3000,
    },
    {
      name: "prompt-service",
      cwd: "apps/prompt-service",
      script: "../../node_modules/.bin/nest",
      args: "start",
      interpreter: "none",
      env,
      max_memory_restart: "256M",
      restart_delay: 3000,
    },
    {
      name: "tts-service",
      cwd: "apps/tts-service",
      script: "../../node_modules/.bin/tsx",
      args: "src/index.ts",
      interpreter: "none",
      env,
      max_memory_restart: "256M",
      restart_delay: 3000,
    },
    {
      name: "voicebot",
      cwd: "apps/voicebot",
      script: "../../node_modules/.bin/tsx",
      args: "src/index.ts",
      interpreter: "none",
      env,
      max_memory_restart: "512M",
      restart_delay: 5000,
    },
    {
      name: "analytics-worker",
      cwd: "apps/analytics-worker",
      script: "../../node_modules/.bin/tsx",
      args: "src/main.ts",
      interpreter: "none",
      env,
      max_memory_restart: "256M",
      restart_delay: 3000,
    },
    {
      name: "web",
      cwd: "apps/web",
      script: "node_modules/.bin/next",
      args: "start -p 3000",
      interpreter: "none",
      env: { ...env, PORT: "3000" },
      max_memory_restart: "512M",
      restart_delay: 3000,
    },
  ],
};
