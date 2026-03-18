# Backups and restore

## Auth DB: legacy dump (5437 → 5441)

The file **`5437-auth.dump`** is a pg_dump custom-format dump of the auth database from the old port **5437**. The housing stack uses **port 5441** for auth. Place the dump in `backups/` (plain **5437-auth.dump**, or **5437-auth.dump.gz** / **5437-auth.dump.zip**; restore script decompresses on the fly).

1. Start the auth Postgres container:
   ```bash
   docker compose up -d postgres-auth
   ```
2. Restore into `localhost:5441` / database `auth`:
   ```bash
   PGPASSWORD=postgres ./scripts/restore-auth-db.sh
   ```
   Or legacy script (plain .dump only):
   ```bash
   PGPASSWORD=postgres ./scripts/restore-auth-from-legacy-dump.sh
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

## Full 7-DB backup and restore

- **Backup all 7 housing DBs** (5441–5447):  
  `PGPASSWORD=postgres ./scripts/backup-all-dbs.sh`  
  Output: `backups/all-7-YYYYMMDD-HHMMSS/` with `5441-auth.dump`, `5442-listings.dump`, etc.

- **Restore after bring-up** (when `restore-external-postgres-from-backup.sh` is available):  
  `RESTORE_BACKUP_DIR=backups/all-7-<timestamp> ./scripts/bring-up-external-infra.sh`  
  or `RESTORE_BACKUP_DIR=latest` to use the newest `backups/all-7-*` directory.

- **Restore a single DB manually** (e.g. auth):  
  `pg_restore -h 127.0.0.1 -p 5441 -U postgres -d auth --clean --if-exists -j 4 backups/all-7-<timestamp>/5441-auth.dump`
