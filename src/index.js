import express from 'express'
import tournamentRouter from './tournament';
import matchRouter from './match';
import userRouter from './users';

const userRouter = express.Router();

userRouter.use('/tournament', tournamentRouter);
userRouter.use('/match', matchRouter);
userRouter.use('/users', userRouter);

export default userRouter