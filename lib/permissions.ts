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
  siteId: string | null;
};

export const ROLE_LABEL: Record<Role, string> = {
  HQ_ADMIN: "본사 관리자",
  SITE_MANAGER: "안전관리자",
  CEO: "법인 대표",
  TEAM_LEAD: "작업팀장",
};

/**
 * 사업장 격리 조건. 본사 관리자는 전 사업장, 그 외는 소속 사업장만.
 * Prisma where 절에 그대로 펼쳐 쓴다.
 */
export function siteScope(user: SessionUser): { siteId?: string } {
  if (user.role === "HQ_ADMIN") return {};
  // 소속이 없는 비본사 계정은 어떤 사업장에도 매칭되지 않도록 한다.
  return { siteId: user.siteId ?? "__none__" };
}

export function canAccessSite(user: SessionUser, siteId: string): boolean {
  return user.role === "HQ_ADMIN" || user.siteId === siteId;
}

/**
 * 결재(승인·반려) 권한.
 *
 * 결재선은 "안전관리자·팀장이 작성 → 그 법인의 대표가 승인" 한 줄이다.
 * 승인할 수 있는 사람은 그 법인 대표뿐이다. 본사 관리자도 대신 승인하지 않는다.
 * 법인마다 대표가 직접 확인한 기록으로 남아야 의미가 있기 때문이다.
 *
 * 그래서 법인에 대표 계정이 없으면 그 법인의 TBM은 결재되지 않는다.
 * 관리 → 계정 화면이 그 상태를 경고로 알려 준다.
 */
export function canApprove(
  user: SessionUser,
  tbm: { siteId: string; status: TbmStatus },
): boolean {
  if (tbm.status !== "SUBMITTED") return false;
  return user.role === "CEO" && user.siteId === tbm.siteId;
}

/**
 * 내용 편집 권한.
 * 승인된 건은 아무도 못 고친다(기록 무결성). 반려·작성중은 작성 가능자가 고친다.
 * 법인 대표는 결재만 한다 — 자기가 쓰고 자기가 승인하면 결재선이 없는 것과 같다.
 */
export function canEdit(
  user: SessionUser,
  tbm: { siteId: string; status: TbmStatus; teamId: string },
  ledTeamIds: string[],
): boolean {
  if (tbm.status === "APPROVED") return false;
  if (user.role === "CEO") return false;
  if (!canAccessSite(user, tbm.siteId)) return false;
  if (user.role === "HQ_ADMIN" || user.role === "SITE_MANAGER") return true;
  return ledTeamIds.includes(tbm.teamId);
}

export const STATUS_LABEL: Record<TbmStatus, string> = {
  DRAFT: "작성중",
  SUBMITTED: "결재 대기",
  APPROVED: "승인",
  REJECTED: "반려",
};

export const STATUS_STYLE: Record<TbmStatus, string> = {
  DRAFT: "bg-slate-100 text-slate-700 ring-slate-300",
  SUBMITTED: "bg-amber-100 text-amber-800 ring-amber-300",
  APPROVED: "bg-emerald-100 text-emerald-800 ring-emerald-300",
  REJECTED: "bg-rose-100 text-rose-800 ring-rose-300",
};
