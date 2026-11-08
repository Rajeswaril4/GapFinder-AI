-- GapFinder AI Production PostgreSQL Schema
-- Next.js 16 + Supabase Auth + Supabase Storage + RLS

-- 1. PROFILES (Extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'teacher', 'admin')),
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- 2. CLASSES & ENROLLMENTS (For Teacher Module & Authorization)
CREATE TABLE IF NOT EXISTS public.classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  subject_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Teachers can manage their classes" ON public.classes;
CREATE POLICY "Teachers can manage their classes"
  ON public.classes FOR ALL
  USING (auth.uid() = teacher_id);

CREATE TABLE IF NOT EXISTS public.class_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE(class_id, student_id)
);

ALTER TABLE public.class_enrollments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students can view their enrollments" ON public.class_enrollments;
CREATE POLICY "Students can view their enrollments"
  ON public.class_enrollments FOR SELECT
  USING (auth.uid() = student_id);

DROP POLICY IF EXISTS "Teachers can view class enrollments" ON public.class_enrollments;
CREATE POLICY "Teachers can view class enrollments"
  ON public.class_enrollments FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.classes
      WHERE classes.id = class_enrollments.class_id
      AND classes.teacher_id = auth.uid()
    )
  );

-- 3. SUBJECTS
CREATE TABLE IF NOT EXISTS public.subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own subjects" ON public.subjects;
CREATE POLICY "Users can manage own subjects"
  ON public.subjects FOR ALL
  USING (auth.uid() = user_id);

-- 4. DOCUMENTS (Preserves Document Lifecycle)
CREATE TABLE IF NOT EXISTS public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  subject_id UUID REFERENCES public.subjects(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('syllabus', 'notes', 'past_paper')),
  detected_kind TEXT,
  status TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'processing', 'extracting', 'chunking', 'embedding', 'indexing', 'ready', 'failed')),
  file_path TEXT,
  file_size BIGINT,
  hash TEXT NOT NULL,
  word_count INT DEFAULT 0,
  page_count INT DEFAULT 0,
  warnings TEXT[] DEFAULT '{}',
  headings TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own documents" ON public.documents;
CREATE POLICY "Users can manage own documents"
  ON public.documents FOR ALL
  USING (auth.uid() = user_id);

-- 5. DOCUMENT PAGES
CREATE TABLE IF NOT EXISTS public.document_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  page_number INT NOT NULL,
  text TEXT NOT NULL,
  char_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE(document_id, page_number)
);

ALTER TABLE public.document_pages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own document pages" ON public.document_pages;
CREATE POLICY "Users can manage own document pages"
  ON public.document_pages FOR ALL
  USING (auth.uid() = user_id);

-- 6. DOCUMENT CHUNKS
CREATE TABLE IF NOT EXISTS public.document_chunks (
  id TEXT PRIMARY KEY, -- e.g. docId-c0
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  subject_id UUID REFERENCES public.subjects(id) ON DELETE SET NULL,
  chunk_index INT NOT NULL,
  section_heading TEXT NOT NULL DEFAULT 'General',
  page_number INT NOT NULL,
  text TEXT NOT NULL,
  char_count INT NOT NULL,
  qdrant_point_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own document chunks" ON public.document_chunks;
CREATE POLICY "Users can manage own document chunks"
  ON public.document_chunks FOR ALL
  USING (auth.uid() = user_id);

-- 7. TOPICS
CREATE TABLE IF NOT EXISTS public.topics (
  id TEXT PRIMARY KEY, -- e.g. t_1_photosynthesis
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  subject_id UUID REFERENCES public.subjects(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  chapter TEXT,
  exam_weight INT DEFAULT 0,
  source_chunk_ids TEXT[] DEFAULT '{}',
  edited BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.topics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own topics" ON public.topics;
CREATE POLICY "Users can manage own topics"
  ON public.topics FOR ALL
  USING (auth.uid() = user_id);

-- 8. SUBTOPICS
CREATE TABLE IF NOT EXISTS public.subtopics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id TEXT NOT NULL REFERENCES public.topics(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INT DEFAULT 0
);

ALTER TABLE public.subtopics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own subtopics" ON public.subtopics;
CREATE POLICY "Users can manage own subtopics"
  ON public.subtopics FOR ALL
  USING (auth.uid() = user_id);

-- 9. LEARNING OBJECTIVES
CREATE TABLE IF NOT EXISTS public.learning_objectives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id TEXT NOT NULL REFERENCES public.topics(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  bloom_level TEXT DEFAULT 'understand'
);

ALTER TABLE public.learning_objectives ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own learning objectives" ON public.learning_objectives;
CREATE POLICY "Users can manage own learning objectives"
  ON public.learning_objectives FOR ALL
  USING (auth.uid() = user_id);

-- 10. TOPIC PREREQUISITES
CREATE TABLE IF NOT EXISTS public.topic_prerequisites (
  topic_id TEXT NOT NULL REFERENCES public.topics(id) ON DELETE CASCADE,
  prerequisite_id TEXT NOT NULL REFERENCES public.topics(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  PRIMARY KEY (topic_id, prerequisite_id)
);

ALTER TABLE public.topic_prerequisites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own topic prerequisites" ON public.topic_prerequisites;
CREATE POLICY "Users can manage own topic prerequisites"
  ON public.topic_prerequisites FOR ALL
  USING (auth.uid() = user_id);

-- 11. PAST PAPER QUESTIONS
CREATE TABLE IF NOT EXISTS public.past_paper_questions (
  id TEXT PRIMARY KEY,
  document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  topic_id TEXT REFERENCES public.topics(id) ON DELETE SET NULL,
  text TEXT NOT NULL,
  marks INT,
  qtype TEXT DEFAULT 'other',
  difficulty TEXT DEFAULT 'medium' CHECK (difficulty IN ('easy', 'medium', 'hard')),
  match_score NUMERIC(5,2) DEFAULT 0,
  confidence NUMERIC(3,2) DEFAULT 0,
  needs_review BOOLEAN DEFAULT FALSE,
  manual BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.past_paper_questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own past paper questions" ON public.past_paper_questions;
CREATE POLICY "Users can manage own past paper questions"
  ON public.past_paper_questions FOR ALL
  USING (auth.uid() = user_id);

-- 12. QUIZZES
CREATE TABLE IF NOT EXISTS public.quizzes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  subject_id UUID REFERENCES public.subjects(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  total_questions INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.quizzes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own quizzes" ON public.quizzes;
CREATE POLICY "Users can manage own quizzes"
  ON public.quizzes FOR ALL
  USING (auth.uid() = user_id);

-- 13. QUIZ QUESTIONS
CREATE TABLE IF NOT EXISTS public.quiz_questions (
  id TEXT PRIMARY KEY,
  quiz_id UUID REFERENCES public.quizzes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  topic_id TEXT REFERENCES public.topics(id) ON DELETE SET NULL,
  topic_name TEXT NOT NULL,
  subtopic TEXT DEFAULT '',
  type TEXT NOT NULL CHECK (type IN ('mcq', 'multi_select', 'true_false', 'fill_blank', 'short', 'numerical')),
  difficulty TEXT NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
  marks INT NOT NULL DEFAULT 1,
  question TEXT NOT NULL,
  options JSONB,
  answer_index INT,
  answer_indices JSONB,
  accepted_answers JSONB,
  numeric_answer NUMERIC,
  tolerance NUMERIC,
  unit TEXT,
  rubric JSONB,
  model_answer TEXT NOT NULL,
  explanation TEXT NOT NULL,
  learning_objective TEXT,
  misconception_tags TEXT[] DEFAULT '{}',
  citation JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.quiz_questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own quiz questions" ON public.quiz_questions;
CREATE POLICY "Users can manage own quiz questions"
  ON public.quiz_questions FOR ALL
  USING (auth.uid() = user_id);

-- 14. QUIZ ATTEMPTS
CREATE TABLE IF NOT EXISTS public.quiz_attempts (
  id TEXT PRIMARY KEY, -- e.g. att_xyz
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  quiz_id UUID REFERENCES public.quizzes(id) ON DELETE SET NULL,
  answers JSONB NOT NULL DEFAULT '{}',
  confidence JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.quiz_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own quiz attempts" ON public.quiz_attempts;
CREATE POLICY "Users can manage own quiz attempts"
  ON public.quiz_attempts FOR ALL
  USING (auth.uid() = user_id);

-- 15. ANSWER EVALUATIONS
CREATE TABLE IF NOT EXISTS public.answer_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id TEXT NOT NULL REFERENCES public.quiz_attempts(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES public.quiz_questions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  score NUMERIC(3,2) NOT NULL,
  correct BOOLEAN NOT NULL,
  correctness TEXT NOT NULL CHECK (correctness IN ('correct', 'partially_correct', 'incorrect', 'unanswered')),
  method TEXT NOT NULL CHECK (method IN ('deterministic', 'rubric_ai', 'fallback')),
  feedback TEXT NOT NULL,
  misconception TEXT,
  evidence TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.answer_evaluations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own evaluations" ON public.answer_evaluations;
CREATE POLICY "Users can manage own evaluations"
  ON public.answer_evaluations FOR ALL
  USING (auth.uid() = user_id);

-- 16. TOPIC MASTERY (Evidence-backed diagnosis persistence)
CREATE TABLE IF NOT EXISTS public.topic_mastery (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  topic_id TEXT NOT NULL REFERENCES public.topics(id) ON DELETE CASCADE,
  mastery NUMERIC(4,3) NOT NULL DEFAULT 0.0,
  level TEXT NOT NULL CHECK (level IN ('weak', 'medium', 'strong', 'untested')),
  confidence TEXT NOT NULL CHECK (confidence IN ('low', 'medium', 'high')),
  attempted INT DEFAULT 0,
  earned NUMERIC(5,2) DEFAULT 0,
  total_attempted INT DEFAULT 0,
  total_correct INT DEFAULT 0,
  priority NUMERIC(4,3) DEFAULT 0.0,
  trend NUMERIC(4,3),
  weak_subtopics TEXT[] DEFAULT '{}',
  misconceptions TEXT[] DEFAULT '{}',
  evidence_text TEXT NOT NULL,
  ai_reason TEXT,
  recommended_action TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE(user_id, topic_id)
);

ALTER TABLE public.topic_mastery ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own topic mastery" ON public.topic_mastery;
CREATE POLICY "Users can manage own topic mastery"
  ON public.topic_mastery FOR ALL
  USING (auth.uid() = user_id);

-- 17. MISCONCEPTIONS
CREATE TABLE IF NOT EXISTS public.misconceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  topic_id TEXT NOT NULL REFERENCES public.topics(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  occurrence_count INT NOT NULL DEFAULT 1,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.misconceptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own misconceptions" ON public.misconceptions;
CREATE POLICY "Users can manage own misconceptions"
  ON public.misconceptions FOR ALL
  USING (auth.uid() = user_id);

-- 18. GAP REPORTS
CREATE TABLE IF NOT EXISTS public.gap_reports (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  attempt_id TEXT REFERENCES public.quiz_attempts(id) ON DELETE SET NULL,
  overall_mastery NUMERIC(4,3) NOT NULL,
  assessed_count INT NOT NULL,
  total_topics INT NOT NULL,
  summary TEXT NOT NULL,
  topics_snapshot JSONB NOT NULL,
  misconceptions_snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.gap_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own gap reports" ON public.gap_reports;
CREATE POLICY "Users can manage own gap reports"
  ON public.gap_reports FOR ALL
  USING (auth.uid() = user_id);

-- 19. REVISION PLANS
CREATE TABLE IF NOT EXISTS public.revision_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  report_id TEXT REFERENCES public.gap_reports(id) ON DELETE SET NULL,
  days INT NOT NULL,
  hours_per_day NUMERIC(3,1) NOT NULL,
  exam_date DATE,
  ai_enhanced BOOLEAN DEFAULT FALSE,
  schedule JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.revision_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own revision plans" ON public.revision_plans;
CREATE POLICY "Users can manage own revision plans"
  ON public.revision_plans FOR ALL
  USING (auth.uid() = user_id);

-- 20. REVISION TASKS
CREATE TABLE IF NOT EXISTS public.revision_tasks (
  id TEXT PRIMARY KEY,
  plan_id UUID NOT NULL REFERENCES public.revision_plans(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  day_number INT NOT NULL,
  topic_id TEXT NOT NULL REFERENCES public.topics(id) ON DELETE CASCADE,
  topic_name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('learn', 'practice', 'review', 'retest')),
  minutes INT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('high', 'medium', 'low')),
  activity TEXT NOT NULL,
  focus TEXT[] DEFAULT '{}',
  sources TEXT[] DEFAULT '{}',
  practice_question TEXT,
  success_criteria TEXT NOT NULL,
  done BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.revision_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own revision tasks" ON public.revision_tasks;
CREATE POLICY "Users can manage own revision tasks"
  ON public.revision_tasks FOR ALL
  USING (auth.uid() = user_id);

-- 21. AGENT RUNS & PROCESSING JOBS (Observability)
CREATE TABLE IF NOT EXISTS public.agent_runs (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'fallback', 'error')),
  input_summary TEXT NOT NULL,
  output_summary TEXT NOT NULL,
  duration_ms INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own agent runs" ON public.agent_runs;
CREATE POLICY "Users can manage own agent runs"
  ON public.agent_runs FOR ALL
  USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.processing_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  document_id UUID REFERENCES public.documents(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  progress INT DEFAULT 0,
  error_message TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.processing_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own processing jobs" ON public.processing_jobs;
CREATE POLICY "Users can manage own processing jobs"
  ON public.processing_jobs FOR ALL
  USING (auth.uid() = user_id);

-- 22. TEACHER ACCESS POLICIES: Teachers can view performance of students enrolled in their classes
DROP POLICY IF EXISTS "Teachers can view enrolled student mastery" ON public.topic_mastery;
CREATE POLICY "Teachers can view enrolled student mastery"
  ON public.topic_mastery FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.class_enrollments
      JOIN public.classes ON classes.id = class_enrollments.class_id
      WHERE class_enrollments.student_id = topic_mastery.user_id
      AND classes.teacher_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Teachers can view enrolled student gap reports" ON public.gap_reports;
CREATE POLICY "Teachers can view enrolled student gap reports"
  ON public.gap_reports FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.class_enrollments
      JOIN public.classes ON classes.id = class_enrollments.class_id
      WHERE class_enrollments.student_id = gap_reports.user_id
      AND classes.teacher_id = auth.uid()
    )
  );
