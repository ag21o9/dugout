import express from 'express'
import prisma from './prisma.js'
import { requireAuth } from './middleware/auth.js'
import jwt from 'jsonwebtoken'
import { upload, uploadImageBuffer } from '../config/utils.js'

const playersRouter = express.Router()

async function buildPlayerProfile(playerId) {
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
      profilepic: true,
      totalRuns: true,
      totalWickets: true,
      user: { select: { id: true, name: true, email: true, phone: true, gender: true, dob: true } },
    },
  })
  if (!player) return null

  const [battingAgg, bestBatInning, bowlingAgg, bestBowlingEntry, battingMatchIds, bowlingMatchIds] = await Promise.all([
    prisma.battingEntry.aggregate({
      where: { playerId },
      _sum: { runs: true, ballsFaced: true, fours: true, sixes: true },
      _max: { runs: true },
    }),
    prisma.battingEntry.findFirst({
      where: { playerId },
      orderBy: [
        { runs: 'desc' },
        { ballsFaced: 'asc' },
        { battingOrder: 'asc' },
      ],
      select: {
        inningId: true,
        runs: true,
        ballsFaced: true,
        fours: true,
        sixes: true,
        inning: {
          select: {
            id: true,
            inningNumber: true,
            battingTeam: { select: { id: true, name: true } },
            bowlingTeam: { select: { id: true, name: true } },
            match: {
              select: {
                id: true,
                teamA: { select: { id: true, name: true } },
                teamB: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    }),
    prisma.bowlingEntry.aggregate({
      where: { playerId },
      _sum: { wickets: true, balls: true, runsConceded: true, maidens: true },
      _max: { wickets: true },
    }),
    prisma.bowlingEntry.findFirst({
      where: { playerId },
      orderBy: [
        { wickets: 'desc' },
        { runsConceded: 'asc' },
        { balls: 'asc' },
      ],
      select: {
        inningId: true,
        wickets: true,
        runsConceded: true,
        balls: true,
        maidens: true,
        inning: {
          select: {
            id: true,
            inningNumber: true,
            battingTeam: { select: { id: true, name: true } },
            bowlingTeam: { select: { id: true, name: true } },
            match: {
              select: {
                id: true,
                teamA: { select: { id: true, name: true } },
                teamB: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    }),
    prisma.battingEntry.findMany({
      where: { playerId },
      distinct: ['inningId'],
      select: { inning: { select: { matchId: true } } },
    }),
    prisma.bowlingEntry.findMany({
      where: { playerId },
      distinct: ['inningId'],
      select: { inning: { select: { matchId: true } } },
    }),
  ])

  const battingSum = battingAgg?._sum || {}
  const bowlingSum = bowlingAgg?._sum || {}

  const totalRuns = battingSum.runs ?? 0
  const ballsFaced = battingSum.ballsFaced ?? 0
  const totalFours = battingSum.fours ?? 0
  const totalSixes = battingSum.sixes ?? 0
  const strikeRate = ballsFaced > 0 ? Number(((totalRuns / ballsFaced) * 100).toFixed(2)) : 0

  const totalWickets = bowlingSum.wickets ?? 0
  const ballsBowled = bowlingSum.balls ?? 0
  const oversBowled = ballsBowled > 0 ? `${Math.floor(ballsBowled / 6)}.${ballsBowled % 6}` : '0.0'
  const runsConceded = bowlingSum.runsConceded ?? 0
  const economy = ballsBowled > 0 ? Number(((runsConceded * 6) / ballsBowled).toFixed(2)) : 0
  const maidens = bowlingSum.maidens ?? 0

  const bestBatting = bestBatInning
    ? {
      inningId: bestBatInning.inningId,
      runs: bestBatInning.runs,
      ballsFaced: bestBatInning.ballsFaced,
      fours: bestBatInning.fours,
      sixes: bestBatInning.sixes,
      matchId: bestBatInning.inning?.match?.id || null,
      inningNumber: bestBatInning.inning?.inningNumber || null,
      battingTeam: bestBatInning.inning?.battingTeam?.name || null,
      bowlingTeam: bestBatInning.inning?.bowlingTeam?.name || null,
    }
    : null

  const bestBowling = bestBowlingEntry
    ? {
      inningId: bestBowlingEntry.inningId,
      wickets: bestBowlingEntry.wickets,
      runsConceded: bestBowlingEntry.runsConceded,
      balls: bestBowlingEntry.balls,
      maidens: bestBowlingEntry.maidens,
      overs: bestBowlingEntry.balls > 0
        ? `${Math.floor(bestBowlingEntry.balls / 6)}.${bestBowlingEntry.balls % 6}`
        : '0.0',
      matchId: bestBowlingEntry.inning?.match?.id || null,
      inningNumber: bestBowlingEntry.inning?.inningNumber || null,
      battingTeam: bestBowlingEntry.inning?.battingTeam?.name || null,
      bowlingTeam: bestBowlingEntry.inning?.bowlingTeam?.name || null,
    }
    : null

  const matchIdSet = new Set([
    ...battingMatchIds.map((m) => m.inning?.matchId).filter(Boolean),
    ...bowlingMatchIds.map((m) => m.inning?.matchId).filter(Boolean),
  ])

  return {
    ...player,
    stats: {
      matchesPlayed: matchIdSet.size,
      batting: {
        totalRuns,
        ballsFaced,
        strikeRate,
        fours: totalFours,
        sixes: totalSixes,
        highestRuns: battingAgg?._max?.runs ?? 0,
        highestInning: bestBatting,
      },
      bowling: {
        totalWickets,
        ballsBowled,
        oversBowled,
        runsConceded,
        maidens,
        economy,
        bestBowling,
      },
      aggregates: {
        recordedTotalRuns: player.totalRuns,
        recordedTotalWickets: player.totalWickets,
      },
    },
  }
}

// POST /players → Create a player for a user
playersRouter.post('/', requireAuth, upload.single('profilepic'), async (req, res) => {
  try {
    const { battingStyle, bowlingStyle, state, district, subDistrict, village, pincode, playingRole } = req.body || {}

    const user = await prisma.user.findUnique({
      where: {
        id: req.user.id
      }
    });
    // Handle profile picture upload if provided
    let profilepicUrl = null
    if (req.file) {
      try {
        profilepicUrl = await uploadImageBuffer(req.file.buffer)
      } catch (uploadErr) {
        return res.status(500).json({ success: false, message: 'Failed to upload profile picture' })
      }
    }

    const player = await prisma.player.create({
      data: {
        userId: req.user.id,
        name: user.name,
        battingStyle: battingStyle || null,
        bowlingStyle: bowlingStyle || null,
        state: state || null,
        district: district || null,
        subDistrict: subDistrict || null,
        village: village || null,
        pincode: pincode || null,
        playingRole: playingRole || null,
        profilepic: profilepicUrl,
      },
      select: { id: true, userId: true, name: true, battingStyle: true, bowlingStyle: true, state: true, district: true, subDistrict: true, village: true, pincode: true, playingRole: true, profilepic: true },
    })

    const secret = process.env.JWT_SECRET

    const token = jwt.sign({ sub: player.userId }, secret, { expiresIn: '7d' })
    // return res.json({ success: true, token, user })
    return res.status(201).json({ success: true, user: player, token })
  } catch (err) {
    console.log(err)
    return res.status(500).json({ success: false, message: 'Failed to create player' })
  }
})

// GET /players/myprofile → Authenticated player's profile with stats
playersRouter.get('/myprofile', requireAuth, async (req, res) => {
  try {
    const player = await prisma.player.findFirst({
      where: { userId: req.user.id },
      select: { id: true },
    })
    if (!player) {
      return res.status(404).json({ success: false, message: 'No player profile found for user' })
    }

    const profile = await buildPlayerProfile(player.id)
    if (!profile) {
      return res.status(404).json({ success: false, message: 'Player not found' })
    }
    return res.json({ success: true, data: profile })
  } catch (err) {
    console.log(err)
    return res.status(500).json({ success: false, message: 'Failed to fetch profile' })
  }
})

// PATCH /players/myprofile → Update authenticated player's profile
playersRouter.patch('/myprofile', requireAuth, async (req, res) => {
  try {
    const {
      name,
      gender,
      battingStyle,
      bowlingStyle,
      state,
      district,
      subDistrict,
      village,
      pincode,
      playingRole,
    } = req.body || {}

    const provided = [
      name,
      gender,
      battingStyle,
      bowlingStyle,
      state,
      district,
      subDistrict,
      village,
      pincode,
      playingRole,
    ].some((val) => val !== undefined)

    if (!provided) {
      return res.status(400).json({ success: false, message: 'No fields to update' })
    }

    const player = await prisma.player.findFirst({
      where: { userId: req.user.id },
      select: { id: true, userId: true },
    })

    if (!player) {
      return res.status(404).json({ success: false, message: 'No player profile found for user' })
    }

    const toNull = (value) => (value === '' ? null : value)

    const userData = {}
    if (name !== undefined) userData.name = toNull(name)
    if (gender !== undefined) userData.gender = toNull(gender)

    const playerData = {}
    if (name !== undefined) playerData.name = toNull(name)
    if (battingStyle !== undefined) playerData.battingStyle = toNull(battingStyle)
    if (bowlingStyle !== undefined) playerData.bowlingStyle = toNull(bowlingStyle)
    if (state !== undefined) playerData.state = toNull(state)
    if (district !== undefined) playerData.district = toNull(district)
    if (subDistrict !== undefined) playerData.subDistrict = toNull(subDistrict)
    if (village !== undefined) playerData.village = toNull(village)
    if (pincode !== undefined) playerData.pincode = toNull(pincode)
    if (playingRole !== undefined) playerData.playingRole = toNull(playingRole)

    const result = await prisma.$transaction(async (tx) => {
      const updatedUser = Object.keys(userData).length
        ? await tx.user.update({
          where: { id: player.userId },
          data: userData,
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            dob: true,
            gender: true,
            profilepic: true,
          },
        })
        : await tx.user.findUnique({
          where: { id: player.userId },
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            dob: true,
            gender: true,
            profilepic: true,
          },
        })

      const updatedPlayer = Object.keys(playerData).length
        ? await tx.player.update({
          where: { id: player.id },
          data: playerData,
          select: {
            id: true,
            userId: true,
            name: true,
            battingStyle: true,
            bowlingStyle: true,
            state: true,
            district: true,
            subDistrict: true,
            village: true,
            pincode: true,
            playingRole: true,
            profilepic: true,
          },
        })
        : await tx.player.findUnique({
          where: { id: player.id },
          select: {
            id: true,
            userId: true,
            name: true,
            battingStyle: true,
            bowlingStyle: true,
            state: true,
            district: true,
            subDistrict: true,
            village: true,
            pincode: true,
            playingRole: true,
            profilepic: true,
          },
        })

      return { user: updatedUser, player: updatedPlayer }
    })

    return res.json({ success: true, data: result })
  } catch (err) {
    console.log(err)
    if (err?.code === 'P2001') {
      return res.status(404).json({ success: false, message: 'Player not found' })
    }
    if (err?.code === 'P2002' && err?.meta?.target?.includes('email')) {
      return res.status(409).json({ success: false, message: 'Email already in use' })
    }
    return res.status(500).json({ success: false, message: 'Failed to update player' })
  }
})

// GET /players/:playerId → Get player profile
playersRouter.get('/:playerId', async (req, res) => {
  try {
    const { playerId } = req.params
    const profile = await buildPlayerProfile(playerId)
    if (!profile) return res.status(404).json({ success: false, message: 'Player not found' })

    return res.json({ success: true, data: profile })
  } catch (err) {
    console.log(err)
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
        profilepic: true,
        user: { select: { id: true, name: true, email: true, phone: true } },
      },
    })
    if (!player) return res.status(404).json({ success: false, message: 'Player not found for this phone' })

    return res.json({ success: true, data: player })
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to fetch player by phone' })
  }
})
