/**
 * 사진 보관 기간 규칙.
 *
 * 무료 저장 용량의 병목은 사진뿐이다. 텍스트 기록은 15년을 둬도 안 차므로
 * 지우지 않는다. 사진만 두 달치를 남기고, 그보다 오래된 것은 백업한 뒤
 * 원본 파일을 지운다. 촬영 시각·좌표·경고는 DB에 그대로 남아 사진이 없어도
 * 그 사진에 무엇이 걸려 있었는지는 계속 확인된다.
 *
 * 자동으로 지우지 않는다. 시점만 알려 주고 지우는 것은 사람이 한다 —
 * 백업이 되어 있는지는 시스템이 대신 판단할 수 없기 때문이다.
 */

/** 남겨 둘 개월 수. 이번 달과 지난달. */
export const KEEP_MONTHS = 2;

/** KST 기준 그 달의 1일 00:00 (UTC Date로) */
function monthStartKst(year: number, monthIndex0: number): Date {
  // KST 자정은 UTC 전날 15:00이다.
  return new Date(Date.UTC(year, monthIndex0, 1, -9, 0, 0, 0));
}

/**
 * 이 날짜보다 이전 작업일의 사진이 정리 대상이다.
 *
 * 11월에 부르면 10월 1일을 돌려준다 → 9월 이전이 대상.
 */
export function pruneCutoff(now: Date = new Date()): Date {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return monthStartKst(kst.getUTCFullYear(), kst.getUTCMonth() - (KEEP_MONTHS - 1));
}

/** "2026-10-01" 형태. 스크립트에 그대로 넘길 수 있게. */
export function ymdUtc(d: Date): string {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

/** 사람이 읽는 기간 표시. "2026년 9월 이전" */
export function beforeLabel(cutoff: Date): string {
  const kst = new Date(cutoff.getTime() + 9 * 60 * 60 * 1000);
  // 대상은 cutoff "이전"이므로 한 달 앞을 가리켜 말한다.
  const y = kst.getUTCFullYear();
  const m = kst.getUTCMonth(); // 0-based, 이미 한 달 앞
  const prev = m === 0 ? { y: y - 1, m: 12 } : { y, m };
  return `${prev.y}년 ${prev.m}월 이전`;
}

/** 장수와 평균 크기로 대략적인 용량을 말한다. 실제 바이트는 재지 않는다. */
export const AVG_PHOTO_KB = 180;

export function approxMb(count: number): string {
  return ((count * AVG_PHOTO_KB) / 1024).toFixed(1);
}
