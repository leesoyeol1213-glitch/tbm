"use client";

import { useActionState, useState } from "react";
import { saveTbmAction, type ActionResult } from "@/actions/tbm";
import {
  LATE_PRESETS,
  THIN_ATTENDANCE_NOTE,
  lateDaysLabel,
  withThinAttendanceNote,
} from "@/lib/tbm";

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
  finishesOnSubmit,
  lateReason,
  isPastDate,
  lateDays,
  thinAttendance,
}: {
  tbmId: string;
  eduItems: EduItem[];
  hazards: Hazard[];
  workDescription: string;
  remarks: string;
  weather: string;
  heldAt: string;
  heldUntil: string;
  /** 아직 올리기 전이라 이 화면에서 올릴 수 있는지. */
  canSubmit: boolean;
  /**
   * 올리면 그대로 완료되는지. 작성자가 그 사업장 안전관리자면 자기가 결재하므로
   * 결재 대기를 거치지 않는다. 팀장이 쓴 건만 상신이 되어 안전관리자를 기다린다.
   */
  finishesOnSubmit: boolean;
  lateReason: string;
  /** 작업일이 오늘이 아닌지. 휴무일 작업을 다음 날 올리는 경우다. */
  isPastDate: boolean;
  /**
   * 작업일에서 며칠 지났는지. 서버에서 재어 넘긴다 — 브라우저 시계로 세면
   * 단말기 시간대가 어긋난 폰에서 하루씩 틀린 숫자가 나온다.
   */
  lateDays: number;
  /**
   * 출석이 명부 절반 이하인 날인지. 휴일 부분 가동이면 출력물에 "총 9명 중
   * 참석 1명"으로 찍혀 여덟 명이 교육을 빠진 것처럼 보인다.
   */
  thinAttendance: boolean;
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
  // 단추로 고른 값과 직접 적은 값이 같은 칸에 들어간다. 고르고 나서 뒤에 한 줄
  // 덧붙이는 일이 실제로 있었다 ("2공장 휴무 / 왓산 입원 중").
  const [late, setLate] = useState(lateReason);
  // 특이사항도 단추로 한 줄 더할 수 있어야 해서 값을 들고 있는다.
  const [note, setNote] = useState(remarks);

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
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          className="field resize-y"
          placeholder="없으면 비워 두세요."
        />

        {/*
          휴일 부분 가동인 날만 띄운다. 평소에도 보이면 이 칸이 상투어로 차는데,
          여기는 아차사고와 위험요인이 실제로 적히는 자리다. 덮어쓰지 않고 뒤에
          한 줄 붙인다 — 이미 적은 위험요인을 단추가 지우면 안 된다.
        */}
        {thinAttendance && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setNote(withThinAttendanceNote(note))}
              disabled={note.includes(THIN_ATTENDANCE_NOTE)}
              className="rounded-full bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 ring-1 ring-inset ring-slate-300 disabled:opacity-40"
            >
              + {THIN_ATTENDANCE_NOTE}
            </button>
            <p className="mt-1.5 text-xs text-slate-600">
              출근자가 명부의 절반 이하입니다. 그대로 두면 출력물에 참석자가 적은
              것으로만 찍혀, 나머지가 교육을 빠진 것처럼 보입니다.
            </p>
          </div>
        )}
      </div>

      {isPastDate && (
        <div className="card border-l-4 border-l-amber-400">
          <label className="label" htmlFor="lateReason">
            늦게 올리는 사유
            {lateDays > 0 && (
              <span className="ml-1.5 font-normal text-slate-500">
                {lateDaysLabel(lateDays)}
              </span>
            )}
          </label>

          {/*
            단추로 고르게 둔다. 자유 입력만 두었을 때 이 칸에 "." 한 글자가
            16건 들어왔다 — 규칙을 통과하려고 아무 글자나 넣은 것이다. 한 번
            누르면 통과하니 점을 찍을 이유가 없어진다. 토요일 작업을 월요일에
            올리는 일이 매주 생기는데, 그때마다 같은 문장을 손으로 치고 있었다.
          */}
          <div className="mb-2 flex flex-wrap gap-1.5">
            {LATE_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setLate(preset)}
                aria-pressed={late === preset}
                className={`rounded-full px-3 py-1.5 text-sm font-semibold ring-1 ring-inset ${
                  late === preset
                    ? "bg-slate-800 text-white ring-slate-800"
                    : "bg-white text-slate-700 ring-slate-300"
                }`}
              >
                {preset}
              </button>
            ))}
          </div>

          <input
            id="lateReason"
            name="lateReason"
            value={late}
            onChange={(e) => setLate(e.target.value)}
            placeholder="위에서 고르거나 직접 적습니다"
            className="field"
          />
          <p className="mt-1.5 text-xs text-slate-600">
            작업일이 지난 기록입니다. 사유가 있어야 올릴 수 있고, 문서에 그대로
            남아 사후 작성과 구분됩니다. 덧붙일 사정이 있으면 칸에 이어 적으세요
            (예: &ldquo;휴무일·주말 작업 — 2공장만 가동&rdquo;).
          </p>
        </div>
      )}
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
            {saving ? "처리 중…" : finishesOnSubmit ? "작성 완료" : "결재 상신"}
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
