/**
 * QR 자가 등록 때 쓰는 본인 확인 값.
 *
 * 태어난 월일 네 자리만 쓴다. 외국인 근로자가 많아 휴대폰이 자주 바뀌는데,
 * 명부의 번호가 낡으면 정작 본인이 출석을 못 하고 관리자가 번호를 계속
 * 쫓아다녀야 했다. 생년월일은 평생 바뀌지 않아 한 번 넣으면 손댈 일이 없다.
 *
 * 쓰지 않는 값과 그 이유:
 * - 휴대폰: 자주 바뀐다. 위가 그 이유다.
 * - 사번: 명단 화면에 그대로 보이는 데다 A-001 식 순번이라 옆 사람 것을
 *   보고 적으면 그만이다. 확인 구실을 못 한다.
 */

export type VerifyKind = "birth" | "none";

/**
 * 한 번 확인하면 다시 묻지 않는 기간. 반기.
 *
 * 예전에는 기기(쿠키)에만 기억했다. 그런데 작업자들이 카카오톡·네이버 같은
 * 앱 안 브라우저로 QR을 열다 보니 쿠키가 남지 않아, 사실상 매일 생년월일을
 * 넣어야 했다. 그래서 사람 기준으로 기억한다.
 *
 * 대신 확인의 힘은 약해진다. 확인을 마친 사람은 반기 동안 어느 기기에서든
 * 이름만 눌러도 출석이 된다. 매일 65명이 네 자리를 넣는 수고와 맞바꾼 것이다.
 */
export const VERIFY_VALID_DAYS = 183;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 지금 본인 확인을 물어야 하는지.
 *
 * 확인 시각은 실제로 생년월일을 맞춘 때만 새로 찍는다. 출석할 때마다 갱신하면
 * 기간이 끝없이 밀려 반기라는 말이 무의미해진다.
 */
export function needsVerify(
  worker: { birthMmdd: string | null; verifiedAt: Date | null },
  now: Date = new Date(),
): boolean {
  if (!worker.birthMmdd) return false; // 물을 것이 없다
  if (!worker.verifiedAt) return true;
  return now.getTime() - worker.verifiedAt.getTime() > VERIFY_VALID_DAYS * DAY_MS;
}

/**
 * 이번 체크인에서 확인 시각을 새로 남길지.
 *
 * 두 가지 경우에 남긴다.
 *  - 방금 생년월일을 맞춘 경우. 반기가 여기서 다시 시작한다.
 *  - 이 기기를 기억하고 있어 묻지 않았는데 아직 기록이 없는 경우.
 *    그 사람은 예전에 이 기기로 확인을 마쳐 기억된 것인데, 기록이 기기에만
 *    있으면 쿠키가 사라지는 날 다시 묻게 된다. 한 번만 열어 준다.
 *
 * 이미 세워 둔 기록은 갱신하지 않는다. 출석할 때마다 밀리면 반기가 끝나지 않는다.
 */
export function shouldStampVerified(opts: {
  justVerified: boolean;
  /** 이 기기가 바로 이 작업자를 기억하고 있는지 */
  rememberedThisWorker: boolean;
  worker: { birthMmdd: string | null; verifiedAt: Date | null };
}): boolean {
  if (opts.justVerified) return true;
  if (!opts.rememberedThisWorker) return false;
  // 물을 것이 없는 사람에게 확인 기록을 세워 두면 나중에 생년월일을 넣어도
  // 확인을 건너뛴다.
  if (!opts.worker.birthMmdd) return false;
  return opts.worker.verifiedAt === null;
}

/** 다음 확인까지 남은 날. 확인한 적이 없으면 null. */
export function verifyDaysLeft(
  worker: { verifiedAt: Date | null },
  now: Date = new Date(),
): number | null {
  if (!worker.verifiedAt) return null;
  const passed = (now.getTime() - worker.verifiedAt.getTime()) / DAY_MS;
  return Math.max(0, Math.ceil(VERIFY_VALID_DAYS - passed));
}

/**
 * 입력된 생년월일을 월일 네 자리(MMDD)로 다듬는다.
 * "0315", "03-15", "900315", "1990-03-15" 을 모두 받는다.
 * 월일로 읽을 수 없으면 null.
 */
export function normalizeBirthMmdd(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");

  let mmdd: string;
  // 엑셀에서 0315를 숫자로 인식하면 앞자리 0이 떨어져 315로 들어온다.
  if (digits.length === 3) mmdd = `0${digits}`;
  else if (digits.length === 4) mmdd = digits;
  else if (digits.length === 6) mmdd = digits.slice(2); // YYMMDD
  else if (digits.length === 8) mmdd = digits.slice(4); // YYYYMMDD
  else return null;

  const month = Number(mmdd.slice(0, 2));
  const day = Number(mmdd.slice(2));
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  return mmdd;
}

/**
 * 이 작업자에게 무엇을 물어야 하는지.
 *
 * 생년월일이 없으면 아무것도 묻지 않고 통과시킨다. 명부가 덜 채워졌다는
 * 이유로 출석을 막으면 그날 기록이 통째로 비어 버리기 때문이다. 대신
 * 관리 화면에서 남은 인원을 계속 알려 준다.
 */
export function verifyExpectation(worker: {
  birthMmdd: string | null;
}): { kind: VerifyKind; expected: string } {
  if (worker.birthMmdd) return { kind: "birth", expected: worker.birthMmdd };
  return { kind: "none", expected: "" };
}

/** 입력값이 맞는지. 생년월일은 자릿수를 가리지 않고 받아 준다. */
export function verifyMatches(
  kind: VerifyKind,
  expected: string,
  input: string,
): boolean {
  if (kind === "none") return true;
  return normalizeBirthMmdd(input) === expected;
}
