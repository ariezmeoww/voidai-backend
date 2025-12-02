import { z } from 'zod';

export const ImageUrlSchema = z.object({
  url: z.string(),
  detail: z.enum(['low', 'high', 'auto']).optional()
});

export const MessageContentPartSchema = z.union([
  z.object({
    type: z.literal('text'),
    text: z.string()
  }),
  z.object({
    type: z.literal('image_url'),
    image_url: ImageUrlSchema
  })
]);

export const ToolCallFunctionSchema = z.object({
  name: z.string(),
  arguments: z.string()
});

export const ToolCallSchema = z.object({
  id: z.string(),
  type: z.literal('function'),
  function: ToolCallFunctionSchema
});

export const ChatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'developer', 'function', 'tool']),
  content: z.union([
    z.string(),
    z.array(MessageContentPartSchema),
    z.null()
  ]).optional(),
  name: z.string().optional(),
  tool_calls: z.array(ToolCallSchema).optional(),
  tool_call_id: z.string().optional()
}).catchall(z.unknown());

export const ToolFunctionSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  parameters: z.record(z.string(), z.any())
});

export const ToolSchema = z.object({
  type: z.literal('function'),
  function: ToolFunctionSchema
});

export const ToolChoiceSchema = z.union([
  z.string(),
  z.object({
    type: z.literal('function'),
    function: z.object({
      name: z.string()
    })
  })
]);

export const ResponseFormatSchema = z.object({
  type: z.enum(['text', 'json_object'])
});

export const ImageConfigSchema = z.object({
  aspectRatio: z.enum(['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']).optional(),
  aspect_ratio: z.enum(['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']).optional(),
  image_size: z.enum(['1K', '2K', '4K']).optional(),
  imageSize: z.enum(['1K', '2K', '4K']).optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  responseModalities: z.array(z.enum(['TEXT', 'IMAGE'])).optional()
});

export const ChatCompletionRequestSchema = z.object({
  model: z.string(),
  messages: z.array(ChatMessageSchema),
  temperature: z.number().optional(),
  stream: z.boolean().optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
  max_tokens: z.number().min(1).optional(),
  max_completion_tokens: z.number().min(1).optional(),
  presence_penalty: z.number().optional(),
  frequency_penalty: z.number().optional(),
  tools: z.array(ToolSchema).optional(),
  tool_choice: ToolChoiceSchema.optional(),
  parallel_tool_calls: z.boolean().optional(),
  response_format: ResponseFormatSchema.optional(),
  reasoning_effort: z.enum(['low', 'medium', 'high']).optional(),
  responseModalities: z.array(z.enum(['TEXT', 'IMAGE'])).optional(),
  image_config: ImageConfigSchema.optional()
});

export const CompletionTokensSchema = z.object({
  reasoning_tokens: z.number().optional(),
  accepted_prediction_tokens: z.number().optional(),
  rejected_prediction_tokens: z.number().optional()
});

export const UsageSchema = z.object({
  prompt_tokens: z.number(),
  completion_tokens: z.number(),
  total_tokens: z.number(),
  completion_tokens_details: CompletionTokensSchema.optional()
});

export const ReasoningContentSchema = z.object({
  type: z.literal('thinking'),
  thinking: z.string(),
  signature: z.string().optional()
});

export const ChatCompletionMessageSchema = z.object({
  role: z.literal('assistant'),
  content: z.string().nullable(),
  tool_calls: z.array(ToolCallSchema).optional(),
  reasoning_content: z.array(ReasoningContentSchema).optional()
});

export const ChatCompletionChoiceSchema = z.object({
  index: z.number(),
  message: ChatCompletionMessageSchema,
  finish_reason: z.enum(['stop', 'length', 'tool_calls', 'content_filter']).nullable()
});

export const ChatCompletionResponseSchema = z.object({
  id: z.string(),
  object: z.literal('chat.completion'),
  created: z.number(),
  model: z.string(),
  choices: z.array(ChatCompletionChoiceSchema),
  usage: UsageSchema,
  system_fingerprint: z.string().optional(),
  provider: z.string().optional()
});

export const StreamDeltaSchema = z.object({
  role: z.literal('assistant').optional(),
  content: z.string().optional(),
  tool_calls: z.array(ToolCallSchema).optional(),
  reasoning_content: z.array(ReasoningContentSchema).optional()
});

export const StreamChoiceSchema = z.object({
  index: z.number(),
  delta: StreamDeltaSchema,
  finish_reason: z.enum(['stop', 'length', 'tool_calls', 'content_filter']).nullable()
});

export const StreamChunkSchema = z.object({
  id: z.string(),
  object: z.literal('chat.completion.chunk'),
  created: z.number(),
  model: z.string(),
  choices: z.array(StreamChoiceSchema),
  usage: UsageSchema.optional(),
  provider: z.string().optional()
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ImageConfig = z.infer<typeof ImageConfigSchema>;
export type ChatCompletionRequest = z.infer<typeof ChatCompletionRequestSchema>;
export type ChatCompletionResponse = z.infer<typeof ChatCompletionResponseSchema>;
export type StreamChunk = z.infer<typeof StreamChunkSchema>;
export type ToolCall = z.infer<typeof ToolCallSchema>;
export type ReasoningContent = z.infer<typeof ReasoningContentSchema>;
export type Tool = z.infer<typeof ToolSchema>;
export type Usage = z.infer<typeof UsageSchema>;