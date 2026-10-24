import { householdRepository } from '../repositories/household.repository.js';
import { AppError } from './errorHandler.js';
import { logger } from '../config/logger.js';

/**
 * Middleware to enforce household authorization.
 * Derives the authenticated user from req.user, verifies active membership
 * in the database, and binds req.household = { id, role, name }.
 * Client-supplied household IDs in body, query, or headers are explicitly ignored/prevented.
 */
export const requireHousehold = async (req, res, next) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        status: 'error',
        message: 'Authentication required to access household resources',
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required to access household resources'
        }
      });
    }

    const membership = await householdRepository.findActiveMembershipByUserId(req.user.id);

    if (!membership || !membership.household_id) {
      logger.warn({ userId: req.user.id }, 'User has no active household membership');
      return res.status(403).json({
        status: 'error',
        message: 'Access denied: User is not an active member of any household',
        error: {
          code: 'FORBIDDEN_HOUSEHOLD',
          message: 'Access denied: User is not an active member of any household'
        }
      });
    }

    // Attach trusted, server-derived household context to request
    req.household = {
      id: membership.household_id,
      role: membership.role,
      name: membership.household?.name || 'My Household'
    };

    return next();
  } catch (err) {
    logger.error({ userId: req.user?.id, err }, 'Failed to resolve household membership');
    return next(new AppError('Internal authorization error', 500, 'HOUSEHOLD_AUTH_ERROR'));
  }
};

export default requireHousehold;
