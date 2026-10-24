import { z } from 'zod';

export const freshnessParamSchema = z.object({
  itemId: z.string().uuid('itemId must be a valid UUID')
});

export default {
  freshnessParamSchema
};
