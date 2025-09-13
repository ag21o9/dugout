import express from 'express'
import prisma from './prisma.js'
import { requireAuth } from './middleware/auth.js'

const inningsRouter = express.Router({ mergeParams: true })

async function ensureMatchAccess(matchId, userId) {
    const match = await prisma.match.findUnique({
        where: { id: matchId },
        select: {
            id: true,
            status: true,
            tournament: { select: { organiser: true } },
            roles: { select: { userId: true, role: true } },
        },
    })
    if (!match) return { error: { code: 404, message: 'Match not found' } }
    const isOrganiser = match.tournament?.organiser && match.tournament.organiser === userId
    const hasScorerRole = match.roles.some((r) => r.userId === userId && (r.role === 'SCORER' || r.role === 'UMPIRE' || r.role === 'ORGANISER'))
    if (!(isOrganiser || hasScorerRole)) return { error: { code: 403, message: 'Not permitted for scoring' } }
    return { match }
}

function oversFromBalls(balls) {
    // returns string like "10.3" assuming 6 balls per over isn't known here, caller provides ballsPerOver
    return balls
}

async function getMatchConfig(matchId) {
    const m = await prisma.match.findUnique({ where: { id: matchId }, select: { ballsPerOver: true, oversLimit: true, teamAId: true, teamBId: true, status: true } })
    return m
}

// POST /matches/:matchId/innings → Start an inning
inningsRouter.post('/', requireAuth, async (req, res) => {
    try {
        const { matchId } = req.params
        const { inningNumber, battingTeamId, bowlingTeamId, strikerId, nonStrikerId, bowlerId } = req.body || {}
        const access = await ensureMatchAccess(matchId, req.user.id)
        if (access.error) return res.status(access.error.code).json({ success: false, message: access.error.message })

        const cfg = await getMatchConfig(matchId)
        if (!cfg) return res.status(404).json({ success: false, message: 'Match not found' })
        if (cfg.status !== 'LIVE') return res.status(400).json({ success: false, message: 'Match must be LIVE to start an inning' })
        if (!inningNumber || !battingTeamId || !bowlingTeamId || !strikerId || !nonStrikerId || !bowlerId) {
            return res.status(400).json({ success: false, message: 'inningNumber, battingTeamId, bowlingTeamId, strikerId, nonStrikerId, bowlerId are required' })
        }
        if (battingTeamId === bowlingTeamId) return res.status(400).json({ success: false, message: 'battingTeamId and bowlingTeamId must differ' })

        // Validate teams belong to match
        if (![cfg.teamAId, cfg.teamBId].includes(battingTeamId) || ![cfg.teamAId, cfg.teamBId].includes(bowlingTeamId)) {
            return res.status(400).json({ success: false, message: 'Teams must be part of the match' })
        }

        const inning = await prisma.inning.create({
            data: {
                matchId,
                inningNumber,
                battingTeamId,
                bowlingTeamId,
                strikerId,
                nonStrikerId,
                currentBowlerId: bowlerId,
            },
            select: { id: true, matchId: true, inningNumber: true, battingTeamId: true, bowlingTeamId: true, strikerId: true, nonStrikerId: true, currentBowlerId: true, runs: true, wickets: true, overs: true },
        })
        return res.status(201).json({ success: true, data: inning })
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Failed to start inning' })
    }
})

// POST /matches/:matchId/innings/:inningId/end → End the inning manually
inningsRouter.post('/:inningId/end', requireAuth, async (req, res) => {
    try {
        const { matchId, inningId } = req.params
        const access = await ensureMatchAccess(matchId, req.user.id)
        if (access.error) return res.status(access.error.code).json({ success: false, message: access.error.message })

        const inning = await prisma.inning.findUnique({ where: { id: inningId }, select: { id: true, matchId: true } })
        if (!inning || inning.matchId !== matchId) return res.status(404).json({ success: false, message: 'Inning not found' })
        // No explicit status field; rely on usage to stop scoring.
        return res.json({ success: true, data: { id: inning.id, ended: true } })
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Failed to end inning' })
    }
})

// GET /matches/:matchId/innings → List innings
inningsRouter.get('/', async (req, res) => {
    try {
        const { matchId } = req.params
        const innings = await prisma.inning.findMany({
            where: { matchId },
            select: { id: true, inningNumber: true, battingTeamId: true, bowlingTeamId: true, runs: true, wickets: true, overs: true, strikerId: true, nonStrikerId: true, currentBowlerId: true },
            orderBy: { inningNumber: 'asc' },
        })
        return res.json({ success: true, data: innings })
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Failed to list innings' })
    }
})

// GET /matches/:matchId/innings/live → Consolidated live scorecard
inningsRouter.get('/live', async (req, res) => {
    try {
        const { matchId } = req.params
        const match = await prisma.match.findUnique({
            where: { id: matchId },
            select: {
                id: true,
                status: true,
                ballsPerOver: true,
                oversLimit: true,
                teamAId: true,
                teamBId: true,
                teamA: { select: { id: true, name: true, logoUrl: true } },
                teamB: { select: { id: true, name: true, logoUrl: true } }
            }
        })
        if (!match) return res.status(404).json({ success: false, message: 'Match not found' })

        const innings = await prisma.inning.findMany({
            where: { matchId },
            select: { id: true, inningNumber: true, battingTeamId: true, bowlingTeamId: true, runs: true, wickets: true, overs: true, strikerId: true, nonStrikerId: true, currentBowlerId: true },
            orderBy: { inningNumber: 'asc' },
        })

        if (!innings.length) {
            return res.json({ success: true, data: { match, innings: [], currentInning: null, chase: null } })
        }

        const current = innings[innings.length - 1]
        const state = await buildMatchState(current.id)

        // Build lookup maps for team names and player names
        const teamMap = new Map([
            [match.teamAId, match.teamA ? { name: match.teamA.name, logoUrl: match.teamA.logoUrl } : { name: null, logoUrl: null }],
            [match.teamBId, match.teamB ? { name: match.teamB.name, logoUrl: match.teamB.logoUrl } : { name: null, logoUrl: null }],
        ])

        const playerIds = new Set()
        innings.forEach((inn) => {
            if (inn.strikerId) playerIds.add(inn.strikerId)
            if (inn.nonStrikerId) playerIds.add(inn.nonStrikerId)
            if (inn.currentBowlerId) playerIds.add(inn.currentBowlerId)
        })
        if (state) {
            if (state.strikerId) playerIds.add(state.strikerId)
            if (state.nonStrikerId) playerIds.add(state.nonStrikerId)
            if (state.bowlerId) playerIds.add(state.bowlerId)
        }

        const players = playerIds.size
            ? await prisma.player.findMany({ where: { id: { in: Array.from(playerIds) } }, select: { id: true, name: true } })
            : []
        const playerMap = new Map(players.map((p) => [p.id, p.name]))

        const inningsEnriched = innings.map((inn) => ({
            ...inn,
            battingTeamName: teamMap.get(inn.battingTeamId)?.name || null,
            bowlingTeamName: teamMap.get(inn.bowlingTeamId)?.name || null,
            strikerName: inn.strikerId ? (playerMap.get(inn.strikerId) || null) : null,
            nonStrikerName: inn.nonStrikerId ? (playerMap.get(inn.nonStrikerId) || null) : null,
            currentBowlerName: inn.currentBowlerId ? (playerMap.get(inn.currentBowlerId) || null) : null,
        }))

        let chase = null
        if (innings.length > 1) {
            const prevMax = Math.max(...innings.slice(0, -1).map((i) => i.runs))
            const target = prevMax + 1
            const legalBalls = await prisma.ball.count({ where: { inningId: current.id, ballType: { in: ['NORMAL', 'FREE_HIT', 'BYE', 'LEG_BYE'] } } })
            const ballsLimit = match.oversLimit * match.ballsPerOver
            const ballsLeft = Math.max(0, ballsLimit - legalBalls)
            const needed = Math.max(0, target - current.runs)
            const currentRunRate = legalBalls > 0 ? (current.runs * match.ballsPerOver) / legalBalls : 0
            const requiredRunRate = ballsLeft > 0 ? (needed * match.ballsPerOver) / ballsLeft : 0
            chase = {
                target,
                needed,
                ballsLeft,
                wicketsLeft: Math.max(0, 10 - current.wickets),
                currentRunRate: Number(currentRunRate.toFixed(2)),
                requiredRunRate: Number(requiredRunRate.toFixed(2)),
            }
        }

        const currentInningEnriched = state
            ? {
                  ...current,
                  ...state,
                  battingTeamName: teamMap.get(current.battingTeamId)?.name || null,
                  bowlingTeamName: teamMap.get(current.bowlingTeamId)?.name || null,
                  strikerName: state.strikerId ? (playerMap.get(state.strikerId) || null) : null,
                  nonStrikerName: state.nonStrikerId ? (playerMap.get(state.nonStrikerId) || null) : null,
                  bowlerName: state.bowlerId ? (playerMap.get(state.bowlerId) || null) : null,
              }
            : current

        return res.json({
            success: true,
            data: {
                match,
                innings: inningsEnriched,
                currentInning: currentInningEnriched,
                chase,
            },
        })
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Failed to get live scorecard' })
    }
})

// GET /matches/:matchId/innings/live-teams → Players of current batting/bowling teams
inningsRouter.get('/live-teams', async (req, res) => {
    try {
        const { matchId } = req.params

        const latestInning = await prisma.inning.findFirst({
            where: { matchId },
            orderBy: { inningNumber: 'desc' },
            select: { id: true, battingTeamId: true, bowlingTeamId: true }
        })

        if (!latestInning) {
            return res.status(404).json({ success: false, message: 'No innings started for this match' })
        }

        const [batMembers, bowlMembers] = await Promise.all([
            prisma.teamMembership.findMany({
                where: { teamId: latestInning.battingTeamId },
                select: { player: { select: { id: true, name: true, battingStyle: true, bowlingStyle: true } } }
            }),
            prisma.teamMembership.findMany({
                where: { teamId: latestInning.bowlingTeamId },
                select: { player: { select: { id: true, name: true, battingStyle: true, bowlingStyle: true } } }
            })
        ])

        const mapPlayer = (pm) => ({
            id: pm.player.id,
            name: pm.player.name,
            battingType: pm.player.battingStyle || null,
            bowlingType: pm.player.bowlingStyle || null,
        })

        return res.json({
            success: true,
            data: {
                battingTeamId: latestInning.battingTeamId,
                bowlingTeamId: latestInning.bowlingTeamId,
                battingTeam: batMembers.map(mapPlayer),
                bowlingTeam: bowlMembers.map(mapPlayer),
            }
        })
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Failed to load team players' })
    }
})

// GET /matches/:matchId/innings/getbatteam → Current batting team players (auth)
inningsRouter.get('/getbatteam', requireAuth, async (req, res) => {
    try {
        const { matchId } = req.params

        const latestInning = await prisma.inning.findFirst({
            where: { matchId },
            orderBy: { inningNumber: 'desc' },
            select: { battingTeamId: true }
        })
        if (!latestInning) return res.status(404).json({ success: false, message: 'No innings started for this match' })

        const members = await prisma.teamMembership.findMany({
            where: { teamId: latestInning.battingTeamId },
            select: { player: { select: { id: true, name: true, battingStyle: true, bowlingStyle: true } } }
        })

        const players = members.map(m => ({
            id: m.player.id,
            name: m.player.name,
            battingType: m.player.battingStyle || null,
            bowlingType: m.player.bowlingStyle || null,
        }))

        return res.json({ success: true, data: { teamId: latestInning.battingTeamId, players } })
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Failed to load batting team' })
    }
})

// GET /matches/:matchId/innings/getbowlteam → Current bowling team players (auth)
inningsRouter.get('/getbowlteam', requireAuth, async (req, res) => {
    try {
        const { matchId } = req.params

        const latestInning = await prisma.inning.findFirst({
            where: { matchId },
            orderBy: { inningNumber: 'desc' },
            select: { bowlingTeamId: true }
        })
        if (!latestInning) return res.status(404).json({ success: false, message: 'No innings started for this match' })

        const members = await prisma.teamMembership.findMany({
            where: { teamId: latestInning.bowlingTeamId },
            select: { player: { select: { id: true, name: true, battingStyle: true, bowlingStyle: true } } }
        })

        const players = members.map(m => ({
            id: m.player.id,
            name: m.player.name,
            battingType: m.player.battingStyle || null,
            bowlingType: m.player.bowlingStyle || null,
        }))

        return res.json({ success: true, data: { teamId: latestInning.bowlingTeamId, players } })
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Failed to load bowling team' })
    }
})

function computeNextState({ runs, ballType, manualStrikeChange, currentOverBalls, ballsPerOver, strikerId, nonStrikerId }) {
    let nextStrikerId = strikerId
    let nextNonStrikerId = nonStrikerId
    let addBall = false

    // Does this ball count? Legal: NORMAL, BYE, LEG_BYE, FREE_HIT
    addBall = ballType === 'NORMAL' || ballType === 'FREE_HIT' || ballType === 'BYE' || ballType === 'LEG_BYE'

    // Strike change by runs for legal deliveries
    if (addBall) {
        if (runs % 2 === 1) {
            const tmp = nextStrikerId
            nextStrikerId = nextNonStrikerId
            nextNonStrikerId = tmp
        }
    }

    // Manual override
    if (manualStrikeChange) {
        const tmp = nextStrikerId
        nextStrikerId = nextNonStrikerId
        nextNonStrikerId = tmp
    }

    // End of over swap if ball counts and completes over
    let completesOver = false
    if (addBall) {
        const afterBalls = (currentOverBalls + 1) % ballsPerOver
        completesOver = afterBalls === 0
        if (completesOver) {
            const tmp = nextStrikerId
            nextStrikerId = nextNonStrikerId
            nextNonStrikerId = tmp
        }
    }

    return { nextStrikerId, nextNonStrikerId, addBall, completesOver }
}

async function buildMatchState(inningId) {
    const inning = await prisma.inning.findUnique({
        where: { id: inningId },
        select: {
            id: true,
            match: { select: { ballsPerOver: true, oversLimit: true } },
            strikerId: true,
            nonStrikerId: true,
            currentBowlerId: true,
            runs: true,
            wickets: true,
            balls: { select: { id: true, ballType: true } },
        },
    })
    if (!inning) return null
    const legalBalls = inning.balls.filter((b) => ['NORMAL', 'FREE_HIT', 'BYE', 'LEG_BYE'].includes(b.ballType)).length
    const oversCompleted = Math.floor(legalBalls / inning.match.ballsPerOver)
    const ballsIntoOver = legalBalls % inning.match.ballsPerOver
    return {
        strikerId: inning.strikerId,
        nonStrikerId: inning.nonStrikerId,
        bowlerId: inning.currentBowlerId,
        runs: inning.runs,
        wickets: inning.wickets,
        overs: `${oversCompleted}.${ballsIntoOver}`,
        needNewBatsman: inning.strikerId == null || inning.nonStrikerId == null,
        needNewBowler: inning.currentBowlerId == null,
    }
}

// POST /matches/:matchId/innings/:inningId/balls → Record a ball
inningsRouter.post('/:inningId/balls', requireAuth, async (req, res) => {
    try {
        const { matchId, inningId } = req.params
        const { runs = 0, ballType = 'NORMAL', wicket, shotType, shotRegion, manualStrikeChange = false } = req.body || {}
        const access = await ensureMatchAccess(matchId, req.user.id)
        if (access.error) return res.status(access.error.code).json({ success: false, message: access.error.message })

        const inning = await prisma.inning.findUnique({
            where: { id: inningId },
            select: {
                id: true,
                match: { select: { id: true, ballsPerOver: true, oversLimit: true, status: true } },
                matchId: true,
                strikerId: true,
                nonStrikerId: true,
                currentBowlerId: true,
                runs: true,
                wickets: true,
                balls: { select: { id: true, ballType: true } },
            },
        })
        if (!inning || inning.matchId !== matchId) return res.status(404).json({ success: false, message: 'Inning not found' })
        if (inning.match.status !== 'LIVE') return res.status(400).json({ success: false, message: 'Match is not LIVE' })

        // Prevent ball if wicket waiting for batsman selection
        if (inning.strikerId == null || inning.nonStrikerId == null || inning.currentBowlerId == null) {
            return res.status(409).json({ success: false, message: 'Select new batsman/bowler before next ball' })
        }

        const legalBallsSoFar = inning.balls.filter((b) => ['NORMAL', 'FREE_HIT', 'BYE', 'LEG_BYE'].includes(b.ballType)).length
        const currentOverBalls = legalBallsSoFar % inning.match.ballsPerOver
        const { nextStrikerId, nextNonStrikerId, addBall, completesOver } = computeNextState({
            runs,
            ballType,
            manualStrikeChange,
            currentOverBalls,
            ballsPerOver: inning.match.ballsPerOver,
            strikerId: inning.strikerId,
            nonStrikerId: inning.nonStrikerId,
        })

        // Totals update
        let runsToAdd = runs
        if (ballType === 'WIDE' || ballType === 'NO_BALL' || ballType === 'PENALTY') {
            if (runsToAdd < 1) runsToAdd = 1 // at least 1 for extras like wide/no-ball
        }

        // Compute new oversCompleted after this ball
        const newLegalBalls = legalBallsSoFar + (addBall ? 1 : 0)
        const oversCompleted = Math.floor(newLegalBalls / inning.match.ballsPerOver)
        const newTotals = {
            runs: inning.runs + runsToAdd,
            wickets: inning.wickets + (wicket ? 1 : 0),
        }

        // Create ball row
        const createdBall = await prisma.ball.create({
            data: {
                inningId,
                overNumber: Math.floor(legalBallsSoFar / inning.match.ballsPerOver) + 1,
                ballInOver: (legalBallsSoFar % inning.match.ballsPerOver) + (addBall ? 1 : 0) || 1,
                batsmanId: inning.strikerId,
                bowlerId: inning.currentBowlerId,
                runs,
                extras: ['WIDE', 'NO_BALL', 'BYE', 'LEG_BYE', 'PENALTY'].includes(ballType) ? ballType : null,
                ballType,
                wicket: wicket?.kind || null,
                shotType: shotType || null,
                shotRegion: shotRegion || null,
            },
            select: { id: true },
        })

        // Update inning state
        let updateData = {
            runs: newTotals.runs,
            wickets: newTotals.wickets,
            overs: oversCompleted,
        }

        // Handle wicket: block next ball until new striker set
        if (wicket && wicket.playerId) {
            if (wicket.playerId === inning.strikerId) {
                updateData = { ...updateData, strikerId: null }
            } else if (wicket.playerId === inning.nonStrikerId) {
                updateData = { ...updateData, nonStrikerId: null }
            }
        } else {
            updateData = { ...updateData, strikerId: nextStrikerId, nonStrikerId: nextNonStrikerId }
        }

        // End of over: require new bowler selection by setting currentBowlerId null
        if (completesOver) {
            updateData = { ...updateData, currentBowlerId: null }
        }

        // Auto end conditions: overs exhausted
        const totalLegalBalls = legalBallsSoFar + (addBall ? 1 : 0)
        const inningsBallsLimit = inning.match.oversLimit * inning.match.ballsPerOver
        let inningEnded = false
        if (totalLegalBalls >= inningsBallsLimit || newTotals.wickets >= 10) {
            inningEnded = true
        }

        // Target achieved check (simple): if this is 2nd+ innings and surpass target
        if (!inningEnded) {
            const currentInning = await prisma.inning.findUnique({ where: { id: inningId }, select: { inningNumber: true } })
            const otherInnings = await prisma.inning.findMany({ where: { matchId }, select: { inningNumber: true, runs: true } })
            const prevInnings = otherInnings.filter((i) => i.inningNumber < currentInning.inningNumber)
            if (prevInnings.length) {
                const target = Math.max(...prevInnings.map((i) => i.runs))
                if (newTotals.runs > target) inningEnded = true
            }
        }

        const updatedInning = await prisma.inning.update({ where: { id: inningId }, data: updateData, select: { id: true, runs: true, wickets: true, overs: true, strikerId: true, nonStrikerId: true, currentBowlerId: true } })

        // Update scorecards
        // Batting entry for striker
        const batterId = inning.strikerId
        const legalDeliveryFaced = addBall && (ballType === 'NORMAL' || ballType === 'FREE_HIT' || ballType === 'BYE' || ballType === 'LEG_BYE')
        const runsToBatter = (ballType === 'NORMAL' || ballType === 'FREE_HIT') ? runs : 0
        const boundaries = { fours: runsToBatter === 4 ? 1 : 0, sixes: runsToBatter === 6 ? 1 : 0 }

        const existingBat = await prisma.battingEntry.findFirst({ where: { inningId, playerId: batterId } })
        if (existingBat) {
            await prisma.battingEntry.update({
                where: { id: existingBat.id },
                data: {
                    runs: existingBat.runs + runsToBatter,
                    ballsFaced: existingBat.ballsFaced + (legalDeliveryFaced ? 1 : 0),
                    fours: existingBat.fours + boundaries.fours,
                    sixes: existingBat.sixes + boundaries.sixes,
                },
            })
        } else {
            const lastOrder = await prisma.battingEntry.findFirst({ where: { inningId }, orderBy: { battingOrder: 'desc' }, select: { battingOrder: true } })
            await prisma.battingEntry.create({
                data: {
                    inningId,
                    playerId: batterId,
                    battingOrder: (lastOrder?.battingOrder || 0) + 1,
                    runs: runsToBatter,
                    ballsFaced: legalDeliveryFaced ? 1 : 0,
                    fours: boundaries.fours,
                    sixes: boundaries.sixes,
                }
            })
        }

        // Mark out if wicket with playerId
        if (wicket && wicket.playerId) {
            const be = await prisma.battingEntry.findFirst({ where: { inningId, playerId: wicket.playerId } })
            if (be) {
                await prisma.battingEntry.update({ where: { id: be.id }, data: { out: true, dismissal: wicket.kind || 'OUT' } })
            }
        }

        // Bowling entry updates
        const bowlerId = inning.currentBowlerId
        const existingBowl = await prisma.bowlingEntry.findFirst({ where: { inningId, playerId: bowlerId } })
        const concedeToBowler = !(ballType === 'BYE' || ballType === 'LEG_BYE' || ballType === 'PENALTY')
        const wicketToBowler = wicket && wicket.kind && wicket.kind.toUpperCase() !== 'RUN_OUT'
        if (existingBowl) {
            await prisma.bowlingEntry.update({
                where: { id: existingBowl.id }, data: {
                    balls: existingBowl.balls + (addBall ? 1 : 0),
                    overs: Math.floor((existingBowl.balls + (addBall ? 1 : 0)) / inning.match.ballsPerOver),
                    runsConceded: existingBowl.runsConceded + (concedeToBowler ? runsToAdd : 0),
                    wickets: existingBowl.wickets + (wicketToBowler ? 1 : 0),
                }
            })
        } else {
            await prisma.bowlingEntry.create({
                data: {
                    inningId,
                    playerId: bowlerId,
                    balls: addBall ? 1 : 0,
                    overs: addBall ? Math.floor(1 / inning.match.ballsPerOver) : 0,
                    runsConceded: concedeToBowler ? runsToAdd : 0,
                    maidens: 0,
                    wickets: wicketToBowler ? 1 : 0,
                }
            })
        }

        // If inning ended, respond accordingly
        const state = await buildMatchState(inningId)
        // Replace IDs with names in state and set runs to this ball's addition
        let strikerName = null
        let nonStrikerName = null
        let bowlerName = null
        const idSet = [updatedInning.strikerId, updatedInning.nonStrikerId, updatedInning.currentBowlerId].filter(Boolean)
        if (idSet.length) {
            const players = await prisma.player.findMany({ where: { id: { in: idSet } }, select: { id: true, name: true } })
            const byId = Object.fromEntries(players.map(p => [p.id, p.name]))
            strikerName = updatedInning.strikerId ? (byId[updatedInning.strikerId] || null) : null
            nonStrikerName = updatedInning.nonStrikerId ? (byId[updatedInning.nonStrikerId] || null) : null
            bowlerName = updatedInning.currentBowlerId ? (byId[updatedInning.currentBowlerId] || null) : null
        }

        const stateWithNames = {
            runs: runsToAdd,
            wickets: state?.wickets ?? updatedInning.wickets,
            overs: state?.overs ?? String(updatedInning.overs),
            striker: strikerName,
            nonStriker: nonStrikerName,
            bowler: bowlerName,
            needNewBatsman: state?.needNewBatsman ?? (updatedInning.strikerId == null || updatedInning.nonStrikerId == null),
            needNewBowler: state?.needNewBowler ?? (updatedInning.currentBowlerId == null),
        }

        return res.status(201).json({ success: true, data: { ballId: createdBall.id, inning: updatedInning, state: stateWithNames, inningEnded } })
    } catch (err) {
        console.log(err)
        return res.status(500).json({ success: false, message: 'Failed to record ball' })
    }
})

// POST /matches/:matchId/innings/:inningId/next-ball → helper to record with auto swap
inningsRouter.post('/:inningId/next-ball', requireAuth, async (req, res) => {
    // Reuse the same handler as /balls
    return inningsRouter.handle({ ...req, url: req.url.replace('/next-ball', '/balls'), method: 'POST' }, res)
})

// GET /matches/:matchId/innings/:inningId/balls → List balls
inningsRouter.get('/:inningId/balls', async (req, res) => {
    try {
        const { inningId } = req.params
        const balls = await prisma.ball.findMany({
            where: { inningId },
            select: { id: true, overNumber: true, ballInOver: true, batsmanId: true, bowlerId: true, runs: true, extras: true, ballType: true, wicket: true, shotType: true, shotRegion: true, createdAt: true },
            orderBy: [{ overNumber: 'asc' }, { ballInOver: 'asc' }],
        })
        return res.json({ success: true, data: balls })
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Failed to list balls' })
    }
})

// POST /matches/:matchId/innings/:inningId/select-batsman → set new striker after wicket
inningsRouter.post('/:inningId/select-batsman', requireAuth, async (req, res) => {
    try {
        const { matchId, inningId } = req.params
        const { strikerId } = req.body || {}
        const access = await ensureMatchAccess(matchId, req.user.id)
        if (access.error) return res.status(access.error.code).json({ success: false, message: access.error.message })
        if (!strikerId) return res.status(400).json({ success: false, message: 'strikerId is required' })

        const inning = await prisma.inning.findUnique({ where: { id: inningId }, select: { id: true, matchId: true, strikerId: true } })
        if (!inning || inning.matchId !== matchId) return res.status(404).json({ success: false, message: 'Inning not found' })

        const updated = await prisma.inning.update({ where: { id: inningId }, data: { strikerId }, select: { id: true, strikerId: true } })
        return res.json({ success: true, data: updated })
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Failed to select batsman' })
    }
})

export default inningsRouter
// POST /matches/:matchId/innings/:inningId/select-bowler → choose next over bowler
inningsRouter.post('/:inningId/select-bowler', requireAuth, async (req, res) => {
    try {
        const { matchId, inningId } = req.params
        const { bowlerId } = req.body || {}
        if (!bowlerId) return res.status(400).json({ success: false, message: 'bowlerId is required' })

        const access = await ensureMatchAccess(matchId, req.user.id)
        if (access.error) return res.status(access.error.code).json({ success: false, message: access.error.message })

        const inning = await prisma.inning.findUnique({
            where: { id: inningId },
            select: {
                id: true,
                matchId: true,
                currentBowlerId: true,
                bowlingTeamId: true,
                match: { select: { ballsPerOver: true, status: true } },
            },
        })
        if (!inning || inning.matchId !== matchId) return res.status(404).json({ success: false, message: 'Inning not found' })
        if (inning.match.status !== 'LIVE') return res.status(400).json({ success: false, message: 'Match is not LIVE' })

        // Must be at over break (we set currentBowlerId to null when an over completes)
        if (inning.currentBowlerId) return res.status(400).json({ success: false, message: 'Not at over break; finish current over first' })

        // Validate bowler belongs to bowling team
        const isMember = await prisma.teamMembership.findFirst({ where: { teamId: inning.bowlingTeamId, playerId: bowlerId }, select: { id: true } })
        if (!isMember) return res.status(400).json({ success: false, message: 'Bowler must be a member of the bowling team' })

        // Prevent consecutive overs by the same bowler
        const legalBallsSoFar = await prisma.ball.count({ where: { inningId, ballType: { in: ['NORMAL', 'FREE_HIT', 'BYE', 'LEG_BYE'] } } })
        if (legalBallsSoFar > 0) {
            const prevOverNumber = Math.floor(legalBallsSoFar / inning.match.ballsPerOver)
            if (prevOverNumber > 0) {
                const lastPrevOverBall = await prisma.ball.findFirst({
                    where: { inningId, overNumber: prevOverNumber },
                    orderBy: { createdAt: 'desc' },
                    select: { bowlerId: true },
                })
                if (lastPrevOverBall?.bowlerId === bowlerId) {
                    return res.status(400).json({ success: false, message: 'Same bowler cannot bowl consecutive overs' })
                }
            }
        }

        const updated = await prisma.inning.update({ where: { id: inningId }, data: { currentBowlerId: bowlerId }, select: { id: true, currentBowlerId: true } })
        const state = await buildMatchState(inningId)
        return res.json({ success: true, data: { inning: updated, state } })
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Failed to select bowler' })
    }
})
