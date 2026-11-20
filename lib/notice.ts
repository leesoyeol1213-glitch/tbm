import { ymd } from "@/lib/kst";

/**
 * 공지사항의 순수 로직.
 *
 * DB도 React도 들이지 않는다. 관리 화면과 근로자 화면, 서버 액션이 모두 같은
 * 규칙으로 걸러야 하므로 거르는 일 자체를 한곳에 둔다. 양쪽에 같은 조건을
 * 적어 두면 한쪽만 고쳐져 남의 법인에 공지가 보이거나 오늘 올린 것이 안 뜬다.
 */

export type NoticeKind = "TIDY" | "RESULT" | "SCHEDULE";

export const NOTICE_KIND_LABEL: Record<NoticeKind, string> = {
  TIDY: "지적",
  RESULT: "결과 공유",
  SCHEDULE: "일정",
};

/**
 * 분류를 세우는 순서.
 *
 * 지적이 앞이다 — 오늘 당장 치워야 하는 일이고, 사진이 있어 눈에 먼저 들어오는
 * 것이 맞다. 결과 공유와 일정은 알아 두라는 것이지 지금 할 일이 아니다.
 */
const KIND_RANK: Record<NoticeKind, number> = { TIDY: 0, RESULT: 1, SCHEDULE: 2 };

/** 게시 기간 기본값. 2주면 두 번은 눈에 띈다. */
export const DEFAULT_POST_DAYS = 14;

/** 시작일에서 기본 게시 기간을 더한 종료일 */
export function defaultEndsOn(startsOn: Date, days: number = DEFAULT_POST_DAYS): Date {
  const d = new Date(startsOn);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/** 거르기에 필요한 최소한의 모양. 화면이 더 들고 있어도 상관없다. */
export type NoticeLike = {
  kind: NoticeKind;
  startsOn: Date;
  endsOn: Date;
  /** 받을 법인. 비어 있으면 전사 공지다. */
  siteIds: string[];
};

/**
 * 오늘 게시 중인지.
 *
 * 양끝을 포함한다 — 시작일 당일에 안 보이면 올린 사람이 올린 날 확인할 수
 * 없고, 종료일 당일에 사라지면 "언제까지"라고 적은 날에 못 보게 된다.
 *
 * 날짜만 비교한다. DB에 @db.Date로 들어가지만 Date 객체로 올라오므로, 시각이
 * 섞인 값이 들어와도 같은 날은 같은 날로 보게 글자로 바꿔 견준다.
 */
export function isPosted(n: Pick<NoticeLike, "startsOn" | "endsOn">, today: Date): boolean {
  const t = ymd(today);
  return ymd(n.startsOn) <= t && t <= ymd(n.endsOn);
}

/** 아직 시작하지 않은 공지인지 */
export function isUpcoming(n: Pick<NoticeLike, "startsOn">, today: Date): boolean {
  return ymd(today) < ymd(n.startsOn);
}

/**
 * 보는 쪽이 받을 공지인지.
 *
 * 보는 쪽을 법인 하나가 아니라 목록으로 받는다. 진천 출하 게이트의 QR 하나가
 * 법인 넷의 명부를 함께 받고 있어서, 아직 체크인하지 않은 사람은 자기 법인이
 * 어디인지 화면이 알지 못한다. 그때는 그 QR이 덮는 법인을 다 넣어 본다 —
 * 옆 법인 공지가 섞여 보이는 쪽이, 자기 법인 공지를 못 보는 쪽보다 낫다.
 *
 * 대상이 비어 있으면 전사다. 법인을 하나도 안 고르는 것은 실수가 아니라
 * "전부에게"라는 뜻으로 쓴다 — 화면에서도 그렇게 적어 둔다.
 */
export function targets(n: Pick<NoticeLike, "siteIds">, viewerSiteIds: string[]): boolean {
  if (n.siteIds.length === 0) return true;
  return n.siteIds.some((id) => viewerSiteIds.includes(id));
}

/**
 * 오늘 띄울 공지를 고른다.
 *
 * 분류 순서로 세우고, 같은 분류 안에서는 늦게 시작한 것을 앞에 둔다. 새로
 * 올린 것이 위로 와야 어제 본 것을 또 읽지 않는다.
 */
export function visibleNotices<T extends NoticeLike>(
  notices: T[],
  viewerSiteIds: string[],
  today: Date,
): T[] {
  return notices
    .filter((n) => targets(n, viewerSiteIds) && isPosted(n, today))
    .sort((a, b) => {
      const byKind = KIND_RANK[a.kind] - KIND_RANK[b.kind];
      if (byKind !== 0) return byKind;
      return ymd(b.startsOn).localeCompare(ymd(a.startsOn));
    });
}

/**
 * 읽음 비율. 대상 인원이 0명이면 null — 0%로 적으면 아무도 안 읽은 것처럼
 * 보이는데, 실제로는 읽을 사람이 없는 것이다.
 */
export function ackRate(read: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((read / total) * 100);
}

/** 대상 칸에 적을 말 */
export function targetLabel(siteNames: string[]): string {
  if (siteNames.length === 0) return "전사";
  if (siteNames.length <= 2) return siteNames.join(" · ");
  return `${siteNames[0]} 외 ${siteNames.length - 1}곳`;
}
