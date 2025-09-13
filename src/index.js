import express from 'express'
import tournamentRouter from './tournament.js'
import matchRouter from './match.js'
import userRouter from './users.js'
import playersRouter from './players.js'
import teamsRouter from './teams.js'

const apiRouter = express.Router()

apiRouter.use('/tournaments', tournamentRouter)
apiRouter.use('/matches', matchRouter)
apiRouter.use('/users', userRouter)
apiRouter.use('/players', playersRouter)
apiRouter.use('/teams', teamsRouter)

export default apiRouter