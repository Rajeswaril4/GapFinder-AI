"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { Bar, Button, ConfidenceBadge, Empty, LevelBadge, PageHead, pct } from "@/components/ui";
import type { Level, Topic, TopicStatus } from "@/lib/types";
import { citeLabel } from "@/lib/types";
import { addTopic, assignPastQuestion, deleteTopic, updateTopic } from "@/lib/workflows";

const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

export default function TopicsPage() {
  const { data, update } = useApp();
  const report = data.reports[data.reports.length - 1];
  const [sel, setSel] = useState<string>(data.topics[0]?.id ?? "");
  const [editing, setEditing] = useState(false);
  const statusOf = (id: string) => report?.topics.find((t) => t.topicId === id);
  const levelOf = (id: string): Level => statusOf(id)?.level ?? "untested";
  const maxW = Math.max(1, ...data.topics.map((t) => t.examWeight));
  const review = data.pastQuestions.filter((q) => q.needsReview);
  const rare = data.topics.filter((t) => t.examWeight === 0 && data.pastQuestions.length > 0);

  useEffect(() => {
    if (!data.topics.find((t) => t.id === sel)) setSel(data.topics[0]?.id ?? "");
  }, [data.topics, sel]);

  if (!data.topics.length)
    return (
      <>
        <PageHead title="2 · Syllabus map" />
        <Empty title="No topic map yet">
          Upload a syllabus on the <Link href="/materials">Materials</Link> page and click “Build topic map”.
        </Empty>
      </>
    );

  const topic = data.topics.find((t) => t.id === sel) ?? data.topics[0];
  const st = statusOf(topic.id);

  return (
    <>
      <PageHead
        title="2 · Syllabus map"
        desc={
          <>
            Built from your syllabus <span className="badge generation">Syllabus Mapping Agent</span>. Notes sections and past-paper
            questions are linked to topics <span className="badge retrieval">retrieval · BM25</span>. Review and edit the map before
            your first quiz — the syllabus is the authority, not the AI.
          </>
        }
      >
        <Button
          variant="secondary"
          onClick={() => {
            const name = prompt("New topic name (as written in your syllabus):");
            if (name?.trim()) update((d) => addTopic(d, name.trim()));
          }}
        >
          + Add topic
        </Button>
        <Link className="btn" href="/quiz">Take diagnostic →</Link>
      </PageHead>

      <div className="split">
        <div className="card">
          <div className="row between">
            <h2 style={{ margin: 0 }}>{data.subject}</h2>
            <div className="row" style={{ gap: 6, fontSize: 12 }}>
              <span className="dot strong" /> Strong <span className="dot medium" /> Medium <span className="dot weak" /> Weak <span className="dot untested" /> Not assessed
            </div>
          </div>
          <div className="tree" style={{ marginTop: 10 }}>
            {data.topics.map((t) => (
              <div key={t.id}>
                <button className={`tree-node ${t.id === topic.id ? "sel" : ""}`} onClick={() => { setSel(t.id); setEditing(false); }}>
                  <span className={`dot ${levelOf(t.id)}`} />
                  <b style={{ flex: 1 }}>{t.name}</b>
                  {t.prerequisites.length > 0 && <span className="chip" title="Has prerequisites">↳ {t.prerequisites.length}</span>}
                  <span className="muted" style={{ fontSize: 12 }}>{t.examWeight} exam Qs</span>
                </button>
                <div className="tree-sub">
                  {t.subtopics.map((s) => {
                    const weak = statusOf(t.id)?.weakSubtopics.includes(s);
                    return <span key={s} className="chip" style={weak ? { background: "var(--weak-soft)", color: "var(--weak)" } : undefined}>{s}</span>;
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card sticky">
          {!editing ? (
            <TopicDetail
              topic={topic}
              status={st}
              onEdit={() => setEditing(true)}
              onDelete={() => confirm(`Delete “${topic.name}”? Its past-paper questions become unmapped.`) && update((d) => deleteTopic(d, topic.id))}
            />
          ) : (
            <TopicEditor
              topic={topic}
              all={data.topics}
              onCancel={() => setEditing(false)}
              onSave={async (patch) => {
                await update((d) => updateTopic(d, topic.id, patch));
                setEditing(false);
              }}
            />
          )}
          <div className="spacer" />
          <div className="row between" style={{ fontSize: 13 }}>
            <span className="muted">Exam importance</span>
            <b>{topic.examWeight} past-paper question{topic.examWeight === 1 ? "" : "s"}</b>
          </div>
          <Bar value={topic.examWeight / maxW} />
          <details style={{ marginTop: 10 }}>
            <summary style={{ cursor: "pointer", fontSize: 14 }}>Related source material ({topic.sourceChunkIds.length} sections)</summary>
            <div className="stack" style={{ gap: 6, marginTop: 6 }}>
              {topic.sourceChunkIds.map((id) => {
                const c = data.chunks.find((x) => x.id === id);
                return c ? <div className="cite" key={id}>📖 {citeLabel(c)}</div> : null;
              })}
            </div>
          </details>
          <details>
            <summary style={{ cursor: "pointer", fontSize: 14 }}>Past-paper questions on this topic ({data.pastQuestions.filter((q) => q.topicId === topic.id).length})</summary>
            <ul style={{ paddingLeft: 18, margin: "6px 0 0", fontSize: 14 }}>
              {data.pastQuestions.filter((q) => q.topicId === topic.id).map((q) => (
                <li key={q.id}>{q.text} <span className="muted" style={{ fontSize: 12 }}>({q.marks ?? "?"} marks · {q.difficulty})</span></li>
              ))}
            </ul>
          </details>
        </div>
      </div>

      <div className="spacer" />
      <div className="card">
        <h2>Previous paper analysis</h2>
        <p className="muted" style={{ fontSize: 13.5 }}>
          Each question is classified (type, marks, difficulty) and mapped to a topic with a confidence score. Low-confidence mappings are
          flagged for you to confirm instead of being guessed. Exam frequency is a prioritisation signal, not a prediction of the next paper.
          {rare.length > 0 && <> <b>Rarely examined:</b> {rare.map((t) => t.name).join(", ")}.</>}
        </p>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Question</th><th>Marks</th><th>Type</th><th>Difficulty</th><th>Topic</th><th>Confidence</th></tr></thead>
            <tbody>
              {data.pastQuestions.map((q) => (
                <tr key={q.id} style={q.needsReview ? { background: "var(--medium-soft)" } : undefined}>
                  <td style={{ maxWidth: 420 }}>{q.text}</td>
                  <td>{q.marks ?? "—"}</td>
                  <td>{q.qtype}</td>
                  <td>{q.difficulty}</td>
                  <td>
                    <select
                      value={q.topicId ?? ""}
                      onChange={(e) => update((d) => assignPastQuestion(d, q.id, e.target.value || null))}
                      style={{ minWidth: 160, padding: "4px 8px" }}
                    >
                      <option value="">— unmapped —</option>
                      {data.topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </td>
                  <td>
                    {q.manual ? <span className="badge strong">set by you</span> : q.needsReview ? <span className="badge medium">needs review ({pct(q.confidence)})</span> : <span className="badge">{pct(q.confidence)}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {review.length > 0 && <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>{review.length} question(s) need your review — pick the right topic in the dropdown.</p>}
      </div>
    </>
  );
}

function TopicDetail({ topic, status, onEdit, onDelete }: { topic: Topic; status?: TopicStatus; onEdit: () => void; onDelete: () => void }) {
  const { data } = useApp();
  const st = status;
  const prereqNames = topic.prerequisites.map((id) => data.topics.find((t) => t.id === id)?.name).filter(Boolean);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row between">
        <h2 style={{ margin: 0 }}>{topic.name}</h2>
        <div className="row" style={{ gap: 6 }}>
          <Button size="sm" variant="secondary" onClick={onEdit}>Edit</Button>
          <Button size="sm" variant="danger" onClick={onDelete}>Delete</Button>
        </div>
      </div>
      <div className="row" style={{ gap: 6 }}>
        <LevelBadge level={st?.level ?? "untested"} />
        {st && st.level !== "untested" && <ConfidenceBadge c={st.confidence} />}
        {topic.edited && <span className="chip">edited by you</span>}
      </div>
      {topic.description && <p style={{ margin: 0 }}>{topic.description}</p>}
      {st && st.level !== "untested" && (
        <div>
          <div className="row between" style={{ fontSize: 13 }}>
            <span className="muted">Mastery · {st.correctAnswers}/{st.questionsAttempted} questions correct</span>
            <b>{pct(st.mastery)}</b>
          </div>
          <Bar value={st.mastery} level={st.level} />
        </div>
      )}
      {topic.learningObjectives.length > 0 && (
        <div>
          <label>Learning objectives</label>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>{topic.learningObjectives.map((o) => <li key={o}>{o}</li>)}</ul>
        </div>
      )}
      {prereqNames.length > 0 && (
        <div style={{ fontSize: 14 }}><span className="muted">Prerequisites: </span>{prereqNames.map((n) => <span key={n} className="chip">{n}</span>)}</div>
      )}
      {!!st?.misconceptions.length && (
        <div>
          <label>Common misconceptions</label>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, color: "var(--weak)" }}>{st.misconceptions.map((m) => <li key={m}>{m}</li>)}</ul>
        </div>
      )}
      {st && (
        <div className="alert info" style={{ fontSize: 14 }}>
          <b>Recommended: </b>{st.recommendedAction}{" "}
          <Link href={`/explain?topic=${encodeURIComponent(topic.name)}`}>Explain this topic →</Link>
        </div>
      )}
    </div>
  );
}

function TopicEditor({ topic, all, onSave, onCancel }: { topic: Topic; all: Topic[]; onSave: (p: Partial<Topic>) => void; onCancel: () => void }) {
  const [name, setName] = useState(topic.name);
  const [description, setDescription] = useState(topic.description);
  const [subtopics, setSubtopics] = useState(topic.subtopics.join("\n"));
  const [objectives, setObjectives] = useState(topic.learningObjectives.join("\n"));
  const [keywords, setKeywords] = useState(topic.keywords.join(", "));
  const [prereqs, setPrereqs] = useState<string[]>(topic.prerequisites);
  return (
    <div className="stack">
      <h2 style={{ margin: 0 }}>Edit topic</h2>
      <div><label>Name</label><input type="text" value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div><label>Description</label><input type="text" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
      <div><label>Subtopics (one per line)</label><textarea value={subtopics} onChange={(e) => setSubtopics(e.target.value)} /></div>
      <div><label>Learning objectives (one per line)</label><textarea value={objectives} onChange={(e) => setObjectives(e.target.value)} /></div>
      <div><label>Keywords (comma separated — improves retrieval)</label><input type="text" value={keywords} onChange={(e) => setKeywords(e.target.value)} /></div>
      <div>
        <label>Prerequisites</label>
        <div className="row" style={{ gap: 6 }}>
          {all.filter((t) => t.id !== topic.id).map((t) => (
            <label key={t.id} className="chip" style={{ cursor: "pointer", fontWeight: 400, color: "var(--ink)", margin: 0 }}>
              <input
                type="checkbox"
                checked={prereqs.includes(t.id)}
                onChange={(e) => setPrereqs((p) => (e.target.checked ? [...p, t.id] : p.filter((x) => x !== t.id)))}
              />{" "}
              {t.name}
            </label>
          ))}
        </div>
      </div>
      <div className="row">
        <Button
          onClick={() =>
            onSave({
              name: name.trim() || topic.name,
              description,
              subtopics: lines(subtopics),
              learningObjectives: lines(objectives),
              keywords: keywords.split(",").map((k) => k.trim()).filter(Boolean),
              prerequisites: prereqs,
            })
          }
        >
          Save
        </Button>
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
