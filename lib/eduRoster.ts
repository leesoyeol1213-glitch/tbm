/**
 * 법정의무교육 교육대장(참석자 서명부)에 쓰는 교육 목록.
 *
 * TBM은 산업안전보건법 정기교육의 증빙이 된다(고용노동부가 2023-12부터 인정).
 * 그러나 성희롱 예방·장애인 인식개선처럼 다른 법에 걸린 교육은 따로 실시하고
 * 따로 기록해야 한다. 고용노동부는 자료를 배포·게시하거나 메일만 보내는 것은
 * 교육 실시로 보지 않는다(상시 10인 이상). 그래서 남아야 하는 것이 결국
 * "교육자료 + 참석자 서명 + 사진" 세 가지이고, 그중 가운데를 받아 오기 위한
 * 서식이다.
 *
 * 교육 내용은 각 법 시행령에 적힌 항목을 기본값으로 넣어 두었다. 조문이 개정되면
 * 여기도 같이 고쳐야 하므로, 화면에서 고칠 수 있게 두고 기본값은 참고로만 쓴다.
 */
export const EDU_KINDS = [
  "HARASSMENT",
  "DISABILITY",
  "BULLYING",
  "PRIVACY",
  "RETIREMENT",
] as const;

export type EduKind = (typeof EDU_KINDS)[number];

export type EduPreset = {
  kind: EduKind;
  /** 교육대장에 찍히는 교육명 */
  title: string;
  /** 근거 법령과 주기. 종이에 한 줄로 들어간다. */
  basis: string;
  /**
   * 법에서 요구하는 1회 최소 교육시간(분). 규정이 없으면 null이다.
   * QR 시작·종료 스캔으로 잰 체류시간을 이 값과 견준다.
   */
  requiredMin: number | null;
  /**
   * 법정 의무인지. 직장 내 괴롭힘 예방교육은 고용노동부 법령해석상 의무교육이
   * 아니고 연 1회 권장이다. 의무가 아닌 것을 의무인 양 적어 두면 나중에
   * 무엇을 반드시 해야 하는지가 흐려진다.
   */
  mandatory: boolean;
  /** 화면에서만 보여 주는 한 줄. 갈음 조건이 있으면 여기에 적는다. */
  note: string;
  /** 자료를 받는 곳. 종이에는 찍지 않는다. */
  source: string;
  /** 미리 채워 인쇄할 교육 내용 */
  contents: string[];
};

export const EDU_PRESETS: EduPreset[] = [
  {
    kind: "HARASSMENT",
    title: "직장 내 성희롱 예방교육",
    requiredMin: 60,
    basis: "남녀고용평등법 제13조 · 시행령 제3조 (연 1회, 1시간 이상)",
    mandatory: true,
    note:
      "사업주도 교육 대상입니다. 상시 10인 미만이거나 한 성(性)으로만 구성된 사업장은 " +
      "자료 게시로 갈음할 수 있습니다.",
    source: "고용노동부 정책자료실 — 표준강의안(1시간용) pptx · 자체교육용 영상",
    contents: [
      "직장 내 성희롱에 관한 법령",
      "우리 사업장의 직장 내 성희롱 발생 시 처리 절차와 조치 기준",
      "피해 근로자의 고충상담 및 구제 절차",
      "그 밖에 직장 내 성희롱 예방에 필요한 사항",
    ],
  },
  {
    kind: "DISABILITY",
    title: "직장 내 장애인 인식개선교육",
    requiredMin: 60,
    basis: "장애인고용촉진법 제5조의2 · 시행령 제5조의2 (연 1회, 1시간 이상)",
    mandatory: true,
    note:
      "상시 50인 미만 사업주는 자료를 배포·게시하거나 전자우편을 보내는 방법으로 " +
      "갈음할 수 있습니다. 자료는 3년 보관합니다.",
    source: "직장 내 장애인 인식개선 교육포털(edu.kead.or.kr) — 간이교육용 리플릿, 17개 언어 번역본",
    contents: [
      "장애의 정의 및 장애 유형에 대한 이해",
      "직장 내 장애인의 인권, 차별 금지 및 정당한 편의 제공",
      "장애인 고용촉진 및 직업재활과 관련된 법과 제도",
      "그 밖에 직장 내 장애인 인식개선에 필요한 사항",
    ],
  },
  {
    kind: "BULLYING",
    title: "직장 내 괴롭힘 예방교육",
    requiredMin: null,
    basis: "근로기준법 제76조의2 · 제76조의3 (법정 의무교육 아님 · 연 1회 권장)",
    mandatory: false,
    note:
      "고용노동부 법령해석상 교육은 의무가 아니고 취업규칙 기재 의무만 있습니다. " +
      "성희롱 예방교육에 붙여 함께 기록해 두면 충분합니다.",
    source: "고용노동부 직장 내 괴롭힘 예방·대응 매뉴얼",
    contents: [
      "직장 내 괴롭힘의 정의와 판단 기준",
      "우리 사업장 취업규칙에 정한 예방 및 발생 시 조치 사항",
      "발생 시 신고·조사 절차와 피해자 보호",
      "행위자 조치와 비밀 유지 의무",
    ],
  },
  {
    kind: "PRIVACY",
    title: "개인정보 보호교육",
    requiredMin: null,
    basis: "개인정보보호법 제28조 (횟수·시간 규정 없음)",
    mandatory: true,
    note: "전 근로자가 아니라 개인정보를 취급하는 사람만 대상입니다.",
    source: "개인정보보호 포털(privacy.go.kr) 교육자료",
    contents: [
      "개인정보 취급자의 범위와 책임",
      "수집·이용·제공의 기준과 동의 절차",
      "안전성 확보에 필요한 조치",
      "유출 시 통지·신고 절차",
    ],
  },
  {
    kind: "RETIREMENT",
    title: "퇴직연금제도 교육",
    requiredMin: null,
    basis: "근로자퇴직급여보장법 제32조 (연 1회)",
    mandatory: true,
    note: "확정급여형(DB)·확정기여형(DC)을 도입한 사업장만 해당합니다.",
    source: "금융감독원·근로복지공단 퇴직연금 교육자료",
    contents: [
      "우리 사업장이 도입한 제도의 종류와 내용",
      "급여 수급 요건과 지급 절차",
      "적립금 운용 방법과 유의사항",
      "담당자 연락처와 문의 방법",
    ],
  },
];

export function findPreset(kind: string): EduPreset | null {
  return EDU_PRESETS.find((p) => p.kind === kind) ?? null;
}

/**
 * 명부에 없는 사람이 와서 들을 때를 위해 비워 두는 줄의 수.
 *
 * 일용직이나 당일 배치된 사람이 꼭 한두 명 생기는데, 그때 종이가 없으면
 * 다른 데 적어 두고 나중에 옮기게 된다. 옮기는 과정에서 빠지는 게 가장 흔한
 * 누락이라 아예 자리를 비워 둔다.
 */
export const BLANK_ROWS = 3;

/**
 * 한 장에 담는 사람 수로 장수를 미리 센다. 화면에서 "몇 장 나옵니다"를
 * 보여 주려고 쓴다. 지면 계산은 lib/eduRosterPdf.ts와 맞춰 두어야 한다.
 */
export function countPages(workerCount: number, firstPage: number, laterPage: number): number {
  const rows = workerCount + BLANK_ROWS;
  if (rows <= firstPage) return 1;
  return 1 + Math.ceil((rows - firstPage) / laterPage);
}
