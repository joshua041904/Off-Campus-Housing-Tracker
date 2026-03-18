module.exports = { apps: [{ name: 'api-gateway', script: 'dist/server.js', instances: 'max', exec_mode: 'cluster' }] }
