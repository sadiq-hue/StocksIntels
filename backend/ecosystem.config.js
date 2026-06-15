// PM2 Ecosystem File — Start with: pm2 start ecosystem.config.js
// Stop with: pm2 stop ecosystem.config.js
module.exports = {
  apps: [{
    name: 'stocksintels-api',
    script: 'index.js',
    cwd: __dirname,
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 3001,
      LOG_REQUESTS: '1',
    },
    env_development: {
      NODE_ENV: 'development',
      PORT: 3001,
      LOG_REQUESTS: '1',
    },
    // Restart if memory exceeds 800MB
    max_memory_restart: '800M',
    // Log configuration
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    merge_logs: true,
    // Watch for file changes in development only
    watch: false,
    // Restart delay
    restart_delay: 3000,
    max_restarts: 10,
    // Graceful shutdown
    kill_timeout: 10000,
    listen_timeout: 5000,
    // Health check
    instance_var: 'NODE_APP_INSTANCE',
    // Auto-restart on crash
    autorestart: true,
  }],
};
