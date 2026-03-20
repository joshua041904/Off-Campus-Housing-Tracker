-- Extensions for auth DB (from 5437-auth). Run once after CREATE DATABASE auth.
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- plpgsql is built-in
