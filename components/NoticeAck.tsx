"use client";

import { useActionState } from "react";
import { ackNoticeAction, type AckResult } from "@/actions/notice";

const IDLE: AckResult = { error: null };

/**
 * 공지를 읽었다고 찍는 버튼.
 *
 * 본인이 누구인지는 체크인 때 심어 둔 쿠키로 서버가 안다. 여기서 workerId를
 * 보내지 않는 이유가 그것이다 — 폼이 보내는 값을 믿으면 남의 이름으로 읽음을
 * 찍을 수 있고, 그러면 "알렸다"는 증빙이 아니게 된다.
 *
 * 쿠키가 없으면 버튼을 띄우지 않는다. 처음 찍는 폰이 그런 경우인데, 출석을
 * 누르면 쿠키가 생기고 화면이 다시 그려져 버튼이 나타난다.
 */
export default function NoticeAck({
  noticeId,
  readAt,
  identified,
}: {
  noticeId: string;
  /** 이미 읽었으면 그 날짜 글자. 안 읽었으면 null. */
  readAt: string | null;
  identified: boolean;
}) {
  const [state, action, pending] = useActionState(ackNoticeAction, IDLE);

  // 서버가 기록을 남겼으면 다시 그려질 때 readAt이 채워진다. 그 전에도
  // 누른 사람 눈에는 바로 바뀌어야 하므로 액션 결과를 함께 본다.
  const done = readAt ?? state.readAt ?? null;

  if (done) {
    return (
      <p className="mt-2 text-xs font-semibold text-emerald-700">읽음 · {done}</p>
    );
  }

  if (!identified) {
    return (
      <p className="mt-2 text-xs text-slate-500">출석 체크를 하면 확인할 수 있습니다.</p>
    );
  }

  return (
    <form action={action} className="mt-2">
      <input type="hidden" name="noticeId" value={noticeId} />
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white active:bg-slate-700 disabled:opacity-50"
      >
        {pending ? "처리 중…" : "확인했습니다"}
      </button>
      {state.error && (
        <p className="mt-1.5 text-xs font-medium text-rose-700">{state.error}</p>
      )}
    </form>
  );
}
