import bcrypt from 'bcryptjs';
import { userRepository } from '../repositories/user.repository.js';
import { generateAccessToken } from '../utils/token.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../config/logger.js';

const BCRYPT_SALT_ROUNDS = 12;

// Dummy hash for constant-time comparison to mitigate timing attacks on unknown emails
const DUMMY_HASH = '$2a$12$7EqJtq98hPqEX7fNZaFWoOhiM.x8q7oY5.2yq1E92P1k9nO7eB4u2';

export class AuthService {
  constructor(repository = userRepository) {
    this.userRepo = repository;
  }

  /**
   * Register a new user with normalized email, strong hashed password, and issue JWT.
   *
   * @param {object} params
   * @param {string} params.name
   * @param {string} params.email
   * @param {string} params.password
   * @returns {Promise<{ user: object, accessToken: string }>}
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
    try {
      // Force default role to 'user' for public signups (prevent privilege escalation)
      newUser = await this.userRepo.create({
        name: name.trim(),
        email: normalizedEmail,
        password_hash: passwordHash,
        role: 'user'
      });
    } catch (err) {
      // Handle PostgreSQL unique constraint race condition
      if (err.code === '23505' || err.message?.includes('duplicate key') || err.message?.includes('unique constraint')) {
        throw new AppError('Email is already registered', 409, 'EMAIL_EXISTS');
      }
      throw err;
    }

    // Generate custom JWT access token
    const accessToken = generateAccessToken(newUser);

    logger.info({ userId: newUser.id }, 'New user successfully registered');

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
      accessToken
    };
  }

  /**
   * Retrieve current authenticated user profile by user UUID.
   *
   * @param {string} userId
   * @returns {Promise<object>} Safe user profile
   */
  async getCurrentUser(userId) {
    const user = await this.userRepo.findById(userId);

    if (!user) {
      throw new AppError('User not found', 404, 'NOT_FOUND');
    }

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      createdAt: user.created_at,
      updatedAt: user.updated_at
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
