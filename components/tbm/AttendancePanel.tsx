import type { AttendanceMethod, AttendanceState } from "@prisma/client";
import { setAttendanceAction } from "@/actions/tbm";
import { timeLabel } from "@/lib/kst";

export type AttendanceRow = {
  workerId: string;
  name: string;
  empNo: string | null;
  state: AttendanceState | null;
  method: AttendanceMethod | null;
  checkedInAt: Date | null;
  note: string | null;
};

const STATE_LABEL: Record<AttendanceState, string> = {
  PRESENT: "참석",
  LATE: "지각",
  ABSENT: "불참",
};

const STATE_STYLE: Record<AttendanceState, string> = {
  PRESENT: "bg-emerald-100 text-emerald-800",
  LATE: "bg-amber-100 text-amber-800",
  ABSENT: "bg-rose-100 text-rose-800",
};

export default function AttendancePanel({
  tbmId,
  rows,
  editable,
}: {
  tbmId: string;
  rows: AttendanceRow[];
  editable: boolean;
}) {
  const present = rows.filter((r) => r.state === "PRESENT" || r.state === "LATE").length;
  const qrCount = rows.filter((r) => r.method === "QR").length;

  return (
    <div className="card">
      <div className="mb-1 flex items-baseline justify-between">
        <h2 className="font-bold text-slate-900">출석 현황</h2>
        <p className="text-sm font-semibold tabular-nums text-slate-900">
          {present} / {rows.length}명
        </p>
      </div>
      <p className="mb-3 text-xs text-slate-500">
        QR 자동 체크인 {qrCount}명. 못 찍은 인원은 아래에서 직접 바꿔 주세요.
      </p>

      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">등록된 작업자가 없습니다.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map((row) => (
            <li key={row.workerId} className="flex items-center justify-between gap-2 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">
                  {row.empNo && (
                    <span className="mr-1.5 font-mono text-xs font-normal text-slate-400">
                      {row.empNo}
                    </span>
                  )}
                  {row.name}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {row.checkedInAt
                    ? `${timeLabel(row.checkedInAt)} ${row.method === "QR" ? "QR 체크인" : "수동 기록"}`
                    : "기록 없음"}
                  {row.note && ` · ${row.note}`}
                </p>
              </div>

              {editable ? (
                <div className="flex shrink-0 gap-1">
                  {(["PRESENT", "LATE", "ABSENT"] as const).map((s) => (
                    <form key={s} action={setAttendanceAction}>
                      <input type="hidden" name="tbmId" value={tbmId} />
                      <input type="hidden" name="workerId" value={row.workerId} />
                      <input type="hidden" name="state" value={s} />
                      <button
                        type="submit"
                        className={`rounded-md px-2 py-1.5 text-xs font-semibold transition ${
                          row.state === s
                            ? STATE_STYLE[s]
                            : "bg-slate-50 text-slate-500 hover:bg-slate-100"
                        }`}
                      >
                        {STATE_LABEL[s]}
                      </button>
                    </form>
                  ))}
                </div>
              ) : (
                <span
                  className={`shrink-0 rounded-md px-2 py-1 text-xs font-semibold ${
                    row.state ? STATE_STYLE[row.state] : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {row.state ? STATE_LABEL[row.state] : "미기록"}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
