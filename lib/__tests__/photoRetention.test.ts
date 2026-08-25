import { describe, expect, it } from "vitest";
import { beforeLabel, pruneCutoff, ymdUtc } from "@/lib/photoRetention";

/** KST 기준 그 시각의 UTC Date */
const kst = (s: string) => new Date(`${s}+09:00`);

describe("pruneCutoff", () => {
  it("이번 달과 지난달을 남긴다", () => {
    // 11월에 부르면 10월 1일이 경계 → 9월 이전이 정리 대상
    expect(ymdUtc(pruneCutoff(kst("2026-11-01T09:00:00")))).toBe("2026-10-01");
    expect(ymdUtc(pruneCutoff(kst("2026-11-30T23:59:00")))).toBe("2026-10-01");
  });

  it("연말을 넘어가도 맞는다", () => {
    expect(ymdUtc(pruneCutoff(kst("2027-01-05T09:00:00")))).toBe("2026-12-01");
  });

  it("KST 자정 직후에도 달이 밀리지 않는다", () => {
    // 서버는 UTC로 도는데 KST 00:30이면 UTC로는 아직 전날 15:30이다.
    expect(ymdUtc(pruneCutoff(kst("2026-11-01T00:30:00")))).toBe("2026-10-01");
  });
});

describe("beforeLabel", () => {
  it("경계가 아니라 대상 달을 말한다", () => {
    // 10월 1일이 경계면 사람에게는 "9월 이전"이라고 말해야 한다.
    expect(beforeLabel(pruneCutoff(kst("2026-11-10T09:00:00")))).toBe("2026년 9월 이전");
    expect(beforeLabel(pruneCutoff(kst("2027-01-10T09:00:00")))).toBe("2026년 11월 이전");
  });
});
