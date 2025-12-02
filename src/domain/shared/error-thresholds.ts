import { ErrorType } from '../provider';

export interface ErrorThresholdConfig {
  maxConsecutiveErrors: number;
  errorWindowSeconds: number;
  criticalErrorPatterns: string[];
  excludedErrorPatterns: string[];
}

export const DEFAULT_ERROR_THRESHOLDS: ErrorThresholdConfig = {
  maxConsecutiveErrors: 5,
  errorWindowSeconds: 300,
  criticalErrorPatterns: [
    '401',
    '402',
    '403',
    '428',
    'Incorrect API key provided',
    'invalid x-api-key',
    'You exceeded your current quota',
    'balance is too low',
    'API Key not found',
    'API key not valid',
    'API key expired',
    'invalid API key',
    'invalid key',
    'hard limit',
    'You have insufficient permissions',
    'Precondition Failed',
    'You have reached your specified API usage limits.'
  ],
  excludedErrorPatterns: [
    'unsupported_country_region_territory',
    'requiring a key',
    'User location',
    'Provider returned error',
    'Request not allowed',
    'organization must be verified',
    'Argument not supported on this model',
    'maximum allowed number of output tokens for',
    'This is not a chat model',
    'Unsupported parameter',
    'maximum context length',
    'Invalid model',
    'Unsupported value',
    'Invalid value for',
    'Unsupported file uri',
    'Model incompatible request argument',
    'must have non-empty content',
    'must be non-empty',
    'too large',
    'overloaded_error',
    'requires moderation',
    'Client specified an invalid argument',
    'must be a string',
    'The model is not supported',
    'Network error',
    'LLM provider is down',
    'could not complete assistant response',
    'moderation_blocked',
    'must contain non-whitespace',
    'model_not_found',
    'Content violates usage guidelines',
    'trailing whitespace',
    'Gateway Timeout',
    'prompt is too long',
    'temperature: '
  ]
};

export function isCriticalError(errorMessage: string): boolean {
  const message = errorMessage.toLowerCase();
  
  for (const excludedPattern of DEFAULT_ERROR_THRESHOLDS.excludedErrorPatterns) {
    if (message.includes(excludedPattern.toLowerCase())) {
      return false;
    }
  }
  
  for (const criticalPattern of DEFAULT_ERROR_THRESHOLDS.criticalErrorPatterns) {
    if (message.includes(criticalPattern.toLowerCase())) {
      return true;
    }
  }
  
  return false;
}

export function getErrorType(errorMessage: string): ErrorType {
  const message = errorMessage.toLowerCase();
  
  if (message.includes('401') || message.includes('403') || message.includes('api key') || message.includes('unauthorized') || message.includes('authentication')) {
    return 'auth_error';
  }
  
  if (message.includes('rate limit') || message.includes('429') || message.includes('quota') || message.includes('too many requests')) {
    return 'rate_limit';
  }
  
  if (message.includes('timeout') || message.includes('timed out')) {
    return 'timeout';
  }
  
  if (message.includes('network') || message.includes('connection')) {
    return 'network';
  }
  
  if (message.includes('500') || message.includes('502') || message.includes('503') || message.includes('504') || message.includes('server error')) {
    return 'server_error';
  }
  
  return 'other';
}