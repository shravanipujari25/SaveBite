import bcrypt from 'bcryptjs';
import { userRepository } from '../repositories/user.repository.js';
import { householdRepository } from '../repositories/household.repository.js';
import { generateAccessToken } from '../utils/token.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../config/logger.js';

const BCRYPT_SALT_ROUNDS = 12;

// Dummy hash for constant-time comparison to mitigate timing attacks on unknown emails
const DUMMY_HASH = '$2a$12$7EqJtq98hPqEX7fNZaFWoOhiM.x8q7oY5.2yq1E92P1k9nO7eB4u2';

export class AuthService {
  constructor(userRepo = userRepository, householdRepo = householdRepository) {
    this.userRepo = userRepo;
    this.householdRepo = householdRepo;
  }

  /**
   * Register a new user, automatically provision default household and owner membership,
   * and issue JWT.
   *
   * @param {object} params
   * @param {string} params.name
   * @param {string} params.email
   * @param {string} params.password
   * @returns {Promise<{ user: object, household: object, accessToken: string }>}
   */
  async signup({ name, email, password }) {
    const normalizedEmail = email.trim().toLowerCase();

    // Check for existing user with this email
    const existing = await this.userRepo.findByEmail(normalizedEmail);
    if (existing) {
      throw new AppError('Email is already registered', 409, 'EMAIL_EXISTS');
    }

    // Securely hash password using bcrypt
    const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

    let newUser;
    let newHousehold;
    try {
      // Force default role to 'user' for public signups (prevent privilege escalation)
      // Atomically creates user + household + owner membership
      const created = await this.householdRepo.createWithHousehold({
        name: name.trim(),
        email: normalizedEmail,
        password_hash: passwordHash,
        role: 'user'
      });
      newUser = created.user;
      newHousehold = created.household;
    } catch (err) {
      // Handle PostgreSQL unique constraint race condition
      if (err.code === '23505' || err.message?.includes('duplicate key') || err.message?.includes('already registered')) {
        throw new AppError('Email is already registered', 409, 'EMAIL_EXISTS');
      }
      throw err;
    }

    // Generate custom JWT access token
    const accessToken = generateAccessToken(newUser);

    logger.info({ userId: newUser.id, householdId: newHousehold.id }, 'New user and household successfully registered');

    // Return safe user representation - NEVER return password_hash
    return {
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        createdAt: newUser.created_at,
        updatedAt: newUser.updated_at
      },
      household: {
        id: newHousehold.id,
        name: newHousehold.name,
        role: newHousehold.role || 'owner'
      },
      accessToken
    };
  }

  /**
   * Authenticate user by email and password, returning JWT access token.
   *
   * @param {object} params
   * @param {string} params.email
   * @param {string} params.password
   * @returns {Promise<{ user: object, accessToken: string }>}
   */
  async signin({ email, password }) {
    const normalizedEmail = email.trim().toLowerCase();

    const user = await this.userRepo.findByEmail(normalizedEmail);

    if (!user) {
      // Run dummy compare to mitigate user enumeration through timing attacks
      await bcrypt.compare(password, DUMMY_HASH);
      throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
    }

    // Retrieve active household membership
    const membership = await this.householdRepo.findActiveMembershipByUserId(user.id);

    // Generate custom JWT access token with user's current token version
    const accessToken = generateAccessToken(user);

    logger.info({ userId: user.id }, 'User authenticated successfully');

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        createdAt: user.created_at,
        updatedAt: user.updated_at
      },
      ...(membership ? {
        household: {
          id: membership.household_id,
          name: membership.household?.name || 'My Household',
          role: membership.role
        }
      } : {}),
      accessToken
    };
  }

  /**
   * Retrieve current authenticated user profile and active household by user UUID.
   *
   * @param {string} userId
   * @returns {Promise<object>} Safe user profile
   */
  async getCurrentUser(userId) {
    const user = await this.userRepo.findById(userId);

    if (!user) {
      throw new AppError('User not found', 404, 'NOT_FOUND');
    }

    const membership = await this.householdRepo.findActiveMembershipByUserId(userId);

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
      household: membership ? {
        id: membership.household_id,
        name: membership.household?.name || 'My Household',
        role: membership.role
      } : null
    };
  }

  /**
   * Logout user and immediately invalidate active JWTs by incrementing token_version.
   *
   * @param {string} userId
   * @returns {Promise<{ message: string }>}
   */
  async logout(userId) {
    await this.userRepo.incrementTokenVersion(userId);

    logger.info({ userId }, 'User session terminated and token version incremented');

    return {
      message: 'Logged out successfully. Active sessions have been invalidated.'
    };
  }
}

export const authService = new AuthService();
export default authService;
