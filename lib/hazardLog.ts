/**
 * 흩어진 위험요인을 한곳에 모아 세는 규칙.
 *
 * 새 입력 창구를 만들지 않는다. 현장은 이미 적고 있다 — TBM 특이사항에 133건,
 * 순찰 점검 불량에 25건. 다만 684개 일지와 183개 순찰일지 안에 한 줄씩 흩어져
 * 있어서, 같은 설비가 반복해 지적되고 있다는 사실 자체가 보이지 않는다.
 * 벨트슬링 파단품이 9월 3일 15개, 10월 2일 60개, 10월 16일 2개로 세 번
 * 올라왔는데 세 번 다 다른 문서에 있다.
 *
 * TBM의 위험요인 칸(HazardItem)은 여기 모으지 않는다. 3,415줄 전부가 템플릿
 * 복사본이고 손으로 고친 것이 한 줄도 없다(2026-11 확인). 모아도 같은 다섯
 * 문장이 3,415번 나올 뿐이다.
 */

/**
 * 한 줄이 무엇을 말하는지. 설비보다 이것이 먼저다 — 사고가 났다는 말과 조심
 * 하자는 말을 같은 칸에 담으면 둘 다 안 보인다.
 */
export type NoteKind =
  /** 실제로 사고가 났다. 우리 사업장에서. */
  | "ACCIDENT"
  /** 아차사고. 다치지는 않았다. */
  | "NEAR_MISS"
  /** 위험요인·주의·조치. 대부분이 여기다. */
  | "HAZARD"
  /** 다른 회사 사고를 교육용으로 공유한 것. 우리 사고가 아니다. */
  | "SHARED"
  /** 인원·연락·운영. 위험요인이 아니다. */
  | "ADMIN";

export const KIND_LABEL: Record<NoteKind, string> = {
  ACCIDENT: "사고 발생",
  NEAR_MISS: "아차사고",
  HAZARD: "위험요인",
  SHARED: "타사 사례",
  ADMIN: "인원·운영",
};

/**
 * 남의 사고를 가리키는 말.
 *
 * 먼저 본다. "중대재해 사고 공유"를 우리 사고로 세면 숫자가 거짓이 되고,
 * 그 숫자로 보고서를 쓰면 없던 재해를 신고하는 셈이 된다.
 */
const SHARED_MARK = /타\s*공장|타사|사고\s*사례|사례\s*공유|중대재해/;

/**
 * 사고가 났다고 단정할 수 있는 말.
 *
 * 치료·진단·보고 절차를 가리키는 낱말만 넣는다. 이런 말은 예방 문장에
 * 섞여 들지 않는다 — "봉합하지 않도록 주의"라고 쓰는 사람은 없다.
 */
const ACCIDENT_HARD =
  /공상|골절|봉합|후송|X-?ray|엑스레이|사고\s*경위|사고\s*내용|사고\s*일시|진단|병원|정형외과/;

/**
 * 사고를 가리키는 듯하나 예방 문장에도 쓰이는 말.
 *
 * "사고 발생"은 났다는 뜻도 되고 "사고 발생하지 않도록"처럼 막자는 뜻도 된다.
 * 뒤에 붙는 말로 가른다. 이 구분을 안 하면 684건 거의 전부가 사고가 된다.
 */
const ACCIDENT_SOFT =
  /(?:사고|재해)\s*발생(?!\s*(?:하지|할|우려|가능|예방|방지|시|되지|을\s*우려))|부상|다쳤|다침|전도\s*사고|이탈하며|충격/;

/** 아차사고를 가리키는 말 */
const NEAR_MISS_MARK = /아차\s*사고/;

/**
 * 인원·연락·운영.
 *
 * 특이사항 133건 중 "왓산 입원 중"류가 45건이다. 사람 사정을 적을 칸이 따로
 * 없어 여기에 적는 것인데, 위험요인과 섞어 세면 화면이 쓸모없어진다.
 */
const ADMIN_MARK =
  /입원|병가|휴가|퇴사|부친상|경조|복귀\s*예정|건강검진|출석\s*체크|출근자만|출근자\s*만|최소\s*인원|작업복|사이즈|기숙사/;

/**
 * 한 줄을 무엇으로 볼지 정한다.
 *
 * 순서가 규칙이다. 남의 사고를 가장 먼저 걸러 내고, 그다음에 우리 사고를
 * 본다. 사고로 판정된 줄은 아차사고나 위험요인으로 내려가지 않는다 —
 * "아차사고 공유 … 새끼 손가락이 끼여 공상 사고 발생"처럼 두 말이 한 줄에
 * 같이 있으면 무거운 쪽으로 읽어야 한다.
 */
export function classifyNote(text: string): NoteKind {
  const t = text.trim();
  if (!t) return "ADMIN";

  // 남의 사고가 먼저다. 단, 우리 치료 기록이 같이 적혀 있으면 우리 사고다.
  if (SHARED_MARK.test(t) && !ACCIDENT_HARD.test(t)) return "SHARED";

  if (ACCIDENT_HARD.test(t) || ACCIDENT_SOFT.test(t)) return "ACCIDENT";
  if (NEAR_MISS_MARK.test(t)) return "NEAR_MISS";

  // 인원 사정은 위험요인 낱말이 하나도 없을 때만. "2공장 휴무 / 왓산 입원 중"
  // 처럼 섞여 있으면 뒤에서 주제로 다시 걸러진다.
  if (ADMIN_MARK.test(t) && !hasAnyTheme(t)) return "ADMIN";

  return "HAZARD";
}

/** 되풀이되는 주제. 설비와 상황을 섞어 두되, 위험성평가에서 쓰는 말로 적는다. */
export type ThemeKey =
  | "CRANE"
  | "SLING"
  | "AISLE"
  | "PPE"
  | "WEATHER"
  | "PINCH"
  | "CHEM"
  | "VEHICLE"
  | "ELEC"
  | "HEALTH";

type Theme = { key: ThemeKey; label: string; words: readonly string[] };

/**
 * 주제 사전.
 *
 * 실제로 적힌 글에서 뽑았다(특이사항 103줄 · 순찰 지적 28건, 2026-11).
 * 오타도 함께 넣는다 — "혹이스트", "벌트슬링", "시우전"이 실제로 적혀 있고,
 * 맞춤법으로만 찾으면 그 줄이 빠진다. 적은 사람을 고치는 것이 이 화면의
 * 일이 아니다.
 *
 * "교육", "주의", "집중", "공유" 같은 낱말은 넣지 않는다. 거의 모든 줄에
 * 들어 있어 주제를 가르지 못한다.
 */
const THEMES: readonly Theme[] = [
  {
    key: "CRANE",
    label: "호이스트·크레인",
    words: [
      "호이스트", "혹이스트", "크레인", "훅", "후크", "해지장치", "체인고리",
      "인양", "리모컨", "거더", "섀들", "중량",
    ],
  },
  {
    key: "SLING",
    label: "슬링·반생이",
    words: ["슬링", "벌트슬링", "반생이", "파단", "걸이대", "볼커터"],
  },
  {
    key: "AISLE",
    label: "통로·적재",
    words: [
      "통로", "적재", "보행", "정리정돈", "걸려넘어", "걸려 넘어", "긁히",
      "찢어짐", "대청소", "쌓여", "넘어지",
    ],
  },
  {
    key: "PPE",
    label: "보호구",
    words: ["보호구", "안전모", "턱끈", "보안경", "보호안경", "안전화", "안전대"],
  },
  {
    key: "WEATHER",
    label: "기상·바닥",
    words: [
      "우천", "미끄", "기온", "안개", "결빙", "폭염", "한파", "온풍기",
      "체온", "스트레칭", "낙상",
    ],
  },
  {
    key: "PINCH",
    label: "끼임·회전체",
    words: [
      "끼임", "끼여", "회전", "롤러", "컨베이어", "협착", "방호", "커플러",
      "손가락", "손 위치", "손위치", "치공구",
    ],
  },
  {
    key: "CHEM",
    label: "화학물질·분진",
    words: ["MSDS", "구리스", "작동유", "유해물질", "철가루"],
  },
  {
    key: "VEHICLE",
    label: "차량·운반",
    words: ["지게차", "차량", "입차", "상차", "하차", "수신호", "충돌", "기사"],
  },
  {
    key: "ELEC",
    label: "전기·설비이상",
    words: [
      "감전", "전원", "전기", "누전", "오작동", "고장", "수리", "소음",
      "안전검사", "압력용기", "시운전", "시우전", "사다리", "아웃트리거",
    ],
  },
  {
    key: "HEALTH",
    label: "보건·위생",
    words: ["위생", "독감", "감기", "건강관리", "근골격"],
  },
];

export const THEME_LABEL = Object.fromEntries(
  THEMES.map((t) => [t.key, t.label]),
) as Record<ThemeKey, string>;

/** 이 줄에 걸리는 주제를 모두 돌려준다. 한 줄이 여러 주제일 수 있다. */
export function themesOf(text: string): ThemeKey[] {
  const t = text.trim();
  if (!t) return [];
  return THEMES.filter((theme) => theme.words.some((w) => t.includes(w))).map(
    (theme) => theme.key,
  );
}

function hasAnyTheme(text: string): boolean {
  return THEMES.some((theme) => theme.words.some((w) => text.includes(w)));
}

/** 모아 놓은 한 줄 */
export type HazardEntry = {
  /** 어디서 왔는지 */
  source: "TBM" | "PATROL";
  /** 그 문서로 가는 링크에 쓸 id */
  docId: string;
  /** 작업일 또는 순찰일 */
  date: Date;
  /** 법인 이름(TBM) 또는 공장 이름(순찰) */
  where: string;
  /** 작업팀(TBM)이나 점검 항목(순찰). 없으면 null */
  detail: string | null;
  text: string;
  kind: NoteKind;
  themes: ThemeKey[];
};

/**
 * 특이사항 한 칸을 줄 단위로 쪼갠다.
 *
 * 한 칸에 여러 건이 들어오는 일이 잦다. "1. 왓산 입원 중 / 2. 공임수 경조
 * 휴가"처럼 번호를 붙여 적거나, 사고 보고를 일시·내용·조치로 나눠 적는다.
 * 칸째로 분류하면 사고 보고가 인원 사정으로 묻히거나 그 반대가 된다.
 *
 * 머리에 붙은 번호("1.", "2)", "- ", "※ ")는 뗀다. 분류에 쓸모가 없고
 * 화면에서도 번호가 두 번 보인다.
 */
export function splitNote(remarks: string | null): string[] {
  if (!remarks) return [];
  return remarks
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:\d+\s*[.)]|[-·*※])\s*/, "").trim())
    .filter((line) => line.length >= 2);
}

/** 주제별 건수. 많은 것부터. */
export type ThemeTally = { key: ThemeKey; label: string; count: number };

export function tallyThemes(entries: HazardEntry[]): ThemeTally[] {
  const n = new Map<ThemeKey, number>();
  for (const e of entries) {
    for (const t of e.themes) n.set(t, (n.get(t) ?? 0) + 1);
  }
  return [...n]
    .map(([key, count]) => ({ key, label: THEME_LABEL[key], count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** 종류별 건수. 화면 맨 위 타일에 쓴다. */
export function tallyKinds(entries: HazardEntry[]): Record<NoteKind, number> {
  const out: Record<NoteKind, number> = {
    ACCIDENT: 0,
    NEAR_MISS: 0,
    HAZARD: 0,
    SHARED: 0,
    ADMIN: 0,
  };
  for (const e of entries) out[e.kind]++;
  return out;
}

/** 주제 하나의 달별 추이 */
export type ThemeTrend = ThemeTally & {
  /** 오래된 달부터. 그 주제가 한 건도 없는 달도 0으로 채워 넣는다. */
  months: { label: string; count: number }[];
  /**
   * 마지막 달이 첫 달보다 늘었는지. 달이 둘 미만이면 판단하지 않는다(null).
   * 같으면 false다 — 줄지 않은 것도 좋은 소식이 아니다.
   */
  rising: boolean | null;
};

/**
 * 주제별 달 추이.
 *
 * "되풀이되는 주제"를 건수나 달 수로 가려내 보았지만 쓸모가 없었다. 주제 열
 * 개 중 아홉 개가 되풀이로 잡혔다(2026-11 확인). 억지로 만든 기준이 아니라
 * 데이터의 사실이다 — 호이스트·통로·기상·슬링이 실제로 매달 다 올라온다.
 * 그러면 "되풀이" 딱지는 아무것도 가려 주지 않는다.
 *
 * 대신 달마다 몇 건이었는지를 그대로 보여 준다. 조치한 뒤에 줄었는지가 보여야
 * 위험성평가가 돌아간 것이고, 석 달 내내 같은 수면 안 돌아간 것이다. 어느
 * 쪽인지는 집계가 판단할 일이 아니라 보는 사람이 판단할 일이다.
 */
export function themeTrends(entries: HazardEntry[]): ThemeTrend[] {
  const monthKey = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

  // 전체 기간의 달을 먼저 세운다. 주제마다 다른 달을 쓰면 줄이 안 맞는다.
  const allMonths = [...new Set(entries.map((e) => monthKey(e.date)))].sort();

  const per = new Map<ThemeKey, Map<string, number>>();
  for (const e of entries) {
    const m = monthKey(e.date);
    for (const t of e.themes) {
      const inner = per.get(t) ?? new Map<string, number>();
      inner.set(m, (inner.get(m) ?? 0) + 1);
      per.set(t, inner);
    }
  }

  return tallyThemes(entries).map((t) => {
    const inner = per.get(t.key) ?? new Map<string, number>();
    const months = allMonths.map((m) => ({
      label: `${Number(m.slice(5))}월`,
      count: inner.get(m) ?? 0,
    }));
    return {
      ...t,
      months,
      rising: months.length < 2 ? null : months.at(-1)!.count >= months[0].count,
    };
  });
}
