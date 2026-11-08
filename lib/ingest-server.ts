// Server-side Document Ingestion Pipeline for GapFinder AI.
// Handles PDF, TXT, Markdown extraction, SHA-256 deduplication,
// page preservation, heading extraction, overlapping chunking,
// Gemini embeddings generation, and Qdrant vector indexing.
// Idempotent and recoverable across partial failures.

import { createHash, randomUUID } from "node:crypto";
import { extractText, getDocumentProxy } from "unpdf";
import type { Chunk, Material, MaterialKind, DocStatus } from "./types";
import { uid } from "./types";
import { chunkMaterial } from "./chunk";
import { detectKind } from "./ingest";
import { getBatchEmbeddings, EMBEDDING_MODEL, EMBEDDING_VERSION } from "./ai/embeddings";
import { upsertChunksToQdrant, deleteDocumentVectors } from "./vector/qdrant";
import { getSupabaseAdminClient } from "./supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

export const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB max
export const STORAGE_BUCKET = "materials";

/** Resolves or creates a valid Supabase Auth user & profile for database foreign key integrity */
export async function resolveDbUserId(supabase: SupabaseClient, rawId: string): Promise<string> {
  // If it's already a valid UUID in profiles
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawId)) {
    const { data: p } = await supabase.from("profiles").select("id").eq("id", rawId).maybeSingle();
    if (p) return p.id;
  }

  const email = rawId.includes("@") ? rawId.toLowerCase() : `${rawId.toLowerCase()}@gapfinder.ai`;
  const { data: byEmail } = await supabase.from("profiles").select("id").eq("email", email).maybeSingle();
  if (byEmail) return byEmail.id;

  // Check auth.users
  try {
    const { data: authList } = await supabase.auth.admin.listUsers();
    const existing = authList?.users?.find((u) => u.email?.toLowerCase() === email);
    if (existing) {
      await supabase.from("profiles").upsert({
        id: existing.id,
        email,
        full_name: existing.user_metadata?.full_name || (rawId === "demo_student" ? "Demo Student" : rawId.split("@")[0]),
        role: "student",
      });
      return existing.id;
    }

    const { data: created } = await supabase.auth.admin.createUser({
      email,
      password: "temp-password-123456",
      email_confirm: true,
      user_metadata: {
        full_name: rawId === "demo_student" ? "Demo Student" : rawId.split("@")[0],
        role: "student",
      },
    });

    if (created?.user) {
      await supabase.from("profiles").upsert({
        id: created.user.id,
        email,
        full_name: rawId === "demo_student" ? "Demo Student" : rawId.split("@")[0],
        role: "student",
      });
      return created.user.id;
    }
  } catch (err) {
    console.warn("[ingest-server] Failed to auto-resolve auth user:", err);
  }

  return rawId;
}

export interface ServerIngestInput {
  userId: string;
  subjectId?: string;
  fileName: string;
  fileBuffer: Buffer | Uint8Array;
  mimeType?: string;
  declaredKind?: MaterialKind;
}

export interface ServerIngestResult {
  documentId: string;
  material: Material;
  chunks: Chunk[];
  duplicateOf?: string;
  warnings: string[];
  status: DocStatus;
}

/** Compute cryptographic SHA-256 hash of raw file bytes */
export function computeSha256(buffer: Buffer | Uint8Array): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/** Formats PDF page text, restoring newline breaks before headers */
function restorePdfLines(page: string): string {
  const lines = page.split("\n").length;
  if (lines > 4 || page.length < 300) return page;
  return page
    .replace(/\s+(?=(?:Chapter|Unit|Section|Module)\s+\d+)/g, "\n")
    .replace(/\s+(?=\d+(?:\.\d+)+\s+[A-Z])/g, "\n")
    .replace(/\s+(?=Q(?:uestion)?\s*\.?\s*\d+[.):]?\s)/g, "\n")
    .replace(/([.?!])\s+(?=[A-Z][a-z]+(?:\s[A-Z][a-z]+){0,4}\n)/g, "$1\n");
}

/**
 * Extracts raw pages from PDF or text file buffers, preserving 1-based page numbers.
 */
export async function extractPagesFromBuffer(
  buffer: Buffer | Uint8Array,
  fileName: string,
  mimeType?: string
): Promise<{ pages: string[]; warnings: string[] }> {
  const warnings: string[] = [];
  const isPdf = /\.pdf$/i.test(fileName) || mimeType === "application/pdf";

  if (isPdf) {
    try {
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      const { text } = await extractText(pdf, { mergePages: false });
      const rawPages = Array.isArray(text) ? text : [text];

      const pages = rawPages.map((p, idx) => {
        const clean = restorePdfLines(String(p ?? ""));
        if (clean.replace(/\s/g, "").length < 40) {
          warnings.push(
            `Page ${idx + 1} has almost no readable text (<40 chars). It may be scanned or image-only and requires OCR.`
          );
        }
        return clean;
      });

      const totalChars = pages.join("").replace(/\s/g, "").length;
      if (totalChars === 0) {
        throw new Error(
          "No selectable text found in this PDF (it may be a scanned image or empty). Please provide a readable PDF or paste text."
        );
      }

      return { pages, warnings };
    } catch (err: unknown) {
      if ((err as Error).message.includes("No selectable text")) throw err;
      throw new Error(`Corrupted or unreadable PDF: ${(err as Error).message}`);
    }
  }

  // Text or Markdown
  const text = new TextDecoder().decode(buffer);
  if (text.replace(/\s/g, "").length < 10) {
    throw new Error("The uploaded file does not contain enough readable text.");
  }

  return { pages: [text], warnings };
}

/**
 * Executes the full server-side ingestion pipeline:
 * Validation → Hash/Dedup check → Text Extraction → Chunking → Embeddings → Qdrant Indexing.
 */
export async function processDocumentServerSide(
  input: ServerIngestInput,
  onStatusUpdate?: (status: DocStatus, progress: number) => Promise<void>
): Promise<ServerIngestResult> {
  const { userId, subjectId = "default", fileName, fileBuffer, declaredKind = "notes" } = input;

  if (fileBuffer.byteLength > MAX_FILE_SIZE) {
    throw new Error(`File exceeds maximum size limit of ${MAX_FILE_SIZE / (1024 * 1024)} MB`);
  }

  await onStatusUpdate?.("processing", 10);

  // 1. Compute SHA-256
  const hash = computeSha256(fileBuffer);
  const supabase = getSupabaseAdminClient();
  let dbUserId = userId;
  if (supabase) {
    dbUserId = await resolveDbUserId(supabase, userId);
  }

  // 2. Check for duplicate document in database
  if (supabase) {
    const { data: existingDoc } = await supabase
      .from("documents")
      .select("id, name, status")
      .eq("user_id", dbUserId)
      .eq("hash", hash)
      .maybeSingle();

    if (existingDoc) {
      return {
        documentId: existingDoc.id,
        material: {
          id: existingDoc.id,
          name: fileName,
          kind: declaredKind,
          pages: [],
          createdAt: Date.now(),
          status: "ready",
          hash,
          wordCount: 0,
          headings: [],
          warnings: [`Duplicate document: content is identical to existing file "${existingDoc.name}"`],
        },
        chunks: [],
        duplicateOf: existingDoc.name,
        warnings: [`Content is identical to "${existingDoc.name}". Reusing existing index.`],
        status: "ready",
      };
    }
  }

  // 3. Extract text pages
  await onStatusUpdate?.("extracting", 25);
  const { pages, warnings } = await extractPagesFromBuffer(fileBuffer, fileName, input.mimeType);
  const fullText = pages.join("\n");
  const detectedKind = detectKind(fullText);

  if (detectedKind !== declaredKind) {
    warnings.push(`Document detected as "${detectedKind.replace("_", " ")}" but was uploaded as "${declaredKind.replace("_", " ")}".`);
  }

  // 4. Create document record in database if Supabase available
  const docId = randomUUID();
  let storagePath: string | null = null;

  if (supabase) {
    try {
      storagePath = `${dbUserId}/${docId}_${fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      await supabase.storage.from(STORAGE_BUCKET).upload(storagePath, fileBuffer, {
        contentType: input.mimeType || "application/octet-stream",
        upsert: true,
      });
    } catch (err) {
      console.warn("[ingest-server] Supabase storage upload skipped:", err);
    }

    try {
      await supabase.from("documents").insert({
        id: docId,
        user_id: dbUserId,
        subject_id: null,
        name: fileName,
        kind: declaredKind,
        detected_kind: detectedKind,
        status: "chunking",
        file_path: storagePath,
        file_size: fileBuffer.byteLength,
        hash,
        word_count: fullText.split(/\s+/).filter(Boolean).length,
        page_count: pages.length,
        warnings,
      });
    } catch (err) {
      console.warn("[ingest-server] Supabase document record insertion warning:", err);
    }
  }

  // 5. Chunking
  await onStatusUpdate?.("chunking", 50);
  const material: Material = {
    id: docId,
    name: fileName,
    kind: declaredKind,
    detectedKind,
    pages,
    createdAt: Date.now(),
    status: "chunking",
    hash,
    wordCount: fullText.split(/\s+/).filter(Boolean).length,
    headings: [],
    warnings,
  };

  const chunks = chunkMaterial(material);
  material.headings = Array.from(new Set(chunks.map((c) => c.section.split(" > ").pop()!))).filter(
    (h) => h !== "General"
  );

  // 6. Generate embeddings
  await onStatusUpdate?.("embedding", 70);
  const chunkTexts = chunks.map((c) => `${c.section}\n${c.text}`);
  const embeddings = await getBatchEmbeddings(chunkTexts);

  // 7. Index in Qdrant with tenant isolation
  await onStatusUpdate?.("indexing", 85);
  const qdrantPoints = chunks.map((c, i) => ({
    id: c.id,
    vector: embeddings[i],
    payload: {
      user_id: userId,
      subject_id: subjectId,
      document_id: docId,
      chunk_id: c.id,
      kind: c.kind,
      page_number: c.page,
      section_heading: c.section,
      chunk_text: c.text,
      embedding_model: EMBEDDING_MODEL,
      embedding_version: EMBEDDING_VERSION,
    },
  }));

  await upsertChunksToQdrant(qdrantPoints);

  // 8. Update document status to ready
  material.status = "ready";
  if (supabase) {
    try {
      await supabase
        .from("documents")
        .update({
          status: "ready",
          headings: material.headings,
          updated_at: new Date().toISOString(),
        })
        .eq("id", docId);

      // Persist chunks in document_chunks table
      const dbChunks = chunks.map((c, idx) => ({
        id: c.id,
        document_id: docId,
        user_id: dbUserId,
        subject_id: null,
        chunk_index: idx,
        section_heading: c.section,
        page_number: c.page,
        text: c.text,
        char_count: c.text.length,
      }));

      await supabase.from("document_chunks").upsert(dbChunks);
    } catch (err) {
      console.warn("[ingest-server] Failed to update document record in DB:", err);
    }
  }

  await onStatusUpdate?.("ready", 100);

  return {
    documentId: docId,
    material,
    chunks,
    warnings,
    status: "ready",
  };
}

/**
 * Clean up a document: remove vectors, database records, and Supabase Storage object.
 */
export async function deleteDocumentServerSide(userId: string, documentId: string): Promise<boolean> {
  try {
    // 1. Delete vectors from Qdrant
    await deleteDocumentVectors(userId, documentId);

    // 2. Delete file and database records from Supabase
    const supabase = getSupabaseAdminClient();
    if (supabase) {
      const { data: doc } = await supabase
        .from("documents")
        .select("file_path")
        .eq("id", documentId)
        .eq("user_id", userId)
        .maybeSingle();

      if (doc?.file_path) {
        await supabase.storage.from(STORAGE_BUCKET).remove([doc.file_path]);
      }

      await supabase.from("documents").delete().eq("id", documentId).eq("user_id", userId);
    }
    return true;
  } catch (err) {
    console.error(`[ingest-server] Failed to delete document ${documentId}:`, err);
    return false;
  }
}
