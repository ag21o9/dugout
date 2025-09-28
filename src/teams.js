import express from 'express'
import prisma from './prisma.js'
import { requireAuth } from './middleware/auth.js'
import { upload, uploadImageBuffer } from '../config/utils.js'

const teamsRouter = express.Router()

// POST /teams → Create a team
teamsRouter.post('/', requireAuth, upload.single('logo'), async (req, res) => {
  try {
    const { name, logoUrl } = req.body || {}
    if (!name) return res.status(400).json({ success: false, message: 'name is required' })

    // Handle logo upload if provided
    let finalLogoUrl = logoUrl || null
    if (req.file) {
      try {
        finalLogoUrl = await uploadImageBuffer(req.file.buffer)
      } catch (uploadErr) {
        return res.status(500).json({ success: false, message: 'Failed to upload team logo' })
      }
    }

    const team = await prisma.team.create({
      data: { name, logoUrl: finalLogoUrl, ownerId: req.user.id },
      select: { id: true, name: true, logoUrl: true, createdAt: true, ownerId: true },
    })
    return res.status(201).json({ success: true, data: team })
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to create team' })
  }
})

// PATCH /teams/:teamId → Update team info (owner only)
teamsRouter.patch('/:teamId', requireAuth, upload.single('logo'), async (req, res) => {
  try {
    const { teamId } = req.params
    const { name, logoUrl } = req.body || {}
    // verify ownership
    const existing = await prisma.team.findUnique({ where: { id: teamId }, select: { id: true, ownerId: true } })
    if (!existing) return res.status(404).json({ success: false, message: 'Team not found' })
    if (existing.ownerId !== req.user.id) return res.status(403).json({ success: false, message: 'Forbidden' })
    
    const data = {}
    if (name !== undefined) data.name = name
    if (logoUrl !== undefined) data.logoUrl = logoUrl
    
    // Handle logo upload if provided
    if (req.file) {
      try {
        data.logoUrl = await uploadImageBuffer(req.file.buffer)
      } catch (uploadErr) {
        return res.status(500).json({ success: false, message: 'Failed to upload team logo' })
      }
    }

    if (Object.keys(data).length === 0) return res.status(400).json({ success: false, message: 'No fields to update' })

    const team = await prisma.team.update({
      where: { id: teamId },
      data,
      select: { id: true, name: true, logoUrl: true, createdAt: true },
    })
    return res.json({ success: true, data: team })
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to update team' })
  }
})

// POST /teams/:teamId/members → Add player(s) to a team
teamsRouter.post('/:teamId/members', requireAuth, async (req, res) => {
  try {
    const { teamId } = req.params
    const { playerIds, role } = req.body || {}
    if (!Array.isArray(playerIds) || playerIds.length === 0) {
      return res.status(400).json({ success: false, message: 'playerIds array is required' })
    }

    // validate team exists
    const team = await prisma.team.findUnique({ where: { id: teamId }, select: { id: true } })
    if (!team) return res.status(404).json({ success: false, message: 'Team not found' })

    // create memberships (ignore duplicates using unique constraint if any later)
    const created = await prisma.$transaction(
      playerIds.map((pid) =>
        prisma.teamMembership.upsert({
          where: { playerId_teamId: { playerId: pid, teamId } },
          update: { role: role || null },
          create: { playerId: pid, teamId, role: role || null },
        })
      )
    )

    return res.status(201).json({ success: true, count: created.length })
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to add members' })
  }
})

// GET /teams/:teamId/members → List team members
teamsRouter.get('/:teamId/members', async (req, res) => {
  try {
    const { teamId } = req.params
    const teamname = await prisma.teamMembership.findFirst({
      where: {
        teamId
      },
      select: {
        team: {
          select: {
            name: true
          }
        },
      }
    })
    const members = await prisma.teamMembership.findMany({
      where: { teamId },
      select: {
        id: true,
        role: true,
        player: { select: { id: true, name: true, battingStyle: true, bowlingStyle: true, profilepic: true } },
      },
    })
    return res.json({ success: true, teamname: teamname?.team?.name ? teamname.team.name : '', data: members })
  } catch (err) {
    console.log(err)
    return res.status(500).json({ success: false, message: 'Failed to list members' })
  }
})

// DELETE /teams/:teamId/members → Remove player(s) from a team
teamsRouter.delete('/:teamId/members', requireAuth, async (req, res) => {
  try {
    const { teamId } = req.params
    const { playerIds } = req.body || {}

    if (!Array.isArray(playerIds) || playerIds.length === 0) {
      return res.status(400).json({ success: false, message: 'playerIds array is required' })
    }

    // Validate team exists and check ownership (optional - you can remove this if any authenticated user can remove members)
    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select: { id: true, ownerId: true }
    })
    if (!team) return res.status(404).json({ success: false, message: 'Team not found' })

    // Optional: Only team owner can remove members - uncomment if needed
    if (team.ownerId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Only team owner can remove members' })
    }

    // Remove memberships
    const result = await prisma.teamMembership.deleteMany({
      where: {
        teamId,
        playerId: { in: playerIds }
      }
    })

    return res.json({
      success: true,
      message: `Removed ${result.count} player(s) from team`,
      removedCount: result.count
    })
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to remove members' })
  }
})

// GET /teams → List all teams
teamsRouter.get('/', async (req, res) => {
  try {
    const teams = await prisma.team.findMany({ select: { id: true, name: true, logoUrl: true, createdAt: true } })
    return res.json({ success: true, data: teams })
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to list teams' })
  }
})

export default teamsRouter
// GET /teams/mine → My teams (owned and member)
teamsRouter.get('/mine', requireAuth, async (req, res) => {
  try {
    const owned = await prisma.team.findMany({
      where: { ownerId: req.user.id },
      select: {
        id: true,
        name: true,
        logoUrl: true,
        createdAt: true,
        _count: { select: { members: true } }
      },
    })

    const memberships = await prisma.teamMembership.findMany({
      where: { player: { userId: req.user.id } },
      select: {
        team: {
          select: {
            id: true,
            name: true,
            logoUrl: true,
            createdAt: true,
            _count: { select: { members: true } }
          }
        }
      },
    })

    const ownedTeams = owned.map(team => ({
      ...team,
      playerCount: team._count.members,
      _count: undefined
    }))

    const memberTeams = memberships.map((m) => ({
      ...m.team,
      playerCount: m.team._count.members,
      _count: undefined
    }))

    return res.json({ success: true, data: { owned: ownedTeams, member: memberTeams } })
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to get my teams' })
  }
})
