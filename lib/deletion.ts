/**
 * 삭제 허용 여부 판단.
 *
 * 안전 기록(출석·TBM)은 보존 대상이므로, 기록이 붙어 있는 항목은 지우지 않고
 * 비활성화로 유도한다. 서버 액션이 이 판단을 그대로 쓴다.
 */

export type DeleteVerdict =
  | { allowed: true; note?: string }
  | { allowed: false; reason: string };

export function judgeWorkerDelete(
  name: string,
  counts: { attendances: number },
): DeleteVerdict {
  if (counts.attendances > 0) {
    return {
      allowed: false,
      reason:
        `${name} 님은 출석 기록이 ${counts.attendances}건 있어 삭제할 수 없습니다. ` +
        `대신 비활성화하면 명단에서 빠지고 과거 기록은 남습니다.`,
    };
  }
  return { allowed: true };
}

export function judgeTeamDelete(
  name: string,
  counts: { tbms: number; workers: number },
): DeleteVerdict {
  if (counts.tbms > 0) {
    return {
      allowed: false,
      reason:
        `"${name}" 팀은 TBM 기록이 ${counts.tbms}건 있어 삭제할 수 없습니다. ` +
        `삭제하면 그 기록이 함께 사라집니다. 대신 비활성화하세요.`,
    };
  }
  return {
    allowed: true,
    note:
      counts.workers > 0
        ? `소속 작업자 ${counts.workers}명은 '팀 미지정'이 되었습니다.`
        : undefined,
  };
}

/** 비활성 인원 일괄 삭제 대상 선별 */
export function splitInactiveForDelete<T extends { id: string; _count: { attendances: number } }>(
  targets: T[],
): { deletable: T[]; kept: T[] } {
  return {
    deletable: targets.filter((w) => w._count.attendances === 0),
    kept: targets.filter((w) => w._count.attendances > 0),
  };
}

export function summarizeBulkDelete(deleted: number, kept: number): string {
  return (
    `${deleted}명을 삭제했습니다.` +
    (kept > 0 ? ` ${kept}명은 출석 기록이 있어 그대로 두었습니다.` : "")
  );
}
