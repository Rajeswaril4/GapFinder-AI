// Google Gemini client for structured generation and streaming.
// Supports Gemini 1.5 Flash / 2.0 Flash with automatic retry, exponential backoff,
// rate-limit detection, token usage tracking, and timeout controls.

export interface GeminiUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface GeminiGenerateOptions {
  model?: string;
  systemPrompt?: string;
  userPrompt: string;
  temperature?: number;
  maxOutputTokens?: number;
  jsonMode?: boolean;
  timeoutMs?: number;
}

export interface GeminiResponse {
  text: string;
  usage: GeminiUsage;
  finishReason?: string;
}

export class GeminiError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public isRateLimit: boolean = false
  ) {
    super(message);
    this.name = "GeminiError";
  }
}

const DEFAULT_GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash";
const API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export function getGeminiApiKey(): string | null {
  return process.env.GEMINI_API_KEY || null;
}

/** Sleep helper with optional jitter */
function sleep(ms: number): Promise<void> {
  const jitter = Math.random() * 200;
  return new Promise((resolve) => setTimeout(resolve, ms + jitter));
}

/**
 * Generate text or structured JSON from Gemini with exponential backoff retry.
 */
export async function callGemini(opts: GeminiGenerateOptions): Promise<GeminiResponse> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new GeminiError("GEMINI_API_KEY is not configured", 500);
  }

  const model = opts.model || DEFAULT_GEMINI_MODEL;
  const timeoutMs = opts.timeoutMs ?? 45_000;
  const url = `${API_BASE_URL}/models/${model}:generateContent?key=${apiKey}`;

  const payload: Record<string, unknown> = {
    contents: [
      {
        role: "user",
        parts: [{ text: opts.userPrompt }],
      },
    ],
    generationConfig: {
      temperature: opts.temperature ?? 0.2,
      maxOutputTokens: opts.maxOutputTokens ?? 8192,
      ...(opts.jsonMode ? { responseMimeType: "application/json" } : {}),
    },
  };

  if (opts.systemPrompt) {
    payload.systemInstruction = {
      role: "system",
      parts: [{ text: opts.systemPrompt }],
    };
  }

  const maxAttempts = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        const errorBody = await res.json().catch(() => ({}));
        const message =
          errorBody.error?.message || `Gemini API returned HTTP ${res.status}`;
        const isRateLimit = res.status === 429 || /quota|rate limit/i.test(message);

        if (isRateLimit && attempt < maxAttempts) {
          const backoff = Math.pow(2, attempt) * 1000;
          await sleep(backoff);
          continue;
        }

        if (res.status >= 500 && attempt < maxAttempts) {
          await sleep(1500 * attempt);
          continue;
        }

        if (res.status === 404 && model !== "gemini-1.5-flash" && attempt === 1) {
          console.warn(`[gemini] Model ${model} unavailable (404), auto-switching to gemini-1.5-flash`);
          return callGemini({ ...opts, model: "gemini-1.5-flash" });
        }

        throw new GeminiError(message, res.status, isRateLimit);
      }

      const data = await res.json();
      const candidate = data.candidates?.[0];
      const text =
        candidate?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";

      const usageMetadata = data.usageMetadata || {};
      const usage: GeminiUsage = {
        promptTokens: usageMetadata.promptTokenCount ?? 0,
        completionTokens: usageMetadata.candidatesTokenCount ?? 0,
        totalTokens: usageMetadata.totalTokenCount ?? 0,
      };

      return {
        text,
        usage,
        finishReason: candidate?.finishReason,
      };
    } catch (err: unknown) {
      lastError = err as Error;
      if (err instanceof GeminiError && !err.isRateLimit && err.statusCode < 500) {
        throw err;
      }
      if (attempt < maxAttempts) {
        await sleep(Math.pow(2, attempt) * 1000);
      }
    }
  }

  throw lastError || new GeminiError("Failed to reach Gemini API after retries", 502);
}

/**
 * Call Gemini stream for real-time tutoring / learning assistant responses.
 */
export async function streamGemini(opts: {
  systemPrompt?: string;
  messages: Array<{ role: "user" | "model" | "assistant"; text: string }>;
  temperature?: number;
}): Promise<ReadableStream<Uint8Array>> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new GeminiError("GEMINI_API_KEY is not configured", 500);
  }

  const model = DEFAULT_GEMINI_MODEL;
  const url = `${API_BASE_URL}/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;

  const contents = opts.messages.map((m) => ({
    role: m.role === "assistant" ? "model" : m.role,
    parts: [{ text: m.text }],
  }));

  const payload: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature: opts.temperature ?? 0.2,
    },
  };

  if (opts.systemPrompt) {
    payload.systemInstruction = {
      role: "system",
      parts: [{ text: opts.systemPrompt }],
    };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    const message = errorBody.error?.message || `HTTP ${res.status}`;
    throw new GeminiError(message, res.status);
  }

  // Parse SSE and emit raw text chunks
  const encoder = new TextEncoder();
  const reader = res.body?.getReader();
  if (!reader) throw new GeminiError("No response stream", 500);

  return new ReadableStream({
    async pull(controller) {
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          break;
        }
        buffer += new TextDecoder().decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const dataStr = line.slice(6).trim();
            if (!dataStr || dataStr === "[DONE]") continue;
            try {
              const parsed = JSON.parse(dataStr);
              const chunkText =
                parsed.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ?? "";
              if (chunkText) {
                controller.enqueue(encoder.encode(chunkText));
              }
            } catch {
              // Ignore malformed SSE frames
            }
          }
        }
      }
    },
  });
}
