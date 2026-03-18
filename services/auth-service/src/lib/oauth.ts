import { PrismaClient } from "@prisma/client";
import { signJwt, type JwtPayload } from "@common/utils/auth";
import { randomUUID } from "node:crypto";

export interface OAuthProfile {
  id: string;
  email: string;
  name?: string;
  picture?: string;
  [key: string]: any;
}

export async function findOrCreateOAuthUser(
  prisma: PrismaClient,
  provider: string,
  profile: OAuthProfile
): Promise<{ userId: string; email: string; isNewUser: boolean }> {
  // Check if OAuth account already exists
  const existingOAuth = await prisma.$queryRaw<Array<{
    user_id: string;
    email: string;
  }>>`
    SELECT user_id, u.email
    FROM auth.oauth_providers o
    JOIN auth.users u ON u.id = o.user_id
    WHERE o.provider = ${provider} AND o.provider_user_id = ${profile.id}
    LIMIT 1
  `.then((r: any[]) => r[0] || null);

  if (existingOAuth) {
    return {
      userId: existingOAuth.user_id,
      email: existingOAuth.email,
      isNewUser: false,
    };
  }

  // Check if user with this email exists
  const existingUser = await prisma.$queryRaw<Array<{
    id: string;
    email: string;
  }>>`
    SELECT id, email
    FROM auth.users
    WHERE email = ${profile.email}
    LIMIT 1
  `.then((r: any[]) => r[0] || null);

  let userId: string;
  let isNewUser = false;

  if (existingUser) {
    // Link OAuth to existing user
    userId = existingUser.id;
  } else {
    // Create new user
    const newUser = await prisma.$queryRaw<Array<{
      id: string;
      email: string;
    }>>`
      INSERT INTO auth.users (email, email_verified, created_at)
      VALUES (${profile.email}, true, NOW())
      RETURNING id, email
    `.then((r: any[]) => r[0]);
    userId = newUser.id;
    isNewUser = true;
  }

  // Create OAuth provider record
  await prisma.$queryRaw`
    INSERT INTO auth.oauth_providers (user_id, provider, provider_user_id, email, profile_data, created_at, updated_at)
    VALUES (
      ${userId}::uuid,
      ${provider},
      ${profile.id},
      ${profile.email},
      ${JSON.stringify(profile)}::jsonb,
      NOW(),
      NOW()
    )
    ON CONFLICT (provider, provider_user_id) DO UPDATE
    SET email = EXCLUDED.email,
        profile_data = EXCLUDED.profile_data,
        updated_at = NOW()
  `;

  return { userId, email: profile.email, isNewUser };
}

export function generateOAuthToken(userId: string, email: string): string {
  const jti = randomUUID();
  const payload: JwtPayload & { jti: string } = {
    sub: userId,
    email,
    jti,
  };
  return signJwt(payload);
}

