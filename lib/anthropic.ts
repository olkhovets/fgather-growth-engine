/** Model ids for API + display labels for UI dropdown. */
export const ANTHROPIC_MODELS = [
  { id: "claude-haiku-4-5", label: "Haiku 4.5" },
  { id: "claude-sonnet-4-5", label: "Sonnet 4.5" },
  { id: "claude-3-5-haiku-latest", label: "Haiku 3.5 (legacy)" },
  { id: "claude-3-5-sonnet-latest", label: "Sonnet 3.5 (legacy)" },
  { id: "claude-3-5-haiku-20241022", label: "Haiku 3.5 Oct 2024 (retired)" },
  { id: "claude-3-5-sonnet-20241022", label: "Sonnet 3.5 Oct 2024 (retired)" },
] as const;

export type AnthropicUsage = { input_tokens: number; output_tokens: number };

/** Deprecated/retired models → current model. Claude 3.5 Haiku was retired Feb 2026. */
const DEPRECATED_MODEL_FALLBACK: Record<string, string> = {
  "claude-3-5-haiku-latest": "claude-haiku-4-5",
  "claude-3-5-haiku-20241022": "claude-haiku-4-5",
  "claude-3-5-sonnet-latest": "claude-sonnet-4-5",
  "claude-3-5-sonnet-20240620": "claude-sonnet-4-5",
  "claude-3-5-sonnet-20241022": "claude-sonnet-4-5",
};

function resolveModel(model: string): string {
  return DEPRECATED_MODEL_FALLBACK[model] ?? model;
}

export async function callAnthropic(
  apiKey: string,
  userMessage: string,
  options?: { maxTokens?: number; model?: string; systemPrompt?: string }
): Promise<{ text: string; usage?: AnthropicUsage }> {
  const maxTokens = options?.maxTokens ?? 2000;
  const requested = options?.model ?? ANTHROPIC_MODELS[0].id;
  const model = resolveModel(requested);

  const reqBody: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: userMessage }],
  };

  if (options?.systemPrompt) {
    reqBody.system = [
      {
        type: "text",
        text: options.systemPrompt,
        cache_control: { type: "ephemeral" },
      },
    ];
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      ...(options?.systemPrompt ? { "anthropic-beta": "prompt-caching-2024-07-31" } : {}),
    },
    body: JSON.stringify(reqBody),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(`Anthropic (${model}): ${res.status} - ${JSON.stringify(errData)}`);
  }

  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
    usage?: { input_tokens: number; output_tokens: number };
  };
  const text = data.content?.[0]?.text ?? "";
  const usage = data.usage
    ? { input_tokens: data.usage.input_tokens, output_tokens: data.usage.output_tokens }
    : undefined;
  return { text, usage };
}
