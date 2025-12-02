export type ErrorType =
  | 'timeout'
  | 'rate_limit'
  | 'auth_error'
  | 'server_error'
  | 'network'
  | 'stream_failure'
  | 'moderation_error'
  | 'other';