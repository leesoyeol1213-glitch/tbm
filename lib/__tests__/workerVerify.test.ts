import { describe, expect, it } from "vitest";
import {
  VERIFY_VALID_DAYS,
  needsVerify,
  normalizeBirthMmdd,
  shouldStampVerified,
  verifyDaysLeft,
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
  it("생년월일이 있으면 그것을 묻는다", () => {
    expect(verifyExpectation({ birthMmdd: "0315" })).toEqual({
      kind: "birth",
      expected: "0315",
    });
  });

  it("생년월일이 없으면 아무것도 묻지 않는다", () => {
    // 휴대폰으로 내려가지 않는다. 번호가 자주 바뀌어 확인 수단에서 뺐다.
    // 명부가 덜 채워졌다고 출석을 막으면 그날 기록이 통째로 비어 버리므로
    // 막는 대신 통과시키고, 관리 화면에서 남은 인원을 계속 알려 준다.
    expect(verifyExpectation({ birthMmdd: null }).kind).toBe("none");
  });
});

describe("verifyMatches", () => {
  it("생년월일은 표기를 가리지 않는다", () => {
    expect(verifyMatches("birth", "0315", "0315")).toBe(true);
    expect(verifyMatches("birth", "0315", "900315")).toBe(true);
    expect(verifyMatches("birth", "0315", "1990-03-15")).toBe(true);
    expect(verifyMatches("birth", "0315", "0316")).toBe(false);
  });

  it("확인 값이 없으면 통과시킨다", () => {
    expect(verifyMatches("none", "", "")).toBe(true);
  });
});

describe("needsVerify (반기)", () => {
  const NOW = new Date("2026-08-27T00:00:00Z");
  const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

  it("확인한 적이 없으면 묻는다", () => {
    expect(needsVerify({ birthMmdd: "0315", verifiedAt: null }, NOW)).toBe(true);
  });

  it("어제 확인했으면 묻지 않는다", () => {
    // 예전에는 기기 쿠키에만 기억해서, 쿠키가 안 남는 폰은 매일 물었다.
    expect(needsVerify({ birthMmdd: "0315", verifiedAt: daysAgo(1) }, NOW)).toBe(false);
  });

  it("반기가 끝나기 전까지는 묻지 않는다", () => {
    expect(needsVerify({ birthMmdd: "0315", verifiedAt: daysAgo(182) }, NOW)).toBe(false);
    expect(needsVerify({ birthMmdd: "0315", verifiedAt: daysAgo(183) }, NOW)).toBe(false);
  });

  it("반기가 지나면 다시 묻는다", () => {
    expect(needsVerify({ birthMmdd: "0315", verifiedAt: daysAgo(184) }, NOW)).toBe(true);
  });

  it("생년월일이 없으면 물을 것이 없다", () => {
    // 명부가 덜 채워졌다고 출석을 막으면 그날 기록이 통째로 빈다.
    expect(needsVerify({ birthMmdd: null, verifiedAt: null }, NOW)).toBe(false);
  });
});

describe("verifyDaysLeft", () => {
  const NOW = new Date("2026-08-27T00:00:00Z");
  const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

  it("확인한 적이 없으면 셀 것이 없다", () => {
    expect(verifyDaysLeft({ verifiedAt: null }, NOW)).toBeNull();
  });

  it("남은 날을 센다", () => {
    expect(verifyDaysLeft({ verifiedAt: daysAgo(0) }, NOW)).toBe(VERIFY_VALID_DAYS);
    expect(verifyDaysLeft({ verifiedAt: daysAgo(100) }, NOW)).toBe(83);
  });

  it("지났으면 0", () => {
    expect(verifyDaysLeft({ verifiedAt: daysAgo(300) }, NOW)).toBe(0);
  });
});

describe("shouldStampVerified", () => {
  const NOW = new Date("2026-08-28T00:00:00Z");
  const never = { birthMmdd: "0315", verifiedAt: null };
  const done = { birthMmdd: "0315", verifiedAt: new Date("2026-08-01T00:00:00Z") };

  it("생년월일을 맞혔으면 남긴다", () => {
    expect(
      shouldStampVerified({ justVerified: true, rememberedThisWorker: false, worker: never }),
    ).toBe(true);
  });

  it("기기가 기억해 안 물었고 기록이 없으면 한 번 열어 준다", () => {
    // 기록이 기기에만 있으면 쿠키가 사라지는 날 다시 묻게 된다.
    expect(
      shouldStampVerified({ justVerified: false, rememberedThisWorker: true, worker: never }),
    ).toBe(true);
  });

  it("이미 세워 둔 기록은 갱신하지 않는다", () => {
    // 출석할 때마다 밀리면 반기가 영영 끝나지 않는다.
    expect(
      shouldStampVerified({ justVerified: false, rememberedThisWorker: true, worker: done }),
    ).toBe(false);
  });

  it("생년월일이 없는 사람에게는 세우지 않는다", () => {
    // 나중에 생년월일을 넣어도 확인을 건너뛰게 된다.
    expect(
      shouldStampVerified({
        justVerified: false,
        rememberedThisWorker: true,
        worker: { birthMmdd: null, verifiedAt: null },
      }),
    ).toBe(false);
  });

  it("기억된 기기도 아니고 확인도 안 했으면 남길 것이 없다", () => {
    expect(
      shouldStampVerified({ justVerified: false, rememberedThisWorker: false, worker: never }),
    ).toBe(false);
  });

  it("확인을 마친 사람은 반기 안에서 다시 묻지 않는다", () => {
    expect(needsVerify(done, NOW)).toBe(false);
  });
});
