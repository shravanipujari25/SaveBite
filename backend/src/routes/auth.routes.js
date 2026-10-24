import { Router } from 'express';
import { authController } from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { signupSchema, signinSchema } from '../schemas/auth.schema.js';

const router = Router();

// Apply auth-specific rate limiting to all auth endpoints
router.use(authLimiter);

// POST /api/v1/auth/signup - Register new user account
router.post('/signup', validate({ body: signupSchema }), authController.signup);

// POST /api/v1/auth/signin - Authenticate existing user
router.post('/signin', validate({ body: signinSchema }), authController.signin);

// GET /api/v1/auth/me - Retrieve verified user profile
router.get('/me', authenticate, authController.getMe);

// POST /api/v1/auth/logout - Invalidate active session and token version
router.post('/logout', authenticate, authController.logout);

export default router;
