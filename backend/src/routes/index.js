import { Router } from 'express';
import authRoutes from './auth.routes.js';

const router = Router();

// Minimal health check endpoint - no internal credentials or configuration exposed
router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime())
  });
});

// Authentication endpoints
router.use('/auth', authRoutes);

export default router;
