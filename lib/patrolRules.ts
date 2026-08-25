/**
 * 순찰일지 규칙과 표시값.
 *
 * DB를 건드리지 않는 순수한 것만 둔다. 클라이언트 컴포넌트가 라벨과 표준 항목을
 * 쓰는데, prisma를 안고 있는 모듈에서 가져오면 그게 브라우저 번들까지 딸려 온다.
 * lib/permissions.ts를 lib/authz.ts에서 떼어 둔 것과 같은 이유다.
 * DB가 필요한 것(ensurePatrol 등)은 lib/patrol.ts에 있고 여기 것을 다시 내보낸다.
 */

import type { PatrolState, TbmStatus } from "@prisma/client";
import { canAccessSite, type SessionUser } from "@/lib/permissions";

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

/**
 * 순찰일지 편집 권한.
 *
 * TBM의 canEdit과 규칙은 같지만 팀 개념이 없다. 순찰은 공장 한 바퀴를 도는
 * 일이라 팀장이 아니라 안전관리자(와 본사)가 쓴다.
 * 법인 대표는 결재만 한다 — 자기가 쓰고 자기가 승인하면 결재선이 없는 것과 같다.
 */
export function canEditPatrol(
  user: SessionUser,
  patrol: { siteId: string; status: TbmStatus },
): boolean {
  if (user.role === "CEO" || user.role === "TEAM_LEAD") return false;
  // 승인된 문서는 잠근다. 다만 오기 정정은 본사만 열어 둔다.
  if (patrol.status === "APPROVED") return user.role === "HQ_ADMIN";
  if (!canAccessSite(user, patrol.siteId)) return false;
  return user.role === "HQ_ADMIN" || user.role === "SITE_MANAGER";
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
