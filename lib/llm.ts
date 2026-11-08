// GENERATION LAYER (server only). Every LLM call in the app goes through here.
// Unified AI architecture: Gemini Flash (primary) + Groq (fallback).
// Callers pass in exact source text retrieved from the student's material;
// prompts forbid hallucinating information absent from retrieved chunks.

import { createGroq } from "@ai-sdk/groq";
import type { z } from "zod";
import {
  generateStructuredJson,
  extractJsonFromText,
  AIProviderError,
} from "./ai/provider";

export const MODEL_ID = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
export const GROQ_OPTIONS = {
  groq: { reasoningEffort: process.env.GROQ_REASONING_EFFORT || "low" },
} as const;

export class ApiError extends Error {
  constructor(message: string, public status = 500) {
    super(message);
    this.name = "ApiError";
  }
}

export function model() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new ApiError(
      "GROQ_API_KEY is not set on the server. Add it in .env.local or in Vercel → Settings → Environment Variables.",
      500
    );
  }
  return createGroq({ apiKey })(MODEL_ID);
}

/** Pulls the first JSON object/array out of a model reply */
export function extractJson(text: string): unknown {
  return extractJsonFromText(text);
}

/** Generate + validate JSON against a zod schema with Gemini Flash + Groq fallback */
export async function generateJson<S extends z.ZodTypeAny>(opts: {
  schema: S;
  system: string;
  prompt: string;
  temperature?: number;
  timeoutMs?: number;
}): Promise<z.infer<S>> {
  try {
    const result = await generateStructuredJson({
      schema: opts.schema,
      system: opts.system,
      prompt: opts.prompt,
      temperature: opts.temperature,
      timeoutMs: opts.timeoutMs,
    });
    return result.data;
  } catch (err: unknown) {
    if (err instanceof AIProviderError) {
      throw new ApiError(err.message, err.statusCode);
    }
    throw new ApiError((err as Error).message || "AI generation failed", 502);
  }
}

export function fail(e: unknown): Response {
  const err = e as Error & { status?: number; statusCode?: number };
  const status =
    err instanceof ApiError
      ? err.status
      : err instanceof AIProviderError
        ? err.statusCode
        : err.statusCode === 429
          ? 429
          : 500;
  let message = err?.message || "Unexpected error";
  if (status === 429 || /rate limit|429|quota/i.test(message)) {
    message = "AI service rate limit reached. Please wait a moment and try again.";
  }
  console.error("[api]", message);
  return Response.json(
    { error: message },
    { status: status === 429 || /rate limit/i.test(message) ? 429 : status }
  );
}
