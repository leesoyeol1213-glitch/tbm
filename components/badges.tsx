import type { Tbm, TbmStatus } from "@prisma/client";
import { STATUS_LABEL, STATUS_STYLE } from "@/lib/authz";
import { describeFlags } from "@/lib/tbm";

export function StatusBadge({ status }: { status: TbmStatus }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${STATUS_STYLE[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

type FlagFields = Pick<
  Tbm,
  "flagLateSubmit" | "flagPhotoDateGap" | "flagOutsideFence" | "flagNoExif" | "submittedAt"
>;

/** 검증 경고를 작은 칩으로 */
export function FlagChips({
  tbm,
  site,
}: {
  tbm: FlagFields;
  site: { dueMinute: number };
}) {
  const flags = describeFlags(tbm, site);
  if (flags.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1">
      {flags.map((f) => (
        <span
          key={f.key}
          title={f.detail}
          className="inline-flex items-center rounded-full bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700 ring-1 ring-inset ring-rose-200"
        >
          ⚠ {f.label}
        </span>
      ))}
    </div>
  );
}

/** 검증 경고를 설명까지 붙여 자세히 */
export function FlagPanel({
  tbm,
  site,
}: {
  tbm: FlagFields;
  site: { dueMinute: number };
}) {
  const flags = describeFlags(tbm, site);
  if (flags.length === 0) return null;

  return (
    <div className="rounded-lg bg-rose-50 p-3 ring-1 ring-rose-200">
      <p className="text-sm font-bold text-rose-900">자동 검증에서 걸린 항목</p>
      <ul className="mt-2 space-y-1">
        {flags.map((f) => (
          <li key={f.key} className="text-sm text-rose-800">
            <span className="font-semibold">{f.label}</span> — {f.detail}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: string; tone?: "warn" | "ok" }) {
  const toneClass =
    tone === "warn" ? "text-rose-600" : tone === "ok" ? "text-emerald-600" : "text-slate-900";
  return (
    <div>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-0.5 text-lg font-bold tabular-nums ${toneClass}`}>{value}</p>
    </div>
  );
}
