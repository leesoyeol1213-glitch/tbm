"use client";

import { useActionState, useState } from "react";
import { saveTbmAction, type ActionResult } from "@/actions/tbm";

export type EduItem = { id: string; content: string; done: boolean };
export type Hazard = { hazard: string; control: string };

export default function TbmForm({
  tbmId,
  eduItems,
  hazards: initialHazards,
  workDescription,
  remarks,
  weather,
  heldAt,
  heldUntil,
  canSubmit,
}: {
  tbmId: string;
  eduItems: EduItem[];
  hazards: Hazard[];
  workDescription: string;
  remarks: string;
  weather: string;
  heldAt: string;
  heldUntil: string;
  /** 아직 상신 전이라 이 화면에서 결재로 올릴 수 있는지. */
  canSubmit: boolean;
}) {
  const [hazards, setHazards] = useState<Hazard[]>(
    initialHazards.length > 0 ? initialHazards : [{ hazard: "", control: "" }],
  );
  const [state, formAction, saving] = useActionState(saveTbmAction, {
    error: null,
  } as ActionResult);
  // 종료 시각에 min을 걸어 두려면 시작 시각을 알고 있어야 한다.
  const [heldFrom, setHeldFrom] = useState(heldAt);
  const [heldTo, setHeldTo] = useState(heldUntil);

  function updateHazard(index: number, patch: Partial<Hazard>) {
    setHazards((prev) => prev.map((h, i) => (i === index ? { ...h, ...patch } : h)));
  }

  return (
    <form action={formAction} className="space-y-5"
    >
      <input type="hidden" name="tbmId" value={tbmId} />
      <input type="hidden" name="hazards" value={JSON.stringify(hazards)} />

      {/* --- 실시 정보 --- */}
      <div className="card">
        <h2 className="mb-3 font-bold text-slate-900">실시 정보</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="heldAt">
              실시 시간
            </label>
            <div className="flex items-center gap-1.5">
              <input
                id="heldAt"
                name="heldAt"
                type="time"
                value={heldFrom}
                onChange={(e) => setHeldFrom(e.target.value)}
                className="field"
              />
              <span className="shrink-0 text-sm text-slate-400">~</span>
              <input
                id="heldUntil"
                name="heldUntil"
                type="time"
                value={heldTo}
                min={heldFrom || undefined}
                onChange={(e) => setHeldTo(e.target.value)}
                className="field"
                aria-label="실시 종료 시각"
              />
            </div>
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
          <label className="label" htmlFor="workDescription">
            오늘의 작업 내용
          </label>
          <textarea
            id="workDescription"
            name="workDescription"
            defaultValue={workDescription}
            rows={3}
            className="field resize-y"
            placeholder="공정·작업 위치·특이 작업 등"
          />
        </div>
      </div>

      {/* --- 교육 항목 --- */}
      {eduItems.length > 0 && (
        <div className="card">
          <h2 className="font-bold text-slate-900">안전보건교육 실시 항목</h2>
          <p className="mt-1 mb-3 text-xs text-slate-500">
            매일 동일한 과정입니다. 실제 교육한 항목만 체크하세요.
          </p>
          <ul className="space-y-1">
            {eduItems.map((item) => (
              <li key={item.id}>
                <label className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 hover:bg-slate-50">
                  <input
                    type="checkbox"
                    name="eduDone"
                    value={item.id}
                    defaultChecked={item.done}
                    className="mt-0.5 size-5 shrink-0 rounded border-slate-300 accent-slate-900"
                  />
                  <span className="text-sm text-slate-700">{item.content}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* --- 위험요인 / 안전대책 --- */}
      <div className="card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold text-slate-900">위험요인 및 안전대책</h2>
          <button
            type="button"
            onClick={() => setHazards((prev) => [...prev, { hazard: "", control: "" }])}
            className="rounded-lg px-2 py-1 text-sm font-semibold text-slate-600 hover:bg-slate-100"
          >
            + 추가
          </button>
        </div>

        <ul className="space-y-3">
          {hazards.map((h, i) => (
            <li key={i} className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500">{i + 1}</span>
                {hazards.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setHazards((prev) => prev.filter((_, x) => x !== i))}
                    className="text-xs font-semibold text-rose-600 hover:underline"
                  >
                    삭제
                  </button>
                )}
              </div>
              <input
                value={h.hazard}
                onChange={(e) => updateHazard(i, { hazard: e.target.value })}
                placeholder="위험요인"
                className="field mb-2"
              />
              <input
                value={h.control}
                onChange={(e) => updateHazard(i, { control: e.target.value })}
                placeholder="안전대책"
                className="field"
              />
            </li>
          ))}
        </ul>
      </div>

      {/* --- 특이사항 --- */}
      <div className="card">
        <label className="label" htmlFor="remarks">
          특이사항 · 아차사고 공유 · 근로자 건의사항
        </label>
        <textarea
          id="remarks"
          name="remarks"
          defaultValue={remarks}
          rows={3}
          className="field resize-y"
          placeholder="없으면 비워 두세요."
        />
      </div>

      <div className="sticky bottom-0 -mx-4 space-y-2 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        {state.error && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800 ring-1 ring-rose-200">
            {state.error}
          </p>
        )}
        {/*
          상신도 같은 폼으로 보낸다. 따로 두면 저장을 안 누른 채 상신했을 때
          적은 내용이 사라진다. 눌린 단추의 값이 그대로 넘어간다.
        */}
        {canSubmit && (
          <button
            type="submit"
            name="intent"
            value="submit"
            disabled={saving}
            className="btn-primary w-full py-3"
          >
            {saving ? "처리 중…" : "결재 상신"}
          </button>
        )}
        <button
          type="submit"
          name="intent"
          value="save"
          disabled={saving}
          className="btn-secondary w-full"
        >
          {saving ? "저장 중…" : "임시 저장"}
        </button>
      </div>
    </form>
  );
}
