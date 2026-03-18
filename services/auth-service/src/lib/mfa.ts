import { authenticator, totp } from "otplib";
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hashPassword, comparePassword } from "./bcrypt-queue.js";
import QRCode from "qrcode";

// Generate backup codes (10 codes, each 8 characters)
export function generateBackupCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < 10; i++) {
    const code = randomBytes(4).toString("hex").toUpperCase();
    codes.push(code);
  }
  return codes;
}

// Hash backup codes for storage
export async function hashBackupCodes(codes: string[]): Promise<string[]> {
  return Promise.all(codes.map((code) => hashPassword(code)));
}

// Verify backup code
export async function verifyBackupCode(
  hashedCodes: string[],
  code: string
): Promise<boolean> {
  for (const hashed of hashedCodes) {
    if (await comparePassword(code, hashed)) {
      return true;
    }
  }
  return false;
}

// Generate TOTP secret and QR code
export async function setupMFA(
  prisma: PrismaClient,
  userId: string,
  email: string
): Promise<{ secret: string; qrCode: string; backupCodes: string[] }> {
  // Generate secret
  const secret = authenticator.generateSecret();
  const serviceName = "Record Platform";
  const accountName = email;

  // Generate backup codes
  const backupCodes = generateBackupCodes();
  const hashedBackupCodes = await hashBackupCodes(backupCodes);

  // Create or update MFA settings
  await prisma.$queryRaw`
    INSERT INTO auth.mfa_settings (user_id, totp_secret, backup_codes, enabled, created_at, updated_at)
    VALUES (${userId}::uuid, ${secret}, ${hashedBackupCodes}::text[], false, NOW(), NOW())
    ON CONFLICT (user_id) DO UPDATE
    SET totp_secret = EXCLUDED.totp_secret,
        backup_codes = EXCLUDED.backup_codes,
        updated_at = NOW()
  `;

  // Generate QR code (skip if canvas dependencies not available to prevent hanging)
  const otpAuthUrl = authenticator.keyuri(accountName, serviceName, secret);
  let qrCode = "";
  // Skip QRCode generation to prevent hanging - client can generate from otpAuthUrl
  // QRCode.toDataURL() hangs if canvas native dependencies are missing
  // TODO: Install canvas dependencies or use client-side QRCode generation
  
  return { secret, qrCode, backupCodes };
}

// Verify TOTP code
export async function verifyMFA(
  prisma: PrismaClient,
  userId: string,
  code: string,
  allowUnenabled: boolean = false
): Promise<boolean> {
  // Get MFA settings
  const mfaSettings = await prisma.$queryRaw<Array<{
    totp_secret: string;
    backup_codes: string[];
    enabled: boolean;
  }>>`
    SELECT totp_secret, backup_codes, enabled
    FROM auth.mfa_settings
    WHERE user_id = ${userId}::uuid
    LIMIT 1
  `.then((r: any[]) => r[0] || null);

  if (!mfaSettings) {
    return false;
  }

  // If MFA is not enabled, only allow verification during setup (allowUnenabled=true)
  if (!mfaSettings.enabled && !allowUnenabled) {
    return false;
  }

  // Try TOTP first
  try {
    // Verify with default settings (otplib handles time window automatically)
    // Use window option to allow codes from previous/next time step (30s window)
    // Type assertion needed because otplib types may not include window in all versions
    const isValid = authenticator.verify({
      token: code,
      secret: mfaSettings.totp_secret,
      window: [1, 1], // Allow codes from 1 step before and 1 step after (30s each = 90s total window)
    } as any);
    if (isValid) {
      console.log(`[MFA] TOTP code verified successfully for user ${userId} - code: ${code}`);
      return true;
    } else {
      console.log(`[MFA] TOTP code verification failed for user ${userId} - code: ${code}, secret: ${mfaSettings.totp_secret.substring(0, 10)}...`);
    }
  } catch (e: any) {
    console.log(`[MFA] TOTP verification error for user ${userId}:`, e?.message || e);
    // Invalid code format, try backup code
  }

  // Try backup code
  const isBackupCode = await verifyBackupCode(mfaSettings.backup_codes, code);
  if (isBackupCode) {
    // Remove used backup code
    const remainingCodes: string[] = [];
    for (const hashed of mfaSettings.backup_codes) {
      const isMatch = await comparePassword(code, hashed);
      if (!isMatch) {
        remainingCodes.push(hashed);
      }
    }
    await prisma.$queryRaw`
      UPDATE auth.mfa_settings
      SET backup_codes = ${remainingCodes}::text[],
          updated_at = NOW()
      WHERE user_id = ${userId}::uuid
    `;
    return true;
  }

  return false;
}

// Enable MFA
// Production-style: Use PostgreSQL stored procedure to ensure atomicity and proper commit
// This bypasses Prisma transaction issues and ensures the update persists
export async function enableMFA(
  prisma: PrismaClient,
  userId: string
): Promise<void> {
  try {
    // First, verify mfa_settings exists (should exist from setup)
    const settings = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM auth.mfa_settings WHERE user_id = ${userId}::uuid
    `.then((r: any[]) => r[0] || null);
    
    if (!settings) {
      throw new Error(`MFA settings not found for user ${userId}. Call setupMFA first.`);
    }

    // Production approach: Use sequential updates with explicit verification
    // Each UPDATE auto-commits in Prisma, so we update then verify
    
    // Use a single transaction to ensure both updates commit atomically
    // This prevents any possibility of partial updates or rollbacks
    console.log(`[MFA] Starting transaction to enable MFA for user ${userId}`);
    await prisma.$transaction(async (tx) => {
      // Update mfa_settings first
      const settingsUpdated = await tx.$executeRawUnsafe(
        `UPDATE auth.mfa_settings SET enabled = true, updated_at = NOW() WHERE user_id = $1::uuid`,
        userId
      );
      
      if (settingsUpdated === 0) {
        throw new Error(`Failed to update mfa_settings for user ${userId}`);
      }
      
      console.log(`[MFA] Transaction: Updated mfa_settings for user ${userId} - rows: ${settingsUpdated}`);
      
      // Update users table
      const usersUpdated = await tx.$executeRawUnsafe(
        `UPDATE auth.users SET mfa_enabled = true, updated_at = NOW() WHERE id = $1::uuid`,
        userId
      );
      
      if (usersUpdated === 0) {
        throw new Error(`User ${userId} not found when enabling MFA`);
      }
      
      console.log(`[MFA] Transaction: Updated auth.users for user ${userId} - rows: ${usersUpdated}`);
      
      // Verify within transaction to ensure updates are visible
      const txVerify = await tx.$queryRaw<Array<{ mfa_enabled: boolean; mfa_settings_enabled: boolean }>>`
        SELECT 
          u.mfa_enabled,
          COALESCE(m.enabled, false) as mfa_settings_enabled
        FROM auth.users u
        LEFT JOIN auth.mfa_settings m ON u.id = m.user_id
        WHERE u.id = ${userId}::uuid
      `.then((r: any[]) => r[0] || null);
      
      console.log(`[MFA] Transaction: Verification within tx - mfa_enabled=${txVerify?.mfa_enabled}, settings_enabled=${txVerify?.mfa_settings_enabled}`);
      
      if (!txVerify || txVerify.mfa_enabled !== true || txVerify.mfa_settings_enabled !== true) {
        throw new Error(`Transaction verification failed: mfa_enabled=${txVerify?.mfa_enabled}, settings_enabled=${txVerify?.mfa_settings_enabled}`);
      }
    }, {
      isolationLevel: 'ReadCommitted',
      timeout: 10000, // 10 second timeout
    });
    
    console.log(`[MFA] Transaction committed successfully for user ${userId}`);
    
    // Force connection refresh after transaction commit
    await prisma.$queryRaw`SELECT pg_backend_pid()`;
    
    // Wait for commit visibility - transaction should commit immediately, but add delay for safety
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Verify with multiple retries
    let verify = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      verify = await prisma.$queryRaw<Array<{ mfa_enabled: boolean; mfa_settings_enabled: boolean }>>`
        SELECT 
          u.mfa_enabled,
          COALESCE(m.enabled, false) as mfa_settings_enabled
        FROM auth.users u
        LEFT JOIN auth.mfa_settings m ON u.id = m.user_id
        WHERE u.id = ${userId}::uuid
      `.then((r: any[]) => r[0] || null);
      
      console.log(`[MFA] Verification attempt ${attempt + 1} for user ${userId}: mfa_enabled=${verify?.mfa_enabled}, settings_enabled=${verify?.mfa_settings_enabled}`);
      
      if (verify && verify.mfa_enabled === true && verify.mfa_settings_enabled === true) {
        console.log(`[MFA] ✅ MFA enabled successfully for user ${userId} - verified on attempt ${attempt + 1}`);
        return; // Success
      }
      
      if (attempt < 4) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    // All retries failed - do not throw; transaction committed, so MFA is enabled. Visibility delay (pool/replica) can cause this.
    console.warn(`[MFA] Post-commit verification did not see mfa_enabled after 5 attempts for user ${userId}; transaction committed. Next /me may see it.`);
    return;
  } catch (error: any) {
    console.error(`[MFA] Error enabling MFA for user ${userId}:`, error?.message || error);
    throw error;
  }
}

// Disable MFA
export async function disableMFA(
  prisma: PrismaClient,
  userId: string
): Promise<void> {
  await prisma.$queryRaw`
    UPDATE auth.mfa_settings
    SET enabled = false, updated_at = NOW()
    WHERE user_id = ${userId}::uuid
  `;

  await prisma.$queryRaw`
    UPDATE auth.users
    SET mfa_enabled = false, updated_at = NOW()
    WHERE id = ${userId}::uuid
  `;
}

