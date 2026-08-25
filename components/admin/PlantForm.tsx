"use client";

import { useActionState, useState } from "react";
import { savePlantAction, type ActionResult } from "@/actions/plant";

const IDLE: ActionResult = { error: null };

export type ManagerOption = { id: string; name: string; label: string };

export type PlantValues = {
  id?: string;
  name: string;
  address: string;
  managerId: string;
  sort: number;
};

export default function PlantForm({
  managers,
  plant,
  mode,
}: {
  managers: ManagerOption[];
  plant?: PlantValues;
  mode: "create" | "edit";
}) {
  const [state, action, pending] = useActionState(savePlantAction, IDLE);
  const [resetKey, setResetKey] = useState(0);

  const isCreate = mode === "create";
  if (isCreate && state.ok && !state.error && resetKey === 0) setResetKey(1);

  return (
    <form
      key={resetKey}
      action={action}
      className={isCreate ? "card space-y-3" : "space-y-2"}
    >
      {plant?.id && <input type="hidden" name="plantId" value={plant.id} />}

      {isCreate && (
        <div>
          <h2 className="font-bold text-slate-900">공장 추가</h2>
          <p className="mt-1 text-xs text-slate-500">
            순찰일지는 법인이 아니라 공장 단위로 하루 한 건 씁니다. 한 공장에 법인이
            여럿 있어도 순찰은 한 번만 돕니다.
          </p>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-4">
        <input
          name="name"
          defaultValue={plant?.name ?? ""}
          placeholder="공장 이름 (예: 진천 1공장)"
          className="field"
          required
        />
        <input
          name="address"
          defaultValue={plant?.address ?? ""}
          placeholder="주소 (선택)"
          className="field"
        />
        <select
          name="managerId"
          defaultValue={plant?.managerId ?? ""}
          className="field"
        >
          <option value="">담당자 없음</option>
          {managers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <input
          name="sort"
          defaultValue={plant?.sort ?? 0}
          placeholder="정렬"
          inputMode="numeric"
          className="field"
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className={isCreate ? "btn-primary" : "btn-secondary py-1.5 text-sm"}
        >
          {pending ? "저장 중…" : isCreate ? "공장 추가" : "저장"}
        </button>
        {state.error && (
          <span className="text-sm font-medium text-rose-700">{state.error}</span>
        )}
        {state.ok && !state.error && (
          <span className="text-sm font-medium text-emerald-700">저장됨</span>
        )}
      </div>

      {isCreate && (
        <p className="text-xs text-slate-500">
          담당자로 지정된 사람만 그 공장의 순찰일지를 씁니다. 본사 관리자는 모든
          공장을 쓸 수 있습니다.
        </p>
      )}
    </form>
  );
}
