import { MODEL_ID } from "@/lib/llm";

export async function GET() {
  return Response.json({ model: MODEL_ID, groqKeyConfigured: Boolean(process.env.GROQ_API_KEY) });
}
