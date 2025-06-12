// routes/authRoutes.jsAdd commentMore actions
import express from 'express';
import { registerUser } from '../controllers/authController.js';

const router = express.Router();
console.log('working')
router.post('/register', registerUser);

export default router;