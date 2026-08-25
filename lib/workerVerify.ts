/**
 * QR 자가 등록 때 쓰는 본인 확인 값.
 *
 * 외국인 근로자가 많아 휴대폰이 자주 바뀐다. 명부의 번호가 낡으면 정작 본인이
 * 출석을 못 하고 관리자가 매번 번호를 쫓아다녀야 한다. 그래서 평생 바뀌지 않는
 * 생년월일 월일 네 자리를 기본으로 쓴다.
 *
 * 사번은 확인 값으로 쓰지 않는다. 명단 화면에 그대로 보이는 데다 A-001 식
 * 순번이라 옆 사람 것을 보고 그대로 적을 수 있어 확인 구실을 못 한다.
 */

export type VerifyKind = "birth" | "phone" | "none";

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

/** 이 작업자에게 무엇을 물어야 하는지. */
export function verifyExpectation(worker: {
  birthMmdd: string | null;
  phone: string | null;
}): { kind: VerifyKind; expected: string } {
  if (worker.birthMmdd) return { kind: "birth", expected: worker.birthMmdd };

  const last4 = (worker.phone ?? "").replace(/\D/g, "").slice(-4);
  if (last4.length === 4) return { kind: "phone", expected: last4 };

  // 확인할 값이 없으면 막지 않는다. 명부가 덜 채워졌다는 이유로 출석을
  // 못 하게 하면 기록이 통째로 비어 버린다.
  return { kind: "none", expected: "" };
}

/** 입력값이 맞는지. 생년월일은 자릿수를 가리지 않고 받아 준다. */
export function verifyMatches(
  kind: VerifyKind,
  expected: string,
  input: string,
): boolean {
  if (kind === "none") return true;
  const typed = (input ?? "").replace(/\D/g, "");
  if (kind === "birth") return normalizeBirthMmdd(typed) === expected;
  return typed === expected;
}
