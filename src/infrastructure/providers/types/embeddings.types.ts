import { z } from 'zod';

export const EmbeddingRequestSchema = z.object({
  model: z.string(),
  input: z.union([z.string(), z.array(z.string())]),
  encoding_format: z.enum(['float', 'base64']).optional(),
  dimensions: z.number().optional()
});

export const EmbeddingDataSchema = z.object({
  object: z.literal('embedding'),
  embedding: z.array(z.number()),
  index: z.number()
});

export const EmbeddingUsageSchema = z.object({
  prompt_tokens: z.number(),
  total_tokens: z.number()
});

export const EmbeddingResponseSchema = z.object({
  id: z.string().optional(),
  object: z.literal('list'),
  data: z.array(EmbeddingDataSchema),
  model: z.string(),
  usage: EmbeddingUsageSchema,
  provider: z.string().optional()
});

export type EmbeddingRequest = z.infer<typeof EmbeddingRequestSchema>;
export type EmbeddingResponse = z.infer<typeof EmbeddingResponseSchema>;
export type EmbeddingData = z.infer<typeof EmbeddingDataSchema>;