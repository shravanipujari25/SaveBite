import jwt from 'jsonwebtoken';
import env from '../config/env.js';

const SIGNING_ALGORITHM = 'HS256';

/**
 * Generate a signed JWT access token for an authenticated user.
 *
 * @param {object} user - User record from database
 * @param {string} user.id - User unique identifier
 * @param {string} user.email - User email
 * @param {string} user.role - User role (user | admin)
 * @param {number} user.token_version - Current token version for revocation
 * @returns {string} Signed JWT token
 */
export const generateAccessToken = (user) => {
  const payload = {
    email: user.email,
    role: user.role || 'user',
    tokenVersion: user.token_version ?? 1
  };

  return jwt.sign(payload, env.JWT_SECRET, {
    subject: String(user.id),
    expiresIn: env.JWT_EXPIRES_IN,
    algorithm: SIGNING_ALGORITHM
  });
};

/**
 * Verify a JWT access token signature, expiration, and algorithm.
 *
 * @param {string} token - The Bearer JWT string
 * @returns {object} Decoded JWT payload
 * @throws {jwt.JsonWebTokenError | jwt.TokenExpiredError}
 */
export const verifyAccessToken = (token) => {
  return jwt.verify(token, env.JWT_SECRET, {
    algorithms: [SIGNING_ALGORITHM]
  });
};

export default {
  generateAccessToken,
  verifyAccessToken
};
