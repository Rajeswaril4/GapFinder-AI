// Extracts text from an uploaded PDF or text file, page by page (page numbers feed citations).
import { extractText, getDocumentProxy } from "unpdf";
import { ApiError, fail } from "@/lib/llm";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 50 * 1024 * 1024; // Vercel serverless request limit is ~4.5 MB

/** PDF text often comes back as one long line; put line breaks back before headings and question numbers. */
function restoreLines(page: string): string {
  const lines = page.split("\n").length;
  if (lines > 4 || page.length < 300) return page;
  return page
    .replace(/\s+(?=(?:Chapter|Unit|Section|Module)\s+\d+)/g, "\n")
    .replace(/\s+(?=\d+(?:\.\d+)+\s+[A-Z])/g, "\n")
    .replace(/\s+(?=Q(?:uestion)?\s*\.?\s*\d+[.):]?\s)/g, "\n")
    .replace(/([.?!])\s+(?=[A-Z][a-z]+(?:\s[A-Z][a-z]+){0,4}\n)/g, "$1\n");
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new ApiError("No file uploaded", 400);
    if (file.size > MAX_BYTES) throw new ApiError("File is larger than 50 MB. Split the PDF or paste the text instead.", 413);

    const name = file.name || "upload";
    const buf = new Uint8Array(await file.arrayBuffer());
    let pages: string[];

    if (/\.pdf$/i.test(name) || file.type === "application/pdf") {
      const pdf = await getDocumentProxy(buf);
      const { text } = await extractText(pdf, { mergePages: false });
      pages = (Array.isArray(text) ? text : [text]).map((p) => restoreLines(String(p ?? "")));
      if (!pages.join("").trim())
        throw new ApiError("No selectable text found in this PDF (it may be a scanned image). Paste the text instead.", 422);
    } else {
      pages = [new TextDecoder().decode(buf)];
    }
    return Response.json({ name: name.replace(/\.(pdf|txt|md)$/i, ""), pages });
  } catch (e) {
    return fail(e);
  }
}
