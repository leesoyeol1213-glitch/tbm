"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { markPaperSignedAction, type ActionResult } from "@/actions/paperSign";
import { type Binder, groupByBinder } from "@/lib/approved";
import { BUDGET_KB, estimateTotalKb, fitBatch } from "@/lib/printBudget";

const IDLE: ActionResult = { error: null };

export type ApprovedDoc = {
  id: string;
  kind: "tbm" | "patrol";
  /** 서류철 단위. TBM은 사업장, 순찰일지는 공장. 묶음의 차례이기도 하다. */
  groupKey: string;
  groupLabel: string;
  title: string;
  dateLabel: string;
  approvedLabel: string;
  /** 종이 서명을 본사가 확인한 시각. 비어 있으면 아직 안 받은 것이다. */
  paperLabel: string | null;
  /** 이 문서에 든 사진 장수. 묶음 크기를 가늠하는 데만 쓴다. */
  photoCount: number;
};

/**
 * 결재가 끝난 문서를 서류철별로 접어 두고, 열어서 골라 받는다.
 *
 * TBM과 순찰일지를 각각 따로 두고 이 컴포넌트를 두 번 그린다. 양식도 다르고
 * 묶어서 인쇄할 일도 없어서, 한 목록에 섞으면 매번 종류부터 골라내야 한다.
 *
 * 그 안에서 다시 사업장(공장)별로 나눈다. 서류철이 법인별로 매이기 때문에,
 * 한 묶음을 여는 것이 곧 서류철 하나를 집는 일이 된다. 선택과 내려받기도
 * 묶음 안에서만 돌아서, 열어 둔 곳 말고 다른 사업장 문서가 딸려오지 않는다.
 */
export default function ApprovedBox({
  docs,
  canMarkPaper,
}: {
  docs: ApprovedDoc[];
  canMarkPaper: boolean;
}) {
  const binders = groupByBinder(docs);
  // 묶음이 하나뿐이면 접을 이유가 없다. 사업장 하나만 보는 계정에게는 예전과
  // 똑같이 펼쳐진 목록으로 보인다. 누른 것만 기록해 두고 나머지는 그때그때
  // 묶음 수로 판단한다 — 기간이나 칸을 바꿔도 이 규칙이 그대로 산다.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const openByDefault = binders.length === 1;
  const isOpen = (key: string) => toggled[key] ?? openByDefault;

  return (
    <div className="space-y-2">
      {binders.map((b) => (
        <div key={b.key} className="card">
          <button
            type="button"
            onClick={() =>
              setToggled((prev) => ({ ...prev, [b.key]: !isOpen(b.key) }))
            }
            aria-expanded={isOpen(b.key)}
            className="flex w-full items-center gap-2 text-left"
          >
            <span aria-hidden className="shrink-0 text-slate-400">
              {isOpen(b.key) ? "▾" : "▸"}
            </span>
            <span className="min-w-0 flex-1 truncate font-bold text-slate-900">
              {b.label}
            </span>
            <span className="shrink-0 text-xs text-slate-500">{b.docs.length}건</span>
            {b.waiting > 0 ? (
              <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900 ring-1 ring-inset ring-amber-300">
                대기 {b.waiting}
              </span>
            ) : (
              <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-300">
                수기결재 완료
              </span>
            )}
          </button>

          {/*
            닫힌 묶음은 아예 그리지 않는다. 한 달치가 285건이라 전부 붙여 두면
            열지도 않은 목록 때문에 화면이 무거워진다.
          */}
          {isOpen(b.key) && (
            <div className="mt-3 border-t border-slate-200 pt-3">
              <BinderPanel binder={b} canMarkPaper={canMarkPaper} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** 서류철 하나. 선택·내려받기·수기결재 표시가 이 안에서만 돈다. */
function BinderPanel({
  binder,
  canMarkPaper,
}: {
  binder: Binder<ApprovedDoc>;
  canMarkPaper: boolean;
}) {
  const docs = binder.docs;
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
  // 건수가 아니라 예상 용량으로 본다. 사진 없는 문서는 여러 건이 들어가고,
  // 사진이 든 문서는 몇 건 못 들어간다.
  const pickedKb = estimateTotalKb(picked);
  const tooBig = pickedKb > BUDGET_KB;
  // 다음 묶음에 몇 건이 들어가는지 미리 세어 버튼에 적는다.
  const nextBatch = fitBatch(docs, cursor >= docs.length ? 0 : cursor);
  // 대기와 완료가 섞여 있을 때만 걸러 주는 버튼이 쓸모가 있다. 한 칸만 보고
  // 있으면 "남은 건만"은 곧 "전체 선택"이라 버튼이 둘로 늘어나기만 한다.
  const mixed = binder.waiting > 0 && binder.waiting < docs.length;

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
      <div className="sticky top-[var(--header-h)] z-10 space-y-2.5 rounded-lg bg-white py-1">
        <div className="flex flex-wrap gap-2">
          {/*
            한 번에 받을 수 있는 양이 정해져 있어 한 달치를 나눠 받게 된다.
            어디까지 집었는지를 따로 세어 앞에서부터 한 묶음씩 내준다.
            현재 선택으로 판단하면 두 번째 묶음부터 앞 묶음이 다시 딸려온다.
          */}
          {nextBatch.length < docs.length && (
            <button
              type="button"
              onClick={() => {
                const from = cursor >= docs.length ? 0 : cursor;
                setSelected(new Set(nextBatch.map(key)));
                setCursor(from + nextBatch.length);
              }}
              className="btn-secondary py-1.5 text-xs"
            >
              {cursor === 0 || cursor >= docs.length
                ? `앞에서 ${nextBatch.length}건 선택`
                : `다음 ${nextBatch.length}건 (${cursor + 1}~${cursor + nextBatch.length} / ${docs.length})`}
            </button>
          )}
          <button
            type="button"
            onClick={() => setSelected(new Set(docs.map(key)))}
            className="btn-secondary py-1.5 text-xs"
          >
            전체 선택 ({docs.length})
          </button>
          {mixed && (
            <button
              type="button"
              onClick={() =>
                setSelected(new Set(docs.filter((d) => !d.paperLabel).map(key)))
              }
              className="btn-secondary py-1.5 text-xs"
            >
              수기결재 남은 건만 ({binder.waiting})
            </button>
          )}
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

        {tooBig && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 ring-1 ring-amber-200">
            선택한 {picked.length}건은 합치면 약 {(pickedKb / 1024).toFixed(1)}MB로
            한 번에 받기 어렵습니다. 위의 묶음 선택 버튼으로 나눠 받아 주세요.
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
              disabled={selected.size === 0 || tooBig}
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
              className={`rounded-lg p-3 ring-1 ${
                selected.has(k) ? "bg-slate-50 ring-slate-900" : "ring-slate-200"
              }`}
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
        <form
          action={action}
          className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200"
        >
          {hidden}
          <input type="hidden" name="undo" value="1" />
          <p className="mb-2 text-xs text-slate-500">
            잘못 표시했다면 선택한 건의 수기결재 확인을 되돌릴 수 있습니다.
          </p>
          <button
            type="submit"
            disabled={pending}
            className="btn-secondary py-1.5 text-sm"
          >
            선택한 건 수기결재 확인 해제
          </button>
        </form>
      )}
    </div>
  );
}
