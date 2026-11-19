import { normalizeAddress } from "@/lib/siteGroup";
import { ymd } from "@/lib/kst";

/**
 * TBM 주재자와 교육 장소.
 *
 * 고용노동부가 낸 TBM 예시 양식의 항목은 일자 · 장소 · 시간 · 강사 ·
 * 참석 인원/총원 다섯이다. 우리 출력물에는 장소와 강사가 없었다. Tbm 표에도
 * 칸이 없고, authorId는 문서를 *작성한* 계정이지 교육을 *진행한* 사람이
 * 아니다. 안전보건교육규정 제4조로 TBM을 정기교육 시간으로 인정받는 일을
 * 다투게 되면 이 둘이 먼저 걸린다.
 *
 * 입력 칸을 만들지 않았다. 둘 다 공장마다 고정값이기 때문이다 —
 * 진천은 생산팀장 한 사람이 네 법인을 모두 교육하고, 1공장·2공장 모두
 * 출하 게이트에서 한다(2026-11-19 확인). 매일 같은 값을 네 번 적게 하면
 * 결국 아무도 안 적고, 빈 칸이 찍힌 문서가 나온다. 비상연락망과 같은 꼴이라
 * 같은 방식으로 둔다 — 코드에 적고, 바뀌면 여기만 고친다.
 *
 * 묶음 기준은 주소다. 법인이 아니다. 한 공장에 든 법인은 한자리에서 같은
 * 사람에게 교육받는다.
 */
export type TbmHost = {
  factory: string;
  address: string;
  /** 주재자 역할. 이 공장에서 TBM을 실제로 진행하는 자리. */
  hostRole: string;
  /**
   * 주재자 이름. null이면 역할만 찍는다.
   *
   * 이름이 들어가는 쪽이 증빙으로 강하다. 다만 사람 이름을 추측해 교육
   * 기록에 적을 수는 없어, 확인되기 전까지는 비워 둔다.
   */
  hostName: string | null;
  /** 교육 장소. 예시 양식의 "장소" 칸. */
  place: string;
  /**
   * 이 날부터의 문서에만 찍는다.
   *
   * 앞선 문서는 이미 결재가 끝나 종이로 보관되고 있다. 없던 칸이 생기면
   * 보관본과 다시 뽑은 것이 달라진다. 더구나 지난 8월 TBM이 지금의 생산
   * 팀장에게, 지금의 출하 게이트에서 열렸다고 단정할 근거가 우리에게 없다.
   */
  effectiveFrom: string;
};

const JINCHEON: TbmHost = {
  factory: "진천공장",
  address: "충북 진천군 덕산읍 산수산단3로 26",
  hostRole: "생산팀장",
  // 진천 네 법인 모두 "생산팀" 하나씩을 두고 있으나(64명), 그 팀의 팀장으로
  // 지정된 계정이 없다(2026-11-19 확인). 이름이 확인되면 여기만 채운다.
  hostName: null,
  place: "출하 게이트",
  effectiveFrom: "2026-11-20",
};

const HOSTS: TbmHost[] = [JINCHEON];

export function tbmHostFor(address: string | null): TbmHost | null {
  const key = normalizeAddress(address);
  if (!key) return null;
  return HOSTS.find((h) => normalizeAddress(h.address) === key) ?? null;
}

/**
 * 이 작업일의 문서에 찍을 주재자·장소. 등록하지 않은 공장이거나 시행일
 * 앞의 작업일이면 null — 그 자리에 아무것도 찍지 않는다.
 */
export function tbmHostOn(
  site: { address: string | null },
  workDate: Date,
): TbmHost | null {
  const host = tbmHostFor(site.address);
  if (!host) return null;
  return ymd(workDate) >= host.effectiveFrom ? host : null;
}

/** 출력물의 "강사" 칸에 찍을 말. */
export function hostLabel(host: TbmHost): string {
  return host.hostName ? `${host.hostRole} ${host.hostName}` : host.hostRole;
}

export function allHosts(): TbmHost[] {
  return HOSTS;
}
