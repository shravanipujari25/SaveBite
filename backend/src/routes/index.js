import { Router } from 'express';
import authRoutes from './auth.routes.js';
import inventoryRoutes from './inventory.routes.js';
import dashboardRoutes from './dashboard.routes.js';
import deviceRoutes from './device.routes.js';
import telemetryRoutes from './telemetry.routes.js';
import notificationRoutes from './notification.routes.js';
import receiptRoutes from './receipt.routes.js';
import barcodeRoutes from './barcode.routes.js';
import shoppingListRoutes from './shoppingList.routes.js';
import analyticsRoutes from './analytics.routes.js';
import assistantRoutes from './assistant.routes.js';
import recipeRoutes from './recipe.routes.js';
import profileRoutes from './profile.routes.js';
import householdSettingsRoutes from './householdSettings.routes.js';

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

// Inventory endpoints
router.use('/inventory', inventoryRoutes);

// Dashboard endpoints
router.use('/dashboard', dashboardRoutes);

// Device management endpoints
router.use('/devices', deviceRoutes);

// Telemetry ingestion endpoints
router.use('/telemetry', telemetryRoutes);

// Notifications endpoints
router.use('/notifications', notificationRoutes);

// Receipts endpoints (Phase 3)
router.use('/receipts', receiptRoutes);

// Barcode lookup endpoints (Phase 3)
router.use('/barcodes', barcodeRoutes);

// Shopping list endpoints (Phase 4)
router.use('/shopping-list', shoppingListRoutes);

// Analytics endpoints (Phase 4)
router.use('/analytics', analyticsRoutes);

// AI assistant proxy endpoints (Phase 4)
router.use('/assistant', assistantRoutes);

// Recipe rescue endpoints (Phase 4)
router.use('/recipes', recipeRoutes);

// User profile endpoints (Phase 4)
router.use('/profile', profileRoutes);

// Household settings endpoints (Phase 4)
router.use('/household/settings', householdSettingsRoutes);

export default router;
