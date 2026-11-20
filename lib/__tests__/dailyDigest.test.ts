import { describe, expect, it } from "vitest";
import {
  DIGEST_PRINT_FROM,
  MAX_DIGEST_LINES,
  buildDigest,
  clipText,
  digestIntro,
  digestTitle,
  lineLabel,
  printsDigest,
  previewLines,
  terseText,
  type DigestInput,
} from "@/lib/dailyDigest";
import { parseYmd } from "@/lib/kst";

/**
 * 전일 공유 요약본.
 *
 * 여기서 잘리는 줄은 아침에 공유되지 않는 줄이다. 사고가 휴가 공지에 밀려
 * 상한 밖으로 나가면 요약본이 있는 쪽이 없는 쪽보다 나쁘다 — 공유했다고
 * 믿게 되기 때문이다. 그래서 순서와 거름을 테스트로 고정한다.
 */

const TODAY = parseYmd("2026-11-19");
const YESTERDAY = parseYmd("2026-11-18");
const BEFORE = parseYmd("2026-11-17");

function tbm(remarks: string, date = YESTERDAY, over: Partial<DigestInput> = {}): DigestInput {
  return {
    source: "TBM",
    docId: "t1",
    date,
    where: "지지산업(주) 진천",
    detail: "가공1팀",
    remarks,
    ...over,
  } as DigestInput;
}

function patrol(text: string, date = YESTERDAY, over: Partial<DigestInput> = {}): DigestInput {
  return {
    source: "PATROL",
    docId: "p1",
    date,
    where: "진천 1공장",
    detail: "소화기 점검",
    text,
    ...over,
  } as DigestInput;
}

describe("buildDigest — 무엇을 싣는가", () => {
  it("실을 것이 없으면 null", () => {
    expect(buildDigest([], TODAY)).toBeNull();
  });

  it("인원·운영은 싣지 않는다", () => {
    // 특이사항 162줄 가운데 69줄이 휴가·입원·연락이다(2026-11-19 실측).
    // 섞으면 사고가 밀려난다.
    const d = buildDigest([tbm("왓산 입원 중 / 공임수 경조휴가")], TODAY);
    expect(d).toBeNull();
  });

  it("오늘 것은 섞지 않는다", () => {
    // 아침에 방금 쓴 칸이 "어제"로 올라오면 안 된다.
    expect(buildDigest([tbm("벨트슬링 파단품 발견", TODAY)], TODAY)).toBeNull();
  });

  it("한 칸에 여러 건이 적혀 있으면 줄 단위로 쪼갠다", () => {
    const d = buildDigest(
      [tbm("1. 왓산 입원 중\n2. 가공1팀 벨트슬링 파단품 15개 발견")],
      TODAY,
    )!;
    // 인원 사정은 빠지고 위험요인만 남는다. 머리 번호도 떼어진다.
    expect(d.lines).toHaveLength(1);
    expect(d.lines[0].text).toBe("가공1팀 벨트슬링 파단품 15개 발견");
  });

  it("두 자 미만 줄은 버린다", () => {
    expect(buildDigest([tbm("-\n.")], TODAY)).toBeNull();
  });
});

describe("buildDigest — 어느 날 것인가", () => {
  it("기록이 있는 가장 가까운 지난 날 하나만 싣는다", () => {
    const d = buildDigest(
      [tbm("크레인 와이어 손상", BEFORE), tbm("지게차 후진 중 근접", YESTERDAY)],
      TODAY,
    )!;
    expect(d.date).toEqual(YESTERDAY);
    expect(d.lines).toHaveLength(1);
    expect(d.lines[0].text).toBe("지게차 후진 중 근접");
  });

  it("어제가 비어 있으면 그 앞 작업일로 거슬러 간다", () => {
    // 월요일 아침에 주말을 보고 "공유할 것 없음"을 띄우면, 월요일마다
    // 아무것도 공유되지 않는다.
    const monday = parseYmd("2026-11-23");
    const friday = parseYmd("2026-11-20");
    const d = buildDigest([tbm("벨트슬링 파단", friday)], monday)!;
    expect(d.date).toEqual(friday);
  });
});

describe("digestTitle · digestIntro — 묵은 것을 전일이라 부르지 않는다", () => {
  it("어제 것이면 전일 공유다", () => {
    const d = buildDigest([tbm("벨트슬링 파단", YESTERDAY)], TODAY)!;
    expect(d.daysBack).toBe(1);
    expect(digestTitle(d)).toBe("전일 공유");
    expect(digestIntro(d)).toContain("어제 올라온");
  });

  it("이레 전 것이면 최근 공유다", () => {
    // 2026-11-20 아침에 인천 요약본이 11-13 것을 실었다. 그 사이 올라온
    // 특이사항이 없어서인데, 꼬리표가 "전일 공유"면 문서가 거짓을 말한다.
    const d = buildDigest(
      [tbm("크레인 안전작업 교육", parseYmd("2026-11-13"))],
      parseYmd("2026-11-20"),
    )!;
    expect(d.daysBack).toBe(7);
    expect(digestTitle(d)).toBe("최근 공유");
    expect(digestIntro(d)).toBe("7일 전 기록입니다. 그 뒤로 새로 올라온 것이 없습니다.");
  });

  it("월요일 아침에 올라온 금요일 것도 전일이 아니다", () => {
    const d = buildDigest([tbm("벨트슬링 파단", parseYmd("2026-11-20"))], parseYmd("2026-11-23"))!;
    expect(d.daysBack).toBe(3);
    expect(digestTitle(d)).toBe("최근 공유");
  });

  it("daysBack은 0이나 음수가 되지 않는다", () => {
    // 기준일 당일 것은 애초에 걸러지지만, 꼬리표 쪽에서 0일 전이 새면
    // "0일 전 기록입니다"가 찍힌다.
    const d = buildDigest([tbm("벨트슬링 파단", YESTERDAY)], TODAY)!;
    expect(d.daysBack).toBeGreaterThanOrEqual(1);
  });
});

describe("buildDigest — 무엇을 먼저 싣는가", () => {
  it("사고가 맨 앞이다", () => {
    const d = buildDigest(
      [
        tbm("소화기 압력 미달"),
        patrol("안전난간 일부 파손"),
        tbm("판재 이동 중 손가락 협착으로 병원 치료"),
        tbm("아차사고 — 지게차 후진 중 근접"),
      ],
      TODAY,
    )!;
    expect(d.lines[0].kind).toBe("ACCIDENT");
    expect(d.lines[1].kind).toBe("NEAR_MISS");
  });

  it("같은 위험요인끼리는 순찰 지적을 먼저 둔다", () => {
    // 점검자가 직접 보고 찍은 것이라 조치로 이어질 확률이 높다.
    const d = buildDigest([tbm("크레인 주의 필요"), patrol("크레인 와이어 손상")], TODAY)!;
    expect(d.lines[0].source).toBe("PATROL");
  });

  it("타사 사례는 우리 사고 아래로 내려간다", () => {
    const d = buildDigest(
      [tbm("타사 중대재해 사고 사례 공유"), tbm("우리 공장 크레인 와이어 손상")],
      TODAY,
    )!;
    expect(d.lines[0].kind).toBe("HAZARD");
    expect(d.lines[1].kind).toBe("SHARED");
  });
});

describe("buildDigest — 내용 없는 순찰 줄", () => {
  it("조치·비고가 빈 순찰 지적은 뒤로 미룬다", () => {
    // "설비별 안전순회 — 불량"을 읽어도 할 일이 떠오르지 않는다.
    // 2026-11-19 실측: 음성공장의 유일한 지적이 바로 이 모양이었다.
    const d = buildDigest(
      [
        patrol("설비별 안전순회 — 불량", YESTERDAY, { docId: "thin", thin: true }),
        tbm("크레인 와이어 손상 확인"),
      ],
      TODAY,
    )!;
    expect(d.lines[0].source).toBe("TBM");
    expect(d.lines[1].thin).toBe(true);
  });

  it("버리지는 않는다 — 불량이 났다는 사실은 사실이다", () => {
    const d = buildDigest(
      [patrol("설비별 안전순회 — 불량", YESTERDAY, { thin: true })],
      TODAY,
    )!;
    expect(d.lines).toHaveLength(1);
  });

  it("내용이 얇아도 사고는 맨 앞이다", () => {
    const d = buildDigest(
      [
        tbm("크레인 와이어 손상 확인"),
        patrol("작업자 손가락 협착으로 병원 치료", YESTERDAY, { docId: "acc", thin: true }),
      ],
      TODAY,
    )!;
    expect(d.lines[0].docId).toBe("acc");
    expect(d.lines[0].kind).toBe("ACCIDENT");
  });
});

describe("buildDigest — 중복과 상한", () => {
  it("한 공장 네 법인이 같은 것을 적어도 한 줄로 묶는다", () => {
    // 진천은 아침 TBM을 한자리에서 함께 한다. 그대로 두면 다섯 줄이 같은
    // 문장 네 개로 차 버린다.
    const text = "벨트슬링 파단품 15개 발견";
    const d = buildDigest(
      [
        tbm(text, YESTERDAY, { docId: "a", where: "금문철강(주) 진천공장" }),
        tbm(text, YESTERDAY, { docId: "b", where: "지지산업(주) 진천" }),
        tbm(`${text}.`, YESTERDAY, { docId: "c", where: "케이지산업(주) 진천" }),
        tbm(text, YESTERDAY, { docId: "d", where: "(주)지지스틸텍 진천" }),
      ],
      TODAY,
    )!;
    expect(d.lines).toHaveLength(1);
    expect(d.omitted).toBe(0);
  });

  it("상한을 넘으면 자르고 넘친 수를 적는다", () => {
    const inputs = Array.from({ length: 8 }, (_, i) =>
      tbm(`위험요인 ${i} 크레인 점검 필요`, YESTERDAY, { docId: `d${i}` }),
    );
    const d = buildDigest(inputs, TODAY)!;
    expect(d.lines).toHaveLength(MAX_DIGEST_LINES);
    expect(d.omitted).toBe(3);
  });

  it("상한에 걸려도 사고는 잘리지 않는다", () => {
    // 이것이 이 기능 전체에서 제일 중요한 보장이다.
    const noise = Array.from({ length: 8 }, (_, i) =>
      tbm(`크레인 점검 필요 ${i}`, YESTERDAY, { docId: `n${i}` }),
    );
    const d = buildDigest(
      [...noise, tbm("판재 이동 중 손가락 협착으로 병원 치료", YESTERDAY, { docId: "acc" })],
      TODAY,
    )!;
    expect(d.lines[0].kind).toBe("ACCIDENT");
    expect(d.lines.map((l) => l.docId)).toContain("acc");
  });
});

describe("terseText — 서술형을 개조식으로", () => {
  /*
    진천 특이사항 칸은 실제로 아침 훈화로 쓰이고 있다(2026-11-19 실측).
    여기 적힌 왼쪽 문장들은 모두 진짜 데이터에서 가져온 것이다.
  */
  const CASES: [string, string, boolean][] = [
    [
      "작업전 스트레칭, 졸리면 세수, 체조 등을 하고 작업 하도록 합시다",
      "작업전 스트레칭, 졸리면 세수, 체조",
      true,
    ],
    [
      "호이스트에 사용하는 체인고리 훅해지장치 파손시 즉시 교체 하도록 합시다",
      "호이스트에 사용하는 체인고리 훅해지장치 파손시 즉시 교체",
      true,
    ],
    ["통로 적재물 정리 바랍니다", "통로 적재물 정리", true],
    ["보호구 착용 철저히 해주세요", "보호구 착용 철저", true],
    // 당부가 아닌 줄은 손대지 않는다.
    ["벨트슬링 파단품 15개 발견", "벨트슬링 파단품 15개 발견", false],
    ["지게차 후방 경보기 점검 필요", "지게차 후방 경보기 점검 필요", false],
    ["판재 이동 중 손가락 협착으로 병원 치료", "판재 이동 중 손가락 협착으로 병원 치료", false],
    // 겹친 공백은 정리한다. 실제로 이렇게 적혀 있었다.
    ["크레인 안전작업  교육", "크레인 안전작업 교육", false],
  ];

  for (const [raw, want, urging] of CASES) {
    it(`"${raw.slice(0, 22)}…" → "${want.slice(0, 22)}…"`, () => {
      const out = terseText(raw);
      expect(out.text).toBe(want);
      expect(out.urging).toBe(urging);
    });
  }

  it("어미를 떼면 아무것도 안 남는 줄은 원문을 그대로 둔다", () => {
    // 빈 줄을 공유할 수는 없다.
    expect(terseText("합시다").text).toBe("합시다");
  });

  it("분류는 원문으로 한다 — 어미를 뗀 뒤에 하면 단서가 사라진다", () => {
    const d = buildDigest([tbm("타사 중대재해 사례 공유 하도록 합시다")], TODAY)!;
    expect(d.lines[0].kind).toBe("SHARED");
  });

  it("원문을 raw에 남긴다", () => {
    const raw = "통로 적재물 정리 바랍니다";
    const d = buildDigest([tbm(raw)], TODAY)!;
    expect(d.lines[0].raw).toBe(raw);
    expect(d.lines[0].text).toBe("통로 적재물 정리");
  });
});

describe("lineLabel", () => {
  it("당부한 말은 '권장'으로 적는다", () => {
    // "위험요인 — 작업전 스트레칭"으로 읽히면 안 된다.
    const d = buildDigest([tbm("작업전 스트레칭 하도록 합시다")], TODAY)!;
    expect(lineLabel(d.lines[0])).toBe("권장");
  });

  it("발견한 것은 '위험요인' 그대로다", () => {
    const d = buildDigest([tbm("벨트슬링 파단품 15개 발견")], TODAY)!;
    expect(lineLabel(d.lines[0])).toBe("위험요인");
  });

  it("당부해도 사고는 '사고 발생'이다", () => {
    const d = buildDigest([tbm("협착 사고 발생, 재발 방지에 유의 합시다")], TODAY)!;
    expect(lineLabel(d.lines[0])).toBe("사고 발생");
  });

  it("당부한 말은 발견한 것 아래로 내려간다", () => {
    const d = buildDigest(
      [tbm("보호구 착용 철저히 합시다", YESTERDAY, { docId: "u" }), tbm("벨트슬링 파단품 발견", YESTERDAY, { docId: "f" })],
      TODAY,
    )!;
    expect(d.lines[0].docId).toBe("f");
    expect(d.lines[1].docId).toBe("u");
  });

  it("순찰에서 온 위험요인은 '순찰 지적'으로 적는다", () => {
    const d = buildDigest([patrol("안전난간 일부 파손")], TODAY)!;
    expect(lineLabel(d.lines[0])).toBe("순찰 지적");
  });

  it("순찰에서 온 사고는 그대로 '사고 발생'이다", () => {
    const d = buildDigest([patrol("작업자 손가락 협착으로 병원 치료")], TODAY)!;
    expect(lineLabel(d.lines[0])).toBe("사고 발생");
  });
});

describe("clipText", () => {
  it("짧으면 그대로", () => {
    expect(clipText("크레인 점검", 20)).toBe("크레인 점검");
  });

  it("길면 줄임표를 붙여 자른다", () => {
    const out = clipText("가".repeat(50), 10);
    expect(out).toHaveLength(10);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("previewLines — 적는 사람에게 보여 줄 미리보기", () => {
  it("빈 칸이면 아무것도 없다", () => {
    expect(previewLines("")).toEqual([]);
    expect(previewLines("   ")).toEqual([]);
  });

  it("서술형으로 적으면 '권장'으로 뜬다", () => {
    const [l] = previewLines("작업전 스트레칭 하도록 합시다");
    expect(l.label).toBe("권장");
    expect(l.urging).toBe(true);
    expect(l.shared).toBe(true);
    expect(l.text).toBe("작업전 스트레칭");
  });

  it("있었던 일로 적으면 '위험요인'으로 뜬다", () => {
    const [l] = previewLines("벨트슬링 파단품 15개 발견 → 전량 폐기");
    expect(l.label).toBe("위험요인");
    expect(l.urging).toBe(false);
  });

  it("인원·휴가는 '공유 안 됨'으로 알려 준다", () => {
    // 그 줄이 왜 내일 안 보이는지 적는 자리에서 알게 해야 한다.
    const [l] = previewLines("왓산 입원 중");
    expect(l.label).toBe("공유 안 됨");
    expect(l.shared).toBe(false);
  });

  it("한 칸에 여러 건이면 줄마다 따로 보여 준다", () => {
    const lines = previewLines(
      "1. 왓산 입원 중\n2. 벨트슬링 파단품 발견\n3. 보호구 착용 철저히 합시다",
    );
    expect(lines.map((l) => l.label)).toEqual(["공유 안 됨", "위험요인", "권장"]);
  });

  it("적은 순서를 흔들지 않는다", () => {
    // 치는 동안 줄이 자리를 바꾸면 무엇을 적고 있었는지 놓친다.
    const lines = previewLines("보호구 착용 철저히 합시다\n손가락 협착 사고 발생");
    expect(lines[0].label).toBe("권장");
    expect(lines[1].label).toBe("사고 발생");
  });
});

describe("printsDigest", () => {
  it("기능을 넣은 날 앞의 문서는 종이 모양을 그대로 둔다", () => {
    // 결재가 끝난 문서에 없던 칸이 생기면 보관본과 다시 뽑은 것이 달라진다.
    expect(printsDigest(parseYmd("2026-11-19"))).toBe(false);
    expect(printsDigest(parseYmd("2026-09-01"))).toBe(false);
  });

  it("시행일부터는 찍는다", () => {
    expect(printsDigest(parseYmd(DIGEST_PRINT_FROM))).toBe(true);
    expect(printsDigest(parseYmd("2026-12-01"))).toBe(true);
  });
});
