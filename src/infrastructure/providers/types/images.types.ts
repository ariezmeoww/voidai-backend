import { z } from 'zod';

export const ImageSizeSchema = z.enum(['256x256', '512x512', '1024x1024', '1536x1024', '1024x1536', '2048x2048', '4096x4096', 'auto']);

export const ImageGenerationRequestSchema = z.object({
  model: z.string(),
  prompt: z.string(),
  n: z.number().optional(),
  size: ImageSizeSchema.optional()
});

export const ImageEditRequestSchema = z.object({
  image: z.instanceof(File),
  prompt: z.string(),
  model: z.string(),
  n: z.number().optional(),
  size: ImageSizeSchema.optional(),
  mask: z.instanceof(File).optional()
});

export const ImageDataSchema = z.object({
  url: z.string().optional(),
  b64_json: z.string().optional(),
  revised_prompt: z.string().optional()
});

export const ImageResponseSchema = z.object({
  id: z.string().optional(),
  created: z.number(),
  data: z.array(ImageDataSchema),
  provider: z.string().optional()
});

export type ImageSize = z.infer<typeof ImageSizeSchema>;
export type ImageGenerationRequest = z.infer<typeof ImageGenerationRequestSchema>;
export type ImageEditRequest = z.infer<typeof ImageEditRequestSchema>;
export type ImageResponse = z.infer<typeof ImageResponseSchema>;
export type ImageData = z.infer<typeof ImageDataSchema>;