import { Router, type Request, type Response } from 'express';
import { verifyJwt } from '@common/utils/auth';
import {
  generateChallenge,
  storeChallenge,
  verifyChallenge,
  registerPasskey,
  getUserPasskeys,
  getPasskeyByCredentialId,
  updatePasskeyUsage,
  deletePasskey,
} from '../lib/passkey.js';
import { prisma } from '../lib/prisma.js'; // Use shared PrismaClient instance
// WebAuthn validation now uses @simplewebauthn/server directly

const router: Router = Router();

// Auth middleware helper
function requireAuth(req: Request, res: Response, next: () => void) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'auth required' });
  }
  try {
    (req as any).user = verifyJwt(token);
    next();
  } catch {
    return res.status(401).json({ error: 'invalid token' });
  }
}

// POST /passkeys/register/start - Begin passkey registration (requires auth)
router.post('/register/start', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.sub;
    const challenge = generateChallenge();

    await storeChallenge(prisma, userId, challenge, 'registration');

    // Return challenge and user info for WebAuthn API
    res.json({
      challenge,
      userId,
      rp: {
        name: 'Record Platform',
        id: process.env.WEBAUTHN_RP_ID || 'localhost',
      },
      user: {
        id: userId,
        name: (req as any).user.email,
        displayName: (req as any).user.email,
      },
    });
  } catch (err) {
    console.error('[auth] passkey register start error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /passkeys/register/finish - Complete passkey registration (requires auth)
router.post('/register/finish', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.sub;
    const { challenge, credentialId, publicKey, deviceName, deviceType } = req.body;

    if (!challenge || !credentialId || !publicKey) {
      return res.status(400).json({ error: 'challenge, credentialId, and publicKey required' });
    }

    // Verify challenge
    const challengeRecord = await verifyChallenge(prisma, challenge);
    if (!challengeRecord || challengeRecord.userId !== userId || challengeRecord.type !== 'registration') {
      return res.status(400).json({ error: 'Invalid or expired challenge' });
    }

    // Register the passkey with WebAuthn signature validation
    // If attestationObject is provided, validate it using @simplewebauthn/server; otherwise accept mock data for testing
    const { attestationObject, clientDataJSON } = req.body;
    
    if (attestationObject && clientDataJSON) {
      // Production: Validate WebAuthn signature using @simplewebauthn/server
      try {
        const { verifyRegistrationResponse } = await import('@simplewebauthn/server');
        const rpId = process.env.WEBAUTHN_RP_ID || process.env.WEB_APP_RP_ID || 'localhost';
        const origin = process.env.WEBAUTHN_ORIGIN || process.env.WEB_APP_ORIGIN || `https://${rpId}`;
        
        // Decode base64url strings if needed
        const credentialIdStr = typeof credentialId === 'string' ? credentialId : credentialId.toString('base64url');
        const clientDataJSONStr = typeof clientDataJSON === 'string' ? clientDataJSON : clientDataJSON.toString('base64url');
        const attestationObjectStr = typeof attestationObject === 'string' ? attestationObject : attestationObject.toString('base64url');
        
        // Verify the registration response
        const verification = await verifyRegistrationResponse({
          response: {
            id: credentialIdStr,
            rawId: credentialIdStr, // @simplewebauthn/server expects base64url string
            response: {
              clientDataJSON: clientDataJSONStr,
              attestationObject: attestationObjectStr,
            },
            type: 'public-key',
            clientExtensionResults: {}, // Required by @simplewebauthn/server
          },
          expectedChallenge: challenge,
          expectedOrigin: origin,
          expectedRPID: rpId,
          requireUserVerification: false,
        });
        
        if (!verification.verified) {
          throw new Error('WebAuthn verification failed');
        }
        
        // Extract public key from verification result
        const verifiedPublicKey = verification.registrationInfo?.credentialPublicKey;
        if (!verifiedPublicKey) {
          throw new Error('Public key not found in verification result');
        }
        
        // Register with verified public key
        await registerPasskey(
          prisma,
          userId,
          credentialId,
          Buffer.from(verifiedPublicKey).toString('base64'),
          deviceName,
          deviceType
        );
        
        console.log('[auth] WebAuthn registration verified using @simplewebauthn/server and passkey registered');
      } catch (err: any) {
        console.error('[auth] WebAuthn verification error:', err);
        return res.status(400).json({ error: 'WebAuthn verification failed', details: err.message });
      }
    } else {
      // Check if test/dev mode allows mock data
      const allowMockData = process.env.ALLOW_MOCK_PASSKEY_DATA === 'true' || process.env.NODE_ENV === 'test';
      
      if (!allowMockData) {
        // Production: Require real WebAuthn data - reject mock data
        return res.status(400).json({ 
          error: 'WebAuthn validation required',
          message: 'attestationObject and clientDataJSON are required for passkey registration. Mock data is not accepted in production.',
          details: 'Use @simplewebauthn/browser or browser WebAuthn API to generate valid attestation data. Set ALLOW_MOCK_PASSKEY_DATA=true for testing.'
        });
      }
      
      // Test/dev mode: Accept mock data (for testing without browser WebAuthn API)
      console.warn('[auth] Test mode: Accepting mock passkey data (ALLOW_MOCK_PASSKEY_DATA=true)');
      await registerPasskey(prisma, userId, credentialId, publicKey, deviceName, deviceType);
    }

    res.json({ success: true, message: 'Passkey registered successfully' });
  } catch (err) {
    console.error('[auth] passkey register finish error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /passkeys/authenticate/start - Begin passkey authentication
router.post('/authenticate/start', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'email required' });
    }

    // Find user by email
    const user = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM auth.users WHERE email = ${email}
    `.then((r: Array<any>) => r[0] || null);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get user's passkeys
    const passkeys = await getUserPasskeys(prisma, user.id);
    if (passkeys.length === 0) {
      return res.status(400).json({ error: 'No passkeys registered for this user' });
    }

    const challenge = generateChallenge();
    await storeChallenge(prisma, user.id, challenge, 'authentication');

    // Return challenge and allowed credentials
    res.json({
      challenge,
      userId: user.id,
      allowCredentials: passkeys.map((pk) => ({
        id: pk.id,
        type: 'public-key',
      })),
    });
  } catch (err) {
    console.error('[auth] passkey authenticate start error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /passkeys/authenticate/finish - Complete passkey authentication (public - returns token)
router.post('/authenticate/finish', async (req: Request, res: Response) => {
  try {
    const { challenge, credentialId, counter } = req.body;

    if (!challenge || !credentialId) {
      return res.status(400).json({ error: 'challenge and credentialId required' });
    }

    // Verify challenge
    const challengeRecord = await verifyChallenge(prisma, challenge);
    if (!challengeRecord || challengeRecord.type !== 'authentication') {
      return res.status(400).json({ error: 'Invalid or expired challenge' });
    }

    // Get passkey
    const passkey = await getPasskeyByCredentialId(prisma, credentialId);
    if (!passkey || passkey.userId !== challengeRecord.userId) {
      return res.status(401).json({ error: 'Invalid passkey' });
    }

    // Verify counter (replay protection)
    if (counter !== undefined && BigInt(counter) <= passkey.counter) {
      return res.status(401).json({ error: 'Invalid counter - possible replay attack' });
    }

    // Update passkey usage
    if (counter !== undefined) {
      await updatePasskeyUsage(prisma, credentialId, BigInt(counter));
    }

    // Generate JWT token for the user
    const { signJwt } = await import('@common/utils/auth');
    const token = signJwt({ sub: passkey.userId, email: '' }); // Email will be fetched if needed

    res.json({
      success: true,
      token,
      userId: passkey.userId,
    });
  } catch (err) {
    console.error('[auth] passkey authenticate finish error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /passkeys - Get user's passkeys (requires auth)
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.sub;
    const passkeys = await getUserPasskeys(prisma, userId);
    res.json({ passkeys });
  } catch (err) {
    console.error('[auth] get passkeys error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /passkeys/:id - Delete a passkey (requires auth)
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.sub;
    const passkeyId = req.params.id;

    const deleted = await deletePasskey(prisma, userId, passkeyId);
    if (!deleted) {
      return res.status(404).json({ error: 'Passkey not found' });
    }

    res.json({ success: true, message: 'Passkey deleted' });
  } catch (err) {
    console.error('[auth] delete passkey error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

