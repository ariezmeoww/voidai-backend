import { z } from 'zod';

export const VideoSizeSchema = z.enum(['1280x720', '1920x1080', '1080x1920']);

export const VideoSecondsSchema = z.enum(['4', '8', '12']);

export const VideoStatusSchema = z.enum(['queued', 'in_progress', 'completed', 'failed']);

export const VideoVariantSchema = z.enum(['video', 'thumbnail', 'spritesheet']);

export const VideoErrorSchema = z.object({
  code: z.string(),
  message: z.string()
});

export const VideoCreateRequestSchema = z.object({
  model: z.enum(['sora-2', 'sora-2-pro']),
  prompt: z.string(),
  size: VideoSizeSchema.optional(),
  seconds: VideoSecondsSchema.optional(),
  input_reference: z.union([z.instanceof(File), z.null(), z.undefined()]).optional()
});

export const VideoRemixRequestSchema = z.object({
  prompt: z.string()
});

export const VideoResponseSchema = z.object({
  id: z.string(),
  object: z.literal('video'),
  created_at: z.number(),
  status: VideoStatusSchema,
  model: z.string(),
  progress: z.number().optional(),
  seconds: z.string().optional(),
  size: z.string().optional(),
  error: VideoErrorSchema.optional(),
  provider: z.string().optional()
});

export const VideoListResponseSchema = z.object({
  object: z.literal('list'),
  data: z.array(VideoResponseSchema),
  has_more: z.boolean().optional(),
  first_id: z.string().optional(),
  last_id: z.string().optional()
});

export const VideoWebhookEventSchema = z.object({
  id: z.string(),
  object: z.literal('event'),
  created_at: z.number(),
  type: z.enum(['video.completed', 'video.failed']),
  data: z.object({
    id: z.string()
  })
});

export type VideoSize = z.infer<typeof VideoSizeSchema>;
export type VideoSeconds = z.infer<typeof VideoSecondsSchema>;
export type VideoStatus = z.infer<typeof VideoStatusSchema>;
export type VideoVariant = z.infer<typeof VideoVariantSchema>;
export type VideoError = z.infer<typeof VideoErrorSchema>;
export type VideoCreateRequest = z.infer<typeof VideoCreateRequestSchema>;
export type VideoRemixRequest = z.infer<typeof VideoRemixRequestSchema>;
export type VideoResponse = z.infer<typeof VideoResponseSchema>;
export type VideoListResponse = z.infer<typeof VideoListResponseSchema>;
export type VideoWebhookEvent = z.infer<typeof VideoWebhookEventSchema>;