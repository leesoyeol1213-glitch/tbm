/**
 * 모든 날짜 계산은 KST(UTC+9) 기준으로 한다.
 * Vercel 서버는 UTC로 동작하므로 서버 로컬 시간을 절대 신뢰하지 않는다.
 *
 * Tbm.workDate 는 Prisma `@db.Date` 라서 "UTC 자정 Date"로 오간다.
 * 즉 KST 달력 날짜 2026-08-18 → Date(2026-08-18T00:00:00Z) 로 표현한다.
 */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function toKstParts(at: Date) {
  return new Date(at.getTime() + KST_OFFSET_MS);
}

/** 주어진 시각(기본 지금)의 KST 달력 날짜를 UTC 자정 Date로 반환 */
export function kstDateOnly(at: Date = new Date()): Date {
  const k = toKstParts(at);
  return new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()));
}

/** "YYYY-MM-DD" */
export function ymd(at: Date): string {
  return toKstParts(at).toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" → UTC 자정 Date */
export function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** KST 기준 자정으로부터 흐른 분 (08:30 → 510) */
export function kstMinuteOfDay(at: Date): number {
  const k = toKstParts(at);
  return k.getUTCHours() * 60 + k.getUTCMinutes();
}

/** 510 → "08:30" */
export function minuteLabel(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "08:32" */
export function timeLabel(at: Date): string {
  return minuteLabel(kstMinuteOfDay(at));
}

/** "2026-08-18 08:32" */
export function dateTimeLabel(at: Date): string {
  return `${ymd(at)} ${timeLabel(at)}`;
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** "2026-08-18 (화)" — @db.Date 값에도 안전하게 쓸 수 있다 */
export function dateLabel(at: Date): string {
  const k = toKstParts(at);
  return `${ymd(at)} (${WEEKDAYS[k.getUTCDay()]})`;
}

/** 두 @db.Date 값이 같은 날인지 */
export function sameDay(a: Date, b: Date): boolean {
  return ymd(a) === ymd(b);
}

/** 오늘로부터 n일 전의 UTC 자정 Date */
export function daysAgo(n: number, from: Date = new Date()): Date {
  const base = kstDateOnly(from);
  return new Date(base.getTime() - n * 24 * 60 * 60 * 1000);
}

/** from(포함) ~ to(포함) 사이의 날짜 목록 */
export function dateRange(from: Date, to: Date): Date[] {
  const out: Date[] = [];
  for (let t = from.getTime(); t <= to.getTime(); t += 24 * 60 * 60 * 1000) {
    out.push(new Date(t));
  }
  return out;
}

// --- 결재 기간 -------------------------------------------------------------
//
// 대표가 매일 결재하지 못하고 월·분기 단위로 몰아서 결재하는 경우를 위한 구간이다.
// 작업일(workDate) 기준으로 자르며, 여기서 나온 값도 KST 달력 기준 UTC 자정 Date다.

export type PeriodKey =
  | "this-month"
  | "last-month"
  | "this-quarter"
  | "last-quarter"
  | "all";

export type Period = {
  key: PeriodKey;
  label: string;
  /** null이면 제한 없음 */
  from: Date | null;
  to: Date | null;
};

export const PERIOD_KEYS: PeriodKey[] = [
  "this-month",
  "last-month",
  "this-quarter",
  "last-quarter",
  "all",
];

export function isPeriodKey(v: string): v is PeriodKey {
  return (PERIOD_KEYS as string[]).includes(v);
}

/** 해당 월의 1일 ~ 말일 */
function monthRange(year: number, month0: number): { from: Date; to: Date } {
  return {
    from: new Date(Date.UTC(year, month0, 1)),
    // 다음 달 0일 = 이번 달 말일
    to: new Date(Date.UTC(year, month0 + 1, 0)),
  };
}

export function resolvePeriod(key: PeriodKey, now: Date = new Date()): Period {
  const k = new Date(kstDateOnly(now));
  const y = k.getUTCFullYear();
  const m = k.getUTCMonth();

  switch (key) {
    case "this-month": {
      const r = monthRange(y, m);
      return { key, label: `${y}년 ${m + 1}월`, ...r };
    }
    case "last-month": {
      const d = new Date(Date.UTC(y, m - 1, 1));
      const r = monthRange(d.getUTCFullYear(), d.getUTCMonth());
      return {
        key,
        label: `${d.getUTCFullYear()}년 ${d.getUTCMonth() + 1}월`,
        ...r,
      };
    }
    case "this-quarter": {
      const q = Math.floor(m / 3);
      return {
        key,
        label: `${y}년 ${q + 1}분기`,
        from: new Date(Date.UTC(y, q * 3, 1)),
        to: new Date(Date.UTC(y, q * 3 + 3, 0)),
      };
    }
    case "last-quarter": {
      const q = Math.floor(m / 3) - 1;
      const ly = q < 0 ? y - 1 : y;
      const lq = q < 0 ? 3 : q;
      return {
        key,
        label: `${ly}년 ${lq + 1}분기`,
        from: new Date(Date.UTC(ly, lq * 3, 1)),
        to: new Date(Date.UTC(ly, lq * 3 + 3, 0)),
      };
    }
    case "all":
      return { key, label: "전체", from: null, to: null };
  }
}

export const PERIOD_LABEL: Record<PeriodKey, string> = {
  "this-month": "이번 달",
  "last-month": "지난달",
  "this-quarter": "이번 분기",
  "last-quarter": "지난 분기",
  all: "전체",
};
