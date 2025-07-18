// app.jsAdd commentMore actions
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import authRoutes from './routes/authRoutes.js';
// app.js
import protectedRoutes from './routes/protectedRoutes.js'; 
import syncRoutes from './routes/syncRoutes.js';
import downSyncRoutes from './routes/downSyncRoutes.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// Routes
app.use('/api', authRoutes);
app.use('/api', protectedRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/down-sync', downSyncRoutes);

// Root routeAdd commentMore actions
app.get('/', (req, res) => {
  res.send('API is running...');
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server is running on http://0.0.0.0:${PORT}`);
});
