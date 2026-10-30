// pm2 process file for the API on the server (used by deploy/deploy.sh).
//   pm2 status | pm2 logs wholesale-api | pm2 monit
// Cluster mode: API_INSTANCES copies of the API share port 5000 (default 2 = one per vCPU of a t3.micro / t3.small).
// The scheduler and email worker run in every copy; that's safe (they claim work with row locks).
const path = require("path");

module.exports = {
  apps: [
    {
      name: "wholesale-api",
      cwd: path.join(__dirname, "..", "Backend"),
      script: "src/server.js",
      exec_mode: "cluster",
      instances: Number(process.env.API_INSTANCES) || 2,
      max_memory_restart: "450M",
      kill_timeout: 10000, // let requests in progress finish on reload
      listen_timeout: 20000,
      time: true, // timestamps in pm2 logs
      env: { NODE_ENV: "production" },
    },
  ],
};
