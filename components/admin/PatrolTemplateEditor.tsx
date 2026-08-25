"use client";

import { useActionState, useState } from "react";
import {
  createSharedPatrolTemplateAction,
  forkPatrolTemplateAction,
  savePatrolTemplateAction,
  type ActionResult,
} from "@/actions/patrolTemplate";
import { DEFAULT_PATROL_ITEMS } from "@/lib/patrolRules";

const IDLE: ActionResult = { error: null };

export default function PatrolTemplateEditor({
  templateId,
  name: initialName,
  items: initialItems,
  readOnly,
}: {
  templateId: string;
  name: string;
  items: string[];
  readOnly: boolean;
}) {
  const [state, action, pending] = useActionState(savePatrolTemplateAction, IDLE);
  const [name, setName] = useState(initialName);
  const [items, setItems] = useState<string[]>(
    initialItems.length > 0 ? initialItems : [""],
  );

  function update(i: number, value: string) {
    setItems((prev) => prev.map((v, n) => (n === i ? value : v)));
  }
  function move(i: number, delta: number) {
    const j = i + delta;
    if (j < 0 || j >= items.length) return;
    setItems((prev) => {
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  if (readOnly) {
    return (
      <div className="card">
        <h2 className="font-bold text-slate-900">{name}</h2>
        <p className="mt-1 mb-3 text-xs text-slate-500">
          전사 공통 점검표는 본사만 고칠 수 있습니다. 이 사업장에 맞게 바꾸려면 위에서
          전용 점검표를 만드세요.
        </p>
        <ol className="space-y-1 text-sm text-slate-700">
          {items.map((v, i) => (
            <li key={i}>
              {i + 1}. {v}
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return (
    <form action={action} className="card space-y-3">
      <input type="hidden" name="templateId" value={templateId} />

      <div>
        <label className="label" htmlFor="ptName">
          점검표 이름
        </label>
        <input
          id="ptName"
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="field"
          required
        />
      </div>

      <div>
        <span className="label">점검항목</span>
        <p className="mb-2 text-xs text-slate-500">
          순찰일지를 열 때 이 순서 그대로 채워집니다. 현장에 없는 설비 항목은 지우세요.
        </p>
        <ul className="space-y-2">
          {items.map((v, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className="w-5 shrink-0 text-right text-xs text-slate-400">
                {i + 1}
              </span>
              <input
                name="items"
                value={v}
                onChange={(e) => update(i, e.target.value)}
                placeholder="예: 안전보호구 착용 준수여부"
                className="field flex-1"
              />
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  className="rounded px-1.5 py-1 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                  aria-label="위로"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === items.length - 1}
                  className="rounded px-1.5 py-1 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                  aria-label="아래로"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => setItems((p) => p.filter((_, n) => n !== i))}
                  className="rounded px-1.5 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50"
                >
                  삭제
                </button>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setItems((p) => [...p, ""])}
            className="btn-secondary py-1.5 text-sm"
          >
            항목 추가
          </button>
          <button
            type="button"
            onClick={() => setItems(DEFAULT_PATROL_ITEMS)}
            className="btn-secondary py-1.5 text-sm"
          >
            표준 항목으로 되돌리기
          </button>
        </div>
      </div>

      {state.error && (
        <p className="rounded-lg bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-800 ring-1 ring-rose-200">
          {state.error}
        </p>
      )}
      {state.ok && !state.error && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2.5 text-sm font-medium text-emerald-800 ring-1 ring-emerald-200">
          저장했습니다. 다음에 여는 순찰일지부터 반영됩니다.
        </p>
      )}

      <button type="submit" disabled={pending} className="btn-primary w-full">
        {pending ? "저장 중…" : "점검표 저장"}
      </button>
    </form>
  );
}

export function ForkPatrolTemplateForm({
  siteId,
  siteName,
}: {
  siteId: string;
  siteName: string;
}) {
  const [state, action, pending] = useActionState(forkPatrolTemplateAction, IDLE);

  return (
    <form action={action} className="card">
      <h2 className="font-bold text-slate-900">이 사업장 전용 점검표 만들기</h2>
      <p className="mt-1 mb-3 text-xs text-slate-500">
        지금은 전사 공통 점검표를 쓰고 있습니다. 복사본을 만들면 {siteName}의 설비에
        맞게 항목을 고칠 수 있고, 다른 사업장에는 영향이 없습니다.
      </p>
      <input type="hidden" name="siteId" value={siteId} />
      {state.error && (
        <p className="mb-2 text-sm font-medium text-rose-700">{state.error}</p>
      )}
      <button type="submit" disabled={pending} className="btn-secondary">
        {pending ? "만드는 중…" : "전용 점검표 만들기"}
      </button>
    </form>
  );
}

export function CreateSharedPatrolTemplateForm() {
  // 입력이 없는 동작이라 서버 액션은 인자를 받지 않는다.
  const [state, action, pending] = useActionState(
    async () => createSharedPatrolTemplateAction(),
    IDLE,
  );

  return (
    <form action={action} className="card">
      <h2 className="font-bold text-slate-900">점검표가 없습니다</h2>
      <p className="mt-1 mb-3 text-xs text-slate-500">
        표준 점검항목 {DEFAULT_PATROL_ITEMS.length}개로 전사 공통 점검표를 만듭니다.
        만든 뒤 사업장마다 고쳐 쓰면 됩니다.
      </p>
      {state.error && (
        <p className="mb-2 text-sm font-medium text-rose-700">{state.error}</p>
      )}
      <button type="submit" disabled={pending} className="btn-primary">
        {pending ? "만드는 중…" : "표준 점검표 만들기"}
      </button>
    </form>
  );
}
