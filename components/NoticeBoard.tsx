import { dateLabel } from "@/lib/kst";
import { NOTICE_KIND_LABEL, type NoticeKind } from "@/lib/notice";
import type { NoticeView } from "@/lib/noticeData";
import NoticeAck from "@/components/NoticeAck";

/**
 * 공지사항 카드.
 *
 * 접지 않는다 — 전일 공유와 같은 이유로, 읽어야 할 내용 자체다. 대신 사진을
 * 작은 썸네일로 줄여 카드가 길어지지 않게 한다. 바로 아래에 비상연락망이
 * 있어서, 공지 하나가 화면을 다 먹으면 연락망이 밀려 아무도 못 찾는다.
 *
 * 꼬리표 색은 요약본(lib/hazardLog의 분류)과 겹치지 않게 골랐다. 둘이 나란히
 * 놓이는 화면이라 같은 색이면 어느 카드 것인지 헷갈린다.
 */
const KIND_STYLE: Record<NoticeKind, string> = {
  TIDY: "bg-amber-100 text-amber-900 ring-amber-300",
  RESULT: "bg-sky-100 text-sky-900 ring-sky-300",
  SCHEDULE: "bg-slate-100 text-slate-700 ring-slate-300",
};

export default function NoticeBoard({
  notices,
  /** 확인 버튼을 띄울지. 팀장 화면에서는 끈다 — 팀장은 Worker가 아니다. */
  canAck = false,
  /** 쿠키로 본인이 식별됐는지. 안 됐으면 버튼 대신 안내를 띄운다. */
  identified = false,
}: {
  notices: NoticeView[];
  canAck?: boolean;
  identified?: boolean;
}) {
  if (notices.length === 0) return null;

  return (
    <section className="card border-l-4 border-l-amber-400">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="font-bold text-slate-900">공지사항</h2>
        <p className="text-xs text-slate-500">{notices.length}건</p>
      </div>

      <ul className="mt-3 space-y-2.5">
        {notices.map((n) => (
          <Row key={n.id} notice={n} canAck={canAck} identified={identified} />
        ))}
      </ul>
    </section>
  );
}

function Row({
  notice: n,
  canAck,
  identified,
}: {
  notice: NoticeView;
  canAck: boolean;
  identified: boolean;
}) {
  return (
    <li className="rounded-lg bg-white px-3 py-2.5 ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${
            KIND_STYLE[n.kind]
          }`}
        >
          {NOTICE_KIND_LABEL[n.kind]}
        </span>
        <span className="min-w-0 flex-1 truncate font-semibold text-slate-900">{n.title}</span>
      </div>

      {/* 교육 일정은 회차에서 읽는다. 공지에 베껴 적지 않는다. */}
      {n.session && (
        <p className="mt-1.5 text-sm font-medium text-slate-700">
          {dateLabel(n.session.eduDate)}
          {n.session.place && ` · ${n.session.place}`}
          {n.session.instructor && ` · ${n.session.instructor}`}
        </p>
      )}

      {n.body && (
        <p className="mt-1.5 text-sm whitespace-pre-line text-slate-800">{n.body}</p>
      )}

      {n.photos.length > 0 && (
        <ul className="mt-2 grid grid-cols-3 gap-1.5">
          {n.photos.map((p) => (
            <li key={p.id}>
              {/* 누르면 원본이 새 창에 열린다. 글을 못 읽는 사람에게는
                  사진이 본문이라 크게 볼 길이 있어야 한다. */}
              <a href={p.url} target="_blank" rel="noopener noreferrer">
                {/* next/image를 쓰지 않는다 — 공지 사진은 외부 블롭 주소이고,
                    여기서 최적화를 걸면 무료 한도의 이미지 변환 횟수를 먹는다. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.url}
                  alt=""
                  loading="lazy"
                  className="aspect-square w-full rounded-md object-cover ring-1 ring-slate-200"
                />
              </a>
            </li>
          ))}
        </ul>
      )}

      {canAck && n.needsAck && (
        <NoticeAck
          noticeId={n.id}
          readAt={n.readAt ? dateLabel(n.readAt) : null}
          identified={identified}
        />
      )}
    </li>
  );
}
