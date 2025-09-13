import jwt from 'jsonwebtoken'
import prisma from '../prisma.js'

export const requireAuth = async (req, res, next) => {
  try {
    const auth = req.headers.authorization || ''
    const [scheme, token] = auth.split(' ')
    if (scheme !== 'Bearer' || !token) {
      return res.status(401).json({ success: false, message: 'Unauthorized' })
    }
    const secret = process.env.JWT_SECRET
    if (!secret) {
      return res.status(500).json({ success: false, message: 'Server misconfigured: JWT_SECRET missing' })
    }
    const payload = jwt.verify(token, secret)
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, name: true, email: true, phone: true },
    })
    if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' })
    req.user = user
    next()
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Unauthorized' })
  }
}
