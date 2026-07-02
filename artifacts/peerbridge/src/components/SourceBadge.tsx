import type { PyEnvelope } from "@/lib/pythonApi";

// Shows where a Python adapter endpoint's data came from: the student module
// itself (green) or the adapter's own DB computation while the student file
// is still broken (amber, with the captured error).
export function SourceBadge({ envelope }: { envelope: PyEnvelope<unknown> | undefined }) {
  if (!envelope) {
    return null;
  }

  const student = envelope.student_module;
  const fromStudent = envelope.source === "student-module";
  const className = fromStudent
    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : "bg-amber-50 text-amber-700 border-amber-200";
  const label = fromStudent
    ? `Student module (${student?.module ?? "python"})`
    : "Adapter fallback (real DB data)";
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
