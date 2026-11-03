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

export type StayVerdict = "OK" | "SHORT" | "UNKNOWN";

export function stayVerdict(
  scan: { startedAt: Date | null; endedAt: Date | null },
  requiredMin: number | null,
): StayVerdict {
  const min = stayMinutes(scan);
  if (min === null) return "UNKNOWN";
  if (requiredMin === null) return "OK";
  return min + GRACE_MIN >= requiredMin ? "OK" : "SHORT";
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
  /** 한 번도 찍지 않은 사람 */
  missing: number;
};

export function tally(
  workerCount: number,
  scans: { startedAt: Date | null; endedAt: Date | null }[],
  requiredMin: number | null,
): SessionTally {
  const started = scans.filter((s) => s.startedAt).length;
  const ended = scans.filter((s) => s.startedAt && s.endedAt).length;

  let ok = 0;
  let short = 0;
  for (const s of scans) {
    if (!s.startedAt || !s.endedAt) continue;
    if (stayVerdict(s, requiredMin) === "OK") ok += 1;
    else short += 1;
  }

  return {
    total: workerCount,
    started,
    ended,
    ok,
    short,
    unknown: started - ended,
    missing: Math.max(0, workerCount - started),
  };
}

/**
 * 스캔 주소에 쓸 토큰. 종이에 QR로 찍히고 하루만 쓰므로 길 필요는 없지만,
 * 짐작으로 맞출 수 있으면 남의 교육에 찍힐 수 있어 넉넉히 둔다.
 */
export function newToken(random: () => string): string {
  return random().replace(/-/g, "").slice(0, 24);
}
