import { describe, expect, it } from "vitest";
import {
  classifyNote,
  splitNote,
  tallyKinds,
  tallyThemes,
  themeTrends,
  themesOf,
  type HazardEntry,
} from "@/lib/hazardLog";

/**
 * 분류기 시험.
 *
 * 문장은 전부 운영 DB에 실제로 적혀 있던 것이다(2026-09~11). 꾸며 낸 예문으로
 * 시험하면 현장이 쓰는 말투를 놓친다 — 오타("혹이스트", "벌트슬링"), 띄어쓰기,
 * "합시다"로 끝나는 권고문이 전부 분류에 걸린다.
 *
 * 가장 위험한 오류는 예방 문장을 사고로 세는 것이다. "사고 발생하지 않도록
 * 주의"가 사고로 잡히면 684건 거의 전부가 사고가 되고, 그 숫자로 보고서를
 * 쓰면 없던 재해를 신고하게 된다.
 */

describe("classifyNote — 실제로 난 사고", () => {
  it("9월 14일 인천 사고 보고의 각 줄을 사고로 본다", () => {
    expect(classifyNote("안전사고 발생 보고")).toBe("ACCIDENT");
    expect(classifyNote("사고일시: 09월 14일(월) 16:00경 / 아엉(미얀마)")).toBe(
      "ACCIDENT",
    );
    expect(
      classifyNote(
        "사고내용: 1번 절단기 로스 배출구 철근 잔재 제거 중 호이스트 체인으로 인양·제거하는 과정에서 체인이 이탈하며 작업자 이마 충격",
      ),
    ).toBe("ACCIDENT");
    expect(
      classifyNote("조치사항: 마디정형외과 후송 → X-ray 촬영 및 이상 유무 확인 → 이마 봉합 처치"),
    ).toBe("ACCIDENT");
  });

  it("공상·골절로 끝난 끼임 사고를 사고로 본다", () => {
    expect(
      classifyNote(
        "아차사고 공유 원곡 작업시 회전하는 롤러 근처에 손이 가지 말아야하나 갑자기 손위치를 변경 하여 작업으로 회전하는 롤러와 철근 사이에 왼쪽 새끼 손가락이 끼여 공상 사고 발생",
      ),
    ).toBe("ACCIDENT");
    expect(
      classifyNote(
        "호이스트 작동 시 동료와 의사소통이 되지않아 철근과 벨트슬링 사이에 손가락이 들어가 끼임으로 인한 골절 사고",
      ),
    ).toBe("ACCIDENT");
  });

  it("'아차사고 공유'로 시작해도 다쳤으면 사고로 읽는다", () => {
    // 한 줄에 두 말이 같이 있으면 무거운 쪽으로 읽어야 한다. 공상은 요양이다.
    const line = "아차사고 공유 … 왼쪽 새끼 손가락이 끼여 공상 사고 발생";
    expect(classifyNote(line)).toBe("ACCIDENT");
  });

  it("경미한 사고도 사고다", () => {
    expect(classifyNote("전일 경미한 전도 사고 발생 공유")).toBe("ACCIDENT");
  });
});

describe("classifyNote — 예방 문장을 사고로 세지 않는다", () => {
  it("'사고 발생하지 않도록'은 사고가 아니다", () => {
    expect(classifyNote("안전사고 발생하지 않도록 집중해서 작업하고 개인 건강관리 하도록 교육")).toBe(
      "HAZARD",
    );
    expect(
      classifyNote(
        "전체ㅣ 출근이 아닌 일부 인원 출근이니 안전사고 발생하지 않도록 작업에 집중하도록 합시다",
      ),
    ).toBe("HAZARD");
  });

  it("'사고 발생 우려'는 사고가 아니다", () => {
    expect(
      classifyNote("우천으로 상차시 바닥이 미끄러워 낙상 사고 발생 우려로 주의 해서 작업 합시다"),
    ).toBe("HAZARD");
    expect(classifyNote("명절 전 기분이 들떠서 사고 발생 우려 있으니 조심히 작업 합시다")).toBe(
      "HAZARD",
    );
  });

  it("'사고 발생할 수 있으니'는 사고가 아니다", () => {
    expect(
      classifyNote(
        "추석 명절연휴 후 첫 작업으로 작업 집중도 저하로 안전사고 발생할 수 있으니 유의해서 작업 합시다",
      ),
    ).toBe("HAZARD");
    expect(
      classifyNote(
        "출하 연기에따라 공장내 제품이 많이 쌓여 있어 보행시 팔 다리가 긁혀 찢어짐 사고 발생할 수 있으니 지정된 통로로 다니도록 교육",
      ),
    ).toBe("HAZARD");
  });

  it("'사고발생하지'처럼 붙여 써도 사고가 아니다", () => {
    expect(
      classifyNote("우천으로 공장이 비샌ㄷㄴ곳이 있으니 감전사고발생하지 않도록 주의 하도록 합시다"),
    ).toBe("HAZARD");
  });
});

describe("classifyNote — 남의 사고는 우리 사고가 아니다", () => {
  it("타공장 사례 공유는 타사로 본다", () => {
    expect(classifyNote("타공장 사고사례 공유")).toBe("SHARED");
    expect(classifyNote("타공장 협착사고사례 공유")).toBe("SHARED");
    expect(classifyNote("타 공장 아차사고 공유")).toBe("SHARED");
    expect(classifyNote("타공장 안전사고 공유 및 공장장 안전교육")).toBe("SHARED");
  });

  it("중대재해 사례 공유를 우리 재해로 세지 않는다", () => {
    // 이걸 사고로 세면 없던 중대재해가 집계에 올라간다.
    expect(
      classifyNote(
        "중대재해 사고 공유 및 작업시 집중, 상차시 머리위에 철근이 있는 상태로 작업 하지 않도록 합시다",
      ),
    ).toBe("SHARED");
  });

  it("남의 사례라도 우리 치료 기록이 붙어 있으면 우리 사고다", () => {
    // 한 칸에 공유와 우리 사고를 같이 적는 일이 있다. 치료 기록이 있으면
    // 그건 우리 일이다.
    expect(classifyNote("사고사례 공유 — 우리 작업자 이마 봉합 처치")).toBe("ACCIDENT");
  });
});

describe("classifyNote — 아차사고", () => {
  it("다치지 않은 아차사고는 아차사고로 둔다", () => {
    expect(
      classifyNote("혹이스트 조작 시 지속적으로 아차사고 발생 우려로 주의 하도록 교육"),
    ).toBe("NEAR_MISS");
  });
});

describe("classifyNote — 인원·운영", () => {
  it("사람 사정은 위험요인이 아니다", () => {
    // 특이사항 160줄 중 68줄이 이쪽이다. 섞으면 다른 숫자가 다 가려진다.
    expect(classifyNote("왓산 입원 중")).toBe("ADMIN");
    expect(classifyNote("왓산 입원 중 (26.11월 복귀 예정)")).toBe("ADMIN");
    expect(classifyNote("왓산 병가")).toBe("ADMIN");
    expect(classifyNote("박위민 휴가")).toBe("ADMIN");
    expect(classifyNote("피에롬 퇴사")).toBe("ADMIN");
    expect(classifyNote("공임수 경조 휴가 중 (부친상)")).toBe("ADMIN");
  });

  it("출석·인원 안내도 위험요인이 아니다", () => {
    expect(classifyNote("주말 출근자만 출석체크")).toBe("ADMIN");
    expect(classifyNote("휴일 작업 출근자만 출석체크")).toBe("ADMIN");
    expect(classifyNote("생산계획에 맞춰 최소인원 출근 (4명)")).toBe("ADMIN");
    expect(classifyNote("동복 작업복 지급을 위해 사이즈 확인, 구매")).toBe("ADMIN");
  });

  it("인원 사정에 위험요인이 섞여 있으면 위험요인으로 올린다", () => {
    // "2공장 휴무 / 왓산 입원 중"은 인원이지만, 설비 이야기가 붙으면 다르다.
    expect(classifyNote("2공장 휴무 / 왓산 입원 중")).toBe("ADMIN");
    expect(classifyNote("왓산 입원 중 / 호이스트 훅 해지장치 파손 교체")).toBe("HAZARD");
  });

  it("빈 줄은 셈에 들지 않는다", () => {
    expect(classifyNote("")).toBe("ADMIN");
    expect(classifyNote("   ")).toBe("ADMIN");
  });
});

describe("splitNote", () => {
  it("빈 칸은 아무것도 내놓지 않는다", () => {
    expect(splitNote(null)).toEqual([]);
    expect(splitNote("")).toEqual([]);
  });

  it("줄바꿈으로 쪼갠다", () => {
    expect(splitNote("왓산 입원 중\r\n공임수 경조 휴가")).toEqual([
      "왓산 입원 중",
      "공임수 경조 휴가",
    ]);
  });

  it("머리에 붙은 번호를 뗀다", () => {
    expect(splitNote("1. 왓산 입원 중\r\n2. 공임수 부친상")).toEqual([
      "왓산 입원 중",
      "공임수 부친상",
    ]);
    expect(splitNote("1) 첫째\n- 둘째\n※ 안전사고 발생 보고")).toEqual([
      "첫째",
      "둘째",
      "안전사고 발생 보고",
    ]);
  });

  it("한 글자 줄은 버린다 — 통과용으로 찍은 점이 올라오지 않게", () => {
    expect(splitNote(".")).toEqual([]);
    expect(splitNote("호이스트 주의\n.\n-")).toEqual(["호이스트 주의"]);
  });

  it("사고 보고를 줄째로 살려 둔다", () => {
    // 칸째로 분류하면 사고 보고가 인원 사정에 묻히거나 그 반대가 된다.
    const note = "※ 안전사고 발생 보고\r\n사고일시: 09월 14일 16:00경\r\n현재상태: 경과 관찰 중";
    expect(splitNote(note)).toHaveLength(3);
    expect(splitNote(note)[0]).toBe("안전사고 발생 보고");
  });
});

describe("themesOf", () => {
  it("호이스트 관련 말을 모두 같은 주제로 묶는다", () => {
    expect(themesOf("호이스트에 사용하는 체인고리 훅해지장치 파손시 즉시 교체 합시다")).toContain(
      "CRANE",
    );
    expect(themesOf("크레인 사용 안전작업 시행여부")).toContain("CRANE");
    expect(themesOf("호이스트 조작시 정해진 중량 보다 초과해서 들고 이동")).toContain("CRANE");
  });

  it("오타도 잡는다 — 적은 사람을 고치는 것이 이 화면의 일이 아니다", () => {
    expect(themesOf("혹이스트 조작 시 지속적으로 아차사고 발생 우려")).toContain("CRANE");
    expect(themesOf("벌트슬링 파단품 사용시 안전사고 발생 우려")).toContain("SLING");
    expect(themesOf("작업전 설비 시우전 실시 후 작업합시다")).toContain("ELEC");
  });

  it("한 줄이 여러 주제에 걸릴 수 있다", () => {
    const t = themesOf(
      "지속적인 출하 지연으로 작업 완료된 철근이 공장내 다량 적재되어 있으니 지정된 통로로 보행 및 상차시 넘어지거나 벨트슬링에 걸리지 않도록 주의 교육",
    );
    expect(t).toContain("AISLE");
    expect(t).toContain("SLING");
    expect(t).toContain("VEHICLE");
  });

  it("되풀이된 세 건을 같은 주제로 모은다", () => {
    // 9월 3일 15개, 10월 2일 60개, 10월 16일 2개 — 세 번 다 다른 문서에 있었다.
    for (const line of [
      "슬링벨트 파손품 15EA 사용하고 있어 폐기 조치",
      "벨트슬링 60개 파단품 사용 중지 후 폐기 조치",
      "슬링벨트 점검 중 불량 2개를 확인하여 즉시 폐기 조치",
    ]) {
      expect(themesOf(line), line).toContain("SLING");
    }
  });

  it("흔한 낱말로는 주제를 만들지 않는다", () => {
    // "교육", "집중", "주의"는 거의 모든 줄에 있어 주제를 가르지 못한다.
    expect(themesOf("작업시 집중 하도록 교육")).toEqual([]);
    expect(themesOf("안전사고 발생하지 않도록 주의")).toEqual([]);
  });

  it("빈 줄은 주제가 없다", () => {
    expect(themesOf("")).toEqual([]);
    expect(themesOf("   ")).toEqual([]);
  });
});

function entry(text: string, over: Partial<HazardEntry> = {}): HazardEntry {
  return {
    source: "TBM",
    docId: "tbm-1",
    date: new Date("2026-11-18T00:00:00Z"),
    where: "지지산업(주) 진천",
    detail: "생산팀",
    text,
    kind: classifyNote(text),
    themes: themesOf(text),
    ...over,
  };
}

const SEP = new Date("2026-09-10T00:00:00Z");
const OCT = new Date("2026-10-10T00:00:00Z");
const NOV = new Date("2026-11-10T00:00:00Z");

describe("집계", () => {
  const entries = [
    entry("호이스트 훅 해지장치 파손시 즉시 교체 합시다", { date: SEP }),
    entry("호이스트 조작시 중량 초과하지 않도록 합시다", { date: OCT }),
    entry("혹이스트 수리 시 리모컨 조작하지말고", { date: NOV }),
    entry("벨트슬링 파단품 발견 즉시 폐기", { date: SEP }),
    entry("왓산 입원 중", { date: NOV }),
  ];

  it("주제별로 많은 것부터 센다", () => {
    const t = tallyThemes(entries);
    expect(t[0]).toMatchObject({ key: "CRANE", count: 3 });
    expect(t.find((x) => x.key === "SLING")?.count).toBe(1);
  });

  it("종류별로 센다", () => {
    const k = tallyKinds(entries);
    expect(k.HAZARD).toBe(4);
    expect(k.ADMIN).toBe(1);
    expect(k.ACCIDENT).toBe(0);
  });

  it("아무것도 없으면 빈 배열이다", () => {
    expect(tallyThemes([])).toEqual([]);
    expect(themeTrends([])).toEqual([]);
    expect(tallyKinds([]).HAZARD).toBe(0);
  });
});

describe("themeTrends — 달별 추이", () => {
  it("달마다 몇 건이었는지 그대로 보여 준다", () => {
    const e = [
      entry("호이스트 훅 해지장치 파손", { date: SEP }),
      entry("호이스트 중량 초과 주의", { date: OCT }),
      entry("혹이스트 리모컨 조작 금지", { date: OCT }),
      entry("크레인 인양 주의", { date: NOV }),
    ];
    const t = themeTrends(e).find((x) => x.key === "CRANE")!;
    expect(t.count).toBe(4);
    expect(t.months).toEqual([
      { label: "9월", count: 1 },
      { label: "10월", count: 2 },
      { label: "11월", count: 1 },
    ]);
  });

  it("그 주제가 없던 달도 0으로 채운다 — 줄이 맞아야 읽을 수 있다", () => {
    const e = [
      entry("MSDS 물질 보관 교육", { date: SEP }),
      entry("호이스트 점검", { date: OCT }),
      entry("호이스트 수리", { date: NOV }),
    ];
    const chem = themeTrends(e).find((x) => x.key === "CHEM")!;
    expect(chem.months).toEqual([
      { label: "9월", count: 1 },
      { label: "10월", count: 0 },
      { label: "11월", count: 0 },
    ]);
  });

  it("줄었으면 rising이 false다", () => {
    const e = [
      entry("벨트슬링 파손품 15EA 폐기", { date: SEP }),
      entry("벨트슬링 60개 파단품 폐기", { date: SEP }),
      entry("슬링벨트 불량 2개 폐기", { date: NOV }),
    ];
    expect(themeTrends(e).find((x) => x.key === "SLING")!.rising).toBe(false);
  });

  it("같은 수로 머물러도 줄지 않은 것이다", () => {
    // 조치했는데 그대로면 좋은 소식이 아니다.
    const e = [
      entry("호이스트 점검", { date: SEP }),
      entry("크레인 인양 주의", { date: NOV }),
    ];
    expect(themeTrends(e).find((x) => x.key === "CRANE")!.rising).toBe(true);
  });

  it("달이 하나뿐이면 추이를 말하지 않는다", () => {
    const e = [entry("호이스트 점검", { date: NOV })];
    expect(themeTrends(e)[0].rising).toBeNull();
  });

  it("해가 바뀌어도 순서가 섞이지 않는다", () => {
    const e = [
      entry("호이스트 점검", { date: new Date("2026-12-10T00:00:00Z") }),
      entry("크레인 인양 주의", { date: new Date("2027-01-10T00:00:00Z") }),
    ];
    expect(themeTrends(e)[0].months.map((m) => m.label)).toEqual(["12월", "1월"]);
  });
});
