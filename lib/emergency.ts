import { normalizeAddress } from "@/lib/siteGroup";

/**
 * 비상연락망.
 *
 * 공장에 걸려 있는 종이 연락망을 그대로 옮겨 둔다. 법인이 아니라 공장 단위다 —
 * 외국인 고용 때문에 법인을 쪼개 두었을 뿐, 불이 나면 같은 경비실로 뛴다.
 * 그래서 사업장 주소로 찾는다(siteGroup 의 묶음 기준과 같은 열쇠를 쓴다).
 *
 * DB 표를 만들지 않은 이유: 연락망은 1년에 한두 번 바뀌고, 바뀌면 종이와
 * 코드를 같이 고치는 편이 운영 화면을 하나 더 만드는 것보다 확실하다.
 * 바뀐 날짜(effectiveFrom)를 화면과 문서에 같이 찍어, 묵은 번호를 들고 있는지
 * 보는 사람이 바로 알게 한다.
 */

export type EmergencyContact = {
  /** 무슨 일로 거는 번호인지. "경비", "공장장", "화재 발생" 처럼 짧게. */
  role: string;
  /** 사람 이름이나 기관 이름. 역할만으로 충분하면 null. */
  name: string | null;
  phone: string;
};

export type EmergencyGroup = {
  title: string;
  /** 그 자리가 무엇을 맡는지. 종이 연락망의 설명 줄을 옮긴다. */
  note: string | null;
  contacts: EmergencyContact[];
};

export type EmergencyNet = {
  factory: string;
  address: string;
  /** 종이 연락망의 시행일(YYYY-MM-DD). */
  effectiveFrom: string;
  groups: EmergencyGroup[];
};

/** 화면과 문서가 함께 쓰는, 그 사업장에서 보일 연락망 전체. */
export type EmergencyBoard = {
  factory: string;
  /** 119에 불러 줄 주소. 사업장 주소를 그대로 쓴다. */
  address: string;
  effectiveFrom: string;
  groups: EmergencyGroup[];
};

/**
 * 어느 공장에서나 같은 번호.
 *
 * 종이 연락망은 "화재발생 - 진천소방서 043-539-8183" 으로 시작하는데, 불이
 * 났을 때 걸 번호는 소방서 대표번호가 아니라 119다. 사내 전파 순서를 바꾸지
 * 않으면서 119를 맨 앞에 둔다.
 */
export const NATIONAL: EmergencyGroup = {
  title: "긴급 신고",
  note: "불이 났거나 사람이 다쳤으면 사내 보고보다 먼저 건다.",
  contacts: [
    { role: "화재·구조·구급", name: "소방", phone: "119" },
    { role: "사고·범죄", name: "경찰", phone: "112" },
  ],
};

/** 진천공장 비상연락망_260623.pdf 를 옮긴 것. */
const JINCHEON: EmergencyNet = {
  factory: "진천공장",
  address: "충북 진천군 덕산읍 산수산단3로 26",
  effectiveFrom: "2026-06-23",
  groups: [
    {
      title: "1. 경비실 신고",
      note: "재난상황을 발견하면 먼저 경비실로 알린다.",
      contacts: [
        { role: "경비", name: "김진홍", phone: "010-6318-1267" },
        { role: "경비", name: "조항태", phone: "010-4120-9391" },
      ],
    },
    {
      title: "2. 공장장·관리팀 보고",
      note: null,
      contacts: [
        { role: "공장장", name: "문선욱 이사", phone: "010-6585-5439" },
        { role: "관리팀", name: "이소열 과장", phone: "010-3611-2153" },
      ],
    },
    {
      title: "3. 유관기관",
      note: null,
      contacts: [
        { role: "환자 발생", name: "중앙제일병원", phone: "043-533-1711" },
        { role: "화재 발생", name: "진천소방서", phone: "043-539-8183" },
        { role: "상황 공유", name: "진천경찰서", phone: "182" },
      ],
    },
    {
      title: "4. 상황통제·현장수습",
      note: "경비 — 상황 전파 및 통제 / 반장 — 최종 인원 점검",
      contacts: [
        { role: "경비", name: "김진홍", phone: "010-6318-1267" },
        { role: "경비", name: "조항태", phone: "010-4120-9391" },
        // 260623 종이 연락망에는 김진홍 경비와 같은 번호로 적혀 있었다.
        // 오기였고, 2026-11-18 에 확인받아 바로잡았다.
        { role: "반장", name: "이승표", phone: "010-6249-7758" },
      ],
    },
  ],
};

const NETS: EmergencyNet[] = [JINCHEON];

/** 그 주소에 등록된 공장 연락망. 없으면 null. */
export function emergencyFor(address: string | null): EmergencyNet | null {
  const key = normalizeAddress(address);
  if (!key) return null;
  return NETS.find((n) => normalizeAddress(n.address) === key) ?? null;
}

/**
 * 화면·문서에 그릴 연락망. 등록된 공장이 아니면 null — 아무것도 그리지 않는다.
 *
 * 119 번호만 띄워 두는 것도 생각했지만, 연락망이 없는 공장에 "등록되지
 * 않았습니다"라고 적힌 칸이 남아 있으면 비어 있는 것만 못하다. 그 공장
 * 연락망을 받으면 여기에 한 덩이 붙이는 것으로 켜진다.
 *
 * 주소가 비어 있으면 어차피 어느 공장에도 붙지 않는다 — emergencyFor 를 볼 것.
 */
export function emergencyBoard(
  site: { address: string | null },
): EmergencyBoard | null {
  const net = emergencyFor(site.address);
  if (!net) return null;
  return {
    factory: net.factory,
    // 사업장에 적힌 주소를 쓴다. 연락망에 적어 둔 주소는 묶음 열쇠일 뿐이고,
    // 119에 불러 줄 것은 그 사업장 주소다.
    address: site.address?.trim() || net.address,
    effectiveFrom: net.effectiveFrom,
    groups: [NATIONAL, ...net.groups],
  };
}

/** 전화 걸기 주소. 숫자만 남긴다 — 하이픈이 섞이면 못 거는 기기가 있다. */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^0-9]/g, "")}`;
}

/** 한 줄로 적을 때의 모양. "경비 김진홍 010-6318-1267" */
export function contactLabel(c: EmergencyContact): string {
  return c.name ? `${c.role} ${c.name} ${c.phone}` : `${c.role} ${c.phone}`;
}

/**
 * 한 연락망 안에서 사람만 다르고 번호가 같은 경우.
 *
 * 비상연락망에서 번호가 겹치면 둘 중 하나는 안 닿는다는 뜻이다. 같은 사람이
 * 두 자리에 올라 있는 것(경비 김진홍이 신고처와 현장수습에 함께 나오는 것)은
 * 정상이므로, 이름이 다를 때만 센다.
 */
export function duplicatePhones(net: EmergencyNet): string[] {
  const byPhone = new Map<string, Set<string>>();
  for (const g of net.groups) {
    for (const c of g.contacts) {
      const names = byPhone.get(c.phone) ?? new Set<string>();
      names.add(c.name ?? c.role);
      byPhone.set(c.phone, names);
    }
  }
  return [...byPhone.entries()]
    .filter(([, names]) => names.size > 1)
    .map(([phone]) => phone);
}

/** 등록된 연락망 전부. 점검용. */
export function allNets(): EmergencyNet[] {
  return NETS;
}
