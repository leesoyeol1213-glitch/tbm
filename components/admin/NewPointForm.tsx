"use client";

import { useActionState } from "react";
import { createPointAction, type ActionResult } from "@/actions/admin";

const IDLE: ActionResult = { error: null };

export default function NewPointForm({ siteId }: { siteId: string }) {
  const [state, action, pending] = useActionState(
    async (_prev: ActionResult, formData: FormData) => createPointAction(formData),
    IDLE,
  );

  return (
    <form action={action} className="card">
      <label className="label" htmlFor="pointName">
        QR 지점 추가
      </label>
      <div className="flex gap-2">
        <input
          id="pointName"
          name="name"
          placeholder="예: 1공장 지문인식기 옆"
          className="field flex-1"
          required
        />
        <input type="hidden" name="siteId" value={siteId} />
        <button type="submit" disabled={pending} className="btn-primary shrink-0">
          {pending ? "추가 중…" : "추가"}
        </button>
      </div>
      {state.error && (
        <p className="mt-2 text-sm font-medium text-rose-700">{state.error}</p>
      )}
    </form>
  );
}
