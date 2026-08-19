"use client";

import { useActionState, useState } from "react";
import { saveWorkerAction, type ActionResult } from "@/actions/admin";

const IDLE: ActionResult = { error: null };

export type TeamOption = { id: string; name: string };

export type WorkerValues = {
  id?: string;
  name: string;
  empNo: string;
  phone: string;
  jobTitle: string;
  teamId: string;
};

export default function WorkerForm({
  siteId,
  teams,
  worker,
  mode,
}: {
  siteId: string;
  teams: TeamOption[];
  worker?: WorkerValues;
  mode: "create" | "edit";
}) {
  const [state, action, pending] = useActionState(
    async (_prev: ActionResult, formData: FormData) => saveWorkerAction(formData),
    IDLE,
  );
  // 저장 후 새 작업자 입력칸을 비우기 위한 키
  const [resetKey, setResetKey] = useState(0);

  const isCreate = mode === "create";
  if (isCreate && state.ok && !state.error && resetKey === 0) {
    // 성공하면 한 번만 초기화한다.
    setResetKey(1);
  }

  return (
    <form
      key={resetKey}
      action={action}
      className={isCreate ? "card space-y-3" : "space-y-2"}
    >
      <input type="hidden" name="siteId" value={siteId} />
      {worker?.id && <input type="hidden" name="workerId" value={worker.id} />}

      <div className="grid gap-2 sm:grid-cols-5">
        <input
          name="name"
          defaultValue={worker?.name ?? ""}
          placeholder="이름"
          className="field"
          required
        />
        <input
          name="empNo"
          defaultValue={worker?.empNo ?? ""}
          placeholder="사번"
          className="field"
        />
        <input
          name="phone"
          defaultValue={worker?.phone ?? ""}
          placeholder="휴대폰"
          inputMode="tel"
          className="field"
        />
        <input
          name="jobTitle"
          defaultValue={worker?.jobTitle ?? ""}
          placeholder="직종"
          className="field"
        />
        <select name="teamId" defaultValue={worker?.teamId ?? ""} className="field">
          <option value="">팀 미지정</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className={isCreate ? "btn-primary" : "btn-secondary py-1.5 text-sm"}
        >
          {pending ? "저장 중…" : isCreate ? "작업자 추가" : "저장"}
        </button>
        {state.error && (
          <span className="text-sm font-medium text-rose-700">{state.error}</span>
        )}
        {state.ok && !state.error && (
          <span className="text-sm font-medium text-emerald-700">저장됨</span>
        )}
      </div>
    </form>
  );
}
