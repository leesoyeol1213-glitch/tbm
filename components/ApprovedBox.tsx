"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { markPaperSignedAction, type ActionResult } from "@/actions/paperSign";

const IDLE: ActionResult = { error: null };

/** 한 번에 합칠 수 있는 문서 수. 서버 쪽 MAX_DOCS와 같아야 한다. */
const MAX_PRINT = 20;

export type ApprovedDoc = {
  id: string;
  kind: "tbm" | "patrol";
  title: string;
  subtitle: string;
  dateLabel: string;
  approvedLabel: string;
  /** 종이 서명을 본사가 확인한 시각. 비어 있으면 아직 안 받은 것이다. */
  paperLabel: string | null;
};

export default function ApprovedBox({
  docs,
  canMarkPaper,
}: {
  docs: ApprovedDoc[];
  canMarkPaper: boolean;
}) {
  const [state, action, pending] = useActionState(markPaperSignedAction, IDLE);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const key = (d: ApprovedDoc) => `${d.kind}:${d.id}`;
  const toggle = (k: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const picked = docs.filter((d) => selected.has(key(d)));
  const tbmIds = picked.filter((d) => d.kind === "tbm").map((d) => d.id);
  const patrolIds = picked.filter((d) => d.kind === "patrol").map((d) => d.id);
  const tooMany = picked.length > MAX_PRINT;

  const hidden = (
    <>
      {tbmIds.map((id) => (
        <input key={`t-${id}`} type="hidden" name="tbmIds" value={id} />
      ))}
      {patrolIds.map((id) => (
        <input key={`p-${id}`} type="hidden" name="patrolIds" value={id} />
      ))}
    </>
  );

  return (
    <div className="space-y-3">
      <div className="card sticky top-[104px] z-10 space-y-2.5">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setSelected(new Set(docs.map(key)))}
            className="btn-secondary py-1.5 text-xs"
          >
            전체 선택 ({docs.length})
          </button>
          <button
            type="button"
            onClick={() =>
              setSelected(new Set(docs.filter((d) => !d.paperLabel).map(key)))
            }
            className="btn-secondary py-1.5 text-xs"
          >
            수기결재 남은 건만 ({docs.filter((d) => !d.paperLabel).length})
          </button>
          {selected.size > 0 && (
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="btn-secondary py-1.5 text-xs"
            >
              선택 해제
            </button>
          )}
        </div>

        {tooMany && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 ring-1 ring-amber-200">
            한 번에 {MAX_PRINT}건까지 인쇄할 수 있습니다. 지금 {picked.length}건이
            선택돼 있으니 나눠서 인쇄해 주세요.
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

        <div className="flex flex-wrap gap-2">
          {/*
            선택한 문서를 한 개 PDF로 합쳐 새 탭에 연다. 건별로 탭을 여러 개 띄우면
            팝업 차단에 걸리고, 인쇄도 건마다 눌러야 한다.
          */}
          <form action="/api/print" method="post" target="_blank" className="flex-1">
            {hidden}
            <button
              type="submit"
              disabled={selected.size === 0 || tooMany}
              className="btn-primary w-full py-2.5 disabled:opacity-50"
            >
              선택한 {picked.length}건 인쇄
            </button>
          </form>

          {canMarkPaper && (
            <form action={action} className="flex-1">
              {hidden}
              <button
                type="submit"
                disabled={pending || selected.size === 0}
                className="btn-secondary w-full py-2.5 disabled:opacity-50"
              >
                {pending ? "처리 중…" : "수기결재 완료 표시"}
              </button>
            </form>
          )}
        </div>

        {canMarkPaper && (
          <p className="text-center text-xs text-slate-500">
            출력물에 최종결재자 서명을 받아 보관한 건을 표시합니다. 전자결재와 별개로
            셉니다.
          </p>
        )}
      </div>

      <ul className="space-y-2">
        {docs.map((d) => {
          const k = key(d);
          return (
            <li
              key={k}
              className={`card ${selected.has(k) ? "ring-2 ring-slate-900" : ""}`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  id={`pick-${k}`}
                  checked={selected.has(k)}
                  onChange={() => toggle(k)}
                  className="mt-1 size-5 shrink-0 accent-slate-900"
                />
                <div className="min-w-0 flex-1">
                  <Link
                    href={d.kind === "tbm" ? `/tbm/${d.id}` : `/patrol/${d.id}`}
                    className="block hover:underline"
                  >
                    <p className="truncate font-bold text-slate-900">
                      <span
                        className={`mr-2 rounded px-1.5 py-0.5 text-xs font-semibold ${
                          d.kind === "tbm"
                            ? "bg-slate-100 text-slate-600"
                            : "bg-sky-100 text-sky-700"
                        }`}
                      >
                        {d.kind === "tbm" ? "TBM" : "순찰"}
                      </span>
                      {d.title}
                    </p>
                  </Link>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {d.dateLabel} · {d.subtitle}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    승인 {d.approvedLabel}
                  </p>
                </div>

                {d.paperLabel ? (
                  <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-300">
                    수기결재 완료
                  </span>
                ) : (
                  <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-500 ring-1 ring-inset ring-slate-300">
                    출력 대기
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {canMarkPaper && picked.some((d) => d.paperLabel) && (
        <form action={action} className="card">
          {hidden}
          <input type="hidden" name="undo" value="1" />
          <p className="mb-2 text-xs text-slate-500">
            잘못 표시했다면 선택한 건의 수기결재 확인을 되돌릴 수 있습니다.
          </p>
          <button type="submit" disabled={pending} className="btn-secondary py-1.5 text-sm">
            선택한 건 수기결재 확인 해제
          </button>
        </form>
      )}
    </div>
  );
}
