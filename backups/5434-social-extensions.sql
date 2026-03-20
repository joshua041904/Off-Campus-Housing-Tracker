-- Extensions for messaging DB (from 5434-social). Run once after CREATE DATABASE messaging.
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- plpgsql is built-in
