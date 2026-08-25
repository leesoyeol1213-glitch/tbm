/**
 * 순찰일지 규칙과 표시값.
 *
 * DB를 건드리지 않는 순수한 것만 둔다. 클라이언트 컴포넌트가 라벨과 표준 항목을
 * 쓰는데, prisma를 안고 있는 모듈에서 가져오면 그게 브라우저 번들까지 딸려 온다.
 * lib/permissions.ts를 lib/authz.ts에서 떼어 둔 것과 같은 이유다.
 * DB가 필요한 것(ensurePatrol 등)은 lib/patrol.ts에 있고 여기 것을 다시 내보낸다.
 */

import type { PatrolState, PatrolStatus } from "@prisma/client";
import type { SessionUser } from "@/lib/permissions";

/** 순찰 시간 기본값 (KST "HH:mm"). 작성 화면에 미리 채워 두기만 한다. */
export const DEFAULT_PATROL_FROM = "08:00";
export const DEFAULT_PATROL_UNTIL = "09:00";

export const PATROL_STATE_LABEL: Record<PatrolState, string> = {
  GOOD: "양호",
  BAD: "불량",
  NA: "해당없음",
};

export const PATROL_STATE_STYLE: Record<PatrolState, string> = {
  GOOD: "bg-emerald-100 text-emerald-800 ring-emerald-300",
  BAD: "bg-rose-100 text-rose-800 ring-rose-300",
  NA: "bg-slate-100 text-slate-600 ring-slate-300",
};

export function isPatrolState(v: string): v is PatrolState {
  return v === "GOOD" || v === "BAD" || v === "NA";
}

export const PATROL_STATUS_LABEL: Record<PatrolStatus, string> = {
  DRAFT: "작성중",
  SUBMITTED: "안전실장 결재 대기",
  REVIEWED: "본부장 결재 대기",
  APPROVED: "승인",
  REJECTED: "반려",
};

export const PATROL_STATUS_STYLE: Record<PatrolStatus, string> = {
  DRAFT: "bg-slate-100 text-slate-700 ring-slate-300",
  SUBMITTED: "bg-amber-100 text-amber-800 ring-amber-300",
  REVIEWED: "bg-sky-100 text-sky-800 ring-sky-300",
  APPROVED: "bg-emerald-100 text-emerald-800 ring-emerald-300",
  REJECTED: "bg-rose-100 text-rose-800 ring-rose-300",
};

type PatrolRef = { plantId: string; status: PatrolStatus };

/**
 * 순찰일지 편집 권한.
 *
 * 담당으로 지정된 공장만 쓴다. 순찰은 법인이 아니라 공장 단위라 소속 법인이
 * 어디인지는 보지 않는다 — 진천 1공장 담당이면 그 사람이 어느 법인 소속이든
 * 1공장 일지를 쓴다.
 *
 * 승인된 문서는 잠근다. 결재가 끝난 문서가 나중에 바뀌면 이 시스템이 막으려는
 * 사후 작성과 다를 바 없기 때문이다. 다만 오기 정정은 실제로 생기므로
 * 본사 관리자만 열어 두고, 정정한 사실과 시각을 문서와 감사 기록에 남긴다.
 */
export function canEditPatrol(
  user: SessionUser,
  patrol: PatrolRef,
  managedPlantIds: string[],
): boolean {
  if (patrol.status === "APPROVED") return user.role === "HQ_ADMIN";
  if (user.role === "HQ_ADMIN") return true;
  // 결재자는 결재만 한다. 자기가 쓰고 자기가 승인하면 결재선이 없는 것과 같다.
  if (user.role === "SAFETY_DIRECTOR" || user.role === "DIVISION_HEAD") return false;
  return managedPlantIds.includes(patrol.plantId);
}

/** 1차 결재(안전실장) 권한. 상신된 건만 대상이다. */
export function canReviewPatrol(user: SessionUser, patrol: PatrolRef): boolean {
  if (patrol.status !== "SUBMITTED") return false;
  return user.role === "SAFETY_DIRECTOR" || user.role === "HQ_ADMIN";
}

/** 최종 결재(본부장) 권한. 안전실장을 거친 건만 대상이다. */
export function canApprovePatrol(user: SessionUser, patrol: PatrolRef): boolean {
  if (patrol.status !== "REVIEWED") return false;
  return user.role === "DIVISION_HEAD" || user.role === "HQ_ADMIN";
}

/**
 * 이 결재가 대결인지. 본사 관리자가 누른 것은 안전실장·본부장 권한을 대신
 * 행사한 것이다. 실제로 누른 사람은 그대로 기록에 남는다 — 감추면 그 문서는
 * 점검에서 오히려 신뢰를 잃는다.
 */
export function isPatrolDelegated(user: SessionUser): boolean {
  return user.role === "HQ_ADMIN";
}

/** 순찰일지를 볼 수 있는지. 팀장은 순찰과 무관하다. */
export function canViewPatrols(user: SessionUser): boolean {
  return user.role !== "TEAM_LEAD";
}

/** 승인된 건을 고치는 중인가 (정정으로 기록해야 하는 상황) */
export function isPatrolCorrection(patrol: { status: PatrolStatus }): boolean {
  return patrol.status === "APPROVED";
}

/** 양식에 처음 넣어 둘 표준 점검항목. 현장에서 고쳐 쓰라고 있는 값이다. */
export const DEFAULT_PATROL_ITEMS = [
  "안전보호구 착용 준수여부",
  "작업장통로 확보 및 정리정돈여부",
  "작업표준서에 의한 작업 시행여부",
  "크레인 사용 안전작업 시행여부",
  "안전표지판 등 부착상태",
  "철근적재시 안전수칙 준수여부",
  "기계(설비) 방호장치(커버)등 설치여부",
  "공장내 MSDS(구리스등) 위반여부",
  "고장 수리시 안전작업 시행여부",
  "고소작업시 안전벨트 착용여부",
  "기타 유해위험 요인",
];
