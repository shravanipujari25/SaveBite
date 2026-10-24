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
      if (schemas.body && req.body) {
        req.body = await schemas.body.parseAsync(req.body);
      }
      if (schemas.query && req.query) {
        req.query = await schemas.query.parseAsync(req.query);
      }
      if (schemas.params && req.params) {
        req.params = await schemas.params.parseAsync(req.params);
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
