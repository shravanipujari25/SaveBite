import { ZodError } from 'zod';

/**
 * Middleware factory for validating incoming request objects using Zod schemas.
 *
 * @param {object} schemas
 * @param {import('zod').ZodTypeAny} [schemas.body] - Schema for req.body
 * @param {import('zod').ZodTypeAny} [schemas.query] - Schema for req.query
 * @param {import('zod').ZodTypeAny} [schemas.params] - Schema for req.params
 */
export const validate = (schemas = {}) => {
  return async (req, res, next) => {
    try {
      if (schemas.body) {
        req.body = await schemas.body.parseAsync(req.body || {});
      }
      if (schemas.query) {
        const parsedQuery = await schemas.query.parseAsync(req.query || {});
        try {
          req.query = parsedQuery;
        } catch {
          Object.defineProperty(req, 'query', {
            value: parsedQuery,
            writable: true,
            configurable: true,
            enumerable: true
          });
        }
      }
      if (schemas.params) {
        const parsedParams = await schemas.params.parseAsync(req.params || {});
        try {
          req.params = parsedParams;
        } catch {
          Object.defineProperty(req, 'params', {
            value: parsedParams,
            writable: true,
            configurable: true,
            enumerable: true
          });
        }
      }
      return next();
    } catch (err) {
      if (err instanceof ZodError) {
        const details = err.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message
        }));

        return res.status(400).json({
          status: 'error',
          message: 'Request validation failed',
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            details
          }
        });
      }
      return next(err);
    }
  };
};

export default validate;
