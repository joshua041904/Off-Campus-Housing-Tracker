import { PrismaClient } from "@prisma/client";
import { randomInt } from "node:crypto";
import { hashPassword, comparePassword } from "./bcrypt-queue.js";
import nodemailer from "nodemailer";
import { createSmsProvider, type SmsProvider } from "./sms-providers";

// Generate 6-digit verification code
function generateCode(): string {
  return randomInt(100000, 999999).toString();
}

// Hash verification code
async function hashCode(code: string): Promise<string> {
  return hashPassword(code);
}

// Verify code
async function verifyCode(hashed: string, code: string): Promise<boolean> {
  return comparePassword(code, hashed);
}

// Email transporter (configure via environment variables)
function getEmailTransporter() {
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = parseInt(process.env.SMTP_PORT || "587");
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASSWORD;

  // If SMTP_HOST is not set, email verification is disabled
  if (!smtpHost) {
    console.warn("SMTP_HOST not configured, email verification disabled");
    return null;
  }

  // MailHog and some other mock SMTP servers don't require authentication
  // Only require auth if both USER and PASSWORD are provided
  const transportConfig: any = {
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
  };

  // Only add auth if both user and password are provided
  if (smtpUser && smtpPass) {
    transportConfig.auth = {
      user: smtpUser,
      pass: smtpPass,
    };
  } else {
    console.log(`SMTP configured without authentication (e.g., MailHog at ${smtpHost}:${smtpPort})`);
  }

  return nodemailer.createTransport(transportConfig);
}

// SMS provider (supports multiple providers with fallback)
let smsProvider: SmsProvider | null = null;
function getSmsProvider(): SmsProvider | null {
  if (!smsProvider) {
    smsProvider = createSmsProvider();
  }
  return smsProvider;
}

// Send email verification code
export async function sendEmailVerificationCode(
  prisma: PrismaClient,
  userId: string | null,
  email: string
): Promise<{ success: boolean; message?: string }> {
  const code = generateCode();
  const hashedCode = await hashCode(code);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

  // Store code in database
  if (userId) {
    await prisma.$queryRaw`
      INSERT INTO auth.verification_codes (user_id, type, target, code, expires_at, created_at)
      VALUES (
        ${userId}::uuid,
        'email',
        ${email},
        ${hashedCode},
        ${expiresAt}::timestamptz,
        NOW()
      )
    `;
  } else {
    await prisma.$queryRaw`
      INSERT INTO auth.verification_codes (user_id, type, target, code, expires_at, created_at)
      VALUES (
        NULL,
        'email',
        ${email},
        ${hashedCode},
        ${expiresAt}::timestamptz,
        NOW()
      )
    `;
  }

  // Send email
  const transporter = getEmailTransporter();
  if (!transporter) {
    return { success: false, message: "Email service not configured" };
  }

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: email,
      subject: "Record Platform - Email Verification Code",
      html: `
        <h2>Email Verification</h2>
        <p>Your verification code is: <strong>${code}</strong></p>
        <p>This code will expire in 15 minutes.</p>
        <p>If you didn't request this code, please ignore this email.</p>
      `,
    });
    return { success: true };
  } catch (error: any) {
    console.error("Failed to send email:", error);
    return { success: false, message: error.message };
  }
}

// Send SMS verification code
export async function sendSmsVerificationCode(
  prisma: PrismaClient,
  userId: string | null,
  phone: string
): Promise<{ success: boolean; message?: string }> {
  const code = generateCode();
  const hashedCode = await hashCode(code);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

  // Store code in database
  if (userId) {
    await prisma.$queryRaw`
      INSERT INTO auth.verification_codes (user_id, type, target, code, expires_at, created_at)
      VALUES (
        ${userId}::uuid,
        'phone',
        ${phone},
        ${hashedCode},
        ${expiresAt}::timestamptz,
        NOW()
      )
    `;
  } else {
    await prisma.$queryRaw`
      INSERT INTO auth.verification_codes (user_id, type, target, code, expires_at, created_at)
      VALUES (
        NULL,
        'phone',
        ${phone},
        ${hashedCode},
        ${expiresAt}::timestamptz,
        NOW()
      )
    `;
  }

  // Send SMS using provider abstraction
  const provider = getSmsProvider();
  if (!provider) {
    return { success: false, message: "SMS service not configured" };
  }

  const message = `Your Record Platform verification code is: ${code}. This code expires in 15 minutes.`;
  const result = await provider.sendSms(phone, message);
  
  if (!result.success) {
    console.error(`[SMS] Failed to send SMS via ${provider.getName()}:`, result.error);
    return { success: false, message: result.error || "Failed to send SMS" };
  }
  
  console.log(`[SMS] Verification code sent to ${phone} via ${provider.getName()} (ID: ${result.messageId})`);
  return { success: true };
}

// Verify code
export async function verifyVerificationCode(
  prisma: PrismaClient,
  type: "email" | "phone",
  target: string,
  code: string
): Promise<{ success: boolean; userId?: string; message?: string }> {
  // Find valid code
  const verification = await prisma.$queryRaw<Array<{
    id: string;
    user_id: string | null;
    code: string;
    expires_at: Date;
    used: boolean;
  }>>`
    SELECT id, user_id, code, expires_at, used
    FROM auth.verification_codes
    WHERE type = ${type}
      AND target = ${target}
      AND expires_at > NOW()
      AND used = false
    ORDER BY created_at DESC
    LIMIT 1
  `.then((r: any[]) => r[0] || null);

  if (!verification) {
    return { success: false, message: "Invalid or expired code" };
  }

  // Verify code
  const isValid = await verifyCode(verification.code, code);
  if (!isValid) {
    return { success: false, message: "Invalid code" };
  }

  // Mark as used
  await prisma.$queryRaw`
    UPDATE auth.verification_codes
    SET used = true
    WHERE id = ${verification.id}::uuid
  `;

  // Update user verification status
  if (verification.user_id) {
    if (type === "email") {
      await prisma.$queryRaw`
        UPDATE auth.users
        SET email_verified = true, updated_at = NOW()
        WHERE id = ${verification.user_id}::uuid
      `;
    } else {
      await prisma.$queryRaw`
        UPDATE auth.users
        SET phone_verified = true, updated_at = NOW()
        WHERE id = ${verification.user_id}::uuid
      `;
    }
  }

  return { success: true, userId: verification.user_id || undefined };
}

