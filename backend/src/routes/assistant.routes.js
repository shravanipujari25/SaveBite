import { Router } from 'express';
import { assistantController } from '../controllers/assistant.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireHousehold } from '../middleware/household.js';
import { validate } from '../middleware/validate.js';
import { aiLimiter } from '../middleware/rateLimit.js';
import { assistantChatSchema } from '../schemas/assistant.schema.js';

const router = Router();

// Protect assistant routes with authentication and household verification
router.use(authenticate, requireHousehold);

// POST /api/v1/assistant/chat - Chat with AI assistant with household inventory context
router.post(
  '/chat',
  aiLimiter,
  validate({ body: assistantChatSchema }),
  assistantController.chat
);

export default router;
