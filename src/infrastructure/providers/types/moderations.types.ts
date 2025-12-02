import { z } from 'zod';

export const ModerationRequestSchema = z.object({
  input: z.union([z.string(), z.array(z.string())]),
  model: z.string()
});

export const ModerationResultSchema = z.object({
  flagged: z.boolean(),
  categories: z.record(z.string(), z.boolean()),
  category_scores: z.record(z.string(), z.number())
});

export const ModerationResponseSchema = z.object({
  id: z.string().optional(),
  model: z.string(),
  results: z.array(ModerationResultSchema),
  provider: z.string().optional()
});

export type ModerationRequest = z.infer<typeof ModerationRequestSchema>;
export type ModerationResponse = z.infer<typeof ModerationResponseSchema>;
export type ModerationResult = z.infer<typeof ModerationResultSchema>;