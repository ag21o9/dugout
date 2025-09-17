import express from 'express'
import prisma from './prisma.js'
import { requireAuth } from './middleware/auth.js'

const playersRouter = express.Router()

// POST /players → Create a player for a user
playersRouter.post('/', requireAuth, async (req, res) => {
  try {
    const { battingStyle, bowlingStyle, state, district, subDistrict, village, pincode, playingRole } = req.body || {}
    // if (!name) return res.status(400).json({ success: false, message: 'name is required' })

    const user = await prisma.user.findUnique({
        where : {
            id : req.user.id
        }
    });

    const player = await prisma.player.create({
      data: {
        userId: req.user.id,
        name : user.name,
        battingStyle: battingStyle || null,
        bowlingStyle: bowlingStyle || null,
        state: state || null,
        district: district || null,
        subDistrict: subDistrict || null,
        village: village || null,
        pincode: pincode || null,
        playingRole: playingRole || null,
      },
      select: { id: true, userId: true, name: true, battingStyle: true, bowlingStyle: true, state: true, district: true, subDistrict: true, village: true, pincode: true, playingRole: true },
    })
    return res.status(201).json({ success: true, data: player })
  } catch (err) {
    console.log(err)
    return res.status(500).json({ success: false, message: 'Failed to create player' })
  }
})

// GET /players/:playerId → Get player profile
playersRouter.get('/:playerId', async (req, res) => {
  try {
    const { playerId } = req.params
    const player = await prisma.player.findUnique({
      where: { id: playerId },
      select: {
        id: true,
        name: true,
        battingStyle: true,
        bowlingStyle: true,
        state: true,
        district: true,
        subDistrict: true,
        village: true,
        pincode: true,
        playingRole: true,
        user: { select: { id: true, name: true, email: true, phone: true } },
      },
    })
    if (!player) return res.status(404).json({ success: false, message: 'Player not found' })
    return res.json({ success: true, data: player })
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to fetch player' })
  }
})

export default playersRouter
// GET /players/by-phone/:phone → Get player by phone number (via user phone)
playersRouter.get('/by-phone/:phone', async (req, res) => {
  try {
    const { phone } = req.params
    if (!phone) return res.status(400).json({ success: false, message: 'phone is required' })

    const user = await prisma.user.findFirst({
      where: { phone },
      select: { id: true },
    })
    if (!user) return res.status(404).json({ success: false, message: 'No user with this phone' })

    const player = await prisma.player.findFirst({
      where: { userId: user.id },
      select: {
        id: true,
        name: true,
        battingStyle: true,
        bowlingStyle: true,
        state: true,
        district: true,
        subDistrict: true,
        village: true,
        pincode: true,
        playingRole: true,
        user: { select: { id: true, name: true, email: true, phone: true } },
      },
    })
    if (!player) return res.status(404).json({ success: false, message: 'Player not found for this phone' })

    return res.json({ success: true, data: player })
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to fetch player by phone' })
  }
})
