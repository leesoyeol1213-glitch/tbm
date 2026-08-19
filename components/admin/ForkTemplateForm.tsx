"use client";

import { useActionState } from "react";
import { forkTemplateAction, type ActionResult } from "@/actions/admin";

const IDLE: ActionResult = { error: null };

export default function ForkTemplateForm({
  siteId,
  siteName,
}: {
  siteId: string;
  siteName: string;
}) {
  const [state, action, pending] = useActionState(
    async (_prev: ActionResult, formData: FormData) => forkTemplateAction(formData),
    IDLE,
  );

  return (
    <form action={action} className="card">
      <p className="text-sm text-slate-600">
        지금은 전사 공통 양식을 쓰고 있습니다. 이 사업장만 다르게 운영하려면 전용 양식을
        만드세요. 현재 내용을 그대로 복사해 시작합니다.
      </p>
      <input type="hidden" name="siteId" value={siteId} />
      <button type="submit" disabled={pending} className="btn-secondary mt-3">
        {pending ? "만드는 중…" : `${siteName} 전용 양식 만들기`}
      </button>
      {state.error && (
        <p className="mt-2 text-sm font-medium text-rose-700">{state.error}</p>
      )}
    </form>
  );
}
