import { describe, it, expect } from 'vitest';
import { classifyTestError } from './test-errors';

const ENDPOINT = 'https://api.example.com/v1/chat/completions';

describe('classifyTestError', () => {
  it('classifies TypeError as NETWORK_ERROR', () => {
    const result = classifyTestError(new TypeError('Failed to fetch'), undefined, ENDPOINT);
    expect(result.ok).toBe(false);
    expect(result.errorType).toBe('NETWORK_ERROR');
    expect(result.errorMessage).toContain('网络错误');
    expect(result.endpoint).toBe(ENDPOINT);
  });

  it('classifies 401/403 as AUTH_ERROR', () => {
    const result = classifyTestError(new Error('Unauthorized'), 401, ENDPOINT);
    expect(result.errorType).toBe('AUTH_ERROR');
    expect(result.statusCode).toBe(401);
    expect(result.errorMessage).toContain('认证失败');
  });

  it('classifies 403 as AUTH_ERROR', () => {
    const result = classifyTestError(new Error('Forbidden'), 403, ENDPOINT);
    expect(result.errorType).toBe('AUTH_ERROR');
    expect(result.statusCode).toBe(403);
  });

  it('classifies 404 as NOT_FOUND', () => {
    const result = classifyTestError(new Error('Not Found'), 404, ENDPOINT);
    expect(result.errorType).toBe('NOT_FOUND');
    expect(result.statusCode).toBe(404);
    expect(result.errorMessage).toContain('端点路径或模型 ID');
  });

  it('classifies 400 as BAD_REQUEST', () => {
    const result = classifyTestError(new Error('Bad Request'), 400, ENDPOINT);
    expect(result.errorType).toBe('BAD_REQUEST');
    expect(result.statusCode).toBe(400);
  });

  it('classifies 429 as RATE_LIMIT', () => {
    const result = classifyTestError(new Error('Too Many Requests'), 429, ENDPOINT);
    expect(result.errorType).toBe('RATE_LIMIT');
    expect(result.statusCode).toBe(429);
  });

  it('classifies 5xx as UNKNOWN with server error message', () => {
    const result = classifyTestError(new Error('Internal Server Error'), 500, ENDPOINT);
    expect(result.errorType).toBe('UNKNOWN');
    expect(result.statusCode).toBe(500);
    expect(result.errorMessage).toContain('服务器错误');
  });

  it('classifies invalid URL error as INVALID_URL', () => {
    const result = classifyTestError(new Error('https://bad is not a valid URL'), undefined, 'https://bad');
    expect(result.errorType).toBe('INVALID_URL');
    expect(result.errorMessage).toContain('Base URL 格式无效');
  });

  it('falls back to UNKNOWN for unrecognized errors', () => {
    const result = classifyTestError(new Error('something weird'), 418, ENDPOINT);
    expect(result.errorType).toBe('UNKNOWN');
    expect(result.statusCode).toBe(418);
    expect(result.errorMessage).toBe('something weird');
  });

  it('classifies SyntaxError as PROTOCOL_ERROR', () => {
    const result = classifyTestError(
      new SyntaxError('Unexpected token \'d\', "data: {"id"... is not valid JSON'),
      undefined,
      ENDPOINT,
    );
    expect(result.errorType).toBe('PROTOCOL_ERROR');
    expect(result.errorMessage).toContain('协议错误');
  });

  it('classifies "is not valid JSON" as PROTOCOL_ERROR', () => {
    const result = classifyTestError(
      new Error('Unexpected token "data:" is not valid JSON'),
      200,
      ENDPOINT,
    );
    expect(result.errorType).toBe('PROTOCOL_ERROR');
  });

  it('never includes API key in error message', () => {
    const result = classifyTestError(new Error('Bearer sk-secret-key is invalid'), 401, ENDPOINT);
    expect(result.errorMessage).not.toContain('sk-secret-key');
  });
});
