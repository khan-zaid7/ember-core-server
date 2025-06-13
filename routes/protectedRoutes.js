// routes/protectedRoutes.js
import express from 'express';
import { authenticateToken } from '../middleware/authMiddleware.js';

const router = express.Router();

// 🔐 Protected route to test middleware
router.get('/test-protected', authenticateToken, (req, res) => {
  res.status(200).json({
    message: '✅ You have accessed a protected route!',
    user: req.user, // includes uid, email, role from token
  });
});

export default router;
