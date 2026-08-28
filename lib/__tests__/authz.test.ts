import { describe, expect, it } from "vitest";
import {
  canAccessSite,
  canApprove,
  canEdit,
  isApprover,
  isCompanyWide,
  isCorrection,
  isDelegatedApproval,
  siteScope,
  type SessionUser,
} from "@/lib/permissions";

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
  siteIds: siteId ? [siteId] : [],
});

const submitted = { siteId: SITE_A, status: "SUBMITTED" as const };

describe("canApprove — 승인은 그 법인의 대표만", () => {
  it("자기 법인의 상신 건을 승인한다", () => {
    expect(canApprove(as("CEO", SITE_A), submitted)).toBe(true);
  });

  it("다른 법인 건은 대표라도 승인하지 못한다", () => {
    expect(canApprove(as("CEO", SITE_B), submitted)).toBe(false);
  });

  it("본사 관리자는 대표를 대신해 결재할 수 있다 (대결)", () => {
    expect(canApprove(as("HQ_ADMIN", null), submitted)).toBe(true);
    expect(isDelegatedApproval(as("HQ_ADMIN", null))).toBe(true);
  });

  it("대표 본인이 누른 결재는 대결이 아니다", () => {
    expect(isDelegatedApproval(as("CEO", SITE_A))).toBe(false);
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

  it("결재함에 결재 버튼을 둘 역할은 대표와 본사뿐이다", () => {
    expect(isApprover(as("CEO", SITE_A))).toBe(true);
    expect(isApprover(as("HQ_ADMIN", null))).toBe(true);
    expect(isApprover(as("SITE_MANAGER", SITE_A))).toBe(false);
    expect(isApprover(as("TEAM_LEAD", SITE_A))).toBe(false);
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

  it("승인된 건은 본사만 정정할 수 있다", () => {
    const approved = { ...draft, status: "APPROVED" as const };
    expect(canEdit(as("HQ_ADMIN", null), approved, [])).toBe(true);
    expect(canEdit(as("SITE_MANAGER", SITE_A), approved, [])).toBe(false);
    expect(canEdit(as("TEAM_LEAD", SITE_A), approved, ["team-1"])).toBe(false);
    expect(canEdit(as("CEO", SITE_A), approved, [])).toBe(false);
  });

  it("승인된 건을 고치는 것은 정정으로 표시된다", () => {
    expect(isCorrection({ status: "APPROVED" })).toBe(true);
    for (const status of ["DRAFT", "SUBMITTED", "REJECTED"] as const) {
      expect(isCorrection({ status })).toBe(false);
    }
  });

  it("다른 사업장 건은 쓰지 못한다", () => {
    expect(canEdit(as("SITE_MANAGER", SITE_B), draft, [])).toBe(false);
  });
});

/**
 * 안전실장·본부장은 순찰일지 결재선이다. 자기 눈으로 확인하지 못하는 현장을
 * 결재할 수는 없으므로 전 사업장을 조회하되, TBM에는 손대지 않는다.
 */
describe("회사 전체를 보는 자리 (안전실장·본부장)", () => {
  const draft = { siteId: SITE_A, status: "DRAFT" as const, teamId: "team-1" };
  const director = as("SAFETY_DIRECTOR", null);
  const head = as("DIVISION_HEAD", null);
  const hq = as("HQ_ADMIN", null);

  it("사업장을 가리지 않고 조회한다", () => {
    for (const u of [director, head, hq]) {
      expect(isCompanyWide(u)).toBe(true);
      expect(siteScope(u)).toEqual({});
      expect(canAccessSite(u, SITE_A)).toBe(true);
      expect(canAccessSite(u, SITE_B)).toBe(true);
    }
  });

  it("소속 법인이 있는 자리는 자기 사업장만 본다", () => {
    const manager = as("SITE_MANAGER", SITE_A);
    expect(isCompanyWide(manager)).toBe(false);
    expect(siteScope(manager)).toEqual({ siteId: { in: [SITE_A] } });
    expect(canAccessSite(manager, SITE_B)).toBe(false);
  });

  it("소속이 없는 그 밖의 계정은 아무것도 못 본다", () => {
    // siteId가 비었다고 전 사업장이 열리면 안 된다.
    expect(siteScope(as("TEAM_LEAD", null))).toEqual({ siteId: { in: ["__none__"] } });
  });

  it("TBM은 조회만 하고 쓰지 않는다", () => {
    for (const u of [director, head]) {
      expect(canEdit(u, draft, [])).toBe(false);
      // 팀장으로 잘못 지정돼 있어도 열리지 않아야 한다.
      expect(canEdit(u, draft, [draft.teamId])).toBe(false);
    }
  });

  it("TBM 결재는 하지 않는다", () => {
    // TBM 승인은 그 법인 대표(와 대결하는 본사) 몫이다.
    for (const u of [director, head]) {
      expect(canApprove(u, submitted)).toBe(false);
      expect(isApprover(u)).toBe(false);
    }
  });
});

describe("겸임 사업장", () => {
  // 한 사람이 여러 법인의 대표를 겸한다. 예전에는 사업장마다 계정을 따로
  // 만들어 로그인을 바꿔가며 결재했다.
  const ceo: SessionUser = {
    id: "u-ceo",
    name: "문성호",
    role: "CEO",
    siteId: SITE_A,
    siteIds: [SITE_A, SITE_B],
  };

  it("맡은 사업장은 모두 조회 범위에 든다", () => {
    expect(siteScope(ceo)).toEqual({ siteId: { in: [SITE_A, SITE_B] } });
    expect(canAccessSite(ceo, SITE_A)).toBe(true);
    expect(canAccessSite(ceo, SITE_B)).toBe(true);
  });

  it("맡지 않은 사업장은 여전히 막힌다", () => {
    expect(canAccessSite(ceo, "site-c")).toBe(false);
  });

  it("겸임 사업장의 TBM도 결재한다", () => {
    expect(canApprove(ceo, { siteId: SITE_B, status: "SUBMITTED" })).toBe(true);
  });

  it("겸임해도 남의 사업장 TBM은 결재하지 못한다", () => {
    expect(canApprove(ceo, { siteId: "site-c", status: "SUBMITTED" })).toBe(false);
  });
});
