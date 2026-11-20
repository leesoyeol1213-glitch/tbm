import Link from "next/link";
import { requireRole } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { kstDateOnly, ymd } from "@/lib/kst";
import { emergencyFor } from "@/lib/emergency";
import { sessionPhase } from "@/lib/legalEdu";
import {
  NOTICE_KIND_LABEL,
  ackRate,
  isPosted,
  isUpcoming,
  targetLabel,
  type NoticeKind,
} from "@/lib/notice";
import { loadAllNotices, type NoticeAdminView } from "@/lib/noticeData";
import { deleteNoticeAction, endNoticeAction } from "@/actions/notice";
import NoticeForm, {
  type SessionOption,
  type SiteOption,
} from "@/components/admin/NoticeForm";
import NoticePhotos from "@/components/admin/NoticePhotos";
import DeleteButton from "@/components/admin/DeleteButton";
import ConfirmButton from "@/components/admin/ConfirmButton";

export const dynamic = "force-dynamic";

/** app/api/admin/notices/[id]/photos/route.ts 의 MAX_PHOTOS 와 같아야 한다. */
const MAX_PHOTOS = 6;

const KIND_STYLE: Record<NoticeKind, string> = {
  TIDY: "bg-amber-100 text-amber-900 ring-amber-300",
  RESULT: "bg-sky-100 text-sky-900 ring-sky-300",
  SCHEDULE: "bg-slate-100 text-slate-700 ring-slate-300",
};

const ymdOf = ymd;

export default async function NoticesPage() {
  await requireRole("HQ_ADMIN");

  const [notices, siteRows, sessionRows] = await Promise.all([
    loadAllNotices(),
    prisma.site.findMany({
      where: { active: true },
      select: { id: true, name: true, address: true },
      orderBy: { code: "asc" },
    }),
    // 아직 하지 않은 회차만 고를 수 있게 한다. 지난 교육 일정을 공지해 봐야
    // 쓸 데가 없고, 고를 것이 많아지면 엉뚱한 회차를 잇는다.
    prisma.legalEduSession.findMany({
      where: { openedAt: null, closedAt: null, eduDate: { gte: kstDateOnly() } },
      select: {
        id: true,
        title: true,
        eduDate: true,
        openedAt: true,
        closedAt: true,
        site: { select: { name: true } },
      },
      orderBy: { eduDate: "asc" },
    }),
  ]);

  const sites: SiteOption[] = siteRows.map((s) => ({
    id: s.id,
    name: s.name,
    // 연락망에 등록된 공장이면 그 이름으로 묶는다. 아니면 주소로 묶는다 —
    // 공장 이름을 추측해 붙이지 않는다.
    factory: emergencyFor(s.address)?.factory ?? s.address?.trim() ?? "주소 미등록",
  }));

  const sessions: SessionOption[] = sessionRows
    .filter((s) => sessionPhase(s) === "BEFORE")
    .map((s) => ({
      id: s.id,
      label: `${ymdOf(s.eduDate)} · ${s.site.name} · ${s.title}`,
    }));

  const today = kstDateOnly();
  const posted = notices.filter((n) => isPosted(n, today));
  const upcoming = notices.filter((n) => isUpcoming(n, today));
  const past = notices.filter((n) => !isPosted(n, today) && !isUpcoming(n, today));

  return (
    <div className="space-y-5">
      <header>
        <Link href="/admin" className="text-sm text-slate-500 underline underline-offset-2">
          ← 관리
        </Link>
        <h1 className="mt-1 text-xl font-bold text-slate-900">공지사항</h1>
        <p className="mt-1 text-sm text-slate-600">
          근로자가 출석 QR을 찍을 때 전일 공유 아래에 보입니다. 팀장 TBM 화면에도
          같이 뜹니다.
        </p>
      </header>

      <section className="card">
        <h2 className="font-bold text-slate-900">새 공지 올리기</h2>
        <div className="mt-3">
          <NoticeForm sites={sites} sessions={sessions} />
        </div>
      </section>

      <Group
        title="게시 중"
        desc="지금 근로자 화면에 보이고 있습니다."
        notices={posted}
        sites={sites}
        sessions={sessions}
        canEnd
      />
      <Group
        title="게시 예정"
        desc="시작일이 되면 저절로 보입니다."
        notices={upcoming}
        sites={sites}
        sessions={sessions}
      />
      <Group
        title="지난 공지"
        desc="내려갔지만 기록은 남습니다. 무엇을 언제 알렸는지가 증빙입니다."
        notices={past}
        sites={sites}
        sessions={sessions}
      />
    </div>
  );
}

function Group({
  title,
  desc,
  notices,
  sites,
  sessions,
  canEnd = false,
}: {
  title: string;
  desc: string;
  notices: NoticeAdminView[];
  sites: SiteOption[];
  sessions: SessionOption[];
  canEnd?: boolean;
}) {
  return (
    <section className="card">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="font-bold text-slate-900">{title}</h2>
        <p className="text-xs text-slate-500">{notices.length}건</p>
      </div>
      <p className="mt-0.5 text-xs text-slate-500">{desc}</p>

      {notices.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">없습니다.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {notices.map((n) => (
            <Row
              key={n.id}
              notice={n}
              sites={sites}
              sessions={sessions}
              canEnd={canEnd}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function Row({
  notice: n,
  sites,
  sessions,
  canEnd,
}: {
  notice: NoticeAdminView;
  sites: SiteOption[];
  sessions: SessionOption[];
  canEnd: boolean;
}) {
  const rate = ackRate(n.readCount, n.targetCount);

  return (
    <li className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
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

      <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
        <div className="flex gap-1.5">
          <dt className="text-slate-500">기간</dt>
          <dd className="text-slate-800">
            {ymdOf(n.startsOn)} ~ {ymdOf(n.endsOn)}
          </dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-slate-500">대상</dt>
          <dd className="text-slate-800">{targetLabel(n.siteNames)}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-slate-500">읽음</dt>
          <dd className="text-slate-800">
            {n.needsAck ? (
              <>
                {n.readCount} / {n.targetCount}명
                {rate !== null && <span className="ml-1 text-slate-500">({rate}%)</span>}
              </>
            ) : (
              <span className="text-slate-500">확인 안 받음</span>
            )}
          </dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-slate-500">올린 사람</dt>
          <dd className="text-slate-800">{n.createdByName ?? "(삭제된 계정)"}</dd>
        </div>
      </dl>

      {n.body && (
        <p className="mt-2 text-sm whitespace-pre-line text-slate-700">{n.body}</p>
      )}

      <NoticePhotos noticeId={n.id} photos={n.photos} max={MAX_PHOTOS} />

      <details className="mt-3">
        <summary className="cursor-pointer text-sm font-semibold text-slate-700">
          내용 고치기
        </summary>
        <div className="mt-3 border-t border-slate-200 pt-3">
          <NoticeForm
            sites={sites}
            sessions={sessions}
            draft={{
              id: n.id,
              kind: n.kind,
              title: n.title,
              body: n.body,
              startsOn: ymdOf(n.startsOn),
              endsOn: ymdOf(n.endsOn),
              needsAck: n.needsAck,
              siteIds: n.siteIds,
              legalEduSessionId: n.legalEduSessionId,
            }}
          />
        </div>
      </details>

      <div className="mt-3 flex flex-wrap items-start gap-3 border-t border-slate-200 pt-3">
        {canEnd && (
          <ConfirmButton
            action={endNoticeAction}
            fields={{ id: n.id }}
            question="지금 내립니다. 기록과 읽음은 그대로 남습니다."
            label="지금 내리기"
            confirmLabel="내리기"
          />
        )}
        <DeleteButton
          action={deleteNoticeAction}
          fields={{ id: n.id }}
          question="공지와 사진, 읽음 기록까지 모두 지웁니다. 되돌릴 수 없습니다."
        />
      </div>
    </li>
  );
}
