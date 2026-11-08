// AGENT 10 — Learning Assistant (generation, streaming). Supplementary to the diagnosis.
// The browser retrieves the relevant chunks (BM25) and sends them as numbered context;
// the model must answer only from them and cite [n].
import { streamText } from "ai";
import { z } from "zod";
import { GROQ_OPTIONS, fail, model } from "@/lib/llm";

export const maxDuration = 60;

const Body = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) })).min(1),
  context: z.array(z.object({ n: z.number(), label: z.string(), text: z.string() })).max(8),
});

export async function POST(req: Request) {
  try {
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
    const { messages, context } = parsed.data;
    const sources = context.map((c) => `[${c.n}] ${c.label}\n${c.text.slice(0, 1200)}`).join("\n\n");

    const result = streamText({
      model: model(),
      temperature: 0.2,
      providerOptions: GROQ_OPTIONS,
      system:
        "You are a patient tutor (the Learning Assistant). You can explain concepts, explain why an answer was wrong, give examples and write extra practice questions with answers — always from the sources. Explain using ONLY the numbered SOURCES from the student's own study material below. " +
        "Cite every factual sentence with its source number like [1] or [2]. " +
        "If the sources do not contain the answer, reply exactly: \"I couldn't find this in your uploaded material.\" and " +
        "suggest which uploaded section might be closest, if any. Never use outside knowledge, even if you know the answer. " +
        "Keep explanations simple: short paragraphs, an example from the sources when possible, and finish with one quick " +
        "check-your-understanding question.\n\nSOURCES:\n" +
        sources,
      messages: messages.slice(-8).map((m) => ({ role: m.role, content: m.content })),
    });
    return result.toTextStreamResponse();
  } catch (e) {
    return fail(e);
  }
}
