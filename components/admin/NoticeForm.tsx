"use client";

import { useActionState, useState } from "react";
import {
  createNoticeAction,
  updateNoticeAction,
  type ActionResult,
} from "@/actions/notice";
import { NOTICE_KIND_LABEL, type NoticeKind } from "@/lib/notice";

const IDLE: ActionResult = { error: null };

export type SiteOption = { id: string; name: string; factory: string };
export type SessionOption = { id: string; label: string };

export type NoticeDraft = {
  id: string;
  kind: NoticeKind;
  title: string;
  body: string | null;
  /** "YYYY-MM-DD" */
  startsOn: string;
  endsOn: string;
  needsAck: boolean;
  siteIds: string[];
  legalEduSessionId: string | null;
};

const KINDS: NoticeKind[] = ["TIDY", "RESULT", "SCHEDULE"];

const KIND_HINT: Record<NoticeKind, string> = {
  TIDY: "기숙사·식단 정리정돈, 분리수거처럼 바로 치워야 하는 일",
  RESULT: "위험성평가 결과, 작업환경측정 결과처럼 알려야 하는 결과",
  SCHEDULE: "법정의무교육 일정",
};

/**
 * 공지 올리기·고치기 폼.
 *
 * 사진은 여기서 받지 않는다. 저장해서 id가 생긴 뒤에 붙인다 — 어디에 붙일지
 * 정해지기 전에 파일을 받으면 주인 없는 파일이 남는다. 그래서 새로 올릴 때는
 * 저장 후 목록에서 사진을 올리라고 알려 준다.
 */
export default function NoticeForm({
  sites,
  sessions,
  draft,
}: {
  sites: SiteOption[];
  /** 아직 하지 않은 법정의무교육 회차. 일정 공지에서 골라 잇는다. */
  sessions: SessionOption[];
  /** 있으면 고치기, 없으면 새로 올리기 */
  draft?: NoticeDraft;
}) {
  const editing = draft !== undefined;
  const [state, action, pending] = useActionState(
    editing ? updateNoticeAction : createNoticeAction,
    IDLE,
  );
  const [kind, setKind] = useState<NoticeKind>(draft?.kind ?? "TIDY");

  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const plus = (days: number) => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() + days);
    return iso(d);
  };

  // 공장별로 묶어 보여 준다. 진천 네 법인을 한 번에 고르는 것이 가장 흔한 일이다.
  const byFactory = new Map<string, SiteOption[]>();
  for (const s of sites) {
    const list = byFactory.get(s.factory) ?? [];
    list.push(s);
    byFactory.set(s.factory, list);
  }

  return (
    <form action={action} className="space-y-4">
      {editing && <input type="hidden" name="id" value={draft.id} />}

      <div>
        <span className="label">분류</span>
        <div className="mt-1 flex flex-wrap gap-2">
          {KINDS.map((k) => (
            <label
              key={k}
              className={`cursor-pointer rounded-lg px-3 py-2 text-sm font-semibold ring-1 ring-inset ${
                kind === k
                  ? "bg-slate-900 text-white ring-slate-900"
                  : "bg-white text-slate-700 ring-slate-300"
              }`}
            >
              <input
                type="radio"
                name="kind"
                value={k}
                checked={kind === k}
                onChange={() => setKind(k)}
                className="sr-only"
              />
              {NOTICE_KIND_LABEL[k]}
            </label>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-slate-500">{KIND_HINT[kind]}</p>
      </div>

      <div>
        <label className="label" htmlFor={`title-${draft?.id ?? "new"}`}>
          제목
        </label>
        <input
          id={`title-${draft?.id ?? "new"}`}
          name="title"
          defaultValue={draft?.title ?? ""}
          maxLength={120}
          placeholder="기숙사 분리수거 미흡"
          className="field"
          required
        />
      </div>

      <div>
        <label className="label" htmlFor={`body-${draft?.id ?? "new"}`}>
          내용 <span className="font-normal text-slate-400">(사진만 올릴 때는 비워도 됩니다)</span>
        </label>
        <textarea
          id={`body-${draft?.id ?? "new"}`}
          name="body"
          defaultValue={draft?.body ?? ""}
          rows={3}
          placeholder={"음식물과 플라스틱을 나눠 버려 주세요.\n분리수거장 사진을 함께 올립니다."}
          className="field"
        />
        <p className="mt-1.5 text-xs text-slate-500">
          읽는 사람 절반이 외국인 근로자입니다. 짧게 쓰고 사진으로 보여 주는 쪽이
          전달됩니다.
        </p>
      </div>

      {kind === "SCHEDULE" && (
        <div>
          <label className="label" htmlFor={`session-${draft?.id ?? "new"}`}>
            교육 회차 이어 붙이기
          </label>
          <select
            id={`session-${draft?.id ?? "new"}`}
            name="legalEduSessionId"
            defaultValue={draft?.legalEduSessionId ?? ""}
            className="field"
          >
            <option value="">잇지 않음</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-slate-500">
            이으면 교육일·장소·강사를 회차에서 읽어 찍습니다. 공지에 날짜를 적지
            마세요 — 회차를 고치면 공지가 어긋납니다.
            {sessions.length === 0 && " 지금은 예정된 회차가 없습니다."}
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={`starts-${draft?.id ?? "new"}`}>
            게시 시작일
          </label>
          <input
            id={`starts-${draft?.id ?? "new"}`}
            name="startsOn"
            type="date"
            defaultValue={draft?.startsOn ?? iso(today)}
            className="field"
            required
          />
        </div>
        <div>
          <label className="label" htmlFor={`ends-${draft?.id ?? "new"}`}>
            게시 종료일
          </label>
          <input
            id={`ends-${draft?.id ?? "new"}`}
            name="endsOn"
            type="date"
            defaultValue={draft?.endsOn ?? plus(14)}
            className="field"
            required
          />
        </div>
      </div>

      <div>
        <span className="label">
          받을 법인 <span className="font-normal text-slate-400">(아무것도 고르지 않으면 전사)</span>
        </span>
        <div className="mt-1.5 space-y-2.5">
          {[...byFactory.entries()].map(([factory, list]) => (
            <div key={factory}>
              <p className="text-xs font-semibold text-slate-500">{factory}</p>
              <div className="mt-1 grid gap-1.5 sm:grid-cols-2">
                {list.map((s) => (
                  <label
                    key={s.id}
                    className="flex items-center gap-2 rounded-lg bg-white px-2.5 py-2 text-sm ring-1 ring-slate-200"
                  >
                    <input
                      type="checkbox"
                      name="siteIds"
                      value={s.id}
                      defaultChecked={draft?.siteIds.includes(s.id) ?? false}
                      className="size-4"
                    />
                    <span className="min-w-0 truncate text-slate-800">{s.name}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <label className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2.5 ring-1 ring-slate-200">
        <input
          type="checkbox"
          name="needsAck"
          defaultChecked={draft?.needsAck ?? true}
          className="mt-0.5 size-4"
        />
        <span className="text-sm text-slate-800">
          읽음 확인을 받습니다
          <span className="mt-0.5 block text-xs text-slate-500">
            근로자 화면에 &ldquo;확인했습니다&rdquo; 버튼이 붙고, 누가 언제 읽었는지
            남습니다. 위험성평가·작업환경측정 결과는 알렸다는 증빙이 되므로 켜 두세요.
          </span>
        </span>
      </label>

      {state.error && (
        <p className="rounded-lg bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-800 ring-1 ring-rose-200">
          {state.error}
        </p>
      )}

      {state.ok && !editing && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2.5 text-sm font-medium text-emerald-800 ring-1 ring-emerald-200">
          올렸습니다. 사진은 아래 목록에서 붙여 주세요.
        </p>
      )}

      <button type="submit" disabled={pending} className="btn-primary w-full">
        {pending ? "저장 중…" : editing ? "고치기" : "공지 올리기"}
      </button>
    </form>
  );
}
