"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { approveManyPatrolsAction, type ActionResult } from "@/actions/patrol";

const IDLE: ActionResult = { error: null };

export type PendingPatrol = {
  id: string;
  plantName: string;
  patrolDateLabel: string;
  submittedLabel: string;
  patrollerName: string;
  authorName: string;
  rounds: number;
  /** 불량으로 표시된 점검항목 수. 0보다 크면 눈으로 보고 결재해야 한다. */
  bad: number;
};

/**
 * 월·분기 단위 일괄 결재. TBM 쪽과 같은 규칙이다.
 *
 * 불량이 있는 건은 기본 선택에서 빼 둔다. 한 번에 넘기려고 만든 화면이지만
 * 조치가 필요한 건까지 함께 넘어가면 결재가 형식이 되기 때문이다.
 */
export default function PatrolBatchApprove({
  items,
  canApprove,
}: {
  items: PendingPatrol[];
  canApprove: boolean;
}) {
  const [state, action, pending] = useActionState(approveManyPatrolsAction, IDLE);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectAll = () => setSelected(new Set(items.map((i) => i.id)));
  const selectClean = () =>
    setSelected(new Set(items.filter((i) => i.bad === 0).map((i) => i.id)));
  const clear = () => setSelected(new Set());

  const badSelected = items.filter((i) => i.bad > 0 && selected.has(i.id)).length;

  return (
    <form action={action} className="space-y-3">

      {canApprove && items.length > 0 && (
        <div className="card sticky top-[var(--header-h)] z-10 space-y-2.5">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={selectAll} className="btn-secondary py-1.5 text-xs">
              전체 선택 ({items.length})
            </button>
            <button type="button" onClick={selectClean} className="btn-secondary py-1.5 text-xs">
              불량 없는 건만 ({items.filter((i) => i.bad === 0).length})
            </button>
            {selected.size > 0 && (
              <button type="button" onClick={clear} className="btn-secondary py-1.5 text-xs">
                선택 해제
              </button>
            )}
          </div>

          {badSelected > 0 && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 ring-1 ring-amber-200">
              불량이 있는 {badSelected}건이 선택돼 있습니다. 조치사항을 보고 승인하세요.
            </p>
          )}

          {state.error && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800 ring-1 ring-rose-200">
              {state.error}
            </p>
          )}
          {state.message && (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 ring-1 ring-emerald-200">
              {state.message}
            </p>
          )}

          <button
            type="submit"
            disabled={pending || selected.size === 0}
            className="btn-primary w-full py-2.5 disabled:opacity-50"
          >
            {pending ? "결재 중…" : `선택한 ${selected.size}건 결재`}
          </button>
          <p className="text-center text-xs text-slate-500">
            승인 시각은 지금으로 기록됩니다. 순찰일과 승인일이 다르게 남습니다.
          </p>
        </div>
      )}

      <ul className="space-y-2.5">
        {items.map((item) => (
          <li
            key={item.id}
            className={`card ${selected.has(item.id) ? "ring-2 ring-slate-900" : ""}`}
          >
            <div className="flex items-start gap-3">
              {canApprove && (
                <>
                  <input
                    type="checkbox"
                    id={`pick-patrol-${item.id}`}
                    checked={selected.has(item.id)}
                    onChange={() => toggle(item.id)}
                    className="mt-1 size-5 shrink-0 accent-slate-900"
                  />
                  {selected.has(item.id) && (
                    <input type="hidden" name="patrolIds" value={item.id} />
                  )}
                </>
              )}

              <div className="min-w-0 flex-1">
                <Link href={`/patrol/${item.id}`} className="block hover:underline">
                  <p className="truncate font-bold text-slate-900">
                    {item.plantName} · {item.patrolDateLabel}
                  </p>
                </Link>
                <p className="mt-0.5 text-xs text-slate-500">
                  순찰자 {item.patrollerName || "미기재"} · 작성 {item.authorName} ·
                  순찰사항 {item.rounds}줄
                </p>
                {item.bad > 0 && (
                  <p className="mt-1.5 inline-block rounded-md bg-rose-50 px-1.5 py-0.5 text-xs font-medium text-rose-800 ring-1 ring-rose-200">
                    불량 {item.bad}건
                  </p>
                )}
              </div>

              <span className="shrink-0 text-xs tabular-nums text-slate-400">
                {item.submittedLabel}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </form>
  );
}
