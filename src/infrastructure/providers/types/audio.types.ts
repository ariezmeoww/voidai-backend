import { z } from 'zod';

export const AudioWordSchema = z.object({
  word: z.string(),
  start: z.number(),
  end: z.number()
});

export const AudioSegmentSchema = z.object({
  id: z.number(),
  seek: z.number(),
  start: z.number(),
  end: z.number(),
  text: z.string(),
  tokens: z.array(z.number()),
  temperature: z.number(),
  avg_logprob: z.number(),
  compression_ratio: z.number(),
  no_speech_prob: z.number()
});

export const SpeechRequestSchema = z.object({
  model: z.string(),
  input: z.string(),
  voice: z.enum(['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']),
  response_format: z.enum(['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm']).optional(),
  speed: z.number().min(0.25).max(4.0).optional()
});

export const AudioTranscriptionRequestSchema = z.object({
  file: z.instanceof(File),
  model: z.string(),
  language: z.string().optional(),
  prompt: z.string().optional(),
  response_format: z.enum(['json', 'text', 'srt', 'verbose_json', 'vtt']).optional(),
  temperature: z.number().min(0).max(1).optional(),
  timestamp_granularities: z.array(z.enum(['word', 'segment'])).optional()
});

export const TranscriptionResponseSchema = z.object({
  id: z.string().optional(),
  text: z.string(),
  language: z.string().optional(),
  duration: z.number().optional(),
  words: z.array(AudioWordSchema).optional(),
  segments: z.array(AudioSegmentSchema).optional(),
  provider: z.string().optional()
});

export type SpeechRequest = z.infer<typeof SpeechRequestSchema>;
export type AudioTranscriptionRequest = z.infer<typeof AudioTranscriptionRequestSchema>;
export type TranscriptionResponse = z.infer<typeof TranscriptionResponseSchema>;
export type AudioWord = z.infer<typeof AudioWordSchema>;
export type AudioSegment = z.infer<typeof AudioSegmentSchema>;