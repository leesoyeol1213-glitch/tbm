import { describe, expect, it } from "vitest";
import {
  APPROVED_CAP,
  PAPER_STATES,
  countFor,
  isPaperState,
  paperFilter,
} from "@/lib/approved";

describe("APPROVED_CAP", () => {
  it("한 달치를 담고도 남는다", () => {
    // 12개 팀 × 22일 = 264건에 순찰일지가 더해진다. 예전 상한 200건은 모자랐다.
    expect(APPROVED_CAP).toBeGreaterThan(264 + 20);
  });
});

describe("isPaperState", () => {
  it("아는 값만 통과시킨다", () => {
    for (const s of PAPER_STATES) expect(isPaperState(s)).toBe(true);
    expect(isPaperState("signed")).toBe(false);
    expect(isPaperState("")).toBe(false);
  });
});

describe("paperFilter", () => {
  it("대기는 서명 시각이 비어 있는 것만 본다", () => {
    expect(paperFilter("waiting")).toEqual({ paperSignedAt: null });
  });

  it("완료는 서명 시각이 있는 것만 본다", () => {
    expect(paperFilter("done")).toEqual({ paperSignedAt: { not: null } });
  });

  it("전체는 아무것도 거르지 않는다", () => {
    expect(paperFilter("all")).toEqual({});
  });
});

describe("countFor", () => {
  it("대기와 완료를 더하면 전체가 된다", () => {
    const total = 285;
    const waiting = 197;
    expect(countFor("waiting", total, waiting)).toBe(197);
    expect(countFor("done", total, waiting)).toBe(88);
    expect(
      countFor("waiting", total, waiting) + countFor("done", total, waiting),
    ).toBe(countFor("all", total, waiting));
  });

  it("한 건도 표시하지 않은 달은 전부 대기다", () => {
    // 8월이 그랬다. 승인 24건에 수기결재 표시는 0건.
    expect(countFor("waiting", 24, 24)).toBe(24);
    expect(countFor("done", 24, 24)).toBe(0);
  });
});
