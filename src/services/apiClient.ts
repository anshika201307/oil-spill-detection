/// <reference types="vite/client" />

/**
 * Small fetch wrapper for browser-to-backend requests.
 * Components should use relative endpoint paths, for example: `/incidents`.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly statusText: string,
    public readonly responseBody?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type ApiRequestOptions = Omit<RequestInit, 'body' | 'headers' | 'method'> & {
  headers?: HeadersInit;
};

function getBaseUrl(): string {
  const baseUrl = import.meta.env.VITE_API_URL?.trim().replace(/\/+$/, '');

  if (!baseUrl) {
    throw new Error('VITE_API_URL is not configured. Set it before making backend API requests.');
  }

  return baseUrl;
}

function buildUrl(path: string): string {
  return `${getBaseUrl()}/${path.replace(/^\/+/, '')}`;
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const body = await response.text();

  if (!body) {
    return undefined;
  }

  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

function getErrorMessage(response: Response, responseBody: unknown): string {
  if (typeof responseBody === 'object' && responseBody !== null) {
    const body = responseBody as { error?: { message?: string } | string; message?: string };

    if (typeof body.error === 'string') {
      return body.error;
    }

    if (body.error?.message) {
      return body.error.message;
    }

    if (body.message) {
      return body.message;
    }
  }

  return `Request failed with ${response.status} ${response.statusText}`;
}

async function request<TResponse>(
  path: string,
  method: 'GET' | 'POST',
  options: ApiRequestOptions & { body?: string } = {},
): Promise<TResponse> {
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');

  if (method === 'POST') {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(buildUrl(path), {
    ...options,
    method,
    headers,
  });
  const responseBody = await parseResponseBody(response);

  if (!response.ok) {
    throw new ApiError(
      getErrorMessage(response, responseBody),
      response.status,
      response.statusText,
      responseBody,
    );
  }

  return responseBody as TResponse;
}

export function get<TResponse>(path: string, options?: ApiRequestOptions): Promise<TResponse> {
  return request<TResponse>(path, 'GET', options);
}

export function post<TResponse, TBody>(
  path: string,
  body: TBody,
  options?: ApiRequestOptions,
): Promise<TResponse> {
  return request<TResponse>(path, 'POST', {
    ...options,
    body: JSON.stringify(body),
  });
}

export const apiClient = {
  get,
  post,
};
