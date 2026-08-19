import { describe, expect, it } from "vitest";
import { checkinWindowState } from "@/lib/tbm";

const site = {
  checkinFrom: 360, // 06:00
  checkinUntil: 600, // 10:00
  lateAfterMinute: 510, // 08:30
};

/** KST 벽시계 시각을 실제 Date로 (UTC = KST - 9h) */
function kst(day: string, hh: number, mm: number): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - 9 * 60 * 60 * 1000);
}

describe("checkinWindowState", () => {
  it("05:30에는 아직 닫혀 있다", () => {
    const s = checkinWindowState(site, kst("2026-08-18", 5, 30));
    expect(s.open).toBe(false);
    expect(s.reason).toContain("06:00");
  });

  it("06:00 정각에 열린다", () => {
    const s = checkinWindowState(site, kst("2026-08-18", 6, 0));
    expect(s.open).toBe(true);
    expect(s.late).toBe(false);
  });

  it("08:00 체크인은 정상 참석", () => {
    const s = checkinWindowState(site, kst("2026-08-18", 8, 0));
    expect(s.open).toBe(true);
    expect(s.late).toBe(false);
  });

  it("08:30 정각까지는 지각이 아니다", () => {
    const s = checkinWindowState(site, kst("2026-08-18", 8, 30));
    expect(s.open).toBe(true);
    expect(s.late).toBe(false);
  });

  it("08:31 체크인은 지각으로 표시된다", () => {
    const s = checkinWindowState(site, kst("2026-08-18", 8, 31));
    expect(s.open).toBe(true);
    expect(s.late).toBe(true);
  });

  it("10:00까지는 아직 받는다", () => {
    expect(checkinWindowState(site, kst("2026-08-18", 10, 0)).open).toBe(true);
  });

  it("10:01부터는 닫히고 사유가 붙는다", () => {
    const s = checkinWindowState(site, kst("2026-08-18", 10, 1));
    expect(s.open).toBe(false);
    expect(s.reason).toContain("10:00");
  });
});
