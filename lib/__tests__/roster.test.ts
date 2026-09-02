import { describe, expect, it } from "vitest";
import { rosterFor, wasThere } from "@/lib/roster";

const w = (id: string, active: boolean) => ({
  id,
  name: id,
  empNo: id,
  active,
});

describe("wasThere", () => {
  it("불참만 자리에 없었던 것으로 친다", () => {
    expect(wasThere("PRESENT")).toBe(true);
    expect(wasThere("LATE")).toBe(true);
    expect(wasThere("ABSENT")).toBe(false);
  });
});

describe("rosterFor", () => {
  it("재직 중인 사람은 출결 기록이 없어도 싣는다", () => {
    const rows = rosterFor([w("가", true)], []);
    expect(rows.map((r) => r.id)).toEqual(["가"]);
  });

  it("그만둔 사람은 기록이 없으면 빠진다", () => {
    const rows = rosterFor([w("가", true), w("나", false)], []);
    expect(rows.map((r) => r.id)).toEqual(["가"]);
  });

  it("그만둔 사람도 그날 나왔으면 남는다", () => {
    const rows = rosterFor(
      [w("가", true), w("나", false)],
      [{ workerId: "나", state: "PRESENT" }],
    );
    expect(rows.map((r) => r.id)).toEqual(["가", "나"]);
  });

  it("지각도 나온 것이다", () => {
    const rows = rosterFor([w("나", false)], [{ workerId: "나", state: "LATE" }]);
    expect(rows.map((r) => r.id)).toEqual(["나"]);
  });

  it("그만둔 사람을 불참으로 찍어 둔 줄은 문서에 싣지 않는다", () => {
    // 매일 아침 팀장이 찍던 그 줄이다. "없었다"만 말하는 줄이라 빼도 잃는 것이 없다.
    const rows = rosterFor([w("나", false)], [{ workerId: "나", state: "ABSENT" }]);
    expect(rows).toEqual([]);
  });

  it("재직 중이면 불참이어도 명단에 남는다", () => {
    const rows = rosterFor([w("가", true)], [{ workerId: "가", state: "ABSENT" }]);
    expect(rows.map((r) => r.id)).toEqual(["가"]);
  });

  it("받은 차례를 그대로 지킨다", () => {
    const rows = rosterFor(
      [w("다", true), w("가", true), w("나", false)],
      [{ workerId: "나", state: "PRESENT" }],
    );
    expect(rows.map((r) => r.id)).toEqual(["다", "가", "나"]);
  });
});
