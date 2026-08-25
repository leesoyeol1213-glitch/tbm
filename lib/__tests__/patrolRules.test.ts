import { describe, expect, it } from "vitest";
import type { SessionUser } from "@/lib/permissions";
import {
  canApprovePatrol,
  canEditPatrol,
  canReviewPatrol,
  canViewPatrols,
  isPatrolState,
} from "@/lib/patrolRules";

const manager: SessionUser = {
  id: "u1",
  name: "박태완",
  role: "SITE_MANAGER",
  siteId: "s3",
};
const other: SessionUser = {
  id: "u2",
  name: "강호영",
  role: "SITE_MANAGER",
  siteId: "s2",
};
const hq: SessionUser = { id: "u3", name: "본사", role: "HQ_ADMIN", siteId: null };
const director: SessionUser = {
  id: "u4",
  name: "안전실장",
  role: "SAFETY_DIRECTOR",
  siteId: null,
};
const head: SessionUser = {
  id: "u5",
  name: "본부장",
  role: "DIVISION_HEAD",
  siteId: null,
};
const ceo: SessionUser = { id: "u6", name: "대표", role: "CEO", siteId: "s1" };
const lead: SessionUser = { id: "u7", name: "팀장", role: "TEAM_LEAD", siteId: "s1" };

// 박태완은 1공장만 담당한다.
const P1 = ["plant1"];

describe("canEditPatrol", () => {
  it("담당 공장만 쓴다", () => {
    expect(canEditPatrol(manager, { plantId: "plant1", status: "DRAFT" }, P1)).toBe(true);
    expect(canEditPatrol(manager, { plantId: "plant2", status: "DRAFT" }, P1)).toBe(false);
  });

  it("소속 법인은 보지 않는다", () => {
    // 순찰은 공장 단위다. 담당으로 지정만 되면 어느 법인 소속이든 쓴다.
    expect(canEditPatrol(other, { plantId: "plant1", status: "DRAFT" }, P1)).toBe(true);
  });

  it("결재자는 쓰지 않는다", () => {
    // 자기가 쓰고 자기가 승인하면 결재선이 없는 것과 같다.
    const all = ["plant1"];
    expect(canEditPatrol(director, { plantId: "plant1", status: "DRAFT" }, all)).toBe(false);
    expect(canEditPatrol(head, { plantId: "plant1", status: "DRAFT" }, all)).toBe(false);
  });

  it("승인된 건은 본사만 정정할 수 있다", () => {
    expect(canEditPatrol(manager, { plantId: "plant1", status: "APPROVED" }, P1)).toBe(false);
    expect(canEditPatrol(hq, { plantId: "plant1", status: "APPROVED" }, [])).toBe(true);
  });

  it("반려된 건은 다시 고칠 수 있다", () => {
    expect(canEditPatrol(manager, { plantId: "plant1", status: "REJECTED" }, P1)).toBe(true);
  });
});

describe("canReviewPatrol", () => {
  it("안전실장은 상신된 건을 결재한다", () => {
    expect(canReviewPatrol(director, { plantId: "p", status: "SUBMITTED" })).toBe(true);
  });

  it("아직 상신되지 않았거나 이미 지나간 단계는 안 된다", () => {
    expect(canReviewPatrol(director, { plantId: "p", status: "DRAFT" })).toBe(false);
    expect(canReviewPatrol(director, { plantId: "p", status: "REVIEWED" })).toBe(false);
  });

  it("본부장은 1차 결재를 대신하지 않는다", () => {
    expect(canReviewPatrol(head, { plantId: "p", status: "SUBMITTED" })).toBe(false);
  });

  it("본사는 대결할 수 있다", () => {
    expect(canReviewPatrol(hq, { plantId: "p", status: "SUBMITTED" })).toBe(true);
  });
});

describe("canApprovePatrol", () => {
  it("본부장은 안전실장을 거친 건만 결재한다", () => {
    expect(canApprovePatrol(head, { plantId: "p", status: "REVIEWED" })).toBe(true);
    // 안전실장을 건너뛰고 최종 결재가 되면 결재선이 한 단계뿐인 것과 같다.
    expect(canApprovePatrol(head, { plantId: "p", status: "SUBMITTED" })).toBe(false);
  });

  it("안전실장은 최종 결재를 하지 않는다", () => {
    expect(canApprovePatrol(director, { plantId: "p", status: "REVIEWED" })).toBe(false);
  });

  it("본사는 대결할 수 있다", () => {
    expect(canApprovePatrol(hq, { plantId: "p", status: "REVIEWED" })).toBe(true);
  });
});

describe("canViewPatrols", () => {
  it("팀장은 순찰과 무관하다", () => {
    expect(canViewPatrols(lead)).toBe(false);
  });

  it("나머지는 볼 수 있다", () => {
    for (const u of [manager, hq, director, head, ceo]) {
      expect(canViewPatrols(u)).toBe(true);
    }
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
