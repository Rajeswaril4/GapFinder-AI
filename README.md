# GapFinder AI: Find What You Don't Know. Master What Matters.

> **GapFinder AI** tests students on **their own materials** (syllabus, textbooks, lecture notes, and past papers), identifies exact knowledge gaps with page-level citations, diagnoses recurring misconceptions, and builds an adaptive, day-by-day revision plan that updates dynamically every time they re-test.

[![Next.js 16](https://img.shields.io/badge/Next.js-16.4-black?logo=next.js)](https://nextjs.org/)
[![React 19](https://img.shields.io/badge/React-19-blue?logo=react)](https://react.dev/)
[![Google Gemini](https://img.shields.io/badge/Google_Gemini-3.5_Flash-4285F4?logo=google)](https://ai.google.dev/)
[![Groq](https://img.shields.io/badge/Fallback-Groq_GPT--OSS--120B-f55036)](https://groq.com/)
[![Qdrant Cloud](https://img.shields.io/badge/Vector_DB-Qdrant_Cloud-dc2626)](https://qdrant.tech/)
[![Supabase](https://img.shields.io/badge/Database_&_Auth-Supabase-3ECF8E?logo=supabase)](https://supabase.com/)
[![Tests](https://img.shields.io/badge/Tests-52_Passed-success)](https://vitest.dev/)

---

## Key Differentiators

Unlike generic AI chat tutors that answer user queries from general training data, **GapFinder AI focuses on diagnostic measurement**:
1. **Source Grounding**: All questions, explanations, and revision tasks cite exact source pages from the student's uploaded material.
2. **Adaptive Revision Planning**: Generates day-by-day study tasks based on a weighted priority algorithm ($0.55 \times \text{weakness} + 0.25 \times \text{exam importance} + 0.10 \times \text{misconceptions} + 0.10 \times \text{prerequisites}$).
3. **Resilient Dual-AI Architecture**: Powered primarily by **Google Gemini 3.5 Flash** and dense vector embeddings (`gemini-embedding-001`, 768d), with automatic fallback to **Groq** (`openai/gpt-oss-120b`) and BM25 lexical search.
4. **Hybrid Cloud + Offline Fallback**: Real-time Supabase PostgreSQL, Supabase Auth, and Qdrant Cloud when online, with deterministic in-browser IndexedDB fallback for offline demos.

```
Upload Material → Syllabus Map → Diagnostic Quiz → Evaluation → Gap Report → Revision Plan → Re-Test → Dynamic Update
```

---

## Application Pages & Modules

| Page | Route | Description |
|---|---|---|
| **Landing** | `/` | Problem overview, core loop explanation, interactive features, sample gap report. |
| **Authentication** | `/login` | Supabase Auth login and pre-confirmed registration (bypasses email rate limits). |
| **Dashboard** | `/dashboard` | Overall mastery score, breakdown of assessed topics, next upcoming revision tasks, and attempt history. |
| **Materials** | `/materials` | Multi-format uploader (PDF, TXT, MD) or text paste. In-browser PDF extraction (`unpdf`), SHA-256 duplicate suppression, and status tracking (*Uploaded → Processing → Extracting → Analyzed → Chunking → Embedding → Indexing → Ready*). |
| **Syllabus Map** | `/topics` | Hierarchical topic tree color-coded by mastery (🔴 Weak < 50%, 🟡 Medium 50–80%, 🟢 Strong ≥ 80%, ⚪ Not Assessed). Supports editing topics, objectives, and prerequisites, plus past-paper question mappings. |
| **Diagnostic Quiz** | `/quiz` | Multi-format assessment (MCQ, multi-select, true/false, fill-in-the-blank, short answer, numerical). Each question cites source pages with quote verification and optional confidence ratings. |
| **Gap Report** | `/report` | Diagnostic overview: mastery breakdown, recurring misconception detection, citation-backed evidence table, AI-generated improvement advice. |
| **Revision Plan** | `/plan` | Day-by-day revision schedule with priority indicators, study minutes, success criteria, and completion checkboxes. Features an exam date calendar restricted to the current month from today onwards. |
| **Learning Assistant** | `/explain` | Grounded RAG assistant restricted to the student's material with citation markers `[n]`. Refuses outside queries to prevent hallucinations. |
| **Teacher Hub** | `/teacher` | Cohort-level performance monitoring, class assignment tracking, and collective misconception analysis. |
| **Manage Students** | `/admin/students` | Admin dashboard for user accounts. View study progress, create pre-confirmed accounts, adjust roles (`student`, `teacher`, `admin`), and delete users. |
| **Observability** | `/admin` | System health monitoring, API latencies, AI provider fallback metrics, and Qdrant vector status. |
| **Agent Activity** | `/agents` | Complete execution log of all 10 agents with input/output payloads, run durations, and status badges. |

---

## The 10 Specialized Agents

The application coordinates 10 deterministic and LLM-powered agents into a unified, reproducible workflow:

| # | Agent | Mode | Implementation | Responsibility |
|---|---|---|---|---|
| **1** | **Document Ingestion** | Deterministic Code | `lib/ingest-server.ts`, `lib/chunk.ts`, `api/parse` | Heading-aware chunking, page retention, content hashing, type detection, and duplicate suppression. |
| **2** | **Syllabus Mapping** | LLM + Validation | `app/api/topic-map/route.ts` | Extracts topic hierarchies, learning objectives, and prerequisites from uploaded syllabus documents. |
| **3** | **Knowledge Retrieval** | Dense + Lexical Hybrid | `lib/vector/qdrant.ts`, `lib/retrieval.ts`, `lib/bm25.ts` | Tenant-isolated vector search via Qdrant Cloud combined with BM25 keyword matching. |
| **4** | **Past Paper Analysis** | Code + Parser | `lib/retrieval.ts` | Extracts exam questions, marks, difficulties, and computes mapping confidence against syllabus topics. |
| **5** | **Diagnostic Question Gen** | LLM + Schema Guard | `app/api/quiz/route.ts` | Produces 6 question formats with verified citations and grounded quotes. |
| **6** | **Answer Evaluation** | Code + LLM | `app/api/evaluate/route.ts`, `lib/analysis.ts` | Objective scoring via answer keys; subjective short-answer rubric evaluation with misconception identification. |
| **7** | **Knowledge Gap Diagnosis** | Code + LLM | `app/api/gap-analysis/route.ts`, `lib/analysis.ts` | Computes weighted mastery scores, confidence ratings, priority rankings, and qualitative recommendations. |
| **8** | **Revision Planning** | Code + LLM | `app/api/plan/route.ts`, `lib/planner.ts` | Deterministic time scheduler combined with LLM-generated revision tasks, study tips, and success criteria. |
| **9** | **Progress Monitoring** | Deterministic Code | `lib/workflows.ts` | Tracks longitudinal progress across quiz attempts, detects recurring misconceptions, and triggers plan rebuilds. |
| **10** | **Learning Assistant** | Grounded LLM Stream | `app/api/explain/route.ts` | Streams conversational explanations with citations, strictly bounded to retrieved context. |

---

## Technology Stack

- **Framework**: [Next.js 16](https://nextjs.org/) (App Router, Turbopack, Serverless API Routes)
- **UI Library**: [React 19](https://react.dev/), custom modern CSS variables, accessible components
- **Primary AI**: [Google Gemini 3.5 Flash](https://ai.google.dev/) (`gemini-3.5-flash`)
- **Fallback AI**: [Groq](https://groq.com/) (`openai/gpt-oss-120b`) via Vercel AI SDK
- **Embeddings**: Google Gemini (`gemini-embedding-001`, 768 dimensions)
- **Vector Database**: [Qdrant Cloud](https://qdrant.tech/) with user/tenant isolation filters
- **Relational DB & Auth**: [Supabase](https://supabase.com/) (PostgreSQL, Supabase Auth, Storage, Row Level Security)
- **Background Workflows**: [Inngest](https://www.inngest.com/) durable serverless functions
- **Testing**: [Vitest 5.1](https://vitest.dev/) & [TSX](https://github.com/privatenumber/tsx) (52 unit, integration, e2e, and admin tests)

---

## Local Development Setup

### 1. Prerequisites
- **Node.js**: `v18.18` or newer (Node 20+ recommended)
- **npm** or **pnpm**

### 2. Installation
```bash
git clone https://github.com/Rajeswaril4/GapFinder-AI.git
cd GapFinder-AI
npm install
```

### 3. Environment Configuration
Create a `.env.local` or `.env` file in the root directory:

```env
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL="https://your-project.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="your-supabase-anon-key"
SUPABASE_SERVICE_ROLE_KEY="your-supabase-service-role-key"

# AI Configuration (Primary: Google Gemini)
GEMINI_API_KEY="your-google-ai-studio-gemini-key"
GEMINI_MODEL="gemini-3.5-flash"

# AI Configuration (Fallback: Groq)
GROQ_API_KEY="your-groq-api-key"
GROQ_MODEL="openai/gpt-oss-120b"

# Vector Database (Qdrant Cloud)
QDRANT_URL="https://your-cluster.qdrant.tech:6333"
QDRANT_API_KEY="your-qdrant-api-key"
QDRANT_COLLECTION="gapfinder_materials"
```

### 4. Run Test Suite
Verify that all 52 unit, integration, admin, and core tests pass:
```bash
npm test
```

### 5. Start Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Deployment to Vercel

### Step 1: Push Repository to GitHub
```bash
git add .
git commit -m "feat: complete GapFinder AI setup"
git push origin main
```

### Step 2: Configure Vercel Project
1. Import your repository into **[Vercel](https://vercel.com/new)**.
2. In **Project Settings → Environment Variables**, add the following variables:

| Variable Name | Environment | Description |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_SUPABASE_URL` | Production, Preview, Dev | Supabase project URL (`https://<id>.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Production, Preview, Dev | Supabase public anonymous API key |
| `SUPABASE_SERVICE_ROLE_KEY` | Production, Preview, Dev | Supabase secret service role key (backend only) |
| `GEMINI_API_KEY` | Production, Preview, Dev | Google Gemini API key from AI Studio |
| `GEMINI_MODEL` | Production, Preview, Dev | `gemini-3.5-flash` |
| `GROQ_API_KEY` | Production, Preview, Dev | Groq API key for high-speed fallback |
| `GROQ_MODEL` | Production, Preview, Dev | `openai/gpt-oss-120b` |
| `QDRANT_URL` | Production, Preview, Dev | Qdrant Cloud cluster endpoint |
| `QDRANT_API_KEY` | Production, Preview, Dev | Qdrant API key |
| `QDRANT_COLLECTION` | Production, Preview, Dev | `gapfinder_materials` |

### Step 3: Configure Supabase Authentication
1. In the **Supabase Dashboard → Authentication → Providers → Email**:
   - Toggle **OFF** `Confirm email` (this permits instant student registration and avoids Supabase's 3-email-per-hour rate limit).
2. In **Authentication → URL Configuration → Redirect URLs**:
   - Add: `https://<your-project>.vercel.app/**`

---

## Default Accounts for Testing

| Role | Email | Password | Access Details |
|---|---|---|---|
| **Administrator** | `thamdu2004@gmail.com` | `Admin@123456` | Access to the **Manage Students** dashboard (`/admin/students`) to view and edit student accounts. |
| **Student** | *(Self-register)* | *(Min 6 chars)* | Instant account creation via `/login` with pre-confirmed session. |

---

## Evaluation Walkthrough (3 Minutes)

1. **Sign In**: Navigate to `/login` to sign in with an existing account or register a new account in seconds.
2. **Review Dashboard** (`/dashboard`): Examine the overall mastery score, the 4 assessed topics, recent quiz scores, and upcoming revision tasks.
3. **Inspect Gap Report** (`/report`): Notice that *Excretion* is flagged as 🔴 **Weak** with a recurring misconception (*"thinks urea is reabsorbed in loop of Henle"*). Click the evidence table to see cited test questions.
4. **Explore Syllabus Map** (`/topics`): View the colored topic tree, objectives, and prerequisites. Review the past-paper weight analysis.
5. **Check Revision Plan** (`/plan`): The plan prioritizes weak prerequisite topics first. Click the **Exam date** picker—notice it is restricted to dates from **today through the end of the current month**.
6. **Take Diagnostic Quiz** (`/quiz`): Answer mixed-format questions. Each question is grounded in uploaded source text with verified citations. Submit to observe the gap report and revision plan update automatically.
7. **Ask Learning Assistant** (`/explain`): Ask a question (e.g. *"What is photolysis?"*). The assistant replies with bracketed citations `[n]`. Inquire about an unrelated topic (e.g. *"Quantum mechanics"*); the assistant politely refuses based on material boundaries.
8. **Admin Students Dashboard** (`/admin/students`): Log out and log in as `thamdu2004@gmail.com` / `Admin@123456`. View student mastery metrics, edit student roles, or register new students.
9. **Observability & Agents** (`/admin`, `/agents`): Review live system health, latency breakdowns, and step-by-step agent execution logs.

---

## Repository Structure

```
├── app/
│   ├── (app)/                 # Protected application routes
│   │   ├── admin/             # Observability & Manage students (/admin/students)
│   │   ├── agents/            # 10-Agent execution logs
│   │   ├── dashboard/         # Student diagnostic overview
│   │   ├── explain/           # Grounded RAG learning assistant
│   │   ├── materials/         # Document ingestion & management
│   │   ├── plan/              # Personalised revision planner
│   │   ├── quiz/              # Diagnostic testing interface
│   │   ├── report/            # Knowledge gap report & misconceptions
│   │   ├── teacher/           # Teacher hub & class analytics
│   │   └── topics/            # Syllabus map & past-paper analysis
│   ├── api/                   # Serverless API routes
│   │   ├── admin/students/    # Admin user management endpoints
│   │   ├── auth/register/     # Rate-limit-proof registration endpoint
│   │   ├── evaluate/          # Answer evaluation & misconception tagging
│   │   ├── explain/           # RAG explanation streaming
│   │   ├── gap-analysis/      # Diagnosis & mastery computation
│   │   ├── health/            # Health check & provider status
│   │   ├── ingest/            # Serverless document processing
│   │   ├── inngest/           # Inngest durable job handler
│   │   ├── parse/             # Server-side PDF/text parser
│   │   ├── plan/              # Revision task generator
│   │   ├── quiz/              # Diagnostic question generation
│   │   └── topic-map/         # Syllabus hierarchy extraction
│   ├── login/                 # Login & registration page
│   └── layout.tsx             # Root application layout
├── components/                # Reusable UI components & AppProvider
├── lib/
│   ├── ai/                    # Gemini API & embeddings client
│   ├── inngest/               # Background durable functions
│   ├── supabase/              # Browser and server Supabase clients
│   ├── vector/                # Qdrant client, collections & queries
│   ├── admin-server.ts        # Admin authorization & server helpers
│   ├── analysis.ts            # Scoring formulas & mastery heuristics
│   ├── auth.ts                # Unified authentication layer (Supabase + local)
│   ├── bm25.ts                # BM25 lexical retrieval engine
│   ├── chunk.ts               # Heading-aware document chunker
│   ├── config.ts              # Tunable thresholds, weights & budgets
│   ├── ingest-server.ts       # Server-side document processing pipeline
│   ├── llm.ts                 # Groq fallback client & schema validation
│   ├── planner.ts             # Deterministic revision plan scheduler
│   ├── retrieval.ts           # Hybrid retriever (Qdrant + BM25)
│   ├── store.ts               # Offline IndexedDB persistence
│   └── workflows.ts           # Agent orchestrator & run logger
├── supabase/migrations/       # PostgreSQL schema & RLS migrations
└── tests/                     # 52 unit, integration, e2e, and admin tests
```

---

## License

MIT License. Built for **Hackathon PS 2026**.
