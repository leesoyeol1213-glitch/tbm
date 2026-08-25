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

export type TemplateItem = { content: string; defaultAction: string };
export type TemplateRound = { place: string; content: string };

function MoveButtons({
  index,
  count,
  onMove,
  onRemove,
}: {
  index: number;
  count: number;
  onMove: (delta: number) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex shrink-0 gap-1">
      <button
        type="button"
        onClick={() => onMove(-1)}
        disabled={index === 0}
        className="rounded px-1.5 py-1 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-30"
        aria-label="위로"
      >
        ↑
      </button>
      <button
        type="button"
        onClick={() => onMove(1)}
        disabled={index === count - 1}
        className="rounded px-1.5 py-1 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-30"
        aria-label="아래로"
      >
        ↓
      </button>
      <button
        type="button"
        onClick={onRemove}
        className="rounded px-1.5 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50"
      >
        삭제
      </button>
    </div>
  );
}

function swap<T>(list: T[], i: number, delta: number): T[] {
  const j = i + delta;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

export default function PatrolTemplateEditor({
  templateId,
  name: initialName,
  patrollerName: initialPatroller,
  items: initialItems,
  rounds: initialRounds,
  readOnly,
}: {
  templateId: string;
  name: string;
  patrollerName: string;
  items: TemplateItem[];
  rounds: TemplateRound[];
  readOnly: boolean;
}) {
  const [state, action, pending] = useActionState(savePatrolTemplateAction, IDLE);
  const [name, setName] = useState(initialName);
  const [patroller, setPatroller] = useState(initialPatroller);
  const [items, setItems] = useState<TemplateItem[]>(
    initialItems.length > 0 ? initialItems : [{ content: "", defaultAction: "" }],
  );
  const [rounds, setRounds] = useState<TemplateRound[]>(initialRounds);
  // 조치사항 기본값은 대개 비어 있어서, 값이 있는 줄만 펼쳐 둔다.
  const [openAction, setOpenAction] = useState<Set<number>>(
    () => new Set(initialItems.flatMap((it, i) => (it.defaultAction ? [i] : []))),
  );

  function updateItem(i: number, patch: Partial<TemplateItem>) {
    setItems((prev) => prev.map((v, n) => (n === i ? { ...v, ...patch } : v)));
  }
  function updateRound(i: number, patch: Partial<TemplateRound>) {
    setRounds((prev) => prev.map((v, n) => (n === i ? { ...v, ...patch } : v)));
  }
  function toggleAction(i: number) {
    setOpenAction((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  if (readOnly) {
    return (
      <div className="card">
        <h2 className="font-bold text-slate-900">{name}</h2>
        <p className="mt-1 mb-3 text-xs text-slate-500">
          전사 공통 점검표는 본사만 고칠 수 있습니다. 이 공장에 맞게 바꾸려면 위에서
          전용 점검표를 만드세요.
        </p>
        {patroller && (
          <p className="mb-2 text-sm text-slate-700">기본 순찰자: {patroller}</p>
        )}
        {rounds.length > 0 && (
          <div className="mb-3">
            <p className="mb-1 text-xs font-semibold text-slate-600">기본 순찰사항</p>
            <ul className="space-y-0.5 text-sm text-slate-700">
              {rounds.map((r, i) => (
                <li key={i}>
                  {r.place} · {r.content}
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="mb-1 text-xs font-semibold text-slate-600">점검항목</p>
        <ol className="space-y-1 text-sm text-slate-700">
          {items.map((v, i) => (
            <li key={i}>
              {i + 1}. {v.content}
              {v.defaultAction && (
                <span className="block text-xs text-slate-500">
                  기본 조치사항: {v.defaultAction}
                </span>
              )}
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="templateId" value={templateId} />
      <input type="hidden" name="items" value={JSON.stringify(items)} />
      <input type="hidden" name="rounds" value={JSON.stringify(rounds)} />

      {/* --- 기본 정보 --- */}
      <div className="card">
        <div className="grid gap-3 sm:grid-cols-2">
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
            <label className="label" htmlFor="ptPatroller">
              기본 순찰자
            </label>
            <input
              id="ptPatroller"
              name="patrollerName"
              value={patroller}
              onChange={(e) => setPatroller(e.target.value)}
              placeholder="예: 박태완"
              className="field"
            />
            <p className="mt-1 text-xs text-slate-500">
              순찰일지를 열 때 이 이름이 미리 채워집니다. 그날 다르면 고쳐 쓰면 됩니다.
            </p>
          </div>
        </div>
      </div>

      {/* --- 기본 순찰사항 --- */}
      <div className="card">
        <h2 className="font-bold text-slate-900">기본 순찰사항</h2>
        <p className="mt-1 mb-3 text-xs text-slate-500">
          매번 도는 경로를 적어 두면 순찰일지를 열 때 그대로 깔립니다. 양호·불량 판정만
          그날 찍으면 됩니다. 비워 두면 빈 줄 하나로 시작합니다.
        </p>

        {rounds.length > 0 && (
          <ul className="space-y-2">
            {rounds.map((r, i) => (
              <li key={i} className="flex items-center gap-2">
                <input
                  value={r.place}
                  onChange={(e) => updateRound(i, { place: e.target.value })}
                  placeholder="장소 (예: 1공장)"
                  className="field w-40 shrink-0"
                />
                <input
                  value={r.content}
                  onChange={(e) => updateRound(i, { content: e.target.value })}
                  placeholder="내용 (예: 설비별 안전순회)"
                  className="field flex-1"
                />
                <MoveButtons
                  index={i}
                  count={rounds.length}
                  onMove={(d) => setRounds((p) => swap(p, i, d))}
                  onRemove={() => setRounds((p) => p.filter((_, n) => n !== i))}
                />
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          onClick={() => setRounds((p) => [...p, { place: "", content: "" }])}
          className="btn-secondary mt-3 py-1.5 text-sm"
        >
          순찰사항 줄 추가
        </button>
      </div>

      {/* --- 점검항목 --- */}
      <div className="card">
        <h2 className="font-bold text-slate-900">점검항목</h2>
        <p className="mt-1 mb-3 text-xs text-slate-500">
          순찰일지를 열 때 이 순서 그대로 채워집니다. 현장에 없는 설비 항목은 지우세요.
          매번 같은 문구가 들어가는 항목은 <strong>조치사항</strong> 버튼을 눌러 기본값을
          적어 두면 함께 채워집니다 &mdash; &ldquo;기타 유해위험 요인&rdquo;의 상시 교육
          내용처럼요.
        </p>

        <ul className="space-y-2">
          {items.map((v, i) => (
            <li key={i} className="rounded-lg bg-slate-50 p-2.5 ring-1 ring-slate-200">
              <div className="flex items-center gap-2">
                <span className="w-5 shrink-0 text-right text-xs text-slate-400">
                  {i + 1}
                </span>
                <input
                  value={v.content}
                  onChange={(e) => updateItem(i, { content: e.target.value })}
                  placeholder="예: 안전보호구 착용 준수여부"
                  className="field flex-1"
                />
                <button
                  type="button"
                  onClick={() => toggleAction(i)}
                  className={`shrink-0 rounded px-2 py-1 text-xs font-semibold ${
                    v.defaultAction
                      ? "bg-slate-900 text-white"
                      : "text-slate-500 hover:bg-slate-200"
                  }`}
                >
                  조치사항
                </button>
                <MoveButtons
                  index={i}
                  count={items.length}
                  onMove={(d) => setItems((p) => swap(p, i, d))}
                  onRemove={() => setItems((p) => p.filter((_, n) => n !== i))}
                />
              </div>

              {openAction.has(i) && (
                <textarea
                  value={v.defaultAction}
                  onChange={(e) => updateItem(i, { defaultAction: e.target.value })}
                  rows={3}
                  placeholder="매번 들어갈 조치사항·교육 내용을 적어 두세요. 비워 두면 채우지 않습니다."
                  className="field mt-2 resize-y text-sm"
                />
              )}
            </li>
          ))}
        </ul>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setItems((p) => [...p, { content: "", defaultAction: "" }])}
            className="btn-secondary py-1.5 text-sm"
          >
            점검항목 추가
          </button>
          <button
            type="button"
            onClick={() =>
              setItems(
                DEFAULT_PATROL_ITEMS.map((content) => ({ content, defaultAction: "" })),
              )
            }
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

      <button type="submit" disabled={pending} className="btn-primary w-full py-3">
        {pending ? "저장 중…" : "점검표 저장"}
      </button>
    </form>
  );
}

export function ForkPatrolTemplateForm({
  plantId,
  plantName,
}: {
  plantId: string;
  plantName: string;
}) {
  const [state, action, pending] = useActionState(forkPatrolTemplateAction, IDLE);

  return (
    <form action={action} className="card">
      <h2 className="font-bold text-slate-900">이 공장 전용 점검표 만들기</h2>
      <p className="mt-1 mb-3 text-xs text-slate-500">
        지금은 전사 공통 점검표를 쓰고 있습니다. 복사본을 만들면 {plantName}의 설비와
        순찰 경로에 맞게 고칠 수 있고, 다른 공장에는 영향이 없습니다.
      </p>
      <input type="hidden" name="plantId" value={plantId} />
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
        만든 뒤 공장마다 고쳐 쓰면 됩니다.
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
