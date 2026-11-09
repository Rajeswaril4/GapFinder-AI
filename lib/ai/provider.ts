// Unified AI Provider layer for GapFinder AI.
// Gemini Flash primary, Groq fallback, Zod validation, repair retry,
// rate-limit detection, token telemetry, and a hard time budget per request.

import type { z } from "zod";
import { callGemini, GeminiError, getGeminiApiKey } from "./gemini";
import { createGroq } from "@ai-sdk/groq";
import { generateText } from "ai";

export interface AIProviderMetrics {
  provider: "gemini" | "groq" | "fallback";
  model: string;
  durationMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export class AIProviderError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public isRateLimit: boolean = false
  ) {
    super(message);
    this.name = "AIProviderError";
  }
}

/** Extracts the first JSON object or array from LLM text */
export function extractJsonFromText(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[[{]/);
  if (start < 0) throw new Error("No JSON found in model output");
  const open = body[start];
  const close = open === "{" ? "}" : "]";
  const end = body.lastIndexOf(close);
  if (end <= start) throw new Error("Unterminated JSON in model output");
  return JSON.parse(body.slice(start, end + 1));
}

const JSON_PROMPT_INSTRUCTION =
  "\n\nOUTPUT INSTRUCTION: Respond ONLY with a valid JSON object matching the requested schema. No markdown formatting outside ```json, and no introductory or concluding text.";

// Total time budget per request. Must stay under the route's maxDuration (60s).
const BUDGET_MS = 55_000;
// Groq free tier has a tokens-per-minute cap; trim from the MIDDLE so the
// instructions and JSON format at the end of the prompt are never cut off.
const GROQ_MAX_CHARS = Number(process.env.GROQ_MAX_PROMPT_CHARS) || 12_000;

const fit = (p: string, max: number) =>
  p.length <= max ? p : p.slice(0, max * 0.5) + "\n[...trimmed...]\n" + p.slice(-max * 0.5);

const issuesOf = (e: z.ZodError) =>
  e.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");

/**
 * Structured generation: Gemini first (if GEMINI_API_KEY), then Groq (if GROQ_API_KEY).
 */
export async function generateStructuredJson<S extends z.ZodTypeAny>(opts: {
  schema: S;
  system: string;
  prompt: string;
  temperature?: number;
  timeoutMs?: number;
  mockResponse?: unknown;
}): Promise<{ data: z.infer<S>; metrics: AIProviderMetrics }> {
  const t0 = performance.now();
  const left = () => BUDGET_MS - (performance.now() - t0);
  const ms = () => Math.round(performance.now() - t0);

  // Hermetic mock response support for offline tests & verification
  if (opts.mockResponse !== undefined) {
    const parsed = opts.schema.safeParse(opts.mockResponse);
    if (parsed.success) {
      return {
        data: parsed.data,
        metrics: { provider: "fallback", model: "hermetic-mock", durationMs: ms(), promptTokens: 50, completionTokens: 20, totalTokens: 70 },
      };
    }
  }

  const geminiKey = getGeminiApiKey();
  const groqKey = process.env.GROQ_API_KEY;
  let lastError: Error | null = null;

  // 1. Gemini (2 attempts only to repair invalid JSON; network errors/timeouts go straight to Groq)
  if (geminiKey) {
    let currentPrompt = opts.prompt + JSON_PROMPT_INSTRUCTION;
    for (let attempt = 1; attempt <= 2 && left() > 10_000; attempt++) {
      try {
        const res = await callGemini({
          systemPrompt: opts.system,
          userPrompt: currentPrompt,
          temperature: opts.temperature ?? 0.2,
          jsonMode: true,
          timeoutMs: Math.min(opts.timeoutMs ?? 20_000, left() - 5_000),
        });

        const parsed = opts.schema.safeParse(extractJsonFromText(res.text));
        if (parsed.success) {
          return {
            data: parsed.data,
            metrics: {
              provider: "gemini",
              model: process.env.GEMINI_MODEL || "gemini-3.5-flash",
              durationMs: ms(),
              promptTokens: res.usage.promptTokens,
              completionTokens: res.usage.completionTokens,
              totalTokens: res.usage.totalTokens,
            },
          };
        }
        const issues = issuesOf(parsed.error);
        lastError = new Error(`Validation failed: ${issues}`);
        currentPrompt = `${opts.prompt}${JSON_PROMPT_INSTRUCTION}\n\nYour previous response did not match the schema (${issues}). Return ONLY valid JSON in the exact format requested.`;
      } catch (err) {
        lastError = err as Error;
        console.warn("[ai-provider] Gemini attempt failed:", (err as Error).message);
        if (err instanceof GeminiError && err.isRateLimit) console.warn("[ai-provider] Gemini rate limited");
        break; // timeout / HTTP / parse error: don't burn the time budget, try Groq
      }
    }
  }

  // 2. Groq fallback
  if (groqKey && left() > 8_000) {
    try {
      const modelId = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
      const model = createGroq({ apiKey: groqKey })(modelId);
      const base = fit(opts.prompt, GROQ_MAX_CHARS) + JSON_PROMPT_INSTRUCTION;
      let prompt = base;
      let lastErrStr = "";

      for (let attempt = 0; attempt < 2 && left() > 8_000; attempt++) {
        const { text, usage } = await generateText({
          model,
          system: opts.system + JSON_PROMPT_INSTRUCTION,
          prompt,
          temperature: opts.temperature ?? 0.3,
          abortSignal: AbortSignal.timeout(Math.min(25_000, left() - 3_000)),
          providerOptions: { groq: { reasoningEffort: process.env.GROQ_REASONING_EFFORT || "low" } },
        });

        try {
          const parsed = opts.schema.safeParse(extractJsonFromText(text));
          if (parsed.success) {
            const pt = usage?.inputTokens ?? 0;
            const ct = usage?.outputTokens ?? 0;
            return {
              data: parsed.data,
              metrics: { provider: "groq", model: modelId, durationMs: ms(), promptTokens: pt, completionTokens: ct, totalTokens: pt + ct },
            };
          }
          lastErrStr = issuesOf(parsed.error);
        } catch (e) {
          lastErrStr = (e as Error).message;
        }
        // Repair retry: always rebuild from the trimmed base so the prompt never grows
        prompt = `${base}\n\nYour previous reply was not valid (${lastErrStr}). Return only a valid JSON object with every required field.`;
      }
      lastError = new Error(`Groq returned invalid response: ${lastErrStr}`);
    } catch (err) {
      lastError = err as Error;
      console.warn("[ai-provider] Groq fallback failed:", err);
    }
  }

  // 3. Offline/test fallback: no keys configured, try JSON embedded in the prompt
  if (!geminiKey && !groqKey) {
    try {
      const parsed = opts.schema.safeParse(extractJsonFromText(opts.prompt));
      if (parsed.success) {
        return {
          data: parsed.data,
          metrics: { provider: "fallback", model: "offline-fallback", durationMs: ms(), promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        };
      }
    } catch {
      // Prompt did not contain fallback JSON
    }
  }

  throw new AIProviderError(
    `AI generation failed across configured providers: ${lastError?.message || "No AI API keys configured"}`,
    502
  );
}