import type { Provider } from "../types.ts";
import { createAnthropic } from "./anthropic.ts";
import { withNormalizedErrors } from "./errors.ts";
import { createOpenAICompat } from "./openai-compat.ts";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (add it to .env or your environment)`);
  return value;
}

const providers: Record<string, () => Provider> = {
  anthropic: createAnthropic,
  "anthropic-xkiro": () =>
    createAnthropic(
      "anthropic-xkiro",
      "https://api.xkiro.com",
      requireEnv("XKIRO_API_KEY"),
      "mistralai/mistral-medium-3.5",
      128_000,
    ),
  gemini: () =>
    createOpenAICompat(
      "gemini",
      "https://generativelanguage.googleapis.com/v1beta/openai/",
      requireEnv("GEMINI_API_KEY"),
      "gemini-2.5-flash",
      1_000_000,
    ),
  groq: () =>
    createOpenAICompat(
      "groq",
      "https://api.groq.com/openai/v1",
      requireEnv("GROQ_API_KEY"),
      "openai/gpt-oss-120b",
      131_072,
    ),
};

export const providerNames = Object.keys(providers);

export function getProvider(name: string): Provider {
  const create = providers[name];
  if (!create)
    throw new Error(`unknown provider "${name}". Available: ${providerNames.join(", ")}`);
  return withNormalizedErrors(create());
}
