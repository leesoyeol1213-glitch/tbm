import { describe, expect, it } from "vitest";
import {
  judgeTeamDelete,
  judgeWorkerDelete,
  splitInactiveForDelete,
  summarizeBulkDelete,
} from "@/lib/deletion";

/**
 * 안전 기록(출석·TBM)은 보존 대상이다.
 * 기록이 붙어 있는 항목이 삭제되면 과거 TBM에서 참석자나 기록 자체가 사라진다.
 */
describe("judgeWorkerDelete", () => {
  it("출석 기록이 없으면 삭제할 수 있다", () => {
    expect(judgeWorkerDelete("홍길동", { attendances: 0 })).toEqual({ allowed: true });
  });

  it("출석 기록이 한 건이라도 있으면 막는다", () => {
    const v = judgeWorkerDelete("홍길동", { attendances: 1 });
    expect(v.allowed).toBe(false);
    if (!v.allowed) {
      expect(v.reason).toContain("홍길동");
      expect(v.reason).toContain("1건");
      expect(v.reason).toContain("비활성화");
    }
  });

  it("건수를 사유에 그대로 알려 준다", () => {
    const v = judgeWorkerDelete("김철수", { attendances: 37 });
    if (!v.allowed) expect(v.reason).toContain("37건");
  });
});

describe("judgeTeamDelete", () => {
  it("TBM 기록이 없으면 삭제할 수 있다", () => {
    const v = judgeTeamDelete("조립1반", { tbms: 0, workers: 0 });
    expect(v.allowed).toBe(true);
    if (v.allowed) expect(v.note).toBeUndefined();
  });

  it("TBM 기록이 있으면 막는다", () => {
    const v = judgeTeamDelete("조립1반", { tbms: 5, workers: 3 });
    expect(v.allowed).toBe(false);
    if (!v.allowed) {
      expect(v.reason).toContain("TBM 기록");
      expect(v.reason).toContain("5건");
      expect(v.reason).toContain("비활성화");
    }
  });

  it("소속 작업자가 있으면 팀 미지정이 된다고 알려 준다", () => {
    const v = judgeTeamDelete("포장반", { tbms: 0, workers: 4 });
    expect(v.allowed).toBe(true);
    if (v.allowed) {
      expect(v.note).toContain("4명");
      expect(v.note).toContain("팀 미지정");
    }
  });

  it("기록 유무가 인원 수보다 우선한다", () => {
    // 작업자가 없어도 TBM 기록이 있으면 막혀야 한다
    expect(judgeTeamDelete("폐지반", { tbms: 1, workers: 0 }).allowed).toBe(false);
  });
});

describe("splitInactiveForDelete", () => {
  const rows = [
    { id: "a", _count: { attendances: 0 } },
    { id: "b", _count: { attendances: 3 } },
    { id: "c", _count: { attendances: 0 } },
  ];

  it("기록 없는 인원만 삭제 대상으로 고른다", () => {
    const { deletable, kept } = splitInactiveForDelete(rows);
    expect(deletable.map((r) => r.id)).toEqual(["a", "c"]);
    expect(kept.map((r) => r.id)).toEqual(["b"]);
  });

  it("전부 기록이 있으면 삭제 대상이 없다", () => {
    const { deletable, kept } = splitInactiveForDelete([
      { id: "x", _count: { attendances: 1 } },
    ]);
    expect(deletable).toHaveLength(0);
    expect(kept).toHaveLength(1);
  });

  it("빈 목록도 안전하게 처리한다", () => {
    expect(splitInactiveForDelete([])).toEqual({ deletable: [], kept: [] });
  });
});

describe("summarizeBulkDelete", () => {
  it("보존된 인원이 있으면 함께 알려 준다", () => {
    expect(summarizeBulkDelete(5, 2)).toBe(
      "5명을 삭제했습니다. 2명은 출석 기록이 있어 그대로 두었습니다.",
    );
  });

  it("보존된 인원이 없으면 삭제 건수만 알려 준다", () => {
    expect(summarizeBulkDelete(5, 0)).toBe("5명을 삭제했습니다.");
  });
});
