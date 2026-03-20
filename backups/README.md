# Backups and restore

## Auth DB: legacy dump (5437 → 5441)

The file **`5437-auth.dump`** is a pg_dump custom-format dump of the auth database from the old port **5437**. The housing stack uses **port 5441** for auth. Place the dump in `backups/` (plain **5437-auth.dump**, or **5437-auth.dump.gz** / **5437-auth.dump.zip**; restore script decompresses on the fly).

**Important:** For extensions, use **`backups/5437-auth-extensions.sql`** (the `.sql` file), not the **`.tsv`** file. The `.tsv` files are data exports and will cause `psql` syntax errors.

1. Start the auth Postgres container:
   ```bash
   docker compose up -d postgres-auth
   ```
2. Restore into `localhost:5441` / database `auth` (from repo root, password `postgres`):
   ```bash
   PGPASSWORD=postgres ./scripts/restore-5437-to-5441-auth.sh
   ```
   That script: drops/creates DB `auth`, runs `backups/5437-auth-extensions.sql`, then `pg_restore` on `backups/5437-auth.dump`, then `ANALYZE`.
   Or legacy scripts:
   ```bash
   PGPASSWORD=postgres ./scripts/restore-auth-db.sh
   ```
   Custom path:
   ```bash
   RESTORE_AUTH_DUMP=backups/5437-auth.dump PGPASSWORD=postgres ./scripts/restore-auth-db.sh
   ```

## Auth schema (after restore)

The auth database uses schema **`auth`**. Main tables (see `services/auth-service/prisma/schema.prisma`):

| Table                  | Purpose |
|------------------------|--------|
| `auth.users`           | Users: email, password_hash, mfa_enabled, email_verified, phone_verified, etc. |
| `auth.oauth_providers` | OAuth provider links (provider, provider_user_id) |
| `auth.mfa_settings`    | TOTP secret, backup codes (MFA disabled in login flow but schema remains) |
| `auth.verification_codes` | Email/phone verification codes |
| `auth.passkeys`        | WebAuthn passkey credentials |
| `auth.passkey_challenges` | Temporary passkey challenges |

Login currently uses only **email + password** (no MFA step); the rest of the schema is present for future use or compatibility.

## Messaging DB: restore from 5434-social (forum + messages)

The **messaging** service uses the same DB as the former social service (forum + messages schemas). To rebuild the messaging DB from the legacy 5434-social dump into housing port **5444**:

**Important:** Use the **`.sql`** extension files only. Do **not** run the **`.tsv`** files with `psql` — they are tab-separated data (e.g. `pg_settings` export), not SQL, and will cause syntax errors.

1. Start the messaging Postgres container: `docker compose up -d postgres-messaging`
2. Restore (from repo root, password `postgres`):
   ```bash
   PGPASSWORD=postgres ./scripts/restore-5434-to-5444-messaging.sh
   ```
   That script: drops/creates DB `messaging` on 5444, runs `backups/5434-social-extensions.sql`, then `pg_restore` on `backups/5434-social.dump`, then `ANALYZE`. **Skip** `5434-social-pg_settings.tsv` — it is not executable SQL; system-level settings belong to the Postgres container, not the DB restore.
3. Optional: to add the `messaging.*` schema (conversations, outbox) for integration tests:
   ```bash
   PGPASSWORD=postgres ./scripts/ensure-messaging-schema.sh
   ```

## Full 8-DB backup and restore

- **Backup all 8 housing DBs** (5441–5448):  
  `PGPASSWORD=postgres ./scripts/backup-all-dbs.sh`  
  Output: `backups/all-8-YYYYMMDD-HHMMSS/` with `5441-auth.dump`, … `5448-media.dump`.

- **Restore after bring-up**:  
  `RESTORE_BACKUP_DIR=backups/all-8-<timestamp> ./scripts/bring-up-external-infra.sh`  
  or `RESTORE_BACKUP_DIR=latest` to use the newest `backups/all-8-*` (or `all-7-*`) directory.

- **Restore a single DB manually** (e.g. auth):  
  `pg_restore -h 127.0.0.1 -p 5441 -U postgres -d auth --clean --if-exists -j 4 backups/all-8-<timestamp>/5441-auth.dump`
