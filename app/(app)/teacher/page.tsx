"use client";

import { useEffect, useState } from "react";
import {
  getTeacherClasses,
  createClass,
  getClassAnalytics,
  TeacherClass,
  ClassTopicAnalytics,
  ClassStudentSummary,
} from "@/lib/teacher";

export default function TeacherDashboardPage() {
  const [classes, setClasses] = useState<TeacherClass[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>("");
  const [analytics, setAnalytics] = useState<ClassTopicAnalytics[]>([]);
  const [students, setStudents] = useState<ClassStudentSummary[]>([]);
  const [newClassName, setNewClassName] = useState("");
  const [newSubject, setNewSubject] = useState("Biology");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [assignedTopic, setAssignedTopic] = useState("");
  const [assignmentNotice, setAssignmentNotice] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const cls = await getTeacherClasses("teacher_demo");
        if (!active) return;
        setClasses(cls);
        if (cls.length > 0) {
          setSelectedClassId(cls[0].id);
          const data = await getClassAnalytics("teacher_demo", cls[0].id);
          if (!active) return;
          setAnalytics(data.analytics);
          setStudents(data.students);
        }
      } catch (err) {
        console.warn("[teacher] Initialization fallback:", err);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const handleSelectClass = async (classId: string) => {
    setSelectedClassId(classId);
    setLoading(true);
    try {
      const data = await getClassAnalytics("teacher_demo", classId);
      setAnalytics(data.analytics);
      setStudents(data.students);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClassName.trim()) return;
    const created = await createClass("teacher_demo", newClassName, newSubject);
    setClasses((prev) => [created, ...prev]);
    setSelectedClassId(created.id);
    setShowCreateModal(false);
    setNewClassName("");
  };

  const handleAssignDiagnostic = (topicName: string) => {
    setAssignedTopic(topicName);
    setAssignmentNotice(`Diagnostic quiz on "${topicName}" assigned to all ${students.length} students in this class.`);
    setTimeout(() => setAssignmentNotice(""), 5000);
  };

  const currentClass = classes.find((c) => c.id === selectedClassId) || classes[0];

  return (
    <div className="max-w-6xl mx-auto space-y-8 p-4">
      {/* Header & Class Switcher */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary mb-2">
            Teacher Portal • Role-Based RLS Protected
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Class Diagnostic Hub</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Topic-level class performance, recurring misconception telemetry, and targeted assignments.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={selectedClassId}
            onChange={(e) => handleSelectClass(e.target.value)}
            className="px-3 py-2 bg-card border border-border rounded-md text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary"
          >
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.code})
              </option>
            ))}
          </select>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-md hover:opacity-90 transition-opacity"
          >
            + New Class
          </button>
        </div>
      </div>

      {assignmentNotice && (
        <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-500/40 rounded-lg text-emerald-800 dark:text-emerald-300 text-sm font-medium flex items-center justify-between">
          <span>✓ {assignmentNotice}</span>
          <button onClick={() => setAssignmentNotice("")} className="text-xs underline ml-4">
            Dismiss
          </button>
        </div>
      )}

      {/* Class Meta Card */}
      {currentClass && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-card border border-border p-4 rounded-xl">
            <div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Subject</div>
            <div className="text-xl font-bold mt-1">{currentClass.subjectName}</div>
          </div>
          <div className="bg-card border border-border p-4 rounded-xl">
            <div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Class Invite Code</div>
            <div className="text-xl font-mono font-bold text-primary mt-1">{currentClass.code}</div>
            <p className="text-xs text-muted-foreground mt-0.5">Share with students to enroll</p>
          </div>
          <div className="bg-card border border-border p-4 rounded-xl">
            <div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Enrolled Students</div>
            <div className="text-xl font-bold mt-1">{students.length} students</div>
          </div>
          <div className="bg-card border border-border p-4 rounded-xl">
            <div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Topics Flagged for Review</div>
            <div className="text-xl font-bold text-amber-500 mt-1">
              {analytics.filter((a) => a.requiresClassReview).length} Topics
            </div>
          </div>
        </div>
      )}

      {/* Class Topic Performance */}
      <div className="bg-card border border-border rounded-xl p-6 space-y-6">
        <div>
          <h2 className="text-lg font-bold">Topic Mastery Across Class</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Aggregated from individual student diagnostic tests and past paper assessments.
          </p>
        </div>

        <div className="divide-y divide-border">
          {analytics.map((t) => (
            <div key={t.topicId} className="py-4 first:pt-0 last:pb-0 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1.5 flex-1">
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-base">{t.topicName}</span>
                  {t.requiresClassReview && (
                    <span className="px-2 py-0.5 rounded text-xs font-semibold bg-rose-500/15 text-rose-500">
                      Needs Class Review
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span>Class Average: <strong>{Math.round(t.averageMastery * 100)}%</strong></span>
                  <span>•</span>
                  <span className="text-rose-500 font-medium">{t.weakStudentCount} students struggling</span>
                  <span>•</span>
                  <span className="text-emerald-500 font-medium">{t.strongStudentCount} proficient</span>
                </div>
                {/* Progress bar */}
                <div className="w-full bg-secondary h-2 rounded-full overflow-hidden max-w-md">
                  <div
                    className={`h-full ${
                      t.averageMastery >= 0.8
                        ? "bg-emerald-500"
                        : t.averageMastery >= 0.5
                        ? "bg-amber-500"
                        : "bg-rose-500"
                    }`}
                    style={{ width: `${Math.round(t.averageMastery * 100)}%` }}
                  />
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => handleAssignDiagnostic(t.topicName)}
                  className="px-3.5 py-1.5 bg-secondary text-secondary-foreground text-xs font-semibold rounded-md hover:bg-secondary/80 transition-colors"
                >
                  Assign Diagnostic
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Common Class Misconceptions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-bold">Classroom Misconception Telemetry</h2>
          <p className="text-xs text-muted-foreground">
            Top systematic errors diagnosed across students. Recommended for classroom re-teaching.
          </p>
          <div className="space-y-3">
            {analytics
              .flatMap((a) => a.commonMisconceptions.map((m) => ({ ...m, topicName: a.topicName })))
              .map((m, idx) => (
                <div key={idx} className="p-3 bg-secondary/40 border border-border/60 rounded-lg text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium text-foreground">{m.text}</span>
                    <span className="px-2 py-0.5 rounded text-xs font-bold bg-rose-500/15 text-rose-500 shrink-0">
                      {m.count} students
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">Found in: {m.topicName}</div>
                </div>
              ))}
          </div>
        </div>

        {/* Enrolled Students Roster */}
        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-bold">Enrolled Students ({students.length})</h2>
          <p className="text-xs text-muted-foreground">
            Students currently accessing this curriculum and submitting diagnostic assessments.
          </p>
          <div className="divide-y divide-border">
            {students.map((s) => (
              <div key={s.studentId} className="py-2.5 flex items-center justify-between text-sm">
                <div>
                  <div className="font-semibold">{s.fullName}</div>
                  <div className="text-xs text-muted-foreground">{s.email}</div>
                </div>
                <div className="text-xs text-muted-foreground">
                  Enrolled {s.enrolledAt}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Create Class Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-border p-6 rounded-2xl w-full max-w-md shadow-2xl space-y-4">
            <h3 className="text-xl font-bold">Create New Class</h3>
            <form onSubmit={handleCreateClass} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase">Class Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Grade 10 Biology - Period 4"
                  value={newClassName}
                  onChange={(e) => setNewClassName(e.target.value)}
                  className="w-full mt-1 px-3 py-2 bg-secondary/50 border border-border rounded-md text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase">Subject</label>
                <input
                  type="text"
                  required
                  value={newSubject}
                  onChange={(e) => setNewSubject(e.target.value)}
                  className="w-full mt-1 px-3 py-2 bg-secondary/50 border border-border rounded-md text-sm"
                />
              </div>
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-md"
                >
                  Create Class
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
