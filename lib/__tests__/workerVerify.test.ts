import { describe, expect, it } from "vitest";
import {
  normalizeBirthMmdd,
  verifyExpectation,
  verifyMatches,
} from "@/lib/workerVerify";

describe("normalizeBirthMmdd", () => {
  it("네 자리는 그대로 월일로 본다", () => {
    expect(normalizeBirthMmdd("0315")).toBe("0315");
    expect(normalizeBirthMmdd("03-15")).toBe("0315");
  });

  it("여섯 자리는 YYMMDD, 여덟 자리는 YYYYMMDD로 본다", () => {
    expect(normalizeBirthMmdd("900315")).toBe("0315");
    expect(normalizeBirthMmdd("1990-03-15")).toBe("0315");
  });

  it("엑셀이 앞자리 0을 떨어뜨린 세 자리도 살린다", () => {
    // 0315 를 숫자로 인식하면 315 로 들어온다.
    expect(normalizeBirthMmdd("315")).toBe("0315");
    expect(normalizeBirthMmdd("101")).toBe("0101");
  });

  it("월일로 읽을 수 없으면 null", () => {
    expect(normalizeBirthMmdd("1315")).toBeNull(); // 13월
    expect(normalizeBirthMmdd("0300")).toBeNull(); // 0일
    expect(normalizeBirthMmdd("031")).toBeNull();
    expect(normalizeBirthMmdd("")).toBeNull();
    expect(normalizeBirthMmdd(null)).toBeNull();
  });
});

describe("verifyExpectation", () => {
  it("생년월일이 있으면 그것을 쓴다", () => {
    expect(verifyExpectation({ birthMmdd: "0315", phone: "010-1111-2222" })).toEqual({
      kind: "birth",
      expected: "0315",
    });
  });

  it("생년월일이 없으면 휴대폰 뒤 4자리로 내려간다", () => {
    expect(verifyExpectation({ birthMmdd: null, phone: "010-1111-2222" })).toEqual({
      kind: "phone",
      expected: "2222",
    });
  });

  it("둘 다 없으면 막지 않는다", () => {
    // 명부가 덜 채워졌다고 출석을 막으면 기록이 통째로 비어 버린다.
    expect(verifyExpectation({ birthMmdd: null, phone: null }).kind).toBe("none");
    expect(verifyExpectation({ birthMmdd: null, phone: "010" }).kind).toBe("none");
  });
});

describe("verifyMatches", () => {
  it("생년월일은 표기를 가리지 않는다", () => {
    expect(verifyMatches("birth", "0315", "0315")).toBe(true);
    expect(verifyMatches("birth", "0315", "900315")).toBe(true);
    expect(verifyMatches("birth", "0315", "1990-03-15")).toBe(true);
    expect(verifyMatches("birth", "0315", "0316")).toBe(false);
  });

  it("휴대폰은 뒤 4자리와 정확히 같아야 한다", () => {
    expect(verifyMatches("phone", "2222", "2222")).toBe(true);
    expect(verifyMatches("phone", "2222", "010-1111-2222")).toBe(false);
  });

  it("확인 값이 없으면 통과시킨다", () => {
    expect(verifyMatches("none", "", "")).toBe(true);
  });
});
