// API Route: Server-side document upload, validation, and ingestion pipeline.

import { processDocumentServerSide, deleteDocumentServerSide } from "@/lib/ingest-server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const maxDuration = 60; // Max allowed on Vercel Hobby tier
export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    const declaredKind = (formData.get("kind") as any) || "notes";
    const subjectId = (formData.get("subjectId") as string) || "default";

    if (!(file instanceof File)) {
      return Response.json({ error: "No file provided" }, { status: 400 });
    }

    // Determine authenticated user ID or demo user
    let userId = (formData.get("userId") as string) || "demo_student";
    const supabase = await getSupabaseServerClient();
    if (supabase) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        userId = user.id;
      }
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const result = await processDocumentServerSide({
      userId,
      subjectId,
      fileName: file.name,
      fileBuffer: buffer,
      mimeType: file.type,
      declaredKind,
    });

    return Response.json(result);
  } catch (err: unknown) {
    console.error("[api/ingest] Ingestion failed:", err);
    return Response.json(
      { error: (err as Error).message || "Document processing failed" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const documentId = searchParams.get("id");
    const userId = searchParams.get("userId") || "demo_student";

    if (!documentId) {
      return Response.json({ error: "Missing document id" }, { status: 400 });
    }

    const ok = await deleteDocumentServerSide(userId, documentId);
    return Response.json({ success: ok });
  } catch (err: unknown) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
