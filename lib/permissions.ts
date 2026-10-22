/**
 * 역할·권한 규칙.
 *
 * 세션을 읽지 않는 순수 함수만 둔다. 로그인 확인(requireUser 등)은 @/lib/authz에
 * 있고, 이 파일의 것을 그대로 다시 내보낸다. 부르는 쪽은 authz만 쓰면 된다.
 * 여기를 따로 둔 이유는 규칙을 next-auth 없이 테스트로 고정하기 위해서다.
 */

import type { Role, TbmStatus } from "@prisma/client";

export type SessionUser = {
  id: string;
  name: string;
  role: Role;
  /** 소속 사업장. 문서에 찍히는 소속이자 기본값이다. */
  siteId: string | null;
  /**
   * 이 사람이 맡는 사업장 전부 (소속 + 겸임).
   *
   * 한 사람이 여러 법인의 대표를 겸하는 곳이라, 예전에는 사업장마다 계정을
   * 따로 만들어 로그인을 바꿔가며 결재했다. requireUser 가 채워 준다.
   */
  siteIds: string[];
};

export const ROLE_LABEL: Record<Role, string> = {
  HQ_ADMIN: "본사 관리자",
  SITE_MANAGER: "안전관리자",
  CEO: "법인 대표",
  SAFETY_DIRECTOR: "안전실장",
  DIVISION_HEAD: "본부장",
  TEAM_LEAD: "작업팀장",
};

/**
 * 회사 전체를 보는 자리인지.
 *
 * 본사 관리자와 순찰일지 결재선(안전실장·본부장)이 여기 든다. 셋 다 소속 법인이
 * 없고 어느 사업장이든 들여다볼 수 있어야 한다 — 안전실장이 자기 눈으로 확인하지
 * 못하는 현장을 결재하는 것은 결재가 아니다.
 *
 * 조회 범위일 뿐 편집 권한이 아니다. 쓰기는 canEdit·canApprove가 따로 막는다.
 */
export function isCompanyWide(user: SessionUser): boolean {
  return (
    user.role === "HQ_ADMIN" ||
    user.role === "SAFETY_DIRECTOR" ||
    user.role === "DIVISION_HEAD"
  );
}

/**
 * 사업장 격리 조건. 회사 전체를 보는 자리는 전 사업장, 그 외는 소속 사업장만.
 * Prisma where 절에 그대로 펼쳐 쓴다.
 */
export function siteScope(user: SessionUser): {
  siteId?: { in: string[] };
} {
  if (isCompanyWide(user)) return {};
  // 소속이 없는 그 밖의 계정은 어떤 사업장에도 매칭되지 않도록 한다.
  return { siteId: { in: user.siteIds.length > 0 ? user.siteIds : ["__none__"] } };
}

export function canAccessSite(user: SessionUser, siteId: string): boolean {
  return isCompanyWide(user) || user.siteIds.includes(siteId);
}

/**
 * 결재(승인·반려) 권한.
 *
 * 결재선은 "그 사업장 안전관리자가 작성·상신하고 그 자리에서 결재" 한 줄이다.
 * 2026-10-16에 대표 결재를 내렸다. 대표가 실제로 문서를 들여다보지 못해 본사가
 * 대표 계정으로 눌러 주고 있었고, 그러면 결재란의 이름이 누르지 않은 사람을
 * 가리킨다. 비어 있는 결재란보다 나쁘다 — 기록 자체가 사실이 아니게 된다.
 *
 * 안전관리자는 각 공장의 관리감독자를 겸한다. 그날의 작업 위험을 확인하고 조치할
 * 사람이 그 자리이므로, 그 사람 이름으로 끝나는 것이 사실에 맞다.
 *
 * 대표 계정도 그대로 둔다 — 직접 들어와 누르는 날이 있으면 그것도 유효한 결재다.
 * 본사 관리자는 대표를 대신해 결재할 수 있다(대결). 대결이어도 실제로 누른 사람은
 * 그대로 기록에 남는다. 누가 눌렀는지를 감추면 그 문서는 점검에서 오히려 신뢰를
 * 잃는다. isDelegatedApproval을 함께 볼 것.
 */
export function canApprove(
  user: SessionUser,
  tbm: { siteId: string; status: TbmStatus },
): boolean {
  if (tbm.status !== "SUBMITTED") return false;
  if (user.role === "HQ_ADMIN") return true;
  if (user.role === "CEO") return user.siteIds.includes(tbm.siteId);
  return user.role === "SITE_MANAGER" && user.siteIds.includes(tbm.siteId);
}

/**
 * 이 결재가 대결인지. 본사 관리자가 누른 결재는 대표 권한을 대신 행사한 것이다.
 * 법인 대표 본인이 누른 것은 대결이 아니다.
 */
export function isDelegatedApproval(user: SessionUser): boolean {
  return user.role === "HQ_ADMIN";
}

/**
 * 올리는 순간 끝나는지.
 *
 * 결재자와 작성자가 한 사람이 된 뒤로 상신 → 결재는 같은 사람이 단추를 두 번
 * 누르는 일이 되었다. 자기가 결재할 건을 결재 대기에 세워 둘 이유가 없으니
 * 올리는 순간 완료로 넘긴다. 쌓인 40건이 그 두 번째 단추를 기다리던 것이다.
 *
 * 팀장이 쓴 건은 그대로 결재 대기로 간다 — 그 사업장 안전관리자가 봐야 한다.
 * 판단은 canApprove를 그대로 쓴다. 따로 적으면 두 규칙이 언젠가 갈라진다.
 */
export function completesOnSubmit(
  user: SessionUser,
  tbm: { siteId: string },
): boolean {
  return canApprove(user, { siteId: tbm.siteId, status: "SUBMITTED" });
}

/**
 * 결재자 역할인지. 특정 건이 아니라 화면에 결재 버튼을 둘지 정할 때 쓴다.
 * 실제 승인 여부는 건마다 canApprove로 다시 확인한다.
 */
export function isApprover(user: SessionUser): boolean {
  return (
    user.role === "CEO" || user.role === "HQ_ADMIN" || user.role === "SITE_MANAGER"
  );
}

/**
 * 내용 편집 권한.
 *
 * 반려·작성중은 작성 가능자가 고친다. 승인된 건은 원칙적으로 잠긴다 — 결재가 끝난
 * 문서가 나중에 바뀌면 이 시스템이 막으려는 사후 작성과 다를 바 없기 때문이다.
 *
 * 다만 승인 뒤에 오기가 발견되는 일은 실제로 생긴다. 그래서 본사 관리자만 정정할
 * 수 있게 열어 두고, 정정한 사실과 시각을 문서와 감사 기록에 남긴다.
 * 법인 대표는 결재만 한다. 현장에 서지 않는 자리라 그날의 작업을 쓸 수 없다.
 *
 * 승인 뒤 잠그는 것은 안전관리자가 스스로 결재하게 된 뒤로 더 중요해졌다. 쓰고
 * 승인한 사람이 내용까지 다시 고칠 수 있으면 남는 기록이 아무것도 고정하지 못한다.
 */
export function canEdit(
  user: SessionUser,
  tbm: { siteId: string; status: TbmStatus; teamId: string },
  ledTeamIds: string[],
): boolean {
  if (user.role === "CEO") return false;
  // 순찰일지 결재선은 TBM을 쓰지 않는다. 조회만 한다.
  if (user.role === "SAFETY_DIRECTOR" || user.role === "DIVISION_HEAD") return false;
  if (tbm.status === "APPROVED") return user.role === "HQ_ADMIN";
  if (!canAccessSite(user, tbm.siteId)) return false;
  if (user.role === "HQ_ADMIN" || user.role === "SITE_MANAGER") return true;
  return ledTeamIds.includes(tbm.teamId);
}

/** 승인된 건을 고치는 중인가 (정정으로 기록해야 하는 상황) */
export function isCorrection(tbm: { status: TbmStatus }): boolean {
  return tbm.status === "APPROVED";
}

export const STATUS_LABEL: Record<TbmStatus, string> = {
  DRAFT: "작성중",
  SUBMITTED: "결재 대기",
  // 작성자가 그 자리에서 결재하므로 올리면 끝난다. "승인"은 따로 결재할 사람이
  // 있던 시절의 말이다. 상태값 APPROVED는 그대로 두었다 — 화면 말만 바꾼다.
  APPROVED: "완료",
  REJECTED: "반려",
};

export const STATUS_STYLE: Record<TbmStatus, string> = {
  DRAFT: "bg-slate-100 text-slate-700 ring-slate-300",
  SUBMITTED: "bg-amber-100 text-amber-800 ring-amber-300",
  APPROVED: "bg-emerald-100 text-emerald-800 ring-emerald-300",
  REJECTED: "bg-rose-100 text-rose-800 ring-rose-300",
};
