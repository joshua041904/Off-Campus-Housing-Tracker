import { Router, type Request, type Response } from "express";
import { PrismaClient } from "../../prisma/generated/client";
import {
  sendEmailVerificationCode,
  sendSmsVerificationCode,
  verifyVerificationCode,
} from "../lib/verification";
import { verifyJwt, type JwtPayload } from "@common/utils/auth";

export function setupVerificationRoutes(prisma: PrismaClient): Router {
  const router = Router();

  // Middleware to extract user from JWT (optional for some routes)
  function optionalAuth(req: Request, res: Response, next: () => void) {
    const auth = req.headers.authorization?.split(" ")[1];
    if (auth) {
      try {
        const payload = verifyJwt(auth) as JwtPayload;
        (req as any).user = payload;
      } catch {
        // Invalid token, continue without user
      }
    }
    next();
  }

  // Send email verification code
  router.post("/email/send", optionalAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.sub || null;
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({ error: "Email required" });
      }

      const result = await sendEmailVerificationCode(prisma, userId, email);
      if (!result.success) {
        // If service is not configured, return 503 instead of 500
      if (result.message?.includes("not configured") || result.message?.includes("SMTP")) {
        return res.status(503).json({
          error: "Email service not configured", 
          message: "SMTP_HOST is required. Configure SMTP_HOST (and optionally SMTP_USER/SMTP_PASSWORD for authenticated SMTP servers)." 
        });
      }
        return res.status(500).json({ error: result.message || "Failed to send verification code" });
      }

      res.json({ success: true, message: "Verification code sent" });
    } catch (error: any) {
      console.error("Send email verification error:", error);
      // Check if it's a service configuration error
      if (error.message?.includes("not configured") || error.message?.includes("SMTP")) {
        return res.status(503).json({
          error: "Email service not configured", 
          message: "SMTP_HOST is required. Configure SMTP_HOST (and optionally SMTP_USER/SMTP_PASSWORD for authenticated SMTP servers)." 
        });
      }
      res.status(500).json({ error: "Failed to send verification code" });
    }
  });

  // Verify email code
  router.post("/email/verify", async (req: Request, res: Response) => {
    try {
      const { email, code } = req.body;

      if (!email || !code) {
        return res.status(400).json({ error: "Email and code required" });
      }

      const result = await verifyVerificationCode(prisma, "email", email, code);
      if (!result.success) {
        return res.status(400).json({ error: result.message || "Invalid code" });
      }

      res.json({ success: true, userId: result.userId });
    } catch (error: any) {
      console.error("Verify email error:", error);
      res.status(500).json({ error: "Failed to verify code" });
    }
  });

  // Send SMS verification code
  router.post("/phone/send", optionalAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.sub || null;
      const { phone } = req.body;

      if (!phone) {
        return res.status(400).json({ error: "Phone number required" });
      }

      const result = await sendSmsVerificationCode(prisma, userId, phone);
      if (!result.success) {
        // If service is not configured, return 503 instead of 500
        if (result.message?.includes("not configured") || result.message?.includes("SMS service")) {
          return res.status(503).json({ 
            error: "SMS service not configured", 
            message: "SMS provider credentials are required. Configure one of: TWILIO_*, AWS_*, VONAGE_*, MESSAGEBIRD_*, or set SMS_USE_MOCK=true for development." 
          });
        }
        return res.status(500).json({ error: result.message || "Failed to send verification code" });
      }

      res.json({ success: true, message: "Verification code sent" });
    } catch (error: any) {
      console.error("Send SMS verification error:", error);
      // Check if it's a service configuration error
      if (error.message?.includes("not configured") || error.message?.includes("SMS service")) {
        return res.status(503).json({ 
          error: "SMS service not configured", 
          message: "SMS provider credentials are required. Configure one of: TWILIO_*, AWS_*, VONAGE_*, MESSAGEBIRD_*, or set SMS_USE_MOCK=true for development." 
        });
      }
      res.status(500).json({ error: "Failed to send verification code" });
    }
  });

  // Verify phone code
  router.post("/phone/verify", async (req: Request, res: Response) => {
    try {
      const { phone, code } = req.body;

      if (!phone || !code) {
        return res.status(400).json({ error: "Phone and code required" });
      }

      const result = await verifyVerificationCode(prisma, "phone", phone, code);
      if (!result.success) {
        return res.status(400).json({ error: result.message || "Invalid code" });
      }

      res.json({ success: true, userId: result.userId });
    } catch (error: any) {
      console.error("Verify phone error:", error);
      res.status(500).json({ error: "Failed to verify code" });
    }
  });

  return router;
}

