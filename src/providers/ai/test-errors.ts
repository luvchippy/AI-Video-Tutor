/**
 * Structured provider test result for the "Save & Test" flow.
 * The `errorType` discriminates the failure mode so the UI can show
 * actionable messages instead of bare "Failed to fetch".
 */
export type ProviderTestErrorType =
  | 'NETWORK_ERROR'
  | 'AUTH_ERROR'
  | 'NOT_FOUND'
  | 'BAD_REQUEST'
  | 'RATE_LIMIT'
  | 'INVALID_URL'
  | 'NO_API_KEY'
  | 'PROTOCOL_ERROR'
  | 'UNKNOWN';

export interface ProviderTestResult {
  ok: boolean;
  /** Structured error type when ok === false. */
  errorType?: ProviderTestErrorType;
  /** Human-readable error message (never includes the API key). */
  errorMessage?: string;
  /** HTTP status code if available. */
  statusCode?: number;
  /** The endpoint that was tested (baseUrl + path, no key). */
  endpoint?: string;
}

/**
 * Classify a fetch/HTTP error into a structured test result.
 * Never includes the API key in the output.
 */
export function classifyTestError(
  error: unknown,
  statusCode?: number,
  endpoint?: string,
): ProviderTestResult {
  if (error instanceof TypeError) {
    // fetch() throws TypeError on network failures (DNS, CORS, connection refused)
    return {
      ok: false,
      errorType: 'NETWORK_ERROR',
      errorMessage: `网络错误：无法连接到 ${endpoint ?? '服务器'}。请检查 Base URL 和网络连接。`,
      endpoint,
    };
  }

  if (statusCode !== undefined) {
    if (statusCode === 401 || statusCode === 403) {
      return {
        ok: false,
        errorType: 'AUTH_ERROR',
        statusCode,
        errorMessage: `认证失败（HTTP ${statusCode}）：API Key 无效或无权限。`,
        endpoint,
      };
    }
    if (statusCode === 404) {
      return {
        ok: false,
        errorType: 'NOT_FOUND',
        statusCode,
        errorMessage: `未找到（HTTP 404）：端点路径或模型 ID 不正确。请检查 Base URL 和 Model ID。`,
        endpoint,
      };
    }
    if (statusCode === 400) {
      return {
        ok: false,
        errorType: 'BAD_REQUEST',
        statusCode,
        errorMessage: `请求格式错误（HTTP 400）：可能是模型 ID 不正确或请求参数不支持。`,
        endpoint,
      };
    }
    if (statusCode === 429) {
      return {
        ok: false,
        errorType: 'RATE_LIMIT',
        statusCode,
        errorMessage: `请求频率超限（HTTP 429）：请稍后重试。`,
        endpoint,
      };
    }
    if (statusCode >= 500) {
      return {
        ok: false,
        errorType: 'UNKNOWN',
        statusCode,
        errorMessage: `服务器错误（HTTP ${statusCode}）：中转站或上游服务异常。`,
        endpoint,
      };
    }
  }

  const msg = error instanceof Error ? error.message : String(error);
  // Check for invalid URL patterns
  if (msg.includes('Invalid URL') || msg.includes('is not a valid URL')) {
    return {
      ok: false,
      errorType: 'INVALID_URL',
      errorMessage: `Base URL 格式无效：${endpoint ?? ''}。请检查是否包含完整的 https:// 前缀。`,
      endpoint,
    };
  }

  // Check for SSE/JSON parse errors (e.g. "Unexpected token 'd', "data: ..." is not valid JSON")
  if (
    error instanceof SyntaxError ||
    msg.includes('is not valid JSON') ||
    msg.includes('Unexpected token')
  ) {
    return {
      ok: false,
      errorType: 'PROTOCOL_ERROR',
      errorMessage: `协议错误：服务器返回了无法解析的响应格式。可能是中转站不兼容 OpenAI 协议。${endpoint ? `（${endpoint}）` : ''}`,
      endpoint,
    };
  }

  return {
    ok: false,
    errorType: 'UNKNOWN',
    errorMessage: msg,
    statusCode,
    endpoint,
  };
}
