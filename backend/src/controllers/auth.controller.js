import { authService } from '../services/auth.service.js';

export class AuthController {
  constructor(service = authService) {
    this.authService = service;
  }

  /**
   * POST /api/v1/auth/signup
   * Register a new user with name, email, and password.
   */
  signup = async (req, res, next) => {
    try {
      const { name, email, password } = req.body;
      const result = await this.authService.signup({ name, email, password });

      return res.status(201).json({
        status: 'success',
        data: result
      });
    } catch (err) {
      return next(err);
    }
  };

  /**
   * POST /api/v1/auth/signin
   * Authenticate user with email and password.
   */
  signin = async (req, res, next) => {
    try {
      const { email, password } = req.body;
      const result = await this.authService.signin({ email, password });

      return res.status(200).json({
        status: 'success',
        data: result
      });
    } catch (err) {
      return next(err);
    }
  };

  /**
   * GET /api/v1/auth/me
   * Returns safe profile details of the verified authenticated user.
   */
  getMe = async (req, res, next) => {
    try {
      // User identity is strictly derived from verified token claims on req.user,
      // explicitly ignoring any body or query parameters
      const userProfile = await this.authService.getCurrentUser(req.user.id);

      return res.status(200).json({
        status: 'success',
        data: {
          user: userProfile
        }
      });
    } catch (err) {
      return next(err);
    }
  };

  /**
   * POST /api/v1/auth/logout
   * Invalidates active JWT tokens by incrementing token_version.
   */
  logout = async (req, res, next) => {
    try {
      const result = await this.authService.logout(req.user.id);

      return res.status(200).json({
        status: 'success',
        message: result.message
      });
    } catch (err) {
      return next(err);
    }
  };
}

export const authController = new AuthController();
export default authController;
