"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/components/AppProvider";
import { Alert, Button, PageHead, when } from "@/components/ui";
import type { DocStatus, MaterialKind } from "@/lib/types";
import { addMaterial, buildTopicMap, parseFile, removeMaterial } from "@/lib/workflows";

const KINDS: { value: MaterialKind; label: string; hint: string }[] = [
  { value: "syllabus", label: "Syllabus", hint: "List of units/topics. It is the authoritative structure for the topic map." },
  { value: "notes", label: "Textbook / notes", hint: "Chapters, lecture notes, study guides. Quiz questions and explanations come from here." },
  { value: "past_paper", label: "Past paper", hint: "Previous exam questions. Used to estimate how often each topic is examined." },
];
const LIFECYCLE: DocStatus[] = ["uploaded", "processing", "analyzed", "indexed", "ready"];
const label = (k?: MaterialKind) => KINDS.find((x) => x.value === k)?.label ?? "—";

function Lifecycle({ status }: { status: DocStatus }) {
  const i = LIFECYCLE.indexOf(status);
  return (
    <div className="lifecycle">
      {LIFECYCLE.map((s, k) => (
        <span key={s} className={k < i || status === "ready" ? "done" : k === i ? "now" : ""}>
          {s[0].toUpperCase() + s.slice(1)}
        </span>
      ))}
    </div>
  );
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function MaterialsPage() {
  const { data, update } = useApp();
  const router = useRouter();
  const [kind, setKind] = useState<MaterialKind>("notes");
  const [pasteName, setPasteName] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [busy, setBusy] = useState<string>("");
  const [live, setLive] = useState<{ name: string; status: DocStatus; error?: string }[]>([]);
  const [msgs, setMsgs] = useState<{ kind: "error" | "ok" | "info"; text: string }[]>([]);

  async function ingestOne(name: string, getPages: () => Promise<{ name: string; pages: string[] }>) {
    const setStatus = (status: DocStatus, error?: string) =>
      setLive((l) => l.map((x) => (x.name === name ? { ...x, status, error } : x)));
    setLive((l) => [...l.filter((x) => x.name !== name), { name, status: "uploaded" }]);
    try {
      setStatus("processing");
      const parsed = await getPages(); // text extraction (server for PDFs)
      setStatus("analyzed");
      await pause(150);
      const current = await update((d) => d); // latest saved data (several files can be queued)
      const result = await addMaterial(current, { name: parsed.name, kind, pages: parsed.pages });
      if (result.duplicateOf) {
        setStatus("error", `Duplicate of “${result.duplicateOf}” — skipped.`);
        return;
      }
      setStatus("indexed");
      await update(() => result.data);
      await pause(150);
      setStatus("ready");
      setMsgs((m) => [
        ...m,
        { kind: "ok", text: `“${parsed.name}”: ${parsed.pages.length} page(s) extracted and indexed for retrieval.` },
        ...result.warnings.map((w) => ({ kind: "info" as const, text: `“${parsed.name}”: ${w}` })),
      ]);
    } catch (e) {
      setStatus("error", (e as Error).message);
    }
  }

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setMsgs([]);
    setBusy("Processing uploads…");
    for (const f of Array.from(files)) await ingestOne(f.name, () => parseFile(f));
    setBusy("");
  }

  async function onPaste() {
    if (pasteText.trim().length < 20) return setMsgs([{ kind: "error", text: "Paste at least a few lines of text." }]);
    const name = pasteName || `${label(kind)} (pasted)`;
    setMsgs([]);
    await ingestOne(name, async () => ({ name, pages: [pasteText] }));
    setPasteText("");
    setPasteName("");
  }

  async function onBuildMap() {
    if (data.attempts.length && !confirm("Rebuild the topic map? Topics with the same name keep their progress history.")) return;
    setBusy("Syllabus Mapping Agent is building your topic map…");
    setMsgs([]);
    try {
      const next = await buildTopicMap(data);
      await update(() => next);
      router.push("/topics");
    } catch (e) {
      setMsgs([{ kind: "error", text: (e as Error).message }]);
    } finally {
      setBusy("");
    }
  }

  const has = (k: MaterialKind) => data.materials.some((m) => m.kind === k);

  return (
    <>
      <PageHead
        title="1 · Study material"
        desc="Upload your syllabus, textbook chapters or notes, and past papers (PDF or text). The Document Ingestion Agent extracts text page by page, detects the document type and headings, flags duplicates and poor extraction, and indexes heading-aware chunks for retrieval. The AI only ever sees text from here."
      >
        <Button onClick={onBuildMap} loading={busy.startsWith("Syllabus")} disabled={!data.materials.length || !!busy}>
          {data.topics.length ? "Rebuild topic map" : "Build topic map →"}
        </Button>
      </PageHead>

      {busy && <Alert kind="info">{busy}</Alert>}
      {msgs.map((m, i) => (
        <div key={i} style={{ marginTop: 6 }}><Alert kind={m.kind}>{m.text}</Alert></div>
      ))}
      {(busy || msgs.length > 0) && <div className="spacer" />}

      <div className="grid grid-2">
        <div className="card stack">
          <h2>Add material</h2>
          <div>
            <label>Document type</label>
            <div className="row">
              {KINDS.map((k) => (
                <button key={k.value} className={`btn sm ${kind === k.value ? "" : "secondary"}`} onClick={() => setKind(k.value)} type="button">
                  {k.label} {has(k.value) && "✓"}
                </button>
              ))}
            </div>
            <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>{KINDS.find((k) => k.value === kind)!.hint}</p>
          </div>
          <div>
            <label>Upload PDF / TXT / MD — several at once is fine (max 4 MB each)</label>
            <input type="file" accept=".pdf,.txt,.md,application/pdf,text/plain" multiple disabled={!!busy} onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
          </div>
          <div className="muted" style={{ textAlign: "center", fontSize: 13 }}>— or paste text —</div>
          <input type="text" placeholder="Name (e.g. Chapter 3 notes)" value={pasteName} onChange={(e) => setPasteName(e.target.value)} />
          <textarea placeholder="Paste text here. Headings like “Chapter 3”, “3.2 Light reaction” or “# Title” become citation sections." value={pasteText} onChange={(e) => setPasteText(e.target.value)} />
          <Button variant="secondary" onClick={onPaste} disabled={!pasteText.trim() || !!busy}>Add pasted text</Button>

          {live.length > 0 && (
            <div className="stack" style={{ gap: 8 }}>
              <label style={{ margin: 0 }}>Processing</label>
              {live.map((l) => (
                <div key={l.name} className="row between" style={{ fontSize: 13.5 }}>
                  <span>{l.name}</span>
                  {l.status === "error" ? <span className="badge weak">{l.error}</span> : <Lifecycle status={l.status} />}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h2>Checklist</h2>
          <ul style={{ paddingLeft: 18, margin: 0 }}>
            <li>{has("syllabus") ? "✅" : "⬜"} Syllabus — builds the topic map</li>
            <li>{has("notes") ? "✅" : "⬜"} Textbook / notes — source for questions & explanations</li>
            <li>{has("past_paper") ? "✅" : "⬜"} Past paper — exam importance of each topic</li>
            <li>{data.topics.length ? "✅" : "⬜"} Topic map built and reviewed</li>
          </ul>
          <div className="spacer" />
          <p className="muted" style={{ fontSize: 13 }}>
            Status lifecycle: <b>Uploaded → Processing</b> (text extraction) <b>→ Analyzed</b> (type, headings, duplicates, quality){" "}
            <b>→ Indexed</b> (chunks in the retrieval index) <b>→ Ready</b>. Scanned PDFs have no text — paste the text instead.
          </p>
        </div>
      </div>

      <div className="spacer" />
      <div className="card">
        <h2>Your documents ({data.materials.length})</h2>
        {!data.materials.length ? (
          <p className="muted">Nothing uploaded yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Document</th><th>Type</th><th>Status</th><th>Pages · words</th><th>Sections indexed</th><th>Added</th><th /></tr>
              </thead>
              <tbody>
                {data.materials.map((m) => {
                  const chunks = data.chunks.filter((c) => c.materialId === m.id);
                  return (
                    <tr key={m.id}>
                      <td>
                        <b>{m.name}</b>
                        {m.warnings?.map((w) => <div key={w} style={{ fontSize: 12.5, color: "var(--medium)" }}>⚠ {w}</div>)}
                      </td>
                      <td>
                        <span className="badge">{label(m.kind)}</span>
                        {m.detectedKind && m.detectedKind !== m.kind && <div className="muted" style={{ fontSize: 12 }}>detected: {label(m.detectedKind)}</div>}
                      </td>
                      <td>
                        {(m.status ?? "ready") === "ready" ? (
                          <span className="badge strong" title="Uploaded → Processing → Analyzed → Indexed → Ready">✓ Ready</span>
                        ) : (
                          <Lifecycle status={m.status} />
                        )}
                      </td>
                      <td>{m.pages.length} · {(m.wordCount ?? 0).toLocaleString()}</td>
                      <td>
                        {chunks.length} chunks
                        <div className="muted" style={{ fontSize: 12.5 }}>{(m.headings ?? []).slice(0, 5).join(" · ")}{(m.headings?.length ?? 0) > 5 ? " …" : ""}</div>
                      </td>
                      <td className="muted">{when(m.createdAt)}</td>
                      <td>
                        <Button size="sm" variant="danger" onClick={() => confirm(`Remove “${m.name}” and its indexed chunks?`) && update((d) => removeMaterial(d, m.id))}>
                          Remove
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
