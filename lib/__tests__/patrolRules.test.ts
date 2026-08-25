import { describe, expect, it } from "vitest";
import type { SessionUser } from "@/lib/permissions";
import { canEditPatrol, isPatrolState } from "@/lib/patrolRules";

describe("canEditPatrol", () => {
  const manager: SessionUser = {
    id: "u1",
    name: "안전관리자",
    role: "SITE_MANAGER",
    siteId: "s1",
  };
  const hq: SessionUser = { id: "u2", name: "본사", role: "HQ_ADMIN", siteId: null };
  const ceo: SessionUser = { id: "u3", name: "대표", role: "CEO", siteId: "s1" };
  const lead: SessionUser = { id: "u4", name: "팀장", role: "TEAM_LEAD", siteId: "s1" };

  it("안전관리자는 자기 사업장 것을 쓴다", () => {
    expect(canEditPatrol(manager, { siteId: "s1", status: "DRAFT" })).toBe(true);
  });

  it("안전관리자도 남의 사업장은 못 쓴다", () => {
    expect(canEditPatrol(manager, { siteId: "s2", status: "DRAFT" })).toBe(false);
  });

  it("법인 대표는 결재만 한다", () => {
    // 자기가 쓰고 자기가 승인하면 결재선이 없는 것과 같다.
    expect(canEditPatrol(ceo, { siteId: "s1", status: "DRAFT" })).toBe(false);
  });

  it("팀장은 순찰일지를 쓰지 않는다", () => {
    // 순찰은 팀이 아니라 공장을 도는 일이다.
    expect(canEditPatrol(lead, { siteId: "s1", status: "DRAFT" })).toBe(false);
  });

  it("승인된 건은 본사만 정정할 수 있다", () => {
    expect(canEditPatrol(manager, { siteId: "s1", status: "APPROVED" })).toBe(false);
    expect(canEditPatrol(hq, { siteId: "s1", status: "APPROVED" })).toBe(true);
  });

  it("반려된 건은 다시 고칠 수 있다", () => {
    expect(canEditPatrol(manager, { siteId: "s1", status: "REJECTED" })).toBe(true);
  });

  it("본사는 사업장을 가리지 않는다", () => {
    expect(canEditPatrol(hq, { siteId: "s9", status: "DRAFT" })).toBe(true);
  });
});

describe("isPatrolState", () => {
  it("정해진 값만 통과시킨다", () => {
    expect(isPatrolState("GOOD")).toBe(true);
    expect(isPatrolState("BAD")).toBe(true);
    expect(isPatrolState("NA")).toBe(true);
    expect(isPatrolState("good")).toBe(false);
    expect(isPatrolState("")).toBe(false);
  });
});
