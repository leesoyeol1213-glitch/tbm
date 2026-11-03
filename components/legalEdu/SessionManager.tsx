"use client";

import { useActionState } from "react";
import {
  createLegalEduSessionAction,
  deleteLegalEduSessionAction,
  toggleLegalEduSessionAction,
  type ActionResult,
} from "@/actions/legalEdu";
import { PHASE_LABEL, type SessionPhase, type SessionTally } from "@/lib/legalEdu";

const IDLE: ActionResult = { error: null };

export type SessionRow = {
  id: string;
  /** 스캔 주소 전체. 종이 QR과 같은 곳을 가리킨다. */
  url: string;
  eduDateLabel: string;
  openedLabel: string | null;
  closedLabel: string | null;
  phase: SessionPhase;
  place: string | null;
  instructor: string | null;
  tally: SessionTally;
  requiredLabel: string | null;
};

const PHASE_STYLE: Record<SessionPhase, string> = {
  BEFORE: "bg-slate-100 text-slate-600 ring-slate-300",
  OPEN: "bg-emerald-100 text-emerald-800 ring-emerald-300",
  CLOSED: "bg-slate-200 text-slate-700 ring-slate-400",
};

/**
 * 법정의무교육 회차 관리.
 *
 * 만들기 → (교육 시작할 때) 열기 → (끝나면) 마감. 열기 전에는 스캔을 받지
 * 않는다. QR이 인쇄되어 돌아다니는 종이에 있으므로, 열어 두지 않으면 교육
 * 시작 전에 찍은 시각이 시작 시각으로 남는다.
 */
export default function SessionManager({
  siteId,
  siteName,
  kind,
  eduTitle,
  defaultContents,
  defaultEduDate,
  sessions,
}: {
  siteId: string;
  siteName: string;
  kind: string;
  eduTitle: string;
  defaultContents: string[];
  defaultEduDate: string;
  sessions: SessionRow[];
}) {
  const [created, createAction, creating] = useActionState(
    createLegalEduSessionAction,
    IDLE,
  );
  const [toggled, toggleAction, toggling] = useActionState(
    toggleLegalEduSessionAction,
    IDLE,
  );
  const [deleted, deleteAction, deleting] = useActionState(
    deleteLegalEduSessionAction,
    IDLE,
  );

  const error = created.error ?? toggled.error ?? deleted.error;

  return (
    <section className="card space-y-4">
      <div>
        <h2 className="font-bold text-slate-900">QR 회차</h2>
        <p className="mt-1 text-xs text-slate-500">
          교육 시작과 끝에 각각 한 번 찍게 하면 <strong>체류시간</strong>이 남습니다.
          서명은 참석을 증명하고, 두 번 찍힌 시각은 1시간 앉아 있었다는 것을
          증명합니다 — 종이 한 장으로는 안 되는 일입니다.
        </p>
      </div>

      {error && (
        <p className="rounded-lg bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-800 ring-1 ring-rose-200">
          {error}
        </p>
      )}

      {sessions.length === 0 ? (
        <p className="rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-slate-500">
          {siteName}에 {eduTitle} 회차가 없습니다. 아래에서 만드세요.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {sessions.map((s) => (
            <li key={s.id} className="rounded-xl p-3 ring-1 ring-slate-200">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-bold text-slate-900">{s.eduDateLabel}</p>
                  <p className="text-xs text-slate-500">
                    {[s.place, s.instructor].filter(Boolean).join(" · ") || "장소·강사 미기재"}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${PHASE_STYLE[s.phase]}`}
                >
                  {PHASE_LABEL[s.phase]}
                </span>
              </div>

              {(s.openedLabel ?? s.closedLabel) && (
                <p className="mt-1.5 text-xs text-slate-500">
                  {s.openedLabel && <>열림 {s.openedLabel}</>}
                  {s.closedLabel && <> · 마감 {s.closedLabel}</>}
                </p>
              )}

              {/* 집계. 화면과 출력물이 같은 숫자를 쓴다. */}
              <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                <Stat label="명부" value={`${s.tally.total}명`} />
                <Stat label="시작 찍음" value={`${s.tally.started}명`} />
                <Stat
                  label="끝까지"
                  value={`${s.tally.ended}명`}
                  warn={s.tally.unknown > 0}
                />
                {s.requiredLabel ? (
                  <Stat
                    label={`${s.requiredLabel} 채움`}
                    value={`${s.tally.ok}명`}
                    warn={s.tally.short > 0}
                  />
                ) : (
                  <Stat label="미기록" value={`${s.tally.missing}명`} warn={s.tally.missing > 0} />
                )}
              </dl>

              {(s.tally.short > 0 || s.tally.unknown > 0 || s.tally.missing > 0) && (
                <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-inset ring-amber-200">
                  {[
                    s.tally.short > 0 && `최소시간 미달 ${s.tally.short}명`,
                    s.tally.unknown > 0 && `끝을 안 찍은 사람 ${s.tally.unknown}명`,
                    s.tally.missing > 0 && `한 번도 안 찍은 사람 ${s.tally.missing}명`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  . 종이 서명이 있으면 참석은 증명됩니다 — 체류시간만 확인되지 않은
                  것이니 추측해 채우지 마세요.
                </p>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {s.phase === "BEFORE" && (
                  <form action={toggleAction}>
                    <input type="hidden" name="sessionId" value={s.id} />
                    <input type="hidden" name="to" value="open" />
                    <button type="submit" disabled={toggling} className="btn-primary">
                      {toggling ? "처리 중…" : "스캔 열기"}
                    </button>
                  </form>
                )}
                {s.phase === "OPEN" && (
                  <form action={toggleAction}>
                    <input type="hidden" name="sessionId" value={s.id} />
                    <input type="hidden" name="to" value="close" />
                    <button type="submit" disabled={toggling} className="btn-secondary">
                      {toggling ? "처리 중…" : "마감하기"}
                    </button>
                  </form>
                )}
                {s.phase !== "CLOSED" && (
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-secondary"
                  >
                    스캔 화면 열기
                  </a>
                )}
                {s.tally.started === 0 && (
                  <form action={deleteAction}>
                    <input type="hidden" name="sessionId" value={s.id} />
                    <button
                      type="submit"
                      disabled={deleting}
                      className="text-sm text-slate-500 underline underline-offset-2"
                    >
                      지우기
                    </button>
                  </form>
                )}
              </div>

              {s.phase !== "CLOSED" && (
                <p className="mt-2 break-all text-xs text-slate-400">{s.url}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* --- 회차 만들기 ---------------------------------------------------- */}
      <form action={createAction} className="space-y-3 border-t border-slate-200 pt-4">
        <input type="hidden" name="siteId" value={siteId} />
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="contents" value={defaultContents.join("\n")} />

        <p className="text-sm font-semibold text-slate-900">
          {siteName}에 회차 만들기
        </p>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="eduDate">
              교육일
            </label>
            <input
              id="eduDate"
              name="eduDate"
              type="date"
              defaultValue={defaultEduDate}
              className="field"
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="place">
              장소
            </label>
            <input id="place" name="place" className="field" placeholder="진천공장 식당" />
          </div>
          <div>
            <label className="label" htmlFor="instructor">
              강사
            </label>
            <input
              id="instructor"
              name="instructor"
              className="field"
              placeholder="성명 / 직책"
            />
          </div>
        </div>

        <button type="submit" disabled={creating} className="btn-secondary w-full py-2.5">
          {creating ? "만드는 중…" : "회차 만들기"}
        </button>
        <p className="text-xs text-slate-500">
          만들면 QR이 생기고, 서명부를 뽑을 때 첫 장에 함께 인쇄됩니다. 스캔은{" "}
          <strong>교육을 시작할 때 열어야</strong> 받습니다 — 미리 열어 두면 교육
          전에 찍은 시각이 시작 시각으로 남습니다.
        </p>
      </form>
    </section>
  );
}

function Stat({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd
        className={`font-bold tabular-nums ${warn ? "text-amber-700" : "text-slate-900"}`}
      >
        {value}
      </dd>
    </div>
  );
}
