import type { Request, Response, NextFunction } from 'express'

export interface AuthedRequest extends Request {
  userId?: string
  userEmail?: string
  userJti?: string
}

export function requireUser(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const userId = String(req.headers['x-user-id'] || '')
  if (!userId) {
    res.status(401).json({ error: 'auth required' })
    return
  }

  const authedReq = req as AuthedRequest
  authedReq.userId = userId
  const email = req.headers['x-user-email']
  if (typeof email === 'string') authedReq.userEmail = email
  const jti = req.headers['x-user-jti']
  if (typeof jti === 'string') authedReq.userJti = jti

  next()
}
