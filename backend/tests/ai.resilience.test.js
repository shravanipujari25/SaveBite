import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { AIClientService } from '../src/services/aiClient.service.js';
import { AppError } from '../src/middleware/errorHandler.js';

describe('AI Request Resilience & Reliability Suite (Phase 5)', () => {
  let aiService;
  const originalFetch = global.fetch;

  beforeEach(() => {
    aiService = new AIClientService('http://localhost:8000', 100); // 100ms timeout
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('1. Bounded Retries & Exponential Backoff', () => {
    it('should retry transient 500 error and succeed if subsequent attempt passes', async () => {
      let callCount = 0;
      global.fetch = async () => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: false,
            status: 503,
            text: async () => 'Service Temporarily Unavailable'
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ reply: 'Hello from recovered AI service!' })
        };
      };

      const res = await aiService._post('/api/chat', { message: 'hi' }, { maxRetries: 2 });
      assert.equal(callCount, 2, 'Must have retried exactly once after transient 503');
      assert.equal(res.reply, 'Hello from recovered AI service!');
    });

    it('should NOT retry on 4xx client errors (fail fast)', async () => {
      let callCount = 0;
      global.fetch = async () => {
        callCount++;
        return {
          ok: false,
          status: 400,
          text: async () => 'Invalid prompt formatting'
        };
      };

      await assert.rejects(
        async () => {
          await aiService._post('/api/chat', { message: 'bad input' }, { maxRetries: 2 });
        },
        (err) => {
          assert.equal(err.statusCode, 400);
          assert.equal(err.code, 'AI_CLIENT_ERROR');
          return true;
        }
      );

      assert.equal(callCount, 1, 'Must not retry 4xx errors');
    });

    it('should exhaust maxRetries on persistent 5xx failure and throw 502 AI_SERVICE_ERROR', async () => {
      let callCount = 0;
      global.fetch = async () => {
        callCount++;
        return {
          ok: false,
          status: 502,
          text: async () => 'Bad Gateway'
        };
      };

      await assert.rejects(
        async () => {
          await aiService._post('/api/chat', { message: 'hello' }, { maxRetries: 2 });
        },
        (err) => {
          assert.equal(err.statusCode, 502);
          assert.equal(err.code, 'AI_SERVICE_ERROR');
          return true;
        }
      );

      assert.equal(callCount, 3, 'Must have attempted initial request + 2 retries (total 3)');
    });
  });

  describe('2. Timeouts & Network Disconnections', () => {
    it('should map AbortError / TimeoutError to HTTP 504 AI_SERVICE_TIMEOUT', async () => {
      global.fetch = async () => {
        const timeoutErr = new Error('The operation was aborted due to timeout');
        timeoutErr.name = 'TimeoutError';
        throw timeoutErr;
      };

      await assert.rejects(
        async () => {
          await aiService._post('/api/chat', { message: 'slow request' }, { maxRetries: 0 });
        },
        (err) => {
          assert.equal(err.statusCode, 504);
          assert.equal(err.code, 'AI_SERVICE_TIMEOUT');
          assert.match(err.message, /timed out/i);
          return true;
        }
      );
    });

    it('should map ECONNREFUSED network outage to HTTP 502 AI_SERVICE_UNAVAILABLE', async () => {
      global.fetch = async () => {
        const connErr = new Error('connect ECONNREFUSED 127.0.0.1:8000');
        throw connErr;
      };

      await assert.rejects(
        async () => {
          await aiService._post('/api/chat', { message: 'service down' }, { maxRetries: 0 });
        },
        (err) => {
          assert.equal(err.statusCode, 502);
          assert.equal(err.code, 'AI_SERVICE_UNAVAILABLE');
          return true;
        }
      );
    });
  });

  describe('3. Response Schema Validation & Anti-Fabrication', () => {
    it('should reject malformed chat response missing required reply field with 502 AI_MALFORMED_RESPONSE', async () => {
      global.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ unexpected_field: 12345 })
      });

      await assert.rejects(
        async () => {
          await aiService.chatAssistant('Hello AI', []);
        },
        (err) => {
          assert.equal(err.statusCode, 502);
          assert.equal(err.code, 'AI_MALFORMED_RESPONSE');
          return true;
        }
      );
    });

    it('should reject malformed recipe rescue response missing recipes array with 502 AI_MALFORMED_RESPONSE', async () => {
      global.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ invalid_payload: true })
      });

      await assert.rejects(
        async () => {
          await aiService.rescueRecipes({
            activeItems: [{ id: '1', name: 'Spinach' }]
          });
        },
        (err) => {
          assert.equal(err.statusCode, 502);
          assert.equal(err.code, 'AI_MALFORMED_RESPONSE');
          return true;
        }
      );
    });

    it('should never fabricate AI predictions or silently return hardcoded mock responses', async () => {
      global.fetch = async () => {
        throw new Error('AI Service completely offline');
      };

      // Ensure error is strictly thrown and not replaced by fake results
      await assert.rejects(
        async () => {
          await aiService.chatAssistant('Give me advice', []);
        },
        (err) => {
          assert.ok(err instanceof AppError);
          assert.equal(err.statusCode, 502);
          return true;
        }
      );
    });
  });
});
