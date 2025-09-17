import express from 'express'
import prisma from './prisma.js'
import jwt from 'jsonwebtoken'

const userRouter = express.Router()

// POST /users/login/request-otp → Request OTP (stub: always 1234)
userRouter.post('/login/request-otp', async (req, res) => {
	try {
		const { phone } = req.body || {}
		if (!phone) return res.status(400).json({ success: false, message: 'phone is required' })

		let user = await prisma.user.findFirst({ where: { phone } })
		if (!user) {
			res.status(201).send({status:201, message:"user not found"})
			// user = await prisma.user.create({
			// 	data: { phone, name: 'User', email: `${phone}@placeholder.local` },
			// 	select: { id: true, phone: true },
			// })
		}
		// In real world, send OTP via SMS. For now, return stub info.
		return res.json({ success: true, message: 'OTP sent', otp: '1234' })
	} catch (err) {
		return res.status(500).json({ success: false, message: 'Failed to request OTP' })
	}
})

// POST /users/login/verify-otp → Verify OTP and return JWT
userRouter.post('/login/verify-otp', async (req, res) => {
	try {
		const { phone, otp } = req.body || {}
		if (!phone || !otp) return res.status(400).json({ success: false, message: 'phone and otp are required' })
		if (otp !== '1234') return res.status(401).json({ success: false, message: 'Invalid OTP' })

		const user = await prisma.user.findFirst({
			where: { phone },
			select: { id: true, name: true, email: true, phone: true, dob: true, gender: true },
		})
		if (!user) return res.status(404).json({ success: false, message: 'User not found' })

		const secret = process.env.JWT_SECRET
		if (!secret) return res.status(500).json({ success: false, message: 'Server misconfigured: JWT_SECRET missing' })

		const token = jwt.sign({ sub: user.id }, secret, { expiresIn: '7d' })
		return res.json({ success: true, token, user })
	} catch (err) {
		return res.status(500).json({ success: false, message: 'Failed to verify OTP' })
	}
})

// POST /users → Create a user
userRouter.post('/', async (req, res) => {
	try {
	const { name, email, phone, dob, gender } = req.body || {}

		if (!name || !email) {
			return res.status(400).json({ success: false, message: 'name and email are required' })
		}

		// Parse dob if provided
		let dobDate = null
		if (dob) {
			const parsed = new Date(dob)
			if (isNaN(parsed.getTime())) return res.status(400).json({ success: false, message: 'Invalid dob format' })
			dobDate = parsed
		}

		const user = await prisma.user.create({
			data: { name, email, phone: phone || null, dob: dobDate, gender: gender || null },
			select: { id: true, name: true, email: true, phone: true, dob: true, gender: true, createdAt: true },
		})

		const secret = process.env.JWT_SECRET
		if (!secret) return res.status(500).json({ success: false, message: 'Server misconfigured: JWT_SECRET missing' })
		const token = jwt.sign({ sub: user.id }, secret, { expiresIn: '7d' })

		return res.status(201).json({ success: true, data: user, token })
	} catch (err) {
		if (err?.code === 'P2002' && err?.meta?.target?.includes('email')) {
			return res.status(409).json({ success: false, message: 'Email already in use' })
		}
		return res.status(500).json({ success: false, message: 'Failed to create user' })
	}
})

// GET /users/:userId → Get user profile
userRouter.get('/:userId', async (req, res) => {
	try {
		const { userId } = req.params
		const user = await prisma.user.findUnique({
			where: { id: userId },
			select: { id: true, name: true, email: true, phone: true, dob: true, gender: true, createdAt: true },
		})
		if (!user) {
			return res.status(404).json({ success: false, message: 'User not found' })
		}
		return res.json({ success: true, data: user })
	} catch (err) {
		return res.status(500).json({ success: false, message: 'Failed to fetch user' })
	}
})

// PATCH /users/:userId → Update user profile
userRouter.patch('/:userId', async (req, res) => {
	try {
		const { userId } = req.params
	const { name, email, phone, dob, gender } = req.body || {}

		const data = {}
		if (name !== undefined) data.name = name
		if (email !== undefined) data.email = email
		if (phone !== undefined) data.phone = phone
		if (dob !== undefined) {
			if (dob === null) {
				data.dob = null
			} else {
				const parsed = new Date(dob)
				if (isNaN(parsed.getTime())) return res.status(400).json({ success: false, message: 'Invalid dob format' })
				data.dob = parsed
			}
		}
		if (gender !== undefined) data.gender = gender

		if (Object.keys(data).length === 0) {
			return res.status(400).json({ success: false, message: 'No fields to update' })
		}

		const user = await prisma.user.update({
			where: { id: userId },
			data,
			select: { id: true, name: true, email: true, phone: true, dob: true, gender: true, createdAt: true },
		})
		return res.json({ success: true, data: user })
	} catch (err) {
		if (err?.code === 'P2001') {
			return res.status(404).json({ success: false, message: 'User not found' })
		}
		if (err?.code === 'P2002' && err?.meta?.target?.includes('email')) {
			return res.status(409).json({ success: false, message: 'Email already in use' })
		}
		return res.status(500).json({ success: false, message: 'Failed to update user' })
	}
})

export default userRouter