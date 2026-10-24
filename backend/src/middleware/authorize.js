import { logger } from '../config/logger.js';

/**
 * Authorization middleware generator.
 * Restricts access to users having specified roles based on verified database record.
 *
 * @param {string|string[]} allowedRoles - Role or list of permitted roles
 */
export const authorize = (allowedRoles = []) => {
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        status: 'error',
        message: 'Authentication required',
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required'
        }
      });
    }

    // Role determined exclusively from trusted database record
    const userRole = req.user.role || 'user';

    if (roles.length > 0 && !roles.includes(userRole)) {
      logger.warn({ userId: req.user.id, userRole, requiredRoles: roles }, 'Access forbidden: insufficient permissions');
      return res.status(403).json({
        status: 'error',
        message: 'Access denied: insufficient permissions',
        error: {
          code: 'FORBIDDEN',
          message: 'Access denied: insufficient permissions'
        }
      });
    }

    return next();
  };
};

export default authorize;
