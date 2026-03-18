import jwt from 'jsonwebtoken'
export interface JwtPayload { sub: string; email: string }
export function signJwt(p: JwtPayload) {
  const secret = process.env.JWT_SECRET || 'dev'
  return jwt.sign(p, secret, { expiresIn: '7d' })
}
export function verifyJwt(token: string): JwtPayload {
  const secret = process.env.JWT_SECRET || 'dev'
  return jwt.verify(token, secret) as JwtPayload
}
