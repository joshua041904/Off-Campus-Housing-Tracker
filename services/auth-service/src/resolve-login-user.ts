import type { PrismaClient } from "../prisma/generated/client/index.js";

export type LoginUserRow = {
  id: string;
  email: string;
  passwordHash: string;
  mfaEnabled: boolean;
  emailVerified: boolean;
  phoneVerified: boolean;
  createdAt: Date;
  username: string | null;
};

/** Active account, or merged alias email that authenticates and resolves to canonical user id. */
export async function resolveLoginUserByEmail(
  prisma: PrismaClient,
  email: string,
): Promise<LoginUserRow | null> {
  const activeRows = await prisma.$queryRaw<LoginUserRow[]>`
    SELECT id, email, password_hash as "passwordHash", mfa_enabled as "mfaEnabled",
           email_verified as "emailVerified", phone_verified as "phoneVerified", created_at as "createdAt",
           COALESCE(NULLIF(TRIM(username::text), ''), NULLIF(TRIM(display_username::text), '')) AS username
    FROM auth.users
    WHERE email = ${email} AND COALESCE(is_deleted, false) = false
  `;
  if (activeRows[0]) return activeRows[0];

  const aliasRows = await prisma.$queryRaw<
    Array<LoginUserRow & { mergedInto: string | null }>
  >`
    SELECT id, email, password_hash as "passwordHash", mfa_enabled as "mfaEnabled",
           email_verified as "emailVerified", phone_verified as "phoneVerified", created_at as "createdAt",
           COALESCE(NULLIF(TRIM(username::text), ''), NULLIF(TRIM(display_username::text), '')) AS username,
           NULLIF(TRIM(settings->>'merged_into'), '') AS "mergedInto"
    FROM auth.users
    WHERE email = ${email}
      AND COALESCE(is_deleted, false) = true
      AND COALESCE(NULLIF(TRIM(settings->>'merged_into'), ''), '') <> ''
  `;
  const alias = aliasRows[0];
  if (!alias?.mergedInto) return null;

  const canonicalRows = await prisma.$queryRaw<LoginUserRow[]>`
    SELECT id, email, password_hash as "passwordHash", mfa_enabled as "mfaEnabled",
           email_verified as "emailVerified", phone_verified as "phoneVerified", created_at as "createdAt",
           COALESCE(NULLIF(TRIM(username::text), ''), NULLIF(TRIM(display_username::text), '')) AS username
    FROM auth.users
    WHERE id = ${alias.mergedInto}::uuid AND COALESCE(is_deleted, false) = false
  `;
  const canonical = canonicalRows[0];
  if (!canonical) return null;

  return {
    ...canonical,
    passwordHash: alias.passwordHash,
  };
}
