import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import { z } from 'zod';
import { validate } from '../src/middleware/validate.js';
import { errorHandler, AppError } from '../src/middleware/errorHandler.js';

describe('Middleware Unit & Integration Tests', () => {
  describe('Zod Validation Middleware (validate)', () => {
    const testApp = express();
    testApp.use(express.json());

    const schema = {
      body: z.object({
        name: z.string().min(2),
        quantity: z.number().int().positive()
      })
    };

    testApp.post('/test-validate', validate(schema), (req, res) => {
      res.status(200).json({ status: 'ok', data: req.body });
    });
    testApp.use(errorHandler);

    it('should pass validation when payload is correct', async () => {
      const res = await request(testApp)
        .post('/test-validate')
        .send({ name: 'Apples', quantity: 5 });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.name, 'Apples');
      assert.equal(res.body.data.quantity, 5);
    });

    it('should reject invalid payload with 400 and structured validation errors', async () => {
      const res = await request(testApp)
        .post('/test-validate')
        .send({ name: 'A', quantity: -1 });

      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
      assert.ok(Array.isArray(res.body.error.details));
      assert.equal(res.body.error.details.length, 2);
    });
  });

  describe('Centralized Error Handler (errorHandler)', () => {
    it('should handle custom AppError with specified code and status', async () => {
      const appWithAppError = express();
      appWithAppError.get('/operational-error', (req, res, next) => {
        next(new AppError('Item expired in pantry', 422, 'ITEM_EXPIRED', { itemId: '123' }));
      });
      appWithAppError.use(errorHandler);

      const res = await request(appWithAppError).get('/operational-error');
      assert.equal(res.status, 422);
      assert.equal(res.body.error.code, 'ITEM_EXPIRED');
      assert.equal(res.body.error.message, 'Item expired in pantry');
      assert.deepEqual(res.body.error.details, { itemId: '123' });
    });

    it('should catch unexpected exceptions and return safe 500 without leaking stack traces', async () => {
      const appWithFatalError = express();
      appWithFatalError.get('/fatal-error', (req, res, next) => {
        next(new Error('Database connection failed! Secret password: supersecret123'));
      });
      appWithFatalError.use(errorHandler);

      const res = await request(appWithFatalError).get('/fatal-error');
      assert.equal(res.status, 500);
      assert.equal(res.body.error.code, 'INTERNAL_SERVER_ERROR');
      assert.equal(res.body.error.message, 'An unexpected internal error occurred. Please try again later.');

      // CRITICAL: Ensure internal database error message or secrets are NEVER in response body
      const stringified = JSON.stringify(res.body);
      assert.equal(stringified.includes('supersecret123'), false);
      assert.equal(stringified.includes('Database connection failed'), false);
      assert.equal(stringified.includes('stack'), false);
    });
  });
});
