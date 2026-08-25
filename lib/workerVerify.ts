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
