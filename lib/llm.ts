// GENERATION LAYER (server only). Every LLM call in the app goes through here.
// The model never searches anything itself: callers pass in the exact source text
// that retrieval selected, and the prompts forbid using outside knowledge.
import { createGroq } from "@ai-sdk/groq";
import { generateText } from "ai";
import type { z } from "zod";

export const MODEL_ID = process.env.GROQ_MODEL || "openai/gpt-oss-120b";

// gpt-oss models reason before answering; "low" keeps latency well inside Vercel's 60 s limit
export const GROQ_OPTIONS = { groq: { reasoningEffort: process.env.GROQ_REASONING_EFFORT || "low" } } as const;

export class ApiError extends Error {
  constructor(message: string, public status = 500) {
    super(message);
  }
}

export function model() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new ApiError("GROQ_API_KEY is not set on the server. Add it in .env.local or in Vercel → Settings → Environment Variables.", 500);
  return createGroq({ apiKey })(MODEL_ID);
}

/** Pulls the first JSON object/array out of a model reply (handles ```json fences and chatter). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[\[{]/);
  if (start < 0) throw new Error("No JSON found in model output");
  const open = body[start];
  const close = open === "{" ? "}" : "]";
  const end = body.lastIndexOf(close);
  if (end <= start) throw new Error("Unterminated JSON in model output");
  return JSON.parse(body.slice(start, end + 1));
}

const JSON_RULES =
  "\n\nOUTPUT FORMAT: Reply with ONE valid JSON object only. No markdown fences, no commentary before or after.";

/** Generate + validate JSON against a zod schema; one automatic repair retry. */
export async function generateJson<S extends z.ZodTypeAny>(opts: {
  schema: S;
  system: string;
  prompt: string;
  temperature?: number;
}): Promise<z.infer<S>> {
  let prompt = opts.prompt;
  let lastErr = "";
  for (let i = 0; i < 2; i++) {
    const { text } = await generateText({
      model: model(),
      system: opts.system + JSON_RULES,
      prompt,
      temperature: opts.temperature ?? 0.3,
      providerOptions: GROQ_OPTIONS,
    });
    try {
      const parsed = opts.schema.safeParse(extractJson(text));
      if (parsed.success) return parsed.data;
      lastErr = parsed.error.issues.slice(0, 3).map((x) => `${x.path.join(".")}: ${x.message}`).join("; ");
    } catch (e) {
      lastErr = (e as Error).message;
    }
    prompt = `${opts.prompt}\n\nYour previous reply was not valid (${lastErr}). Return only the JSON object, exactly matching the format.`;
  }
  throw new ApiError(`The AI returned an invalid response (${lastErr}). Please try again.`, 502);
}

export function fail(e: unknown): Response {
  const err = e as Error & { status?: number; statusCode?: number };
  const status = err instanceof ApiError ? err.status : err.statusCode === 429 ? 429 : 500;
  let message = err?.message || "Unexpected error";
  if (status === 429 || /rate limit|429/i.test(message))
    message = "Groq rate limit reached (free tier). Wait about a minute and try again.";
  console.error("[api]", message);
  return Response.json({ error: message }, { status: status === 429 || /rate limit/i.test(message) ? 429 : status });
}
