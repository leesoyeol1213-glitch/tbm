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
