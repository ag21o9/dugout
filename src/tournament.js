import express from 'express'
import prisma from './prisma.js'
import { requireAuth } from './middleware/auth.js'

const tournamentRouter = express.Router()

// Helper to coerce date strings to Date or undefined
const toDate = (v) => (v ? new Date(v) : undefined)

// POST /tournaments → Create tournament (organiser is current user)
tournamentRouter.post('/', requireAuth, async (req, res) => {
	try {
		const {
			name,
			city,
			ground,
			contact,
			startDate,
			endDate,
			category,
			ballType,
			pitchType,
			maxTeams,
			logoUrl,
			bannerUrl,
		} = req.body || {}

		if (!name || !ballType || !pitchType || typeof maxTeams !== 'number') {
			return res.status(400).json({
				success: false,
				message: 'name, ballType, pitchType, maxTeams are required',
			})
		}

		const tournament = await prisma.tournament.create({
			data: {
				name,
				city: city || null,
				ground: ground || null,
				organiser: req.user.id, // storing organiser as current userId for permissions
				contact: contact || req.user.phone || null,
				startDate: toDate(startDate),
				endDate: toDate(endDate),
				category: category || null,
				ballType,
				pitchType,
				maxTeams,
				logoUrl: logoUrl || null,
				bannerUrl: bannerUrl || null,
			},
			select: {
				id: true,
				name: true,
				city: true,
				ground: true,
				organiser: true,
				contact: true,
				startDate: true,
				endDate: true,
				category: true,
				ballType: true,
				pitchType: true,
				maxTeams: true,
				logoUrl: true,
				bannerUrl: true,
				createdAt: true,
			},
		})
		return res.status(201).json({ success: true, data: tournament })
	} catch (err) {
		return res.status(500).json({ success: false, message: 'Failed to create tournament' })
	}
})

// PATCH /tournaments/:tournamentId → Update tournament (organiser only)
tournamentRouter.patch('/:tournamentId', requireAuth, async (req, res) => {
	try {
		const { tournamentId } = req.params
		const existing = await prisma.tournament.findUnique({
			where: { id: tournamentId },
			select: { id: true, organiser: true },
		})
		if (!existing) return res.status(404).json({ success: false, message: 'Tournament not found' })
		if (existing.organiser !== req.user.id) return res.status(403).json({ success: false, message: 'Forbidden' })

		const {
			name,
			city,
			ground,
			contact,
			startDate,
			endDate,
			category,
			ballType,
			pitchType,
			maxTeams,
			logoUrl,
			bannerUrl,
		} = req.body || {}

		const data = {}
		if (name !== undefined) data.name = name
		if (city !== undefined) data.city = city
		if (ground !== undefined) data.ground = ground
		if (contact !== undefined) data.contact = contact
		if (startDate !== undefined) data.startDate = toDate(startDate)
		if (endDate !== undefined) data.endDate = toDate(endDate)
		if (category !== undefined) data.category = category
		if (ballType !== undefined) data.ballType = ballType
		if (pitchType !== undefined) data.pitchType = pitchType
		if (maxTeams !== undefined) data.maxTeams = maxTeams
		if (logoUrl !== undefined) data.logoUrl = logoUrl
		if (bannerUrl !== undefined) data.bannerUrl = bannerUrl

		if (Object.keys(data).length === 0) {
			return res.status(400).json({ success: false, message: 'No fields to update' })
		}

		const updated = await prisma.tournament.update({
			where: { id: tournamentId },
			data,
			select: {
				id: true,
				name: true,
				city: true,
				ground: true,
				organiser: true,
				contact: true,
				startDate: true,
				endDate: true,
				category: true,
				ballType: true,
				pitchType: true,
				maxTeams: true,
				logoUrl: true,
				bannerUrl: true,
				createdAt: true,
			},
		})
		return res.json({ success: true, data: updated })
	} catch (err) {
		return res.status(500).json({ success: false, message: 'Failed to update tournament' })
	}
})

// GET /tournaments/:tournamentId → Get tournament details (with registered teams and matches)
tournamentRouter.get('/:tournamentId', async (req, res) => {
	try {
		const { tournamentId } = req.params
		const tournament = await prisma.tournament.findUnique({
			where: { id: tournamentId },
			select: {
				id: true,
				name: true,
				city: true,
				ground: true,
				organiser: true,
				contact: true,
				startDate: true,
				endDate: true,
				category: true,
				ballType: true,
				pitchType: true,
				maxTeams: true,
				logoUrl: true,
				bannerUrl: true,
				createdAt: true,
				registeredTeams: {
					select: {
						id: true,
						team: { select: { id: true, name: true, logoUrl: true } },
						registeredAt: true,
					},
				},
				matches: {
					select: {
						id: true,
						teamA: { select: { id: true, name: true } },
						teamB: { select: { id: true, name: true } },
						status: true,
						startTime: true,
						oversLimit: true,
						ballsPerOver: true,
					},
				},
			},
		})
		if (!tournament) return res.status(404).json({ success: false, message: 'Tournament not found' })
		return res.json({ success: true, data: tournament })
	} catch (err) {
		return res.status(500).json({ success: false, message: 'Failed to fetch tournament' })
	}
})

// GET /tournaments → List all tournaments (optional filters)
tournamentRouter.get('/', async (req, res) => {
	try {
		const { city } = req.query
		const tournaments = await prisma.tournament.findMany({
			where: { ...(city ? { city } : {}) },
			orderBy: { createdAt: 'desc' },
			select: {
				id: true,
				name: true,
				city: true,
				ground: true,
				organiser: true,
				startDate: true,
				endDate: true,
				category: true,
				ballType: true,
				pitchType: true,
				maxTeams: true,
				logoUrl: true,
				bannerUrl: true,
				createdAt: true,
			},
		})
		return res.json({ success: true, data: tournaments })
	} catch (err) {
		return res.status(500).json({ success: false, message: 'Failed to list tournaments' })
	}
})

export default tournamentRouter
// POST /tournaments/:tournamentId/teams → Register a team into tournament
tournamentRouter.post('/:tournamentId/teams', requireAuth, async (req, res) => {
	try {
		const { tournamentId } = req.params
		const { teamId } = req.body || {}
		if (!teamId) return res.status(400).json({ success: false, message: 'teamId is required' })

		const tournament = await prisma.tournament.findUnique({
			where: { id: tournamentId },
			select: { id: true, maxTeams: true },
		})
		if (!tournament) return res.status(404).json({ success: false, message: 'Tournament not found' })

		const team = await prisma.team.findUnique({ where: { id: teamId }, select: { id: true } })
		if (!team) return res.status(404).json({ success: false, message: 'Team not found' })

		const already = await prisma.tournamentTeam.findUnique({
			where: { tournamentId_teamId: { tournamentId, teamId } },
			select: { id: true },
		})
		if (already) return res.status(409).json({ success: false, message: 'Team already registered' })

		const currentCount = await prisma.tournamentTeam.count({ where: { tournamentId } })
		if (currentCount >= tournament.maxTeams) {
			return res.status(400).json({ success: false, message: 'Tournament capacity reached' })
		}

		const registration = await prisma.tournamentTeam.create({
			data: { tournamentId, teamId },
			select: { id: true, tournamentId: true, team: { select: { id: true, name: true, logoUrl: true } }, registeredAt: true },
		})
		return res.status(201).json({ success: true, data: registration })
	} catch (err) {
		return res.status(500).json({ success: false, message: 'Failed to register team' })
	}
})

// GET /tournaments/:tournamentId/teams → List all registered teams in a tournament
tournamentRouter.get('/:tournamentId/teams', async (req, res) => {
	try {
		const { tournamentId } = req.params
		const exists = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { id: true } })
		if (!exists) return res.status(404).json({ success: false, message: 'Tournament not found' })

		const teams = await prisma.tournamentTeam.findMany({
			where: { tournamentId },
			orderBy: { registeredAt: 'asc' },
			select: { id: true, team: { select: { id: true, name: true, logoUrl: true } }, registeredAt: true },
		})
		return res.json({ success: true, data: teams })
	} catch (err) {
		return res.status(500).json({ success: false, message: 'Failed to list registered teams' })
	}
})

// POST /tournaments/:tournamentId/teams/:teamId/members → Add team members
tournamentRouter.post('/:tournamentId/teams/:teamId/members', requireAuth, async (req, res) => {
	try {
		const { tournamentId, teamId } = req.params
		const { playerIds, role } = req.body || {}
		if (!Array.isArray(playerIds) || playerIds.length === 0) {
			return res.status(400).json({ success: false, message: 'playerIds array is required' })
		}

		const registration = await prisma.tournamentTeam.findUnique({
			where: { tournamentId_teamId: { tournamentId, teamId } },
			select: { id: true },
		})
		if (!registration) return res.status(404).json({ success: false, message: 'Team not registered in tournament' })

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
		return res.status(500).json({ success: false, message: 'Failed to add team members' })
	}
})

// GET /tournaments/:tournamentId/teams/:teamId/members → List members in registered team
tournamentRouter.get('/:tournamentId/teams/:teamId/members', async (req, res) => {
	try {
		const { tournamentId, teamId } = req.params
		const registration = await prisma.tournamentTeam.findUnique({
			where: { tournamentId_teamId: { tournamentId, teamId } },
			select: { id: true },
		})
		if (!registration) return res.status(404).json({ success: false, message: 'Team not registered in tournament' })

		const members = await prisma.teamMembership.findMany({
			where: { teamId },
			select: {
				id: true,
				role: true,
				player: { select: { id: true, name: true, battingStyle: true, bowlingStyle: true } },
			},
		})
		return res.json({ success: true, data: members })
	} catch (err) {
		return res.status(500).json({ success: false, message: 'Failed to list team members' })
	}
})