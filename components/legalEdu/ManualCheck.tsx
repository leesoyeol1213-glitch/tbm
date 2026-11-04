"use client";

import { useActionState, useState } from "react";
import { markLegalEduManualAction, type ActionResult } from "@/actions/legalEdu";

const IDLE: ActionResult = { error: null };

/** 한 사람이 그 회차에서 어떤 상태인지 */
export type ManualState =
  /** 시작·종료를 다 찍었다 */
  | "QR"
  /** 시작만 찍고 끝을 안 찍었다 */
  | "QR_PARTIAL"
  /** 본사가 수기로 인정했다 */
  | "MANUAL"
  /** 아무 기록이 없다 */
  | "NONE";

export type ManualRow = {
  workerId: string;
  name: string;
  empNo: string | null;
  teamName: string | null;
  state: ManualState;
  /** 체류시간. 수기면 회차 시간을 빌려 온 값이다. */
  stayLabel: string;
  /** 수기로 인정한 사유 */
  note: string | null;
};

const STATE_LABEL: Record<ManualState, string> = {
  QR: "QR 확인",
  QR_PARTIAL: "끝 안 찍음",
  MANUAL: "수기 인정",
  NONE: "기록 없음",
};

const STATE_STYLE: Record<ManualState, string> = {
  QR: "bg-emerald-100 text-emerald-800 ring-emerald-300",
  QR_PARTIAL: "bg-amber-100 text-amber-900 ring-amber-300",
  MANUAL: "bg-slate-200 text-slate-700 ring-slate-400",
  NONE: "bg-rose-100 text-rose-800 ring-rose-300",
};

/**
 * QR이 읽히지 않은 사람을 손으로 인정하는 창구.
 *
 * 실제로 참석했는데 구형 단말기나 배터리 때문에 못 찍는 사람이 꼭 나온다. 그
 * 사람을 미기록으로 두면 참석자가 기록에서 사라지고, 스캔한 척 시각을 지어
 * 넣으면 기록 전체를 못 믿게 된다. 그래서 "수기"라고 적어 둔 채로 인정한다.
 *
 * 출력물에서도 "확인" 칸이 QR과 수기를 나눠 찍는다. 색이나 기호로 뭉개면 흑백
 * 복사본에서 구별이 사라지므로 글자로 적는다.
 */
export default function ManualCheck({
  sessionId,
  rows,
  canMark,
}: {
  sessionId: string;
  rows: ManualRow[];
  canMark: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [result, action, pending] = useActionState(markLegalEduManualAction, IDLE);

  const needs = rows.filter((r) => r.state === "NONE").length;
  const manual = rows.filter((r) => r.state === "MANUAL").length;

  return (
    <div className="mt-3 border-t border-slate-200 pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-sm font-semibold text-slate-700 underline underline-offset-2"
      >
        {open ? "참석 확인 닫기" : "참석 확인 (수기)"}
        <span className="ml-1.5 font-normal text-slate-500">
          {needs > 0 ? `기록 없음 ${needs}명` : manual > 0 ? `수기 ${manual}명` : "전원 확인"}
        </span>
      </button>

      {open && (
        <>
          {!canMark && (
            <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-inset ring-slate-200">
              아직 열지 않은 회차입니다. 교육을 시작한 뒤에 인정할 수 있습니다 — 회차가
              열려 있던 시간을 참석 시간으로 보기 때문입니다.
            </p>
          )}
          {result.error && (
            <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800 ring-1 ring-inset ring-rose-200">
              {result.error}
            </p>
          )}

          <ul className="mt-2 divide-y divide-slate-100">
            {rows.map((r) => (
              <li
                key={r.workerId}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2 text-sm"
              >
                <span className="min-w-0 flex-1">
                  <span className="font-semibold text-slate-900">{r.name}</span>
                  <span className="ml-1.5 text-xs text-slate-500">
                    {[r.empNo, r.teamName].filter(Boolean).join(" · ")}
                  </span>
                  {r.note && (
                    <span className="ml-1.5 text-xs text-slate-400">({r.note})</span>
                  )}
                </span>

                <span className="shrink-0 text-xs text-slate-500">{r.stayLabel}</span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${STATE_STYLE[r.state]}`}
                >
                  {STATE_LABEL[r.state]}
                </span>

                {canMark && (
                  <form action={action} className="flex shrink-0 items-center gap-1.5">
                    <input type="hidden" name="sessionId" value={sessionId} />
                    <input type="hidden" name="workerId" value={r.workerId} />
                    {r.state === "MANUAL" ? (
                      <>
                        <input type="hidden" name="want" value="unmark" />
                        <button
                          type="submit"
                          disabled={pending}
                          className="text-xs text-slate-500 underline underline-offset-2"
                        >
                          되돌리기
                        </button>
                      </>
                    ) : (
                      <>
                        <input type="hidden" name="want" value="mark" />
                        <input
                          type="text"
                          name="manualNote"
                          placeholder="사유"
                          maxLength={40}
                          className="w-24 rounded-md px-2 py-1 text-xs ring-1 ring-slate-300"
                        />
                        <button
                          type="submit"
                          disabled={pending}
                          className="shrink-0 rounded-md bg-slate-800 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          {r.state === "QR" ? "수기로 바꾸기" : "참석 인정"}
                        </button>
                      </>
                    )}
                  </form>
                )}
              </li>
            ))}
          </ul>

          <p className="mt-2 text-xs text-slate-500">
            수기로 인정한 사람은 출력물의 <strong>확인</strong> 칸에 &ldquo;수기&rdquo;로
            찍히고, 체류시간은 회차가 열려 있던 시간으로 적힙니다. 시각을 지어 넣지
            않으므로 &ldquo;최소시간 채움&rdquo; 집계에는 들어가지 않습니다 — 참석은
            종이 서명이 증명합니다.
          </p>
        </>
      )}
    </div>
  );
}
