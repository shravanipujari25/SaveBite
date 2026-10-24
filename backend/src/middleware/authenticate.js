import { verifyAccessToken } from '../utils/token.js';
import { userRepository } from '../repositories/user.repository.js';
import { logger } from '../config/logger.js';

// Standard UUID regex for validating user ID claims across all UUID versions
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Middleware to authenticate requests using custom JWT Bearer access tokens.
 * Verifies token signature, expiration, user existence in database,
 * and server-side token version/revocation.
 */
export const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        status: 'error',
        message: 'Missing Authorization header with Bearer token',
        error: {
          code: 'UNAUTHORIZED',
          message: 'Missing Authorization header with Bearer token'
        }
      });
    }

    const parts = authHeader.trim().split(/\s+/);
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return res.status(401).json({
        status: 'error',
        message: 'Malformed Authorization header. Expected format: Bearer <token>',
        error: {
          code: 'UNAUTHORIZED',
          message: 'Malformed Authorization header. Expected format: Bearer <token>'
        }
      });
    }

    const token = parts[1];

    // Basic structure check: standard JWT has 3 dot-separated segments
    const jwtSegments = token.split('.');
    if (jwtSegments.length !== 3 || !jwtSegments[0] || !jwtSegments[1] || !jwtSegments[2]) {
      return res.status(401).json({
        status: 'error',
        message: 'Invalid access token format',
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid access token format'
        }
      });
    }

    // Cryptographically verify token signature and claims using application JWT secret
    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch (err) {
      const reason = err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token signature';
      logger.warn({ reason }, 'Authentication token verification failed');
      return res.status(401).json({
        status: 'error',
        message: 'Invalid or expired access token',
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid or expired access token'
        }
      });
    }

    const userId = decoded.sub;

    // Validate derived user ID format
    if (!userId || !UUID_REGEX.test(userId)) {
      logger.warn('Token claim verification failed: missing or invalid user UUID subject');
      return res.status(401).json({
        status: 'error',
        message: 'Invalid token claims',
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid token claims'
        }
      });
    }

    // Load active user from database to ensure user exists and verify role & token version
    const user = await userRepository.findById(userId);

    if (!user) {
      logger.warn({ userId }, 'Authenticated token subject does not exist in database');
      return res.status(401).json({
        status: 'error',
        message: 'User no longer exists',
        error: {
          code: 'UNAUTHORIZED',
          message: 'User no longer exists'
        }
      });
    }

    // Token revocation check: if user logged out or session was invalidated, token_version will not match
    if (decoded.tokenVersion !== undefined && user.token_version !== undefined && decoded.tokenVersion !== user.token_version) {
      logger.warn({ userId }, 'Token has been revoked due to session invalidation');
      return res.status(401).json({
        status: 'error',
        message: 'Token has been revoked. Please sign in again.',
        error: {
          code: 'UNAUTHORIZED',
          message: 'Token has been revoked. Please sign in again.'
        }
      });
    }

    // Attach verified user identity derived exclusively from verified claims and database record
    req.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role || 'user'
    };

    req.token = token;

    return next();
  } catch (err) {
    logger.error({ err }, 'Unexpected error during token authentication');
    return res.status(401).json({
      status: 'error',
      message: 'Authentication failed',
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication failed'
      }
    });
  }
};

export default authenticate;
