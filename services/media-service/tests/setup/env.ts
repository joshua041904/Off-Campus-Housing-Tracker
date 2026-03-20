/**
 * Vitest setup: explicit Postgres for media integration tests (host Docker Postgres 5448).
 */
if (!process.env.PG_HOST) process.env.PG_HOST = '127.0.0.1'
if (!process.env.PG_PORT) process.env.PG_PORT = '5448'
if (!process.env.PG_DATABASE) process.env.PG_DATABASE = 'media'
if (!process.env.PG_USER) process.env.PG_USER = 'postgres'
if (!process.env.PG_PASSWORD) process.env.PG_PASSWORD = 'postgres'
// Align with PG* used in mediaRepo
if (!process.env.PGHOST) process.env.PGHOST = process.env.PG_HOST
