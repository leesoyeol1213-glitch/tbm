"use client";

import { useActionState, useState } from "react";
import { reloadTemplateAction, type ActionResult } from "@/actions/patrol";

const IDLE: ActionResult = { error: null };

/**
 * 점검표를 이 일지에 다시 불러온다.
 *
 * 점검표를 고쳐도 이미 열어 둔 일지는 따라가지 않는다. 그래서 "고쳤는데 왜 그대로냐"는
 * 상황이 생기는데, 그때 쓰는 버튼이다. 무엇이 바뀌고 무엇이 남는지 눌러 보기 전에
 * 알려 준다 — 적어 둔 내용이 사라질 수 있다고 짐작만 하게 두면 아무도 안 누른다.
 */
export default function ReloadTemplateButton({
  patrolId,
  templateName,
}: {
  patrolId: string;
  templateName: string;
}) {
  const [state, action, pending] = useActionState(reloadTemplateAction, IDLE);
  const [open, setOpen] = useState(false);

  if (state.message) {
    return (
      <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 ring-1 ring-emerald-200">
        {state.message}
      </p>
    );
  }

  if (!open) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-sm font-semibold text-slate-600 hover:underline"
        >
          점검표 다시 불러오기
        </button>
        {state.error && (
          <p className="mt-1 text-sm font-medium text-rose-700">{state.error}</p>
        )}
      </div>
    );
  }

  return (
    <form action={action} className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
      <input type="hidden" name="patrolId" value={patrolId} />
      <p className="text-sm font-bold text-slate-900">
        &ldquo;{templateName}&rdquo;을 다시 불러올까요?
      </p>
      <ul className="mt-2 space-y-0.5 text-xs text-slate-600">
        <li>· 점검항목이 점검표의 목록·순서로 맞춰집니다.</li>
        <li>· 이미 찍어 둔 양호·불량 판정과 적어 둔 조치사항은 그대로 남습니다.</li>
        <li>· 조치사항이 비어 있던 항목은 점검표의 기본 문구로 채워집니다.</li>
        <li className="font-medium text-amber-800">
          · 점검표에 순찰사항이 적혀 있으면 지금 적은 순찰사항은 그것으로 바뀝니다.
        </li>
      </ul>
      {state.error && (
        <p className="mt-2 text-sm font-medium text-rose-700">{state.error}</p>
      )}
      <div className="mt-3 flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="btn-secondary flex-1 py-1.5 text-sm"
        >
          {pending ? "불러오는 중…" : "불러오기"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="btn-secondary flex-1 py-1.5 text-sm"
        >
          취소
        </button>
      </div>
    </form>
  );
}
