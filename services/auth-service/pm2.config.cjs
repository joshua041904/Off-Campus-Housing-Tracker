module.exports = { apps: [{ name: 'auth-service', script: 'dist/server.js', instances: 'max', exec_mode: 'cluster', env: { NODE_ENV: 'production' } }] }
