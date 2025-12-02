import { z } from 'zod';
import { ReasoningContentSchema } from './chat.types';

export const ResponseAudioSchema = z.object({
  data: z.string(),
  format: z.enum(['wav', 'mp3', 'flac', 'aac', 'ogg', 'pcm'])
});

export const ResponseInputParamSchema = z.object({
  type: z.enum(['input_text', 'input_image', 'input_audio']),
  text: z.string().optional(),
  image_url: z.string().optional(),
  input_audio: ResponseAudioSchema.optional()
});

export const ResponseMessageSchema = z.object({
  role: z.string().optional(),
  content: z.union([
    z.string(),
    z.array(ResponseInputParamSchema),
    z.null(),
    z.undefined()
  ]).optional()
}).catchall(z.unknown());

export const JsonSchemaSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  schema: z.record(z.string(), z.any()),
  strict: z.boolean().optional()
});

export const FormatSchema = z.object({
  type: z.enum(['text', 'json_object', 'json_schema']),
  json_schema: JsonSchemaSchema.optional()
});

export const ResponseTextConfigParamSchema = z.object({
  format: FormatSchema.optional()
});

export const ResponseReasoningSchema = z.object({
  effort: z.enum(['low', 'medium', 'high']).nullable().optional(),
  content: z.array(ReasoningContentSchema).optional()
});

export const FunctionObjectSchema = z.object({
  name: z.string(),
  parameters: z.record(z.string(), z.any()).optional(),
  strict: z.boolean().optional(),
  description: z.string().optional()
}).catchall(z.unknown());

export const FunctionToolSchema = z.object({
  type: z.string(),
  function: FunctionObjectSchema.optional()
}).catchall(z.unknown());

export const ToolChoiceFunctionSchema = z.object({
  name: z.string()
});

export const ResponseToolChoiceObjectSchema = z.object({
  type: z.literal('function'),
  function: ToolChoiceFunctionSchema
});

export const ResponsesRequestSchema = z.object({
  input: z.union([z.string(), z.array(ResponseMessageSchema)]),
  model: z.string(),
  instructions: z.string().optional(),
  max_output_tokens: z.number().min(1).optional(),
  parallel_tool_calls: z.boolean().optional(),
  reasoning: ResponseReasoningSchema.optional(),
  stream: z.boolean().optional(),
  temperature: z.number().optional(),
  text: ResponseTextConfigParamSchema.optional(),
  tool_choice: z.union([z.string(), ResponseToolChoiceObjectSchema]).optional(),
  tools: z.array(FunctionToolSchema).optional()
}).catchall(z.unknown());

export const CodeInterpreterOutputSchema = z.object({
  type: z.enum(['logs', 'image']),
  logs: z.string().optional(),
  image: z.object({
    url: z.string()
  }).optional()
});

export const CodeInterpreterSchema = z.object({
  input: z.string(),
  outputs: z.array(CodeInterpreterOutputSchema).optional()
});

export const FileSearchResultSchema = z.object({
  file_id: z.string(),
  file_name: z.string(),
  score: z.number(),
  content: z.string()
});

export const FileSearchSchema = z.object({
  results: z.array(FileSearchResultSchema).optional()
});

export const ComputerOutputSchema = z.object({
  type: z.enum(['text', 'image']),
  text: z.string().optional(),
  image_url: z.string().optional()
});

export const ComputerSchema = z.object({
  output: ComputerOutputSchema.optional()
});

export const ImageGenerationImageSchema = z.object({
  url: z.string(),
  detail: z.string().optional()
});

export const ImageGenerationSchema = z.object({
  images: z.array(ImageGenerationImageSchema).optional()
});

export const ResponseToolCallSchema = z.object({
  id: z.string(),
  type: z.literal('function'),
  function: FunctionObjectSchema.optional(),
  code_interpreter: CodeInterpreterSchema.optional(),
  file_search: FileSearchSchema.optional(),
  computer: ComputerSchema.optional(),
  image_generation: ImageGenerationSchema.optional()
});

export const ResponseContentSchema = z.object({
  type: z.enum(['output_text', 'refusal', 'tool_call']),
  text: z.string().optional(),
  refusal: z.string().optional(),
  annotations: z.array(z.any()).optional(),
  tool_call: ResponseToolCallSchema.optional()
});

export const ResponseOutputSchema = z.object({
  type: z.literal('message'),
  id: z.string(),
  status: z.enum(['completed', 'in_progress', 'failed', 'incomplete']),
  role: z.literal('assistant'),
  content: z.array(ResponseContentSchema)
});

export const OutputTokensDetailsSchema = z.object({
  reasoning_tokens: z.number().optional()
});

export const ResponseUsageSchema = z.object({
  input_tokens: z.number(),
  output_tokens: z.number(),
  total_tokens: z.number(),
  output_tokens_details: OutputTokensDetailsSchema.optional()
});

export const ResponsesResponseSchema = z.object({
  id: z.string(),
  object: z.literal('response'),
  created_at: z.number(),
  status: z.enum(['completed', 'in_progress', 'failed', 'incomplete']),
  instructions: z.string().nullable(),
  max_output_tokens: z.number().min(1).nullable(),
  model: z.string(),
  output: z.array(ResponseOutputSchema),
  parallel_tool_calls: z.boolean(),
  reasoning: ResponseReasoningSchema,
  temperature: z.number(),
  text: ResponseTextConfigParamSchema,
  tool_choice: z.union([z.string(), ResponseToolChoiceObjectSchema]),
  tools: z.array(FunctionToolSchema),
  usage: ResponseUsageSchema,
  provider: z.string().optional()
});

export const ResponseStreamChunkSchema = z.object({
  type: z.string(),
  response: ResponsesResponseSchema.optional(),
  reasoning: ResponseReasoningSchema.optional(),
  item_id: z.string().optional(),
  output_index: z.number().optional(),
  content_index: z.number().optional(),
  annotation_index: z.number().optional(),
  part: z.any().optional(),
  delta: z.string().optional(),
  text: z.string().optional(),
  refusal: z.string().optional(),
  arguments: z.string().optional(),
  annotation: z.any().optional(),
  item: z.any().optional()
});

export type ResponseInputParam = z.infer<typeof ResponseInputParamSchema>;
export type ResponseMessage = z.infer<typeof ResponseMessageSchema>;
export type ResponseTextConfigParam = z.infer<typeof ResponseTextConfigParamSchema>;
export type Reasoning = z.infer<typeof ResponseReasoningSchema>;
export type FunctionTool = z.infer<typeof FunctionToolSchema>;
export type ResponsesRequest = z.infer<typeof ResponsesRequestSchema>;
export type ResponsesResponse = z.infer<typeof ResponsesResponseSchema>;
export type ResponseOutput = z.infer<typeof ResponseOutputSchema>;
export type ResponseContent = z.infer<typeof ResponseContentSchema>;
export type ResponseStreamEvent = z.infer<typeof ResponseStreamChunkSchema>;

export const ResponsesAPIStreamEvents = {
  RESPONSE_CREATED: 'response.created' as const,
  RESPONSE_IN_PROGRESS: 'response.in_progress' as const,
  RESPONSE_COMPLETED: 'response.completed' as const,
  RESPONSE_FAILED: 'response.failed' as const,
  RESPONSE_INCOMPLETE: 'response.incomplete' as const,
  RESPONSE_PART_ADDED: 'response.reasoning_summary_part.added' as const,
  REASONING_SUMMARY_TEXT_DELTA: 'response.reasoning_summary_text.delta' as const,
  OUTPUT_ITEM_ADDED: 'response.output_item.added' as const,
  OUTPUT_ITEM_DONE: 'response.output_item.done' as const,
  CONTENT_PART_ADDED: 'response.content_part.added' as const,
  CONTENT_PART_DONE: 'response.content_part.done' as const,
  OUTPUT_TEXT_DELTA: 'response.output_text.delta' as const,
  OUTPUT_TEXT_ANNOTATION_ADDED: 'response.output_text.annotation.added' as const,
  OUTPUT_TEXT_DONE: 'response.output_text.done' as const,
  REFUSAL_DELTA: 'response.refusal.delta' as const,
  REFUSAL_DONE: 'response.refusal.done' as const,
  FUNCTION_CALL_ARGUMENTS_DELTA: 'response.function_call_arguments.delta' as const,
  FUNCTION_CALL_ARGUMENTS_DONE: 'response.function_call_arguments.done' as const,
  FILE_SEARCH_CALL_IN_PROGRESS: 'response.file_search_call.in_progress' as const,
  FILE_SEARCH_CALL_SEARCHING: 'response.file_search_call.searching' as const,
  FILE_SEARCH_CALL_COMPLETED: 'response.file_search_call.completed' as const,
  WEB_SEARCH_CALL_IN_PROGRESS: 'response.web_search_call.in_progress' as const,
  WEB_SEARCH_CALL_SEARCHING: 'response.web_search_call.searching' as const,
  WEB_SEARCH_CALL_COMPLETED: 'response.web_search_call.completed' as const,
  ERROR: 'error' as const
};