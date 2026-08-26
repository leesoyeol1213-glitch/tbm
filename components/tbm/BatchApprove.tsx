"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { approveManyAction, type ActionResult } from "@/actions/tbm";

const IDLE: ActionResult = { error: null };

export type PendingItem = {
  id: string;
  teamName: string;
  siteName: string;
  workDateLabel: string;
  submittedLabel: string;
  authorName: string;
  photos: number;
  attendances: number;
  /** 자동 검증 경고가 붙은 건 */
  flagged: boolean;
  flagLabels: string[];
};

/**
 * 월·분기 단위 일괄 결재.
 *
 * 경고가 붙은 건은 기본 선택에서 빼 둔다. 한 번에 넘기려고 만든 화면이지만
 * 걸러야 할 건까지 함께 넘어가면 결재가 형식이 되기 때문이다. 필요하면 직접 고른다.
 */
export default function BatchApprove({
  items,
  canApprove,
}: {
  items: PendingItem[];
  canApprove: boolean;
}) {
  const [state, action, pending] = useActionState(approveManyAction, IDLE);
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
    setSelected(new Set(items.filter((i) => !i.flagged).map((i) => i.id)));
  const clear = () => setSelected(new Set());

  const flaggedSelected = items.filter((i) => i.flagged && selected.has(i.id)).length;

  return (
    <form action={action} className="space-y-3">
      {canApprove && items.length > 0 && (
        <div className="card sticky top-[var(--header-h)] z-10 space-y-2.5">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={selectAll} className="btn-secondary py-1.5 text-xs">
              전체 선택 ({items.length})
            </button>
            <button type="button" onClick={selectClean} className="btn-secondary py-1.5 text-xs">
              경고 없는 건만 ({items.filter((i) => !i.flagged).length})
            </button>
            {selected.size > 0 && (
              <button type="button" onClick={clear} className="btn-secondary py-1.5 text-xs">
                선택 해제
              </button>
            )}
          </div>

          {flaggedSelected > 0 && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 ring-1 ring-amber-200">
              경고가 붙은 {flaggedSelected}건이 선택돼 있습니다. 내용을 보고 승인하세요.
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
            {pending ? "승인 중…" : `선택한 ${selected.size}건 승인`}
          </button>
          <p className="text-center text-xs text-slate-500">
            승인 시각은 지금으로 기록됩니다. 작업일과 승인일이 다르게 남습니다.
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
                    id={`pick-${item.id}`}
                    checked={selected.has(item.id)}
                    onChange={() => toggle(item.id)}
                    className="mt-1 size-5 shrink-0 accent-slate-900"
                  />
                  {selected.has(item.id) && (
                    <input type="hidden" name="tbmIds" value={item.id} />
                  )}
                </>
              )}

              <div className="min-w-0 flex-1">
                <Link href={`/tbm/${item.id}`} className="block hover:underline">
                  <p className="truncate font-bold text-slate-900">
                    {item.teamName} · {item.workDateLabel}
                  </p>
                </Link>
                <p className="mt-0.5 text-xs text-slate-500">
                  {item.siteName} · {item.authorName} · 사진 {item.photos}장 · 출석{" "}
                  {item.attendances}명
                </p>
                {item.flagLabels.length > 0 && (
                  <ul className="mt-1.5 flex flex-wrap gap-1">
                    {item.flagLabels.map((f) => (
                      <li
                        key={f}
                        className="rounded-md bg-rose-50 px-1.5 py-0.5 text-xs font-medium text-rose-800 ring-1 ring-rose-200"
                      >
                        {f}
                      </li>
                    ))}
                  </ul>
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
