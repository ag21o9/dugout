import express from 'express'
import prisma from './prisma.js'
import { requireAuth } from './middleware/auth.js'
import { upload, uploadImageBuffer } from '../config/utils.js'

const tournamentRouter = express.Router()

const ballsToOvers = (balls) => {
    if (!balls || balls <= 0) return '0.0'
    const overs = Math.floor(balls / 6)
    const remBalls = balls % 6
    return `${overs}.${remBalls}`
}

// Helper to coerce date strings to Date or undefined
const toDate = (v) => (v ? new Date(v) : undefined)

// POST /tournaments → Create tournament (organiser is current user)
tournamentRouter.post('/', requireAuth, upload.fields([
    { name: 'logo', maxCount: 1 },
    { name: 'banner', maxCount: 1 }
]), async (req, res) => {
    try {
        let {
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
            prize,
            prizeType,
            logoUrl,
            matchType,
            bannerUrl,
        } = req.body || {}

        console.log(req.body);

        maxTeams = parseInt(maxTeams);

        if (!name || !ballType || !pitchType || typeof maxTeams !== 'number') {
            return res.status(400).json({
                success: false,
                message: 'name, ballType, pitchType, maxTeams are required',
            })
        }

        // Handle image uploads
        let finalLogoUrl = logoUrl || null
        let finalBannerUrl = bannerUrl || null

        if (req.files?.logo?.[0]) {
            try {
                finalLogoUrl = await uploadImageBuffer(req.files.logo[0].buffer)
            } catch (uploadErr) {
                return res.status(500).json({ success: false, message: 'Failed to upload tournament logo' })
            }
        }

        if (req.files?.banner?.[0]) {
            try {
                finalBannerUrl = await uploadImageBuffer(req.files.banner[0].buffer)
            } catch (uploadErr) {
                return res.status(500).json({ success: false, message: 'Failed to upload tournament banner' })
            }
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
                prize,
                prizeType,
                ballType,
                pitchType,
                matchType,
                maxTeams,
                logoUrl: finalLogoUrl,
                bannerUrl: finalBannerUrl,
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
        console.log(err)
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
                prize: true,
                prizeType: true,
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
                        team: {
                            select: {
                                id: true, name: true, logoUrl: true, owner: {
                                    select: {
                                        name: true,
                                        phone: true
                                    }
                                }
                            }
                        },
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
                        ground: true,
                        ballsPerOver: true,
                        innings: {
                            select: { id: true, inningNumber: true },
                            orderBy: { inningNumber: 'asc' },
                        },
                    },
                },
            },
        })
        if (!tournament) return res.status(404).json({ success: false, message: 'Tournament not found' })
        const { matches = [], ...rest } = tournament

        const processedMatches = matches.map(({ innings = [], ...matchData }) => {
            const sortedInnings = [...innings].sort((a, b) => (a.inningNumber ?? 0) - (b.inningNumber ?? 0))
            const lastInning = sortedInnings[sortedInnings.length - 1] || null
            const inningsStarted = sortedInnings.length > 0
            const lastInningNumber = lastInning?.inningNumber ?? null
            let lastInningPhase = null
            if (lastInningNumber != null) {
                if (lastInningNumber === 1) lastInningPhase = 'FIRST'
                else if (lastInningNumber === 2) lastInningPhase = 'SECOND'
                else lastInningPhase = `INNING_${lastInningNumber}`
            }

            return {
                ...matchData,
                inningsStarted,
                lastInningId: lastInning?.id || null,
                lastInningNumber,
                lastInningPhase,
            }
        })

        return res.json({ success: true, data: { ...rest, matches: processedMatches } })
    } catch (err) {
        console.log(err)
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
                prize: true,
                prizeType: true,
                startDate: true,
                endDate: true,
                matchType: true,
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

// GET /tournaments/:tournamentId/stats -> Detailed tournament statistics
tournamentRouter.get('/:tournamentId/stats', async (req, res) => {
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
                matchType: true,
                maxTeams: true,
                prize: true,
                prizeType: true,
                logoUrl: true,
                bannerUrl: true,
                createdAt: true,
            },
        })

        if (!tournament) {
            return res.status(404).json({ success: false, message: 'Tournament not found' })
        }

        const [registeredTeams, matches] = await Promise.all([
            prisma.tournamentTeam.findMany({
                where: { tournamentId },
                select: {
                    id: true,
                    teamId: true,
                    registeredAt: true,
                    team: { select: { id: true, name: true, logoUrl: true } },
                },
                orderBy: { registeredAt: 'asc' },
            }),
            prisma.match.findMany({
                where: { tournamentId },
                select: {
                    id: true,
                    status: true,
                    startTime: true,
                    teamAId: true,
                    teamBId: true,
                    winningTeamId: true,
                    result: true,
                    teamA: { select: { id: true, name: true, logoUrl: true } },
                    teamB: { select: { id: true, name: true, logoUrl: true } },
                },
            }),
        ])

        const teamStatsMap = new Map()
        const ensureTeam = (teamId, teamData = null) => {
            if (!teamId) return null
            if (!teamStatsMap.has(teamId)) {
                teamStatsMap.set(teamId, {
                    teamId,
                    name: teamData?.name || null,
                    logoUrl: teamData?.logoUrl || null,
                    matchesPlayed: 0,
                    wins: 0,
                    losses: 0,
                    ties: 0,
                    noResult: 0,
                    points: 0,
                })
            } else if (teamData) {
                const entry = teamStatsMap.get(teamId)
                // Backfill name/logo if missing
                if (!entry.name && teamData?.name) entry.name = teamData.name
                if (!entry.logoUrl && teamData?.logoUrl) entry.logoUrl = teamData.logoUrl
            }
            return teamStatsMap.get(teamId)
        }

        registeredTeams.forEach((registration) => {
            ensureTeam(registration.teamId, registration.team)
        })

        const matchStatusCounts = {
            total: matches.length,
            completed: 0,
            live: 0,
            scheduled: 0,
            abandoned: 0,
        }

        matches.forEach((match) => {
            ensureTeam(match.teamAId, match.teamA)
            ensureTeam(match.teamBId, match.teamB)

            const teamAEntry = teamStatsMap.get(match.teamAId)
            const teamBEntry = teamStatsMap.get(match.teamBId)

            switch (match.status) {
                case 'COMPLETED':
                    matchStatusCounts.completed += 1
                    if (teamAEntry) teamAEntry.matchesPlayed += 1
                    if (teamBEntry) teamBEntry.matchesPlayed += 1

                    if (match.winningTeamId === match.teamAId) {
                        teamAEntry.wins += 1
                        teamAEntry.points += 2
                        teamBEntry.losses += 1
                    } else if (match.winningTeamId === match.teamBId) {
                        teamBEntry.wins += 1
                        teamBEntry.points += 2
                        teamAEntry.losses += 1
                    } else {
                        // Tie or shared result
                        teamAEntry.ties += 1
                        teamBEntry.ties += 1
                        teamAEntry.points += 1
                        teamBEntry.points += 1
                    }
                    break
                case 'LIVE':
                    matchStatusCounts.live += 1
                    break
                case 'SCHEDULED':
                    matchStatusCounts.scheduled += 1
                    break
                case 'ABANDONED':
                    matchStatusCounts.abandoned += 1
                    if (teamAEntry) teamAEntry.matchesPlayed += 1
                    if (teamBEntry) teamBEntry.matchesPlayed += 1
                    if (teamAEntry) teamAEntry.noResult += 1
                    if (teamBEntry) teamBEntry.noResult += 1
                    if (teamAEntry) teamAEntry.points += 1
                    if (teamBEntry) teamBEntry.points += 1
                    break
                default:
                    break
            }
        })

        const standings = Array.from(teamStatsMap.values()).sort((a, b) => {
            if (b.points !== a.points) return b.points - a.points
            if (b.wins !== a.wins) return b.wins - a.wins
            return (b.matchesPlayed || 0) - (a.matchesPlayed || 0)
        })

        const maxPoints = standings.reduce((max, team) => Math.max(max, team.points), 0)
        const teamsWithMaxPoints = standings.filter((team) => team.points === maxPoints && maxPoints > 0)

        const matchIds = matches.map((m) => m.id)

        let aggregateRuns = { runs: 0, wickets: 0 }
        let topRunScorers = []
        let topWicketTakers = []
        let bestBattingInnings = []
        let bestBowlingSpells = []
        let highestTeamInnings = []

        if (matchIds.length) {
            const [
                battingTotals,
                bowlingTotals,
                bestBattingInningsData,
                bestBowlingSpellsData,
                inningsAggregate,
                highestTeamInningsData,
            ] = await Promise.all([
                prisma.battingEntry.groupBy({
                    by: ['playerId'],
                    where: { inning: { matchId: { in: matchIds } } },
                    _sum: { runs: true, ballsFaced: true, fours: true, sixes: true },
                    _count: { _all: true },
                    orderBy: [
                        { _sum: { runs: 'desc' } },
                        { _sum: { ballsFaced: 'asc' } },
                    ],
                    take: 10,
                }),
                prisma.bowlingEntry.groupBy({
                    by: ['playerId'],
                    where: { inning: { matchId: { in: matchIds } } },
                    _sum: { wickets: true, runsConceded: true, balls: true, maidens: true },
                    _count: { _all: true },
                    orderBy: [
                        { _sum: { wickets: 'desc' } },
                        { _sum: { runsConceded: 'asc' } },
                    ],
                    take: 10,
                }),
                prisma.battingEntry.findMany({
                    where: { inning: { matchId: { in: matchIds } } },
                    orderBy: [
                        { runs: 'desc' },
                        { ballsFaced: 'asc' },
                        { fours: 'desc' },
                    ],
                    take: 5,
                    select: {
                        id: true,
                        playerId: true,
                        runs: true,
                        ballsFaced: true,
                        fours: true,
                        sixes: true,
                        inningId: true,
                        inning: {
                            select: {
                                id: true,
                                inningNumber: true,
                                runs: true,
                                wickets: true,
                                battingTeam: { select: { id: true, name: true } },
                                bowlingTeam: { select: { id: true, name: true } },
                                match: { select: { id: true } },
                            },
                        },
                    },
                }),
                prisma.bowlingEntry.findMany({
                    where: { inning: { matchId: { in: matchIds } } },
                    orderBy: [
                        { wickets: 'desc' },
                        { runsConceded: 'asc' },
                        { balls: 'asc' },
                    ],
                    take: 5,
                    select: {
                        id: true,
                        playerId: true,
                        wickets: true,
                        runsConceded: true,
                        balls: true,
                        maidens: true,
                        inningId: true,
                        inning: {
                            select: {
                                id: true,
                                inningNumber: true,
                                runs: true,
                                wickets: true,
                                battingTeam: { select: { id: true, name: true } },
                                bowlingTeam: { select: { id: true, name: true } },
                                match: { select: { id: true } },
                            },
                        },
                    },
                }),
                prisma.inning.aggregate({
                    where: { matchId: { in: matchIds } },
                    _sum: { runs: true, wickets: true },
                }),
                prisma.inning.findMany({
                    where: { matchId: { in: matchIds } },
                    orderBy: [{ runs: 'desc' }],
                    take: 5,
                    select: {
                        id: true,
                        matchId: true,
                        inningNumber: true,
                        runs: true,
                        wickets: true,
                        overs: true,
                        battingTeam: { select: { id: true, name: true, logoUrl: true } },
                        bowlingTeam: { select: { id: true, name: true } },
                    },
                }),
            ])

            aggregateRuns = {
                runs: inningsAggregate?._sum?.runs || 0,
                wickets: inningsAggregate?._sum?.wickets || 0,
            }

            const playerIds = new Set()
            battingTotals.forEach((row) => playerIds.add(row.playerId))
            bowlingTotals.forEach((row) => playerIds.add(row.playerId))
            bestBattingInningsData.forEach((row) => playerIds.add(row.playerId))
            bestBowlingSpellsData.forEach((row) => playerIds.add(row.playerId))

            const players = playerIds.size
                ? await prisma.player.findMany({
                      where: { id: { in: Array.from(playerIds) } },
                      select: {
                          id: true,
                          name: true,
                          profilepic: true,
                          playingRole: true,
                          battingStyle: true,
                          bowlingStyle: true,
                      },
                  })
                : []

            const playerLookup = new Map(players.map((p) => [p.id, p]))

            topRunScorers = battingTotals.map((row) => {
                const info = playerLookup.get(row.playerId) || { id: row.playerId }
                const runs = row._sum?.runs || 0
                const balls = row._sum?.ballsFaced || 0
                return {
                    player: info,
                    runs,
                    ballsFaced: balls,
                    strikeRate: balls > 0 ? Number(((runs / balls) * 100).toFixed(2)) : null,
                    inningsCount: row._count?._all || 0,
                    fours: row._sum?.fours || 0,
                    sixes: row._sum?.sixes || 0,
                }
            })

            topWicketTakers = bowlingTotals.map((row) => {
                const info = playerLookup.get(row.playerId) || { id: row.playerId }
                const wickets = row._sum?.wickets || 0
                const runsConceded = row._sum?.runsConceded || 0
                const balls = row._sum?.balls || 0
                return {
                    player: info,
                    wickets,
                    runsConceded,
                    balls,
                    overs: ballsToOvers(balls),
                    economy: balls > 0 ? Number(((runsConceded * 6) / balls).toFixed(2)) : null,
                    maidens: row._sum?.maidens || 0,
                    spellsCount: row._count?._all || 0,
                }
            })

            bestBattingInnings = bestBattingInningsData.map((entry) => {
                const info = playerLookup.get(entry.playerId) || { id: entry.playerId }
                const inning = entry.inning
                return {
                    entryId: entry.id,
                    player: info,
                    runs: entry.runs,
                    ballsFaced: entry.ballsFaced,
                    fours: entry.fours,
                    sixes: entry.sixes,
                    strikeRate: entry.ballsFaced > 0 ? Number(((entry.runs / entry.ballsFaced) * 100).toFixed(2)) : null,
                    inning: inning
                        ? {
                              inningId: inning.id,
                              matchId: inning.match?.id || null,
                              inningNumber: inning.inningNumber,
                              team: inning.battingTeam,
                              opponent: inning.bowlingTeam,
                              runs: inning.runs,
                              wickets: inning.wickets,
                          }
                        : null,
                }
            })

            bestBowlingSpells = bestBowlingSpellsData.map((entry) => {
                const info = playerLookup.get(entry.playerId) || { id: entry.playerId }
                const inning = entry.inning
                const balls = entry.balls || 0
                const runsConceded = entry.runsConceded || 0
                return {
                    entryId: entry.id,
                    player: info,
                    wickets: entry.wickets,
                    runsConceded,
                    balls,
                    overs: ballsToOvers(balls),
                    economy: balls > 0 ? Number(((runsConceded * 6) / balls).toFixed(2)) : null,
                    maidens: entry.maidens,
                    inning: inning
                        ? {
                              inningId: inning.id,
                              matchId: inning.match?.id || null,
                              inningNumber: inning.inningNumber,
                              team: inning.bowlingTeam,
                              opponent: inning.battingTeam,
                              runs: inning.runs,
                              wickets: inning.wickets,
                          }
                        : null,
                }
            })

            highestTeamInnings = highestTeamInningsData.map((inning) => ({
                inningId: inning.id,
                matchId: inning.matchId,
                inningNumber: inning.inningNumber,
                team: inning.battingTeam,
                opponent: inning.bowlingTeam,
                runs: inning.runs,
                wickets: inning.wickets,
                overs: inning.overs,
            }))
        }

        const response = {
            tournament,
            summary: {
                registeredTeams: registeredTeams.length,
                matches: matchStatusCounts,
                totalRuns: aggregateRuns.runs,
                totalWickets: aggregateRuns.wickets,
            },
            standings: {
                table: standings,
                maxPoints,
                teamsWithMaxPointsCount: teamsWithMaxPoints.length,
                teamsWithMaxPoints: teamsWithMaxPoints,
            },
            batting: {
                highestRunScorer: topRunScorers[0] || null,
                topRunScorers,
                bestInnings: bestBattingInnings,
            },
            bowling: {
                highestWicketTaker: topWicketTakers[0] || null,
                topWicketTakers,
                bestSpells: bestBowlingSpells,
            },
            records: {
                highestTeamInnings,
            },
        }

        return res.json({ success: true, data: response })
    } catch (err) {
        console.log(err)
        return res.status(500).json({ success: false, message: 'Failed to compute tournament stats' })
    }
})

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
export default tournamentRouter