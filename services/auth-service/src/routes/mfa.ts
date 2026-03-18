import { Router, type Request, type Response } from "express";
import { PrismaClient } from "../../prisma/generated/client";
import { setupMFA, verifyMFA, enableMFA, disableMFA } from "../lib/mfa";
import { verifyJwt, type JwtPayload } from "@common/utils/auth";

export function setupMFARoutes(prisma: PrismaClient): Router {
  const router = Router();

  // Middleware to extract user from JWT
  function requireAuth(req: Request, res: Response, next: () => void) {
    const auth = req.headers.authorization?.split(" ")[1];
    if (!auth) {
      return res.status(401).json({ error: "Authentication required" });
    }
    try {
      const payload = verifyJwt(auth) as JwtPayload;
      (req as any).user = payload;
      next();
    } catch {
      return res.status(401).json({ error: "Invalid token" });
    }
  }

  // Setup MFA (generate secret and QR code)
  router.post("/setup", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user.sub;
      const email = (req as any).user.email;

      const result = await setupMFA(prisma, userId, email);
      res.json({
        secret: result.secret,
        qrCode: result.qrCode || "",
        backupCodes: result.backupCodes,
      });
    } catch (error: any) {
      console.error("MFA setup error:", error);
      res.status(500).json({ error: "Failed to setup MFA" });
    }
  });

  // Verify MFA code and enable
  router.post("/verify", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user.sub;
      const { code } = req.body;

      if (!code) {
        return res.status(400).json({ error: "Code required" });
      }

      // First verify the code (allow verification even if MFA not enabled yet - this is the setup verification)
      const isValid = await verifyMFA(prisma, userId, code, true);
      if (!isValid) {
        return res.status(401).json({ error: "Invalid code" });
      }

      // Enable MFA
      await enableMFA(prisma, userId);
      res.json({ success: true, message: "MFA enabled" });
    } catch (error: any) {
      console.error("MFA verify error:", error);
      res.status(500).json({ error: "Failed to verify MFA" });
    }
  });

  // Disable MFA (code optional when MFA is not enabled — e.g. test flow where verify/enable failed)
  router.post("/disable", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user.sub;
      const { code } = req.body;

      const userMfa = await prisma.$queryRaw<Array<{ mfa_enabled: boolean }>>`
        SELECT mfa_enabled FROM auth.users WHERE id = ${userId}::uuid LIMIT 1
      `.then((r: any[]) => r[0] || null);

      if (userMfa?.mfa_enabled) {
        if (code) {
          const isValid = await verifyMFA(prisma, userId, code);
          if (!isValid) {
            return res.status(401).json({ error: "Invalid code" });
          }
        } else {
          return res.status(400).json({ error: "Code required to disable MFA" });
        }
      }
      // If MFA not enabled, no code required (idempotent disable)

      await disableMFA(prisma, userId);
      res.json({ success: true, message: "MFA disabled" });
    } catch (error: any) {
      console.error("MFA disable error:", error);
      res.status(500).json({ error: "Failed to disable MFA" });
    }
  });

  // Verify MFA code during login
  router.post("/verify-login", async (req: Request, res: Response) => {
    try {
      const { userId, code } = req.body;

      if (!userId || !code) {
        return res.status(400).json({ error: "userId and code required" });
      }

      const isValid = await verifyMFA(prisma, userId, code);
      if (!isValid) {
        return res.status(401).json({ error: "Invalid code" });
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error("MFA verify login error:", error);
      res.status(500).json({ error: "Failed to verify MFA" });
    }
  });

  return router;
}

