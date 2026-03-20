// Explicit Redis wiring for local Vitest runs.
if (!process.env.REDIS_HOST) process.env.REDIS_HOST = '127.0.0.1'
if (!process.env.REDIS_PORT) process.env.REDIS_PORT = '6380'
if (!process.env.REDIS_URL) process.env.REDIS_URL = 'redis://127.0.0.1:6380/0'
