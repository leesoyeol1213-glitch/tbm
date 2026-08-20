import { describe, expect, it } from "vitest";
import { canApprove, canEdit, type SessionUser } from "@/lib/permissions";

/**
 * 결재선은 "안전관리자·팀장이 작성 → 그 법인의 대표가 승인" 한 줄이다.
 *
 * 법인을 쪼개 둔 구조라 법인마다 대표가 따로 있고, 각 법인의 TBM은 그 법인 대표만
 * 승인할 수 있다. 본사도 대신 승인하지 않는다 — 대표가 직접 확인한 기록으로
 * 남아야 하기 때문이다.
 */

const SITE_A = "site-a";
const SITE_B = "site-b";

const as = (role: SessionUser["role"], siteId: string | null): SessionUser => ({
  id: `u-${role}-${siteId}`,
  name: role,
  role,
  siteId,
});

const submitted = { siteId: SITE_A, status: "SUBMITTED" as const };

describe("canApprove — 승인은 그 법인의 대표만", () => {
  it("자기 법인의 상신 건을 승인한다", () => {
    expect(canApprove(as("CEO", SITE_A), submitted)).toBe(true);
  });

  it("다른 법인 건은 대표라도 승인하지 못한다", () => {
    expect(canApprove(as("CEO", SITE_B), submitted)).toBe(false);
  });

  it("본사 관리자도 대신 승인하지 않는다", () => {
    expect(canApprove(as("HQ_ADMIN", null), submitted)).toBe(false);
  });

  it("안전관리자는 작성자이므로 승인하지 못한다", () => {
    expect(canApprove(as("SITE_MANAGER", SITE_A), submitted)).toBe(false);
  });

  it("팀장도 승인하지 못한다", () => {
    expect(canApprove(as("TEAM_LEAD", SITE_A), submitted)).toBe(false);
  });

  it("상신되지 않은 건은 대표라도 결재 대상이 아니다", () => {
    for (const status of ["DRAFT", "APPROVED", "REJECTED"] as const) {
      expect(canApprove(as("CEO", SITE_A), { siteId: SITE_A, status })).toBe(false);
    }
  });

  it("소속 없는 대표 계정은 어느 법인도 승인하지 못한다", () => {
    expect(canApprove(as("CEO", null), submitted)).toBe(false);
  });
});

describe("canEdit — 대표는 쓰지 않는다", () => {
  const draft = { siteId: SITE_A, status: "DRAFT" as const, teamId: "team-1" };

  it("안전관리자는 자기 사업장 건을 쓴다", () => {
    expect(canEdit(as("SITE_MANAGER", SITE_A), draft, [])).toBe(true);
  });

  it("팀장은 자기가 맡은 팀 건만 쓴다", () => {
    expect(canEdit(as("TEAM_LEAD", SITE_A), draft, ["team-1"])).toBe(true);
    expect(canEdit(as("TEAM_LEAD", SITE_A), draft, ["team-9"])).toBe(false);
  });

  it("대표는 자기 법인 건이라도 쓰지 못한다 (쓰고 스스로 승인하면 결재선이 없다)", () => {
    expect(canEdit(as("CEO", SITE_A), draft, [])).toBe(false);
  });

  it("대표가 어쩌다 팀장으로 지정돼 있어도 쓰지 못한다", () => {
    expect(canEdit(as("CEO", SITE_A), draft, ["team-1"])).toBe(false);
  });

  it("승인된 건은 아무도 고치지 못한다", () => {
    const approved = { ...draft, status: "APPROVED" as const };
    expect(canEdit(as("SITE_MANAGER", SITE_A), approved, [])).toBe(false);
    expect(canEdit(as("HQ_ADMIN", null), approved, [])).toBe(false);
  });

  it("다른 사업장 건은 쓰지 못한다", () => {
    expect(canEdit(as("SITE_MANAGER", SITE_B), draft, [])).toBe(false);
  });
});
