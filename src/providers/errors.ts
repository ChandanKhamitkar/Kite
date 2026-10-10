import type { Provider } from "../types.ts";

export class ProviderError extends Error {
  status?: number;
  retryable: boolean;
  provider: string;

  constructor(provider: string, message: string, status?: number, retryable = false, cause?: unknown) {
    super(message, { cause });
    this.name = "ProviderError";
    this.provider = provider;
    this.status = status;
    this.retryable = retryable;
  }
}

/** Turn SDK / network errors into one readable error type. */
export function normalizeError(error: unknown, provider: string): Error {
  if (error instanceof ProviderError) return error;
  const e = error as { status?: number; message?: string; name?: string; code?: string };
  const detail = (e?.message ?? String(error)).slice(0, 300);
  const status = typeof e?.status === "number" ? e.status : undefined;

  if (status === 401 || status === 403)
    return new ProviderError(provider, `${provider}: authentication failed (${status}). Check the API key.`, status, false, error);
  if (status === 404)
    return new ProviderError(provider, `${provider}: not found (404). Check the model name. ${detail}`, status, false, error);
  if (status === 429)
    return new ProviderError(provider, `${provider}: rate limited (429). Wait a bit and try again.`, status, true, error);
  if (status !== undefined && status >= 500)
    return new ProviderError(provider, `${provider}: server error (${status}). ${detail}`, status, true, error);
  if (status !== undefined)
    return new ProviderError(provider, `${provider}: request rejected (${status}). ${detail}`, status, false, error);

  const connection =
    e?.name === "APIConnectionError" ||
    e?.name === "APIConnectionTimeoutError" ||
    ["ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT"].includes(e?.code ?? "");
  if (connection)
    return new ProviderError(provider, `${provider}: could not reach the API. Check your network.`, undefined, true, error);

  return error instanceof Error ? error : new Error(detail);
}

/** Wrap a provider so every failure surfaces as a ProviderError. */
export function withNormalizedErrors(provider: Provider): Provider {
  return {
    ...provider,
    async *stream(opts) {
      try {
        yield* provider.stream(opts);
      } catch (error) {
        throw normalizeError(error, provider.name);
      }
    },
  };
}
