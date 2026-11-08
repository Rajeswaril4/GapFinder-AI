"use client";
import { useEffect, useRef, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { Button, PageHead } from "@/components/ui";
import { citeLabel } from "@/lib/types";
import type { RetrievedChunk } from "@/lib/retrieval";
import { CONFIG } from "@/lib/config";

interface Msg {
  role: "user" | "assistant";
  content: string;
  sources?: RetrievedChunk[];
}

const NOT_FOUND = "I couldn't find this in your uploaded material.";
const MIN_SCORE = CONFIG.retrieval.minExplainScore; // BM25 score below which we treat retrieval as "nothing relevant"

export default function ExplainPage() {
  const { data, retriever } = useApp();
  const weakTopics = (data.reports[data.reports.length - 1]?.topics ?? []).filter((t) => t.level === "weak" || t.level === "medium").slice(0, 4);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs]);

  // deep link from the gap report: /explain?topic=...&focus=...
  useEffect(() => {
    if (started.current) return;
    const p = new URLSearchParams(window.location.search);
    const direct = p.get("q");
    if (direct) {
      started.current = true;
      ask(direct);
      return;
    }
    const topic = p.get("topic");
    if (topic) {
      started.current = true;
      const focus = p.get("focus");
      ask(`Explain ${focus ? `${focus} in ${topic}` : topic} simply, step by step.`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function ask(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setInput("");
    const history = [...msgs, { role: "user" as const, content: q }];

    // RETRIEVAL (deterministic, in the browser): include the previous question for short follow-ups
    const prevUser = [...msgs].reverse().find((m) => m.role === "user")?.content ?? "";
    const query = q.split(/\s+/).length < 6 ? `${q} ${prevUser}` : q;
    const hits = retriever.search(query, CONFIG.retrieval.contextChunks, ["notes"]).filter((h) => h.score >= MIN_SCORE);

    if (!hits.length) {
      setMsgs([...history, { role: "assistant", content: `${NOT_FOUND} Try different words, or upload the chapter that covers it.`, sources: [] }]);
      return;
    }

    setMsgs([...history, { role: "assistant", content: "", sources: hits }]);
    setBusy(true);
    try {
      const res = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.map((m) => ({ role: m.role, content: m.content })),
          context: hits.map((h, i) => ({ n: i + 1, label: citeLabel(h), text: h.text })),
        }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setMsgs((m) => [...m.slice(0, -1), { ...m[m.length - 1], content: acc }]);
      }
    } catch (e) {
      setMsgs((m) => [...m.slice(0, -1), { role: "assistant", content: `⚠️ ${(e as Error).message}`, sources: [] }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead
        title="Learning assistant"
        desc={
          <>
            Supplementary to the diagnosis: ask for explanations, examples, why an answer was wrong, or extra practice questions.
            Answers come <b>only</b> from your uploaded material. For every question, the most relevant sections are retrieved first
            (shown under each answer), and the AI must cite them as [1], [2]… If nothing relevant is found, it says so instead of guessing.
          </>
        }
      >
        {msgs.length > 0 && <Button variant="secondary" onClick={() => setMsgs([])}>Clear chat</Button>}
      </PageHead>

      {!data.chunks.length ? (
        <div className="card muted">Upload notes first — the assistant can only use your material.</div>
      ) : (
        <>
          {msgs.length === 0 && (
            <div className="card">
              <b>Try a topic</b>
              <div className="row" style={{ marginTop: 8, gap: 6 }}>
                {data.topics.slice(0, 10).map((t) => (
                  <button key={t.id} className="btn sm secondary" onClick={() => ask(`Explain ${t.name} simply, step by step.`)}>
                    {t.name}
                  </button>
                ))}
              </div>
              {weakTopics.length > 0 && (
                <>
                  <div className="spacer" />
                  <b>Work on your weak spots</b>
                  <div className="row" style={{ marginTop: 8, gap: 6 }}>
                    {weakTopics.map((t) => (
                      <button key={t.topicId} className="btn sm secondary" onClick={() => ask(`Give me 3 practice questions with answers on ${t.weakSubtopics[0] ?? t.name} (${t.name}).`)}>
                        Practice: {t.weakSubtopics[0] ?? t.name}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          <div className="spacer" />
          <div className="chat">
            {msgs.map((m, i) => (
              <div key={i} className={`msg ${m.role}`}>
                {m.content || (busy && i === msgs.length - 1 ? "Thinking…" : "")}
                {m.role === "assistant" && !!m.sources?.length && (
                  <div className="sources">
                    {m.sources.map((s, k) => (
                      <details key={s.id} className="cite">
                        <summary style={{ cursor: "pointer" }}>[{k + 1}] {citeLabel(s)}</summary>
                        <div style={{ color: "var(--ink)", marginTop: 6, whiteSpace: "pre-wrap" }}>{s.text}</div>
                      </details>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <div ref={bottom} />
          </div>
          <div className="spacer" />
          <form
            className="row"
            style={{ flexWrap: "nowrap", position: "sticky", bottom: 12 }}
            onSubmit={(e) => {
              e.preventDefault();
              ask(input);
            }}
          >
            <input type="text" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about any topic in your material…" />
            <Button type="submit" loading={busy}>Ask</Button>
          </form>
        </>
      )}
    </>
  );
}
