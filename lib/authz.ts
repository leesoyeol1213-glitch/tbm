import { redirect } from "next/navigation";
import type { Role, TbmStatus } from "@prisma/client";
import { auth } from "@/auth";

export type SessionUser = {
  id: string;
  name: string;
  role: Role;
  siteId: string | null;
};

export const ROLE_LABEL: Record<Role, string> = {
  HQ_ADMIN: "본사 관리자",
  SITE_MANAGER: "안전관리자",
  TEAM_LEAD: "작업팀장",
};

/** 로그인 필수. 세션이 없으면 /login으로 보낸다. */
export async function requireUser(): Promise<SessionUser> {
  const session = await auth();
  const u = session?.user;
  if (!u?.id) redirect("/login");
  return { id: u.id, name: u.name ?? "", role: u.role, siteId: u.siteId };
}

/** 특정 역할 필수. 아니면 홈으로 돌려보낸다. */
export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect("/");
  return user;
}

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

/** 결재(승인·반려) 권한 */
export function canApprove(
  user: SessionUser,
  tbm: { siteId: string; status: TbmStatus },
): boolean {
  if (tbm.status !== "SUBMITTED") return false;
  if (user.role === "SITE_MANAGER") return user.siteId === tbm.siteId;
  return user.role === "HQ_ADMIN";
}

/**
 * 내용 편집 권한.
 * 승인된 건은 아무도 못 고친다(기록 무결성). 반려·작성중은 작성 가능자가 고친다.
 */
export function canEdit(
  user: SessionUser,
  tbm: { siteId: string; status: TbmStatus; teamId: string },
  ledTeamIds: string[],
): boolean {
  if (tbm.status === "APPROVED") return false;
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
