"use client";

import { useActionState, useState } from "react";
import type { ActionResult } from "@/actions/admin";

const IDLE: ActionResult = { error: null };

/**
 * 두 단계 삭제 버튼. 한 번 누르면 확인 문구가 펼쳐지고, 다시 눌러야 실제로 지운다.
 * 서버가 거절하면(기록이 남아 있는 경우) 그 사유를 그대로 보여 준다.
 */
export default function DeleteButton({
  action,
  fields,
  question,
  label = "삭제",
  confirmLabel = "삭제",
  size = "sm",
}: {
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  fields: Record<string, string>;
  question: string;
  label?: string;
  confirmLabel?: string;
  size?: "sm" | "md";
}) {
  const [state, formAction, pending] = useActionState(action, IDLE);
  const [open, setOpen] = useState(false);

  const textSize = size === "sm" ? "text-xs" : "text-sm";

  // 성공하면 목록이 다시 그려지므로, 남는 메시지는 거절 사유일 때만 의미가 있다.
  if (state.error) {
    return (
      <div className="mt-1 rounded-lg bg-rose-50 p-2.5 text-left ring-1 ring-rose-200">
        <p className="text-xs text-rose-800">{state.error}</p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="mt-1.5 text-xs font-semibold text-rose-700 hover:underline"
        >
          확인
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`shrink-0 font-semibold text-rose-600 hover:underline ${textSize}`}
      >
        {label}
      </button>
    );
  }

  return (
    <form action={formAction} className="mt-1 rounded-lg bg-rose-50 p-2.5 text-left ring-1 ring-rose-200">
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <p className="text-xs text-rose-900">{question}</p>
      <div className="mt-2 flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
        >
          {pending ? "삭제 중…" : confirmLabel}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50"
        >
          취소
        </button>
      </div>
    </form>
  );
}
