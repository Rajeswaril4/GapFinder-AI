import { MODEL_ID } from "@/lib/llm";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { checkQdrantHealth } from "@/lib/vector/qdrant";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const isSupabaseUrlValid =
    supabaseUrl.startsWith("http://") || supabaseUrl.startsWith("https://");

  let supabaseDbStatus = "not_configured";
  let supabaseTables: string[] = [];
  let supabaseError: string | null = null;

  if (isSupabaseUrlValid) {
    const admin = getSupabaseAdminClient();
    if (admin) {
      try {
        const { data, error } = await admin
          .from("documents")
          .select("id")
          .limit(1);

        if (error) {
          supabaseDbStatus = "error";
          supabaseError = error.message;
        } else {
          supabaseDbStatus = "connected";
        }
      } catch (err: any) {
        supabaseDbStatus = "error";
        supabaseError = err?.message || "Connection failed";
      }
    }
  } else if (supabaseUrl) {
    supabaseDbStatus = "invalid_url_format";
    supabaseError =
      "NEXT_PUBLIC_SUPABASE_URL must be an HTTPS URL (e.g. https://your-project.supabase.co), but found an API key string.";
  }

  const qdrantHealthy = await checkQdrantHealth().catch(() => false);

  return Response.json({
    status: "ok",
    ai: {
      primaryProvider: "Google Gemini",
      primaryModel: process.env.GEMINI_MODEL || "gemini-3.5-flash",
      fallbackModel: MODEL_ID,
      geminiKeyConfigured: Boolean(process.env.GEMINI_API_KEY),
      groqKeyConfigured: Boolean(process.env.GROQ_API_KEY),
    },
    vectorDb: {
      provider: "Qdrant Cloud",
      status: qdrantHealthy ? "healthy" : "offline_or_unreachable",
      collection: process.env.QDRANT_COLLECTION || "gapfinder_materials",
    },
    supabase: {
      status: supabaseDbStatus,
      urlConfigured: isSupabaseUrlValid,
      urlPrefix: isSupabaseUrlValid
        ? supabaseUrl.slice(0, 25) + "..."
        : "INVALID (API key placed in URL field)",
      error: supabaseError,
      migrationRequired:
        supabaseDbStatus === "error" &&
        (supabaseError?.toLowerCase().includes("relation") ||
          supabaseError?.toLowerCase().includes("could not find the table")),
    },
  });
}
