import { z } from "zod";
import { config } from "../config.js";
import { logger } from "../logger.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

const ChatCompletionSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({
        content: z.string().nullable().optional()
      })
    })
  )
});

export class NvidiaClient {
  constructor(
    private readonly apiKey = config.NVIDIA_API_KEY,
    private readonly baseUrl = config.NVIDIA_API_BASE_URL
  ) {}

  async chatText(messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
    const model = options.model ?? config.NVIDIA_MODEL_PRIMARY;
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: options.temperature ?? 0.35,
        top_p: 0.9,
        max_tokens: options.maxTokens ?? 8_192,
        stream: false
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.warn({ model, status: response.status, errorText }, "NVIDIA chat request failed");
      throw new Error(`NVIDIA request failed for ${model}: ${response.status}`);
    }

    const json = ChatCompletionSchema.parse(await response.json());
    return json.choices[0]?.message.content?.trim() ?? "";
  }

  async chatJson<T>(
    messages: ChatMessage[],
    schema: z.ZodType<T>,
    options: ChatOptions = {}
  ): Promise<T> {
    const content = await this.chatText(messages, options);
    const jsonText = extractJson(content);
    const parsed = JSON.parse(jsonText) as unknown;
    return schema.parse(parsed);
  }
}

export function extractJson(content: string): string {
  const trimmed = content.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  throw new Error("Model response did not contain JSON");
}
