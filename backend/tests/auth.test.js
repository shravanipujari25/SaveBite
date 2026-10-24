import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import app from '../src/app.js';
import env from '../src/config/env.js';
import { setupTestDatabase, teardownTestDatabase } from './helpers/mockSupabase.js';
import { generateAccessToken, verifyAccessToken } from '../src/utils/token.js';
import { authorize } from '../src/middleware/authorize.js';

describe('Custom Node.js JWT Authentication Suite (/api/v1/auth)', () => {
  let mockDb;

  before(async () => {
    mockDb = await setupTestDatabase();
  });

  after(() => {
    teardownTestDatabase();
  });

  describe('1. User Signup (POST /api/v1/auth/signup)', () => {
    it('should successfully register a new user and return a safe user with accessToken', async () => {
      const res = await request(app)
        .post('/api/v1/auth/signup')
        .send({
          name: 'Jane Foodie',
          email: 'Jane.Foodie@example.com', // Test case normalization
          password: 'SecurePassword123!'
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.status, 'success');
      assert.ok(res.body.data.user);
      assert.ok(res.body.data.accessToken);

      const user = res.body.data.user;
      assert.equal(user.name, 'Jane Foodie');
      assert.equal(user.email, 'jane.foodie@example.com'); // Normalized to lower
      assert.equal(user.role, 'user');
      assert.ok(user.id);
      assert.ok(user.createdAt);

      // CRITICAL: Ensure password hash is NEVER in response
      assert.equal(user.password_hash, undefined);
      assert.equal(user.password, undefined);

      // Verify the returned token is valid
      const decoded = verifyAccessToken(res.body.data.accessToken);
      assert.equal(decoded.sub, user.id);
      assert.equal(decoded.email, user.email);
    });

    it('should reject invalid signup input (short name, invalid email, weak password)', async () => {
      // Short name
      const res1 = await request(app)
        .post('/api/v1/auth/signup')
        .send({
          name: 'J',
          email: 'valid@example.com',
          password: 'StrongPassword123!'
        });
      assert.equal(res1.status, 400);
      assert.equal(res1.body.status, 'error');

      // Invalid email
      const res2 = await request(app)
        .post('/api/v1/auth/signup')
        .send({
          name: 'Valid Name',
          email: 'not-an-email',
          password: 'StrongPassword123!'
        });
      assert.equal(res2.status, 400);

      // Weak password (missing special character)
      const res3 = await request(app)
        .post('/api/v1/auth/signup')
        .send({
          name: 'Valid Name',
          email: 'valid2@example.com',
          password: 'Password123'
        });
      assert.equal(res3.status, 400);
    });

    it('should reject duplicate email registration with 409 Conflict', async () => {
      // First registration
      const email = 'duplicate.test@savebite.com';
      await request(app)
        .post('/api/v1/auth/signup')
        .send({
          name: 'Original User',
          email,
          password: 'StrongPassword123!'
        });

      // Second registration with same email (different case)
      const res = await request(app)
        .post('/api/v1/auth/signup')
        .send({
          name: 'Imposter User',
          email: email.toUpperCase(),
          password: 'StrongPassword123!'
        });

      assert.equal(res.status, 409);
      assert.equal(res.body.status, 'error');
      assert.match(res.body.message, /already registered/i);
    });

    it('should ensure passwords are securely hashed with bcrypt in database', async () => {
      const email = 'hashing.test@savebite.com';
      const rawPassword = 'UniquePassword123!';

      await request(app)
        .post('/api/v1/auth/signup')
        .send({
          name: 'Hash Check User',
          email,
          password: rawPassword
        });

      // Inspect mock database directly
      let savedUser = null;
      for (const u of mockDb.usersTable.values()) {
        if (u.email === email) savedUser = u;
      }

      assert.ok(savedUser);
      assert.notEqual(savedUser.password_hash, rawPassword);
      assert.match(savedUser.password_hash, /^\$2[aby]\$\d+\$/); // bcrypt hash prefix
      const matches = await bcrypt.compare(rawPassword, savedUser.password_hash);
      assert.equal(matches, true);
    });

    it('should prevent role escalation during signup (role cannot be set to admin)', async () => {
      const res = await request(app)
        .post('/api/v1/auth/signup')
        .send({
          name: 'Hacker User',
          email: 'hacker@savebite.com',
          password: 'StrongPassword123!',
          role: 'admin' // Attempted privilege escalation
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.data.user.role, 'user');
    });
  });

  describe('2. User Signin (POST /api/v1/auth/signin)', () => {
    it('should successfully authenticate user with valid credentials and return JWT', async () => {
      const res = await request(app)
        .post('/api/v1/auth/signin')
        .send({
          email: mockDb.defaultUser.email.toUpperCase(), // Test case-insensitive normalization
          password: mockDb.defaultPassword
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.status, 'success');
      assert.ok(res.body.data.accessToken);
      assert.equal(res.body.data.user.id, mockDb.defaultUser.id);
      assert.equal(res.body.data.user.email, mockDb.defaultUser.email);
    });

    it('should reject signin with incorrect password with 401 generic error', async () => {
      const res = await request(app)
        .post('/api/v1/auth/signin')
        .send({
          email: mockDb.defaultUser.email,
          password: 'WrongPassword123!'
        });

      assert.equal(res.status, 401);
      assert.equal(res.body.status, 'error');
      assert.match(res.body.message, /invalid email or password/i);
    });

    it('should reject signin with unknown email with identical 401 generic error (prevent enumeration)', async () => {
      const res = await request(app)
        .post('/api/v1/auth/signin')
        .send({
          email: 'nonexistent.user@example.com',
          password: 'AnyPassword123!'
        });

      assert.equal(res.status, 401);
      assert.equal(res.body.status, 'error');
      assert.match(res.body.message, /invalid email or password/i);
    });
  });

  describe('3. JWT Token Generation, Verification, & Rejection', () => {
    it('should generate and verify valid JWT tokens', () => {
      const token = generateAccessToken(mockDb.defaultUser);
      assert.ok(token);

      const decoded = verifyAccessToken(token);
      assert.equal(decoded.sub, mockDb.defaultUser.id);
      assert.equal(decoded.email, mockDb.defaultUser.email);
      assert.equal(decoded.role, mockDb.defaultUser.role);
    });

    it('should reject missing Authorization header (401)', async () => {
      const res = await request(app).get('/api/v1/auth/me');
      assert.equal(res.status, 401);
      assert.equal(res.body.status, 'error');
      assert.match(res.body.message, /missing authorization header/i);
    });

    it('should reject malformed Authorization header missing Bearer prefix (401)', async () => {
      const token = generateAccessToken(mockDb.defaultUser);
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Token ${token}`);

      assert.equal(res.status, 401);
      assert.match(res.body.message, /malformed authorization header/i);
    });

    it('should reject malformed token that lacks standard 3 JWT segments (401)', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer invalid-token-without-dots');

      assert.equal(res.status, 401);
      assert.match(res.body.message, /invalid access token format/i);
    });

    it('should reject expired JWT access token (401)', async () => {
      // Create a deliberately expired token
      const expiredToken = jwt.sign(
        { sub: mockDb.defaultUser.id, role: 'user', tokenVersion: 1 },
        env.JWT_SECRET,
        { expiresIn: '-1s', algorithm: 'HS256' }
      );

      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${expiredToken}`);

      assert.equal(res.status, 401);
      assert.match(res.body.message, /invalid or expired access token/i);
    });

    it('should reject JWT signed with invalid/different secret (401)', async () => {
      const rogueSecret = 'tampered-secret-key-that-does-not-match-env-at-all';
      const forgedToken = jwt.sign(
        { sub: mockDb.defaultUser.id, role: 'admin', tokenVersion: 1 },
        rogueSecret,
        { algorithm: 'HS256' }
      );

      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${forgedToken}`);

      assert.equal(res.status, 401);
      assert.match(res.body.message, /invalid or expired access token/i);
    });
  });

  describe('4. Current User & Identity Derivation (GET /api/v1/auth/me)', () => {
    it('should return safe profile for authenticated user', async () => {
      const token = generateAccessToken(mockDb.defaultUser);

      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.status, 'success');
      assert.equal(res.body.data.user.id, mockDb.defaultUser.id);
      assert.equal(res.body.data.user.name, mockDb.defaultUser.name);
      assert.equal(res.body.data.user.email, mockDb.defaultUser.email);
      assert.equal(res.body.data.user.role, 'user');

      // Security check: password_hash is never exposed
      assert.equal(res.body.data.user.password_hash, undefined);
    });

    it('should never trust user ID, email, or role provided in query or body (zero-trust)', async () => {
      const token = generateAccessToken(mockDb.defaultUser);
      const spoofedId = '99999999-9999-9999-9999-999999999999';

      const res = await request(app)
        .get(`/api/v1/auth/me?id=${spoofedId}&email=spoofed@evil.com`)
        .send({ id: spoofedId, email: 'spoofed@evil.com', role: 'admin' })
        .set('Authorization', `Bearer ${token}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.data.user.id, mockDb.defaultUser.id);
      assert.notEqual(res.body.data.user.id, spoofedId);
    });
  });

  describe('5. Logout & Token Revocation (POST /api/v1/auth/logout)', () => {
    it('should invalidate active token after logout (token revocation verified)', async () => {
      // 1. Create a dedicated user for revocation test
      const signupRes = await request(app)
        .post('/api/v1/auth/signup')
        .send({
          name: 'Revocation Test User',
          email: 'revocation@savebite.com',
          password: 'StrongPassword123!'
        });

      const token = signupRes.body.data.accessToken;

      // 2. Token should be valid initially
      const meBefore = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`);
      assert.equal(meBefore.status, 200);

      // 3. User calls logout
      const logoutRes = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${token}`);
      assert.equal(logoutRes.status, 200);
      assert.match(logoutRes.body.message, /logged out successfully/i);

      // 4. Using the same token now MUST be rejected (401 Revoked)
      const meAfter = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`);

      assert.equal(meAfter.status, 401);
      assert.match(meAfter.body.message, /revoked/i);
    });
  });

  describe('6. Role Security & SQL Injection Protection', () => {
    it('should reject non-admin users from admin-restricted routes', () => {
      const adminOnlyMiddleware = authorize(['admin']);
      let statusCode = null;
      let responseBody = null;
      const req = { user: { role: 'user', id: mockDb.defaultUser.id } };
      const res = {
        status: (code) => {
          statusCode = code;
          return { json: (b) => { responseBody = b; } };
        }
      };
      const next = () => {};

      adminOnlyMiddleware(req, res, next);
      assert.equal(statusCode, 403);
      assert.equal(responseBody.error.code, 'FORBIDDEN');
    });

    it('should be resilient against SQL injection payloads in email and name', async () => {
      const sqlInjectionEmail = "' OR '1'='1' --";
      const res = await request(app)
        .post('/api/v1/auth/signin')
        .send({
          email: sqlInjectionEmail,
          password: 'AnyPassword123!'
        });

      // Zod or repository rejects safely without database compromise
      assert.ok([400, 401].includes(res.status));
      assert.equal(res.body.status, 'error');
    });
  });
});
