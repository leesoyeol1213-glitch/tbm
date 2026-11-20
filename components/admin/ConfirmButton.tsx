"use client";

import { useActionState, useState } from "react";

type Result = { error: string | null };

const IDLE: Result = { error: null };

/**
 * 두 단계 확인 버튼.
 *
 * DeleteButton과 같은 흐름이지만 지우는 일이 아니다. 붉은색과 "삭제 중…"을
 * 그대로 쓰면 되돌릴 수 없는 일처럼 보이는데, 공지를 내리는 것은 기록이
 * 남는 일이라 그렇게 보여서는 안 된다.
 */
export default function ConfirmButton({
  action,
  fields,
  question,
  label,
  confirmLabel = "진행",
}: {
  action: (prev: Result, formData: FormData) => Promise<Result>;
  fields: Record<string, string>;
  question: string;
  label: string;
  confirmLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(action, IDLE);
  const [open, setOpen] = useState(false);

  // 성공하면 목록이 다시 그려진다. 남는 메시지는 거절 사유일 때만 뜻이 있다.
  if (state.error) {
    return (
      <div className="mt-1 rounded-lg bg-amber-50 p-2.5 text-left ring-1 ring-amber-200">
        <p className="text-xs text-amber-900">{state.error}</p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="mt-1.5 text-xs font-semibold text-amber-800 hover:underline"
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
        className="shrink-0 text-xs font-semibold text-slate-600 hover:underline"
      >
        {label}
      </button>
    );
  }

  return (
    <form
      action={formAction}
      className="mt-1 rounded-lg bg-slate-50 p-2.5 text-left ring-1 ring-slate-200"
    >
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <p className="text-xs text-slate-700">{question}</p>
      <div className="mt-2 flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {pending ? "처리 중…" : confirmLabel}
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
