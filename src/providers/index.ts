import type { Provider } from "../types.ts";
import { createAnthropic } from "./anthropic.ts";

const providers: Record<string, () => Provider> = {
  anthropic: createAnthropic,
  "anthropic-xkiro": () =>
    createAnthropic(
      "anthropic-xkiro",
      "https://api.xkiro.com",
      process.env.XKIRO_API_KEY!,
      "mistralai/mistral-medium-3.5",
    ),
};

export function getProvider(name: string): Provider {
  const create = providers[name];
  if (!create) {
    throw new Error("Provider not found bhai!");
  }
  return create();
}
