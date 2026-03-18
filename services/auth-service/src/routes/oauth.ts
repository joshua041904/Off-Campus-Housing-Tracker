import { Router, type Request, type Response } from "express";
import passport from "passport";
import { Strategy as GoogleStrategy, type Profile } from "passport-google-oauth20";
import { PrismaClient } from "../../prisma/generated/client";
import { findOrCreateOAuthUser, generateOAuthToken } from "../lib/oauth";

// Extend Express Request to include user property
declare global {
  namespace Express {
    interface User {
      userId: string;
      email: string;
      isNewUser: boolean;
    }
  }
}

export function setupOAuthRoutes(prisma: PrismaClient): Router {
  const router = Router();

  const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
  const GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL || "http://localhost:4001/auth/google/callback";
  const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3001";

  // Configure Google OAuth strategy
  if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: GOOGLE_CLIENT_ID,
          clientSecret: GOOGLE_CLIENT_SECRET,
          callbackURL: GOOGLE_CALLBACK_URL,
        },
        async (accessToken: string, refreshToken: string, profile: Profile, done: (error: any, user?: any) => void) => {
          try {
            const oauthProfile = {
              id: profile.id,
              email: profile.emails?.[0]?.value || "",
              name: profile.displayName,
              picture: profile.photos?.[0]?.value,
              ...profile._json,
            };

            const result = await findOrCreateOAuthUser(prisma, "google", oauthProfile);
            done(null, result);
          } catch (error: any) {
            done(error, null);
          }
        }
      )
    );
  } else {
    console.warn("Google OAuth credentials not configured, Google sign-in disabled");
  }

  // Initialize passport session
  router.use(passport.initialize());

  // Initiate Google OAuth
  router.get(
    "/google",
    passport.authenticate("google", {
      scope: ["profile", "email"],
      session: false,
    })
  );

  // Google OAuth callback
  router.get(
    "/google/callback",
    passport.authenticate("google", { session: false, failureRedirect: `${FRONTEND_URL}/login?error=oauth_failed` }),
    async (req: Request & { user?: Express.User }, res: Response) => {
      try {
        if (!req.user) {
          return res.redirect(`${FRONTEND_URL}/login?error=oauth_no_user`);
        }
        const result = req.user;
        const token = generateOAuthToken(result.userId, result.email);

        // Redirect to frontend with token
        res.redirect(`${FRONTEND_URL}/auth/callback?token=${token}&newUser=${result.isNewUser}`);
      } catch (error: any) {
        console.error("OAuth callback error:", error);
        res.redirect(`${FRONTEND_URL}/login?error=oauth_error`);
      }
    }
  );

  return router;
}

