import { cache } from "react";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { kstDateOnly, parseYmd, ymd } from "@/lib/kst";
import { visibleNotices, type NoticeKind } from "@/lib/notice";

/**
 * 공지사항을 DB에서 읽어 온다.
 *
 * 묶음 기준은 법인(Site)이다. 전일 공유와 다르다 — 요약본은 공장에서 난 일을
 * 나누는 것이라 주소로 묶지만, 공지는 본사가 "누구에게 보낼지"를 직접 고른
 * 것이므로 고른 그대로 따른다. 진천 네 법인을 다 고르면 공장 단위가 되고,
 * 아무것도 안 고르면 전사가 된다.
 *
 * 한 요청 안에서는 같은 결과를 다시 묻지 않는다(cache). QR 화면은 한 번만
 * 그리지만 TBM 목록처럼 한 요청에서 여러 법인을 도는 자리가 생기면 건마다
 * 같은 질의가 나간다. Date는 건마다 새 객체라 cache 열쇠로 못 쓰므로 날짜를
 * 글자로 바꿔 넘긴다 — 요약본에서 겪은 것과 같은 함정이다.
 */

/** 화면이 쓰는 공지 한 건. 읽음 여부는 따로 붙인다. */
export type NoticeBase = {
  id: string;
  kind: NoticeKind;
  title: string;
  body: string | null;
  startsOn: Date;
  endsOn: Date;
  needsAck: boolean;
  /** 이어 붙인 교육 회차의 id. 고치기 폼이 그대로 들고 있어야 한다. */
  legalEduSessionId: string | null;
  /** 받을 법인. 비어 있으면 전사. */
  siteIds: string[];
  photos: { id: string; url: string }[];
  /** 이어 붙인 법정의무교육 회차. 일자·장소·강사를 여기서 읽는다. */
  session: {
    title: string;
    eduDate: Date;
    place: string | null;
    instructor: string | null;
  } | null;
};

export type NoticeView = NoticeBase & {
  /** 이 근로자가 읽은 시각. 안 읽었거나 근로자를 모르면 null. */
  readAt: Date | null;
};

const SELECT = {
  sites: { select: { siteId: true } },
  photos: {
    orderBy: [{ sort: "asc" }, { uploadedAt: "asc" }],
    select: { id: true, url: true },
  },
  legalEduSession: {
    select: { title: true, eduDate: true, place: true, instructor: true },
  },
} satisfies Prisma.NoticeInclude;

type Row = {
  id: string;
  kind: NoticeKind;
  title: string;
  body: string | null;
  startsOn: Date;
  endsOn: Date;
  needsAck: boolean;
  legalEduSessionId: string | null;
  sites: { siteId: string }[];
  photos: { id: string; url: string }[];
  legalEduSession: {
    title: string;
    eduDate: Date;
    place: string | null;
    instructor: string | null;
  } | null;
};

function toBase(r: Row): NoticeBase {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    startsOn: r.startsOn,
    endsOn: r.endsOn,
    needsAck: r.needsAck,
    legalEduSessionId: r.legalEduSessionId,
    siteIds: r.sites.map((s) => s.siteId),
    photos: r.photos,
    session: r.legalEduSession,
  };
}

// cache()는 인수를 같은 값인지로 본다. 배열은 건마다 새 객체라 안 맞으므로
// 법인 목록도 글자 하나로 묶어 넘긴다. 날짜를 글자로 바꾸는 것과 같은 이유다.
const postedFor = cache(async (siteKey: string, todayYmd: string): Promise<NoticeBase[]> => {
  const today = parseYmd(todayYmd);
  const rows = await prisma.notice.findMany({
    // 날짜는 DB에서 먼저 거른다. 지난 공지가 쌓여도 읽어 오는 양이 늘지 않는다.
    where: { startsOn: { lte: today }, endsOn: { gte: today } },
    include: SELECT,
  });
  // 대상 거르기와 순서는 lib/notice.ts 하나에서만 정한다.
  return visibleNotices(rows.map(toBase), siteKey.split(","), today);
});

/**
 * 오늘 띄울 공지.
 *
 * 법인을 목록으로 받는다 — 공용 QR은 법인 넷을 덮고, 체크인 전에는 보는 사람
 * 법인을 알 수 없다. 본인이 식별되면 그 사람 법인 하나만 넘기는 쪽이 정확하다.
 *
 * workerId가 null이면 읽음 여부를 모른다 — 처음 찍는 폰처럼 쿠키가 없는
 * 경우다. 그때는 확인 버튼 대신 안내를 띄운다.
 */
export async function loadNoticesFor(
  siteIds: string[],
  workerId: string | null,
  now: Date = new Date(),
): Promise<NoticeView[]> {
  if (siteIds.length === 0) return [];
  const list = await postedFor([...siteIds].sort().join(","), ymd(kstDateOnly(now)));
  if (list.length === 0) return [];
  if (!workerId) return list.map((n) => ({ ...n, readAt: null }));

  const reads = await prisma.noticeRead.findMany({
    where: { workerId, noticeId: { in: list.map((n) => n.id) } },
    select: { noticeId: true, readAt: true },
  });
  const by = new Map(reads.map((r) => [r.noticeId, r.readAt]));
  return list.map((n) => ({ ...n, readAt: by.get(n.id) ?? null }));
}

/** 관리 화면에 쓸 한 건. 읽음 수와 대상 인원이 붙는다. */
export type NoticeAdminView = NoticeBase & {
  siteNames: string[];
  createdByName: string | null;
  createdAt: Date;
  readCount: number;
  /** 읽어야 할 사람 수. 대상 법인의 재직 근로자 수다. */
  targetCount: number;
};

/**
 * 관리 화면용 전체 목록. 지난 것까지 모두 가져온다.
 *
 * 공지 건수가 많아질 자리가 아니다 — 주 몇 건이고 기간이 지나도 행은 남는다.
 * 수천 건이 되면 그때 기간으로 끊는다.
 */
export async function loadAllNotices(): Promise<NoticeAdminView[]> {
  const [rows, sites, counts] = await Promise.all([
    prisma.notice.findMany({
      include: {
        ...SELECT,
        createdBy: { select: { name: true } },
        _count: { select: { reads: true } },
      },
      orderBy: [{ startsOn: "desc" }, { createdAt: "desc" }],
    }),
    prisma.site.findMany({ select: { id: true, name: true }, orderBy: { code: "asc" } }),
    prisma.worker.groupBy({
      by: ["siteId"],
      where: { active: true },
      _count: { _all: true },
    }),
  ]);

  const nameById = new Map(sites.map((s) => [s.id, s.name]));
  const workersBySite = new Map(counts.map((c) => [c.siteId, c._count._all]));
  const allWorkers = counts.reduce((sum, c) => sum + c._count._all, 0);

  return rows.map((r) => {
    const base = toBase(r);
    // 대상이 비면 전사다. 그때 읽어야 할 사람은 재직 근로자 전원이다.
    const targetCount =
      base.siteIds.length === 0
        ? allWorkers
        : base.siteIds.reduce((sum, id) => sum + (workersBySite.get(id) ?? 0), 0);

    return {
      ...base,
      siteNames: base.siteIds.map((id) => nameById.get(id) ?? "(삭제된 사업장)"),
      createdByName: r.createdBy?.name ?? null,
      createdAt: r.createdAt,
      readCount: r._count.reads,
      targetCount,
    };
  });
}
