"use client";

import { useActionState, useState } from "react";
import type { PatrolState } from "@prisma/client";
import { savePatrolAction, type ActionResult } from "@/actions/patrol";
import { PATROL_STATE_LABEL } from "@/lib/patrolRules";

export type CheckItem = {
  id: string;
  content: string;
  state: PatrolState;
  action: string;
};

export type RoundItem = {
  place: string;
  content: string;
  state: PatrolState;
  note: string;
};

const STATES: PatrolState[] = ["GOOD", "BAD", "NA"];

const IDLE: ActionResult = { error: null };

/** 양호·불량·해당없음 세 칸짜리 라디오. 종이 양식의 체크 칸에 해당한다. */
function StatePicker({
  name,
  value,
  onChange,
}: {
  name: string;
  value: PatrolState;
  onChange: (v: PatrolState) => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-lg ring-1 ring-slate-300">
      {STATES.map((s) => {
        const on = value === s;
        const tone =
          s === "GOOD"
            ? "bg-emerald-600 text-white"
            : s === "BAD"
              ? "bg-rose-600 text-white"
              : "bg-slate-600 text-white";
        return (
          <label
            key={s}
            className={`cursor-pointer px-2.5 py-1.5 text-xs font-semibold ${
              on ? tone : "bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            <input
              type="radio"
              name={name}
              value={s}
              checked={on}
              onChange={() => onChange(s)}
              className="sr-only"
            />
            {PATROL_STATE_LABEL[s]}
          </label>
        );
      })}
    </div>
  );
}

export default function PatrolForm({
  patrolId,
  plantName,
  patrollerName,
  weather,
  startedAt,
  endedAt,
  remarks,
  rounds: initialRounds,
  checks: initialChecks,
  canSubmit,
}: {
  patrolId: string;
  plantName: string;
  patrollerName: string;
  weather: string;
  startedAt: string;
  endedAt: string;
  remarks: string;
  rounds: RoundItem[];
  checks: CheckItem[];
  /** 아직 상신 전이라 이 화면에서 결재로 올릴 수 있는지. 승인된 건 정정은 저장만 한다. */
  canSubmit: boolean;
}) {
  const [rounds, setRounds] = useState<RoundItem[]>(
    initialRounds.length > 0
      ? initialRounds
      : [{ place: "", content: "", state: "GOOD", note: "" }],
  );
  const [checks, setChecks] = useState<CheckItem[]>(initialChecks);
  const [state, formAction, saving] = useActionState(savePatrolAction, IDLE);
  const [from, setFrom] = useState(startedAt);
  const [to, setTo] = useState(endedAt);

  function updateRound(i: number, patch: Partial<RoundItem>) {
    setRounds((prev) => prev.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  }
  function updateCheck(i: number, patch: Partial<CheckItem>) {
    setChecks((prev) => prev.map((c, n) => (n === i ? { ...c, ...patch } : c)));
  }

  const badCount = checks.filter((c) => c.state === "BAD").length;

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="patrolId" value={patrolId} />
      {/*
        상신도 이 폼으로 보낸다. 예전에는 저장과 상신이 서로 다른 폼이라,
        적어 놓고 저장을 안 누른 채 상신하면 적은 내용이 통째로 사라졌다.
      */}
      <input type="hidden" name="intent" value={canSubmit ? "submit" : "save"} />
      <input type="hidden" name="rounds" value={JSON.stringify(rounds)} />

      {/* --- 머리말 --- */}
      <div className="card">
        <h2 className="mb-3 font-bold text-slate-900">순찰 정보</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="patrollerName">
              순찰자
            </label>
            <input
              id="patrollerName"
              name="patrollerName"
              defaultValue={patrollerName}
              placeholder="예: 박태완"
              className="field"
              required
            />
            <p className="mt-1 text-xs text-slate-500">문서에 찍히는 이름입니다.</p>
          </div>
          <div>
            <label className="label" htmlFor="weather">
              날씨
            </label>
            <input
              id="weather"
              name="weather"
              defaultValue={weather}
              placeholder="맑음 / 비 / 폭염 등"
              className="field"
            />
          </div>
        </div>

        <div className="mt-3">
          <label className="label" htmlFor="startedAt">
            순찰 시간
          </label>
          <div className="flex items-center gap-1.5">
            <input
              id="startedAt"
              name="startedAt"
              type="time"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="field"
            />
            <span className="shrink-0 text-sm text-slate-400">~</span>
            <input
              id="endedAt"
              name="endedAt"
              type="time"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
              className="field"
              aria-label="순찰 종료 시각"
            />
          </div>
        </div>
      </div>

      {/* --- 1. 순찰사항 --- */}
      <div className="card">
        <h2 className="font-bold text-slate-900">1. 순찰사항</h2>
        <p className="mt-1 mb-3 text-xs text-slate-500">
          어디를 어떻게 돌았는지 적습니다. 줄은 필요한 만큼 늘리세요.
        </p>

        <ul className="space-y-3">
          {rounds.map((r, i) => (
            <li key={i} className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
              <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
                <input
                  value={r.place}
                  onChange={(e) => updateRound(i, { place: e.target.value })}
                  placeholder="장소 (예: 1공장)"
                  className="field"
                />
                <input
                  value={r.content}
                  onChange={(e) => updateRound(i, { content: e.target.value })}
                  placeholder="내용 (예: 설비별 안전순회)"
                  className="field"
                />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <StatePicker
                  name={`round_state_${i}`}
                  value={r.state}
                  onChange={(v) => updateRound(i, { state: v })}
                />
                <input
                  value={r.note}
                  onChange={(e) => updateRound(i, { note: e.target.value })}
                  placeholder="비고"
                  className="field flex-1"
                />
                {rounds.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setRounds((p) => p.filter((_, n) => n !== i))}
                    className="shrink-0 text-xs font-semibold text-rose-600 hover:underline"
                  >
                    삭제
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={() =>
            setRounds((p) => [...p, { place: "", content: "", state: "GOOD", note: "" }])
          }
          className="btn-secondary mt-3 py-1.5 text-sm"
        >
          줄 추가
        </button>
      </div>

      {/* --- 2. 안전점검사항 --- */}
      <div className="card">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-bold text-slate-900">2. 안전점검사항</h2>
          {/* 종이 양식의 "점검상태(양호/불량)" 칸 머리에 공장 이름이 들어간다. */}
          <p className="text-xs text-slate-500">
            점검상태 · {plantName}
            {badCount > 0 && (
              <span className="ml-2 text-sm font-semibold text-rose-700">
                불량 {badCount}건
              </span>
            )}
          </p>
        </div>
        <p className="mt-1 mb-3 text-xs text-slate-500">
          점검표에서 자동으로 채워집니다. 불량으로 표시하면 조치사항을 반드시 적어야
          상신됩니다.
        </p>

        {checks.length === 0 ? (
          <p className="text-sm text-slate-500">
            점검항목이 없습니다. 관리 → 순찰 점검표에서 항목을 만들어 주세요.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {checks.map((c, i) => (
              <li
                key={c.id}
                className={`rounded-lg p-3 ring-1 ${
                  c.state === "BAD"
                    ? "bg-rose-50 ring-rose-200"
                    : "bg-slate-50 ring-slate-200"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="min-w-0 flex-1 text-sm font-medium text-slate-800">
                    {i + 1}. {c.content}
                  </p>
                  <StatePicker
                    name={`state_${c.id}`}
                    value={c.state}
                    onChange={(v) => updateCheck(i, { state: v })}
                  />
                </div>
                <input
                  name={`action_${c.id}`}
                  value={c.action}
                  onChange={(e) => updateCheck(i, { action: e.target.value })}
                  placeholder={
                    c.state === "BAD" ? "조치사항 (필수)" : "조치사항 (필요하면)"
                  }
                  className="field mt-2"
                  required={c.state === "BAD"}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* --- 3. 기타건의 및 특이사항 --- */}
      <div className="card">
        <h2 className="mb-2 font-bold text-slate-900">3. 기타건의 및 특이사항</h2>
        <textarea
          name="remarks"
          defaultValue={remarks}
          rows={4}
          className="field resize-y"
          placeholder="건의사항, 아차사고, 다음 순찰에 확인할 것 등"
        />
      </div>

      {state.error && (
        <p className="rounded-lg bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-800 ring-1 ring-rose-200">
          {state.error}
        </p>
      )}

      <button type="submit" disabled={saving} className="btn-primary w-full py-3">
        {saving
          ? canSubmit
            ? "올리는 중…"
            : "저장 중…"
          : canSubmit
            ? "결재 상신"
            : "저장"}
      </button>
      {canSubmit && (
        <p className="-mt-3 text-center text-xs text-slate-500">
          적은 내용을 그대로 저장하고 안전실장 결재로 올립니다.
        </p>
      )}
    </form>
  );
}
