/**
 * 법정의무교육 회차의 상태와 체류시간 판정.
 *
 * 서명은 참석을 증명하고, 두 번 찍힌 시각은 체류시간을 증명한다. 종이 한 장으로는
 * "1시간 앉아 있었다"를 보일 수 없어서 둘을 같이 남긴다. 법이 서명을 요구하는
 * 조문은 없고, 인정되지 않는 것은 "이수 여부를 확인하기 어려운 경우"다 — 그러니
 * 수단은 자유롭고, 확인이 되는지만 따진다.
 *
 * 여기 있는 것은 모두 순수 함수다. 시각은 바깥에서 넣어 준다.
 */

/** 회차가 지금 무엇을 받는 상태인지 */
export type SessionPhase =
  /** 아직 열지 않음 — 스캔을 받지 않는다 */
  | "BEFORE"
  /** 열려 있음 — 시작·종료 스캔을 받는다 */
  | "OPEN"
  /** 닫힘 — 더 받지 않는다 */
  | "CLOSED";

export const PHASE_LABEL: Record<SessionPhase, string> = {
  BEFORE: "시작 전",
  OPEN: "진행 중",
  CLOSED: "마감",
};

export function sessionPhase(session: {
  openedAt: Date | null;
  closedAt: Date | null;
}): SessionPhase {
  if (session.closedAt) return "CLOSED";
  if (session.openedAt) return "OPEN";
  return "BEFORE";
}

/**
 * 한 사람이 지금 무엇을 찍을 차례인지.
 *
 * 첫 스캔을 시작으로, 다음 스캔을 종료로 자동 판정하지 않는다. 교육 중에 실수로
 * 한 번 더 찍으면 그 시각이 퇴장으로 남아 체류시간이 몇 분으로 줄어 버린다.
 * 화면이 지금 차례를 보여 주고 사람이 눌러서 찍게 한다.
 */
export type ScanStep = "START" | "END" | "DONE";

export function scanStep(scan: {
  startedAt: Date | null;
  endedAt: Date | null;
} | null): ScanStep {
  if (!scan?.startedAt) return "START";
  if (!scan.endedAt) return "END";
  return "DONE";
}

/**
 * 체류시간(분). 둘 중 하나라도 없으면 null이다 — 추측해 채우지 않는다.
 * 종료가 시작보다 앞서면(시계 문제, 수기 보정) 믿지 않고 null로 둔다.
 */
export function stayMinutes(scan: {
  startedAt: Date | null;
  endedAt: Date | null;
}): number | null {
  if (!scan.startedAt || !scan.endedAt) return null;
  const min = (scan.endedAt.getTime() - scan.startedAt.getTime()) / 60000;
  if (min < 0) return null;
  return Math.round(min);
}

/**
 * 법정 최소시간을 채웠는지.
 *
 * 성희롱 예방·장애인 인식개선이 각각 1시간이다. 1분 모자란 것을 미달로 적어
 * 두면 쓸 수 없는 기록이 되므로, 재량 여유를 둔다. 여유를 둔다는 사실 자체를
 * 기록에 적어 두어야 나중에 왜 58분이 통과했는지 설명할 수 있다.
 */
export const GRACE_MIN = 3;

export type StayVerdict = "OK" | "SHORT" | "UNKNOWN" | "MANUAL";

export function stayVerdict(
  scan: { startedAt: Date | null; endedAt: Date | null },
  requiredMin: number | null,
): StayVerdict {
  const min = stayMinutes(scan);
  if (min === null) return "UNKNOWN";
  if (requiredMin === null) return "OK";
  return min + GRACE_MIN >= requiredMin ? "OK" : "SHORT";
}

/**
 * 수기 확인이 주장하는 것.
 *
 * QR이 읽히지 않은 사람이 꼭 나온다. 구형 단말기, 배터리, 카메라 권한 — 종이
 * 서명은 받았는데 시각만 없는 경우다. 그 사람을 미기록으로 두면 실제로 참석한
 * 사람이 기록에서 사라지고, 반대로 스캔한 것처럼 시각을 지어 넣으면 기록 전체를
 * 못 믿게 된다.
 *
 * 그래서 수기 확인은 **"회차가 열려 있던 시간 동안 참석했다"**는 뜻으로만 쓴다.
 * 시각을 새로 만들지 않고 회차 자신의 시각(연 때·닫은 때)을 빌려 온다. 그 시각은
 * 본사가 버튼을 누른 실제 시각이라 지어낸 값이 아니다. 본인이 한쪽만 찍었다면
 * 찍힌 쪽은 그대로 쓰고 빈 쪽만 회차 시각으로 메운다 — 실제로 잰 값을 버리지 않는다.
 */
export type EffectiveStay = {
  startedAt: Date | null;
  endedAt: Date | null;
  /** 한쪽이라도 회차 시각으로 메웠는지. 출력물의 "확인" 칸이 이 값을 쓴다. */
  manual: boolean;
  /** 찍힌 시각을 회차 경계로 당겼는지. 종이에 "보정"으로 찍는다. */
  adjusted: boolean;
};

/**
 * 교육 시각 전후로 이만큼 안에 찍힌 것은 회차 시각으로 당겨 인정한다.
 *
 * 실제로는 교육이 시작된 뒤에야 휴대폰을 꺼내는 사람이 대부분이고, 끝날 때도
 * 줄을 서서 나가며 찍는다. 그 몇십 분을 지각·조퇴로 적으면 1시간을 꽉 채워
 * 앉아 있던 사람이 미달로 남는다.
 *
 * 30분으로 끊는 것은 당겨 주는 범위를 눈에 보이게 가두기 위해서다. 10분만
 * 앉아 있다 간 사람(회차 시작에 찍고 12분 뒤에 찍은 사람)은 경계에서 30분을
 * 넘게 떨어져 있으므로 그대로 미달로 남는다 — 측정값의 뜻이 보존된다.
 *
 * 당겨 준 줄은 출력물의 "확인" 칸에 "보정"으로 찍어 깨끗한 측정과 구분한다.
 * 구분을 지우면 모든 줄이 회차 시간과 똑같아져, 잰 의미가 없어진다.
 */
export const ATTEND_GRACE_MIN = 30;

const GRACE_MS = ATTEND_GRACE_MIN * 60_000;

/** 경계에서 유예 안쪽이면 경계로 당긴다. 바깥이면 찍힌 그대로 둔다. */
function snap(at: Date | null, boundary: Date | null): { at: Date | null; moved: boolean } {
  if (!at || !boundary) return { at, moved: false };
  if (Math.abs(at.getTime() - boundary.getTime()) > GRACE_MS) return { at, moved: false };
  // 이미 경계와 같은 시각이면 당긴 것이 아니다 — "보정"을 괜히 찍지 않는다.
  if (at.getTime() === boundary.getTime()) return { at, moved: false };
  return { at: boundary, moved: true };
}

export function effectiveStay(
  scan: {
    startedAt: Date | null;
    endedAt: Date | null;
    manualAt?: Date | null;
  } | null,
  session: { openedAt: Date | null; closedAt: Date | null },
): EffectiveStay {
  if (!scan) return { startedAt: null, endedAt: null, manual: false, adjusted: false };

  if (scan.manualAt) {
    // 수기는 빈 쪽을 회차 시각으로 메운다. 메운 값은 이미 경계라서 당길 것이 없고,
    // 본인이 찍은 쪽은 당겨 인정한다 — 수기와 보정이 겹치면 수기로 적는다.
    const s = snap(scan.startedAt, session.openedAt);
    const e = snap(scan.endedAt, session.closedAt);
    return {
      startedAt: s.at ?? session.openedAt,
      endedAt: e.at ?? session.closedAt,
      manual: true,
      adjusted: false,
    };
  }

  const s = snap(scan.startedAt, session.openedAt);
  const e = snap(scan.endedAt, session.closedAt);
  return {
    startedAt: s.at,
    endedAt: e.at,
    manual: false,
    adjusted: s.moved || e.moved,
  };
}

/**
 * 마감 뒤에도 이만큼은 종료 스캔을 받는다.
 *
 * 본사가 마감을 누른 뒤에 줄 끝에서 찍는 사람이 생긴다. 거절하면 그 사람은
 * "끝을 안 찍은 사람"으로 남고, 본사가 수기로 메워 줘야 한다. 받아 두는 쪽이
 * 손도 덜 가고 기록도 정확하다.
 */
export function acceptsScan(
  session: { openedAt: Date | null; closedAt: Date | null },
  now: Date,
): boolean {
  if (!session.openedAt) return false;
  if (!session.closedAt) return true;
  return now.getTime() - session.closedAt.getTime() <= GRACE_MS;
}

/**
 * 수기로 인정한 사람의 판정은 MANUAL로 따로 둔다.
 *
 * 통과(OK)로 적으면 기계가 잰 것과 사람이 인정한 것이 한 칸에 섞인다. 미달로
 * 적으면 실제로 참석한 사람을 깎는다. 둘 다 사실과 다르므로 셋째 칸을 만든다.
 */
export function stayVerdictOf(
  scan: {
    startedAt: Date | null;
    endedAt: Date | null;
    manualAt?: Date | null;
  } | null,
  session: { openedAt: Date | null; closedAt: Date | null },
  requiredMin: number | null,
): StayVerdict {
  const eff = effectiveStay(scan, session);
  if (eff.manual) return "MANUAL";
  return stayVerdict(eff, requiredMin);
}

/** "1시간 15분" 꼴로. 0분이면 "0분". */
export function minutesLabel(min: number | null): string {
  if (min === null) return "—";
  if (min < 60) return `${min}분`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
}

/** 회차 한 건의 집계. 화면과 출력물이 같은 숫자를 쓰도록 한 곳에 둔다. */
export type SessionTally = {
  /** 명부 인원 */
  total: number;
  /** 시작을 찍은 사람 */
  started: number;
  /** 종료까지 찍은 사람 */
  ended: number;
  /** 최소시간을 채운 사람 */
  ok: number;
  /** 채우지 못한 사람 */
  short: number;
  /** 시작만 찍고 종료가 없는 사람 */
  unknown: number;
  /** QR이 안 읽혀 본사가 수기로 인정한 사람 */
  manual: number;
  /** 찍지도 않고 수기 확인도 없는 사람 */
  missing: number;
  /**
   * 찍힌 시각을 회차 경계로 당겨 준 사람. 위 칸들과 겹친다(보통 ok에 들어 있다) —
   * 합을 맞추는 데 쓰지 말고, 얼마나 당겨 주었는지 보는 데만 쓴다.
   */
  adjusted: number;
};

export function tally(
  workerCount: number,
  scans: {
    startedAt: Date | null;
    endedAt: Date | null;
    manualAt?: Date | null;
  }[],
  requiredMin: number | null,
  session: { openedAt: Date | null; closedAt: Date | null } = {
    openedAt: null,
    closedAt: null,
  },
): SessionTally {
  const started = scans.filter((s) => s.startedAt).length;
  const ended = scans.filter((s) => s.startedAt && s.endedAt).length;
  const manual = scans.filter((s) => s.manualAt).length;

  // ok·short·unknown은 수기로 인정하지 않은 사람만 센다. 수기를 섞으면
  // "최소시간 채움"이 기계가 잰 숫자가 아니게 된다.
  let ok = 0;
  let short = 0;
  let unknown = 0;
  let adjusted = 0;
  for (const s of scans) {
    if (s.manualAt) continue;
    if (!s.startedAt) continue;
    // 경계로 당겨 준 시각으로 판정한다 — 화면과 종이가 같은 숫자를 써야 한다.
    const eff = effectiveStay(s, session);
    if (eff.adjusted) adjusted += 1;
    if (!eff.endedAt) {
      unknown += 1;
      continue;
    }
    if (stayVerdict(eff, requiredMin) === "OK") ok += 1;
    else short += 1;
  }

  // 수기 확인만 있고 스캔이 없는 사람도 참석자다 — 미기록에서 빼야 한다.
  const accounted = new Set<number>();
  scans.forEach((s, i) => {
    if (s.startedAt || s.manualAt) accounted.add(i);
  });

  return {
    total: workerCount,
    started,
    ended,
    ok,
    short,
    unknown,
    manual,
    missing: Math.max(0, workerCount - accounted.size),
    adjusted,
  };
}

/**
 * 스캔 주소에 쓸 토큰. 종이에 QR로 찍히고 하루만 쓰므로 길 필요는 없지만,
 * 짐작으로 맞출 수 있으면 남의 교육에 찍힐 수 있어 넉넉히 둔다.
 */
export function newToken(random: () => string): string {
  return random().replace(/-/g, "").slice(0, 24);
}
