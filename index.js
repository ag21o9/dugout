import express from 'express'
import cors from 'cors'
import userRouter from './src/index.js'
const app = express()


app.use(express.urlencoded({ extended: false }))
app.use(express.json())

app.use(cors());

app.use('api/v1/user',userRouter);

app.use('*',(req,res)=>{
    res.status(400).json({
        success : false,
        message : "Error 404, Route not Found"
    })
})


app.listen(3000, (req, ress) => {
    console.log("app listening on port 3000");
})