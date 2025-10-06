import express from 'express'
import prisma from './prisma.js'
import { requireAuth } from './middleware/auth.js'
import inningsRouter from './innings.js'

const matchRouter = express.Router()

// Mount innings router under a match
matchRouter.use('/:matchId/innings', inningsRouter)

// GET /matches → Get all matches with optional status filter
matchRouter.get('/', async (req, res) => {
    try {
        const { status, limit = 50, offset = 0 } = req.query
        
        // Build where clause based on status filter
        let where = {}
        if (status) {
            const validStatuses = ['SCHEDULED', 'LIVE', 'COMPLETED', 'ABANDONED']
            if (validStatuses.includes(status.toUpperCase())) {
                where.status = status.toUpperCase()
            } else {
                return res.status(400).json({ 
                    success: false, 
                    message: `Invalid status. Valid values: ${validStatuses.join(', ')}` 
                })
            }
        }

        const matches = await prisma.match.findMany({
            where,
            select: {
                id: true,
                tournament: { select: { id: true, name: true } },
                teamA: { select: { id: true, name: true, logoUrl: true } },
                teamB: { select: { id: true, name: true, logoUrl: true } },
                matchType: true,
                ballType: true,
                pitchType: true,
                city: true,
                town: true,
                ground: true,
                round: true,
                startTime: true,
                oversLimit: true,
                ballsPerOver: true,
                status: true,
                result: true,
                winningTeam: { select: { id: true, name: true } },
                winningMargin: true,
                createdAt: true,
            },
            orderBy: [
                { status: 'asc' }, // LIVE first, then SCHEDULED, then COMPLETED
                { startTime: 'desc' }
            ],
            take: parseInt(limit),
            skip: parseInt(offset),
        })

        // Get total count for pagination
        const totalCount = await prisma.match.count({ where })

        // Categorize matches by status
        const categorized = {
            live: matches.filter(m => m.status === 'LIVE'),
            upcoming: matches.filter(m => m.status === 'SCHEDULED'),
            completed: matches.filter(m => m.status === 'COMPLETED'),
            abandoned: matches.filter(m => m.status === 'ABANDONED'),
        }

        return res.json({
            success: true,
            data: {
                matches,
                categorized,
                pagination: {
                    total: totalCount,
                    limit: parseInt(limit),
                    offset: parseInt(offset),
                    hasMore: parseInt(offset) + parseInt(limit) < totalCount
                }
            }
        })
    } catch (err) {
        console.error(err)
        return res.status(500).json({ success: false, message: 'Failed to fetch matches' })
    }
})

// POST /matches → Create match (standalone or tournament fixture)
matchRouter.post('/', requireAuth, async (req, res) => {
    try {
        const {
            tournamentId,
            teamAId,
            teamBId,
            matchType,
            ballType,
            pitchType,
            city,
            town,
            ground,
            round,
            startTime,
            oversLimit,
            ballsPerOver,
        } = req.body || {}

        if (!teamAId || !teamBId || teamAId === teamBId) {
            return res.status(400).json({ success: false, message: 'teamAId and teamBId are required and must be different' })
        }
        if (!matchType || !ballType || !pitchType || !startTime || typeof oversLimit !== 'number' || typeof ballsPerOver !== 'number') {
            return res.status(400).json({ success: false, message: 'matchType, ballType, pitchType, startTime, oversLimit, ballsPerOver are required' })
        }

        // Validate teams exist
        const [teamA, teamB] = await Promise.all([
            prisma.team.findUnique({ where: { id: teamAId }, select: { id: true } }),
            prisma.team.findUnique({ where: { id: teamBId }, select: { id: true } }),
        ])
        if (!teamA || !teamB) return res.status(404).json({ success: false, message: 'One or both teams not found' })

        // If tournament fixture, validate registration and organiser
        if (tournamentId) {
            const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { id: true, organiser: true } })
            if (!tournament) return res.status(404).json({ success: false, message: 'Tournament not found' })
            if (tournament.organiser && tournament.organiser !== req.user.id) {
                return res.status(403).json({ success: false, message: 'Only organiser can create fixtures' })
            }
            const [regA, regB] = await Promise.all([
                prisma.tournamentTeam.findUnique({ where: { tournamentId_teamId: { tournamentId, teamId: teamAId } }, select: { id: true } }),
                prisma.tournamentTeam.findUnique({ where: { tournamentId_teamId: { tournamentId, teamId: teamBId } }, select: { id: true } }),
            ])
            if (!regA || !regB) return res.status(400).json({ success: false, message: 'Both teams must be registered in tournament' })
        }

        const match = await prisma.match.create({
            data: {
                tournamentId: tournamentId || null,
                teamAId,
                teamBId,
                matchType,
                ballType,
                pitchType,
                round,
                city: city || null,
                town: town || null,
                ground: ground || null,
                startTime: new Date(startTime),
                oversLimit,
                ballsPerOver,
            },
            select: {
                id: true,
                tournamentId: true,
                teamA: { select: { id: true, name: true } },
                teamB: { select: { id: true, name: true } },
                matchType: true,
                ballType: true,
                pitchType: true,
                city: true,
                town: true,
                ground: true,
                startTime: true,
                oversLimit: true,
                ballsPerOver: true,
                status: true,
                createdAt: true,
            },
        })
        return res.status(201).json({ success: true, data: match })
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Failed to create match' })
    }
})

// POST /matches/:matchId/start → Start a match (status → LIVE)
matchRouter.post('/:matchId/start', requireAuth, async (req, res) => {
    try {
        const { matchId } = req.params
        const existing = await prisma.match.findUnique({
            where: { id: matchId },
            select: { id: true, status: true, tournament: { select: { organiser: true } } },
        })
        if (!existing) return res.status(404).json({ success: false, message: 'Match not found' })
        if (existing.tournament?.organiser && existing.tournament.organiser !== req.user.id) {
            return res.status(403).json({ success: false, message: 'Only tournament organiser can start this match' })
        }
        if (existing.status !== 'SCHEDULED') {
            return res.status(400).json({ success: false, message: 'Only scheduled matches can be started' })
        }
        const updated = await prisma.match.update({ where: { id: matchId }, data: { status: 'LIVE' }, select: { id: true, status: true } })
        return res.json({ success: true, data: updated })
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Failed to start match' })
    }
})

// POST /matches/:matchId/end → End a match (set winner, margin, result)
matchRouter.post('/:matchId/end', requireAuth, async (req, res) => {
    try {
        const { matchId } = req.params

        const match = await prisma.match.findUnique({
            where: { id: matchId },
            select: {
                id: true,
                status: true,
                teamAId: true,
                teamBId: true,
                statsApplied: true,
                ballsPerOver: true,
                oversLimit: true,
                tournament: { select: { organiser: true } },
                teamA: { select: { id: true, name: true } },
                teamB: { select: { id: true, name: true } },
            },
        })
        if (!match) return res.status(404).json({ success: false, message: 'Match not found' })
        if (match.tournament?.organiser && match.tournament.organiser !== req.user.id) {
            return res.status(403).json({ success: false, message: 'Only tournament organiser can end this match' })
        }
        if (!['SCHEDULED', 'LIVE'].includes(match.status)) {
            return res.status(400).json({ success: false, message: 'Match already ended or invalid state' })
        }

        const innings = await prisma.inning.findMany({
            where: { matchId },
            select: {
                id: true,
                inningNumber: true,
                runs: true,
                wickets: true,
                battingTeamId: true,
                bowlingTeamId: true,
                battingTeam: { select: { id: true, name: true } },
            },
            orderBy: { inningNumber: 'asc' },
        })

        if (innings.length < 2) {
            return res.status(400).json({ success: false, message: 'Cannot end match: second innings not completed' })
        }

        const relevantInnings = innings.slice(-2)
        const firstInning = relevantInnings[0]
        const secondInning = relevantInnings[1]
        const inningIds = innings.map((i) => i.id)

        const ballsPerOver = match.ballsPerOver || 6
        const oversLimit = match.oversLimit || 0
        const ballsLimit = oversLimit > 0 ? oversLimit * ballsPerOver : null

        const legalBallsSecond = await prisma.ball.count({
            where: {
                inningId: secondInning.id,
                ballType: { in: ['NORMAL', 'FREE_HIT', 'BYE', 'LEG_BYE'] },
            },
        })

        const target = firstInning.runs + 1
        const chaseAchieved = secondInning.runs >= target
        const allBallsUsed = ballsLimit != null ? legalBallsSecond >= ballsLimit : false
        const wicketsAllOut = secondInning.wickets >= 10
        const scoresLevel = secondInning.runs === firstInning.runs

        if (!chaseAchieved && !wicketsAllOut && !allBallsUsed) {
            return res.status(400).json({ success: false, message: 'Second innings still in progress' })
        }
        if (scoresLevel && !wicketsAllOut && !allBallsUsed) {
            return res.status(400).json({ success: false, message: 'Second innings still in progress' })
        }

        let winningTeamId = null
        let winningTeamName = null
        let winningMargin = null
        let result = null

        if (secondInning.runs > firstInning.runs) {
            winningTeamId = secondInning.battingTeamId
            winningTeamName = secondInning.battingTeam?.name || (winningTeamId === match.teamAId ? match.teamA?.name : match.teamB?.name) || null
            const wicketsLeftRaw = Math.max(0, 10 - secondInning.wickets)
            const wicketsLeft = Math.max(1, wicketsLeftRaw)
            winningMargin = `${wicketsLeft} wicket${wicketsLeft === 1 ? '' : 's'}`
            result = `${winningTeamName || 'Unknown team'} won by ${winningMargin}`
        } else if (secondInning.runs < firstInning.runs) {
            winningTeamId = firstInning.battingTeamId
            winningTeamName = firstInning.battingTeam?.name || (winningTeamId === match.teamAId ? match.teamA?.name : match.teamB?.name) || null
            const runMargin = firstInning.runs - secondInning.runs
            winningMargin = `${runMargin} run${runMargin === 1 ? '' : 's'}`
            result = `${winningTeamName || 'Unknown team'} won by ${winningMargin}`
        } else {
            winningMargin = 'Tie'
            result = 'Match tied'
            winningTeamId = null
            winningTeamName = null
        }

        // Pre-aggregate lifetime stats from this match
        let playerAgg = new Map()
        if (!match.statsApplied) {
            const [batSums, bowlSums] = await Promise.all([
                prisma.battingEntry.groupBy({
                    by: ['playerId'],
                    _sum: { runs: true },
                    where: { inningId: { in: inningIds } },
                }),
                prisma.bowlingEntry.groupBy({
                    by: ['playerId'],
                    _sum: { wickets: true },
                    where: { inningId: { in: inningIds } },
                }),
            ])
            for (const row of batSums) {
                const prev = playerAgg.get(row.playerId) || { runs: 0, wickets: 0 }
                playerAgg.set(row.playerId, { runs: (prev.runs || 0) + (row._sum.runs || 0), wickets: prev.wickets || 0 })
            }
            for (const row of bowlSums) {
                const prev = playerAgg.get(row.playerId) || { runs: 0, wickets: 0 }
                playerAgg.set(row.playerId, { runs: prev.runs || 0, wickets: (prev.wickets || 0) + (row._sum.wickets || 0) })
            }
        }

        const tx = []
        // Apply player totals once
        if (!match.statsApplied && playerAgg.size) {
            for (const [playerId, vals] of playerAgg.entries()) {
                const incData = {}
                if (vals.runs) incData.totalRuns = vals.runs
                if (vals.wickets) incData.totalWickets = vals.wickets
                if (Object.keys(incData).length) {
                    tx.push(
                        prisma.player.update({
                            where: { id: playerId },
                            data: {
                                totalRuns: { increment: incData.totalRuns || 0 },
                                totalWickets: { increment: incData.totalWickets || 0 },
                            },
                        })
                    )
                }
            }
        }
        // Finalize match status and mark statsApplied
        tx.push(
            prisma.match.update({
                where: { id: matchId },
                data: {
                    status: 'COMPLETED',
                    winningTeamId: winningTeamId || null,
                    winningMargin: winningMargin,
                    result: result,
                    statsApplied: true,
                },
                select: {
                    id: true,
                    status: true,
                    winningTeamId: true,
                    winningMargin: true,
                    result: true,
                    statsApplied: true,
                    winningTeam: { select: { id: true, name: true } },
                },
            })
        )

        const results = await prisma.$transaction(tx)
        const updated = results[results.length - 1]
        return res.json({ success: true, data: { ...updated, winningTeamName } })
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Failed to end match' })
    }
})

// GET /matches/:matchId → Get match details
matchRouter.get('/:matchId', async (req, res) => {
    try {
        const { matchId } = req.params
        const match = await prisma.match.findUnique({
            where: { id: matchId },
            select: {
                id: true,
                tournament: { select: { id: true, name: true } },
                teamA: { select: { id: true, name: true, logoUrl: true } },
                teamB: { select: { id: true, name: true, logoUrl: true } },
                matchType: true,
                ballType: true,
                pitchType: true,
                city: true,
                town: true,
                ground: true,
                startTime: true,
                oversLimit: true,
                ballsPerOver: true,
                status: true,
                result: true,
                winningTeam: { select: { id: true, name: true } },
                winningMargin: true,
                innings: {
                    select: {
                        id: true,
                        inningNumber: true,
                        battingTeam: { select: { id: true, name: true } },
                        bowlingTeam: { select: { id: true, name: true } },
                        runs: true,
                        wickets: true,
                        overs: true,
                    },
                    orderBy: { inningNumber: 'asc' },
                },
                createdAt: true,
            },
        })
        if (!match) return res.status(404).json({ success: false, message: 'Match not found' })
        return res.json({ success: true, data: match })
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Failed to fetch match' })
    }
})

// GET /matches/:matchId/teams → Teams and members for this match
matchRouter.get('/:matchId/teams', async (req, res) => {
    try {
        const { matchId } = req.params
        const match = await prisma.match.findUnique({
            where: { id: matchId },
            select: { teamAId: true, teamBId: true, teamA: { select: { id: true, name: true, logoUrl: true } }, teamB: { select: { id: true, name: true, logoUrl: true } } }
        })
        if (!match) return res.status(404).json({ success: false, message: 'Match not found' })

        const [teamAMembers, teamBMembers] = await Promise.all([
            prisma.teamMembership.findMany({
                where: { teamId: match.teamAId },
                select: { role: true, player: { select: { id: true, name: true, battingStyle: true, bowlingStyle: true } } }
            }),
            prisma.teamMembership.findMany({
                where: { teamId: match.teamBId },
                select: { role: true, player: { select: { id: true, name: true, battingStyle: true, bowlingStyle: true } } }
            })
        ])

        const mapMember = (m) => ({
            id: m.player.id,
            name: m.player.name,
            battingStyle: m.player.battingStyle || null,
            bowlingStyle: m.player.bowlingStyle || null,
            role: m.role || null,
        })

        return res.json({
            success: true,
            data: {
                teamA: { ...match.teamA, members: teamAMembers.map(mapMember) },
                teamB: { ...match.teamB, members: teamBMembers.map(mapMember) },
            }
        })
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Failed to fetch teams' })
    }
})

export default matchRouter