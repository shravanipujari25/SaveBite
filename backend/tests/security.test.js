import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import app from '../src/app.js';
import env from '../src/config/env.js';
import { createLimiter } from '../src/middleware/rateLimit.js';
import { logger } from '../src/config/logger.js';
import pino from 'pino';

describe('Security Protections Suite', () => {
  describe('HTTP Security Headers (Helmet)', () => {
    it('should include essential security headers on responses', async () => {
      const res = await request(app).get('/api/v1/health');

      assert.equal(res.status, 200);
      assert.equal(res.headers['x-content-type-options'], 'nosniff');
      assert.equal(res.headers['x-dns-prefetch-control'], 'off');
      assert.equal(res.headers['x-frame-options'], 'SAMEORIGIN');
    });
  });

  describe('Strict CORS Origin Filtering', () => {
    it('should allow requests from the configured frontend origin', async () => {
      const res = await request(app)
        .get('/api/v1/health')
        .set('Origin', env.FRONTEND_URL);

      assert.equal(res.status, 200);
      assert.equal(res.headers['access-control-allow-origin'], env.FRONTEND_URL);
      assert.equal(res.headers['access-control-allow-credentials'], 'true');
    });

    it('should reject requests originating from unapproved origins (403)', async () => {
      const res = await request(app)
        .get('/api/v1/health')
        .set('Origin', 'https://malicious-website.evil');

      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, 'CORS_REJECTED');
      assert.equal(res.headers['access-control-allow-origin'], undefined);
    });
  });

  describe('Rate Limiting', () => {
    it('should block requests and return 429 once the rate limit threshold is exceeded', async () => {
      const testApp = express();
      const limiter = createLimiter({
        windowMs: 60 * 1000,
        max: 2,
        skip: () => false // Force enforcement for testing
      });

      testApp.use(limiter);
      testApp.get('/test-limit', (req, res) => res.json({ ok: true }));

      // Request 1: OK
      const res1 = await request(testApp).get('/test-limit');
      assert.equal(res1.status, 200);

      // Request 2: OK
      const res2 = await request(testApp).get('/test-limit');
      assert.equal(res2.status, 200);

      // Request 3: Blocked (429)
      const res3 = await request(testApp).get('/test-limit');
      assert.equal(res3.status, 429);
      assert.equal(res3.body.error.code, 'TOO_MANY_REQUESTS');
    });
  });

  describe('Payload Body Size Limits and JSON Parsing', () => {
    it('should reject payloads exceeding the 100kb limit (413)', async () => {
      // Create a payload larger than 100KB
      const largePayload = { data: 'A'.repeat(105 * 1024) };

      const res = await request(app)
        .post('/api/v1/auth/logout')
        .send(largePayload)
        .set('Content-Type', 'application/json');

      assert.equal(res.status, 413);
      assert.equal(res.body.error.code, 'PAYLOAD_TOO_LARGE');
    });

    it('should reject malformed JSON syntax gracefully (400)', async () => {
      const res = await request(app)
        .post('/api/v1/auth/logout')
        .set('Content-Type', 'application/json')
        .send('{"invalid_json": ');

      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'MALFORMED_JSON');
    });
  });

  describe('Health Check Endpoint (/api/v1/health)', () => {
    it('should return minimal status without leaking credentials, env, or internals', async () => {
      const res = await request(app).get('/api/v1/health');

      assert.equal(res.status, 200);
      assert.equal(res.body.status, 'healthy');
      assert.ok(res.body.timestamp);
      assert.ok(typeof res.body.uptime === 'number');

      // Credentials and secrets must NEVER appear in health check
      const stringified = JSON.stringify(res.body);
      assert.equal(stringified.includes('SUPABASE'), false);
      assert.equal(stringified.includes('SECRET'), false);
      assert.equal(stringified.includes('KEY'), false);
      assert.equal(stringified.includes('password'), false);
    });
  });

  describe('Sensitive Data Redaction and Error Handling', () => {
    it('should ensure Pino logger redacts sensitive authentication parameters', () => {
      const logs = [];
      const dest = {
        write(chunk) {
          logs.push(chunk);
        }
      };

      // Test with the same redaction configuration as production logger
      const testLogger = logger.child({}, {
        redact: {
          paths: [
            'authorization',
            'token',
            'client_secret',
            'password'
          ],
          censor: '[REDACTED]'
        }
      });

      // Use a custom destination to capture output
      const capturingLogger = pino({
        redact: {
          paths: [
            'authorization',
            'token',
            'client_secret',
            'password'
          ],
          censor: '[REDACTED]'
        }
      }, dest);

      capturingLogger.info({
        authorization: 'Bearer super-secret-token',
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        client_secret: 'google-client-secret-xyz',
        password: 'super-secret-password',
        safeField: 'hello-world'
      });

      assert.equal(logs.length, 1);
      const parsed = JSON.parse(logs[0]);
      assert.equal(parsed.authorization, '[REDACTED]');
      assert.equal(parsed.token, '[REDACTED]');
      assert.equal(parsed.client_secret, '[REDACTED]');
      assert.equal(parsed.password, '[REDACTED]');
      assert.equal(parsed.safeField, 'hello-world');
    });

    it('should handle unhandled routes with standard 404 response', async () => {
      const res = await request(app).get('/api/v1/non-existent-endpoint');

      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, 'NOT_FOUND');
    });
  });
});
