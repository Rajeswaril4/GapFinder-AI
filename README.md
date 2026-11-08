# GapFinder AI: Find What You Don't Know. Master What Matters.

> Hackathon PS 2026: *GapFinder AI*. A student uploads their syllabus, textbook chapters, notes and past papers. The app tests them on **their own material**, measures topic-level mastery and diagnoses weak topics with evidence. It then builds a revision plan that adapts every time they re-test.

**Live demo:** `https://<your-project>.vercel.app` · **Demo login:** `demo@gapfinder.ai` / `demo1234`

The main output is a **diagnosis**, not a chat answer. Chat is only a helper.

```
Upload → Topic map → Diagnostic quiz → Evaluate → Gap report → Revision plan → Re-test → diagnosis + plan update
```

---

## Pages

| Page | What it shows |
|---|---|
| **Landing** (`/`) | Problem, how it works, features, a sample diagnostic report, call to action |
| **Login** | Sign up, log in, one-click demo account, protected routes |
| **Dashboard** | Overall mastery, topics assessed / strong / weak / not assessed, upcoming revision tasks, recent quiz results, mastery trend chart, per-topic attempt table |
| **Materials** | Upload several PDF/TXT/MD files or paste text. Shows the status lifecycle *Uploaded → Processing → Analyzed → Indexed → Ready*, detected type, duplicate and poor-extraction warnings, and indexed sections |
| **Syllabus map** | Topic tree coloured by mastery (green / amber / red / grey). Click a topic for its description, objectives, mastery, misconceptions, sources and next step. **Edit, add or delete topics and prerequisites** before testing. Includes the past-paper analysis table with marks, type, difficulty, mapping confidence and manual review |
| **Diagnostic quiz** | One question at a time with previous/next, progress, type, difficulty, marks, optional confidence rating and submit. Answers are revealed only after submission, with "Explain my mistake" links |
| **Gap analysis report** | Overall mastery, coverage, mastery chart with thresholds, weakest topics, misconception analysis (recurring ones flagged), and per-topic level, confidence, trend, evidence table with citations, AI reason and next step |
| **Revision planner** | Exam date or number of days, plus hours per day. Day-by-day tasks with priority, minutes, reading sections, practice question, success criteria and completion tick-boxes, ending in a follow-up assessment |
| **Learning assistant** | RAG chat that only uses uploaded material, with [n] citations. Explains topics or mistakes and writes extra practice questions. Refuses when the material doesn't cover the question |
| **Agent activity** | The 10 agents, what each one does, and an execution log (input, output, duration, ok / fallback / error) |
| **How it works** | Where retrieval and generation are used, and how they are kept apart |

## The 10 agents (one fixed workflow, no free-running agents)

| # | Agent | Runs as | Code |
|---|---|---|---|
| 1 | Document Ingestion: validation, per-page extraction, type detection, headings, duplicate fingerprint, poor-extraction flags, heading-aware chunking with overlap | code | `lib/ingest.ts`, `lib/chunk.ts`, `api/parse` |
| 2 | Syllabus Mapping: topics, subtopics, learning objectives, prerequisites, duplicate merge. The syllabus is the authority and the student can edit the result | LLM | `api/topic-map` |
| 3 | Knowledge Retrieval: BM25 over the student's own chunks, topic-filtered, configurable top-K, citations | code | `lib/bm25.ts`, `lib/retrieval.ts` |
| 4 | Previous Paper Analysis: question extraction, marks, type and difficulty, topic mapping with confidence, low-confidence questions flagged for review, rarely-examined topics | code | `lib/retrieval.ts` |
| 5 | Diagnostic Question Generation: MCQ, multi-select, true/false, fill-in, short answer and numerical. Every question is validated before display | LLM | `api/quiz` |
| 6 | Answer Evaluation: answer key in code for objective types (numericals with tolerance), rubric scoring by the model for short answers, misconception detection | code + LLM | `api/evaluate`, `lib/analysis.ts` |
| 7 | Knowledge Gap Diagnosis: weighted mastery, level, confidence and priority in code; the model writes reasons and next steps | code + LLM | `lib/analysis.ts`, `api/gap-analysis` |
| 8 | Revision Planning: a scheduler that fits the time budget, plus model-written tasks and success criteria | code + LLM | `lib/planner.ts`, `api/plan` |
| 9 | Progress Monitoring: compares diagnoses, detects level changes and recurring mistakes, triggers re-planning | code | `lib/workflows.ts` |
| 10 | Learning Assistant: supplementary, cited explanations and practice | LLM | `api/explain` |

The orchestrator is `lib/workflows.ts`. Every model output is validated with **Zod**, gets one automatic repair retry, and falls back to the computed result if the model still fails.

## Retrieval vs. generation

| Step | Retrieval (deterministic BM25) | Generation (LLM) | Guardrail |
|---|---|---|---|
| Topic map | Links each notes section to the topic it matches best and maps past-paper questions to topics, which gives exam weight | Topics, objectives and prerequisites from the syllabus text | Only syllabus topics are allowed; duplicates are merged; the student can edit; mapping confidence is shown |
| Quiz | Top sections per topic, plus sections on the subtopics the student got wrong | Questions from those chunks only, each with `chunkId` and a verbatim quote | **Validation:** rejects a question if its citation wasn't retrieved, its quote isn't in the chunk, its answer isn't supported, its options are duplicates or "all of the above", or its key is invalid |
| Evaluation | The cited chunk's text is sent with each answer | Rubric scoring and an explanation of each mistake | Objective scores come from the answer key; the model can't change them; a keyword fallback runs if the AI is down |
| Gap report | n/a | Reason and next step per topic | Level, mastery, confidence and priority are computed in code |
| Plan | The topic's best sections become reading tasks | Concrete tasks and success criteria | Order and minutes come from the scheduler, which never exceeds the student's available time |
| Assistant | Top-k sections. Below a score threshold the app answers "not in your material" **without calling the model** | Streamed explanation citing [n] | The prompt forbids outside knowledge |

### Diagnosis model

All tunable numbers are in `lib/config.ts`.

- `mastery = Σ recency × difficulty × type × score / Σ recency × difficulty × type`
  - recency: each older attempt counts half as much
  - difficulty: easy 0.8, medium 1, hard 1.3
  - type: true/false 0.7 … short answer and numerical 1.2
- **Strong** ≥ 80%, **Medium** 50–80%, **Weak** < 50%. **Not assessed** means no answers yet; such a topic is never labelled weak.
- **Confidence:** low with fewer than 2 questions, medium with 2–3, high with 4 or more. Low-confidence topics are flagged for re-assessment.
- `priority = 0.55 × weakness + 0.25 × exam importance + 0.10 × repeated misconceptions + 0.10 × being a prerequisite of unfinished topics`
- This is a transparent heuristic, not a validated psychometric score. Bayesian Knowledge Tracing or IRT could replace `lib/analysis.ts` later.

---

## Spec compliance (master build prompt)

**Implemented:** all 10 agents, the core loop, every listed page and the RAG pipeline (heading-aware chunking with overlap, page preservation, topic-filtered retrieval, citation validation). Also:
- Zod validation of inputs and AI outputs
- six question types, with difficulty, marks, learning objective and misconception tags
- deterministic scoring and rubric scoring
- the "not assessed" state and confidence levels
- misconception analysis and evidence with citations
- exam date and available-time planning, priority order, success criteria, spaced review and a follow-up assessment
- an editable topic hierarchy with prerequisites
- the document status lifecycle and duplicate detection
- agent execution logs
- tests for the deterministic core

**Deliberately different from the suggested stack.** We followed the hackathon brief, which recommends the Vercel AI SDK and Groq, and kept deployment to a single API key:

| Spec | This build | Why / upgrade path |
|---|---|---|
| Gemini Flash + Gemini Embedding + Qdrant (dense + sparse + RRF) | Groq (`openai/gpt-oss-120b`) + BM25 lexical retrieval | Groq has no embeddings API. BM25 needs no extra key, is explainable and suits term-heavy exam text. `lib/retrieval.ts` is the only file to change to add Qdrant hybrid search |
| Supabase Postgres + Auth + Storage + RLS | Browser IndexedDB per account | Free to run and no setup for judges. Every read and write goes through `loadData` / `saveData` in `lib/store.ts`, so it can be swapped for Supabase |
| Google login, teacher onboarding | Email/password + demo account | Needs a real auth provider (Supabase Auth) |
| Inngest background jobs | Ingestion runs in the browser; AI calls are short server routes (≤ 60 s) | Add when ingestion moves server-side |
| Next.js 16, Tailwind, shadcn/ui, Recharts, Bun, Vitest/Playwright | Next.js 15, hand-written CSS and SVG charts, npm, Node assert tests | Fewer dependencies to break before the deadline |

---

## Run locally

```bash
npm install
cp .env.example .env.local     # paste your Groq key into .env.local
npm test                       # core logic tests (no key needed)
npm run build
npm run dev                    # http://localhost:3000
```

Get a free Groq key at <https://console.groq.com/keys>. Never commit `.env.local`. If you hit free-tier rate limits, set `GROQ_MODEL=openai/gpt-oss-20b`.

## Deploy to Vercel

1. Push this folder to a GitHub repository.
2. Import the repository at <https://vercel.com/new>. The framework is detected as Next.js.
3. Add the environment variable `GROQ_API_KEY`. `GROQ_MODEL` is optional.
4. Deploy, open the URL, click **Try the demo**, then open **How it works** and check that AI status shows **Connected**.

## Judge walkthrough (3 minutes)

1. **Landing:** shows the problem and a sample diagnosis. Click **Try the demo** and continue with the demo account.
2. **Dashboard:** two past attempts, 4 of 5 topics improved, upcoming tasks.
3. **Gap report:** Excretion is 🔴 weak with a *recurring* misconception ("thinks urea is reabsorbed", seen twice). Nutrition improved from weak to medium. Open the evidence table to see the cited questions.
4. **Syllabus map:** click a topic for objectives, misconceptions and sources. Edit a topic. Check the past-paper analysis table.
5. **Revision plan:** set an exam date. Excretion comes first, with priority labels, reading sections, practice questions, success criteria and a follow-up assessment.
6. **Diagnostic quiz:** generate 8 questions, step through the mixed formats, rate your confidence and submit. The report, plan and agent log all update.
7. **Learning assistant:** ask "what is photolysis?" The answer cites [1]. Ask about something outside the notes and the app refuses.
8. **Agent activity:** every agent run, with inputs, outputs and timings.

## Project structure

```
app/page.tsx              landing page
app/login/                login, register, demo
app/(app)/…               dashboard, materials, topics, quiz, report, plan, explain, agents, how-it-works
app/api/…                 parse, topic-map, quiz, evaluate, gap-analysis, plan, explain, health
lib/config.ts             all thresholds and weights
lib/ingest.ts, chunk.ts   Agent 1
lib/bm25.ts, retrieval.ts Agents 3 + 4
lib/analysis.ts           Agents 6 (deterministic) + 7 + 9
lib/planner.ts            Agent 8 scheduler
lib/workflows.ts          orchestrator + agent run log
lib/llm.ts                Groq model, JSON generation + Zod validation
lib/store.ts, seed.ts     persistence + demo data (original sample material)
tests/core.test.ts        tests for the deterministic core
```
