"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { markPaperSignedAction, type ActionResult } from "@/actions/paperSign";

const IDLE: ActionResult = { error: null };

/** 한 번에 합칠 수 있는 문서 수. 서버 쪽 MAX_DOCS와 같아야 한다. */
const MAX_PRINT = 12;

export type ApprovedDoc = {
  id: string;
  kind: "tbm" | "patrol";
  title: string;
  dateLabel: string;
  approvedLabel: string;
  /** 종이 서명을 본사가 확인한 시각. 비어 있으면 아직 안 받은 것이다. */
  paperLabel: string | null;
};

/**
 * 결재가 끝난 문서를 골라 한 파일로 받고, 종이 서명을 확인 처리한다.
 *
 * TBM과 순찰일지를 각각 따로 두고 이 컴포넌트를 두 번 그린다. 양식도 다르고
 * 묶어서 인쇄할 일도 없어서, 한 목록에 섞으면 매번 종류부터 골라내야 한다.
 * 선택 상태를 구역마다 따로 갖는 것도 그래서 자연스럽다.
 */
export default function ApprovedBox({
  docs,
  canMarkPaper,
}: {
  docs: ApprovedDoc[];
  canMarkPaper: boolean;
}) {
  const [state, action, pending] = useActionState(markPaperSignedAction, IDLE);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // 나눠 받을 때 어디까지 집었는지. 선택 상태와 따로 센다.
  const [cursor, setCursor] = useState(0);

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
          {/*
            한 번에 받을 수 있는 양이 정해져 있어 한 달치를 나눠 받게 된다.
            어디까지 집었는지를 따로 세어 앞에서부터 한 묶음씩 내준다.
            현재 선택으로 판단하면 두 번째 묶음부터 앞 묶음이 다시 딸려온다.
          */}
          {docs.length > MAX_PRINT && (
            <button
              type="button"
              onClick={() => {
                const from = cursor >= docs.length ? 0 : cursor;
                const batch = docs.slice(from, from + MAX_PRINT);
                setSelected(new Set(batch.map(key)));
                setCursor(from + batch.length);
              }}
              className="btn-secondary py-1.5 text-xs"
            >
              {cursor === 0 || cursor >= docs.length
                ? `앞에서 ${MAX_PRINT}건 선택`
                : `다음 ${Math.min(MAX_PRINT, docs.length - cursor)}건 (${cursor + 1}~${Math.min(
                    cursor + MAX_PRINT,
                    docs.length,
                  )} / ${docs.length})`}
            </button>
          )}
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
              onClick={() => {
                setSelected(new Set());
                setCursor(0);
              }}
              className="btn-secondary py-1.5 text-xs"
            >
              선택 해제
            </button>
          )}
        </div>

        {tooMany && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 ring-1 ring-amber-200">
            한 번에 {MAX_PRINT}건까지 합칠 수 있습니다. 지금 {picked.length}건이
            선택돼 있으니 나눠서 받아 주세요.
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
            선택한 문서를 한 개 PDF로 합쳐 파일로 내려받는다. 새 탭을 열지 않는다 —
            응답이 첨부파일이라 브라우저는 이 화면에 그대로 머문다.
          */}
          <form action="/api/print" method="post" className="flex-1">
            {hidden}
            <button
              type="submit"
              disabled={selected.size === 0 || tooMany}
              className="btn-primary w-full py-2.5 disabled:opacity-50"
            >
              선택한 {picked.length}건 내려받기
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
                    <p className="truncate font-bold text-slate-900">{d.title}</p>
                  </Link>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {d.dateLabel} · 승인 {d.approvedLabel}
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
