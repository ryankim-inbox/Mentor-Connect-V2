import type { PyEnvelope } from "@/lib/pythonApi";

// Shows where a Python adapter endpoint's data came from. Python-only
// endpoints (source "python") are green when the student module produced the
// data and red when it failed; older admin/reports endpoints may still answer
// with source "student-module" or adapter-computed data.
export function SourceBadge({ envelope }: { envelope: PyEnvelope<unknown> | undefined }) {
  if (!envelope) {
    return null;
  }

  const student = envelope.student_module;
  const moduleLabel = student?.module ? `${student.module}.py` : "python";

  let className: string;
  let label: string;
  if (envelope.source === "python") {
    const succeeded = envelope.success ?? envelope.ok;
    className = succeeded
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : "bg-red-50 text-red-700 border-red-200";
    label = succeeded ? `Python output (${moduleLabel})` : `Python error (${moduleLabel})`;
  } else if (envelope.source === "student-module") {
    className = "bg-emerald-50 text-emerald-700 border-emerald-200";
    label = `Student module (${moduleLabel})`;
  } else {
    className = "bg-amber-50 text-amber-700 border-amber-200";
    label = `Adapter data (${moduleLabel} unavailable)`;
  }

  const title = student?.error
    ? `${student.module}.py — ${student.status ?? "error"}: ${student.error}`
    : student
      ? `${student.module}.py — ${student.status ?? "status unknown"}`
      : undefined;

  return (
    <span
      title={title}
      className={`inline-flex items-center px-2.5 py-1 rounded-full border text-xs font-medium ${className}`}
    >
      {label}
    </span>
  );
}
