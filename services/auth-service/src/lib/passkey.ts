import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';

/**
 * Generate a random challenge for passkey registration/authentication
 */
export function generateChallenge(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Store a passkey challenge for verification
 */
export async function storeChallenge(
  prisma: PrismaClient,
  userId: string | null,
  challenge: string,
  type: 'registration' | 'authentication'
): Promise<string> {
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

  const result = await prisma.passkeyChallenge.create({
    data: {
      userId: userId || undefined,
      challenge,
      type,
      expiresAt,
    },
  });

  return result.id;
}

/**
 * Verify and consume a challenge
 */
export async function verifyChallenge(
  prisma: PrismaClient,
  challenge: string
): Promise<{ id: string; userId: string | null; type: string } | null> {
  const challengeRecord = await prisma.passkeyChallenge.findFirst({
    where: {
      challenge,
      expiresAt: {
        gt: new Date(),
      },
    },
  });

  if (!challengeRecord) {
    return null;
  }

  // Delete the challenge after verification (one-time use)
  await prisma.passkeyChallenge.delete({
    where: { id: challengeRecord.id },
  });

  return {
    id: challengeRecord.id,
    userId: challengeRecord.userId || null,
    type: challengeRecord.type,
  };
}

/**
 * Register a new passkey for a user
 */
export async function registerPasskey(
  prisma: PrismaClient,
  userId: string,
  credentialId: string,
  publicKey: string,
  deviceName?: string,
  deviceType?: 'platform' | 'cross-platform'
): Promise<void> {
  await prisma.passkey.create({
    data: {
      userId,
      credentialId,
      publicKey,
      deviceName: deviceName || 'Unknown Device',
      deviceType: deviceType || 'platform',
      counter: 0,
    },
  });
}

/**
 * Get all passkeys for a user
 */
export async function getUserPasskeys(
  prisma: PrismaClient,
  userId: string
): Promise<Array<{ id: string; deviceName: string | null; deviceType: string | null; lastUsedAt: Date | null; createdAt: Date }>> {
  const passkeys = await prisma.passkey.findMany({
    where: { userId },
    select: {
      id: true,
      deviceName: true,
      deviceType: true,
      lastUsedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  return passkeys;
}

/**
 * Get passkey by credential ID
 */
export async function getPasskeyByCredentialId(
  prisma: PrismaClient,
  credentialId: string
): Promise<{ id: string; userId: string; publicKey: string; counter: bigint } | null> {
  const passkey = await prisma.passkey.findUnique({
    where: { credentialId },
    select: {
      id: true,
      userId: true,
      publicKey: true,
      counter: true,
    },
  });

  return passkey;
}

/**
 * Update passkey counter and last used timestamp
 */
export async function updatePasskeyUsage(
  prisma: PrismaClient,
  credentialId: string,
  newCounter: bigint
): Promise<void> {
  await prisma.passkey.update({
    where: { credentialId },
    data: {
      counter: newCounter,
      lastUsedAt: new Date(),
    },
  });
}

/**
 * Delete a passkey
 */
export async function deletePasskey(
  prisma: PrismaClient,
  userId: string,
  passkeyId: string
): Promise<boolean> {
  const result = await prisma.passkey.deleteMany({
    where: {
      id: passkeyId,
      userId,
    },
  });

  return result.count > 0;
}

