"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/authz";

export type ActionResult = { error: string | null; message?: string };

/**
 * 출력물에 손으로 받은 최종 서명을 본사가 확인 처리한다.
 *
 * 전자결재와 별개로 센다. 시스템에서 승인이 끝나도 종이 원본에 서명을 받아
 * 보관해야 하는데, 어디까지 받았는지가 어디에도 남지 않으면 결국 사람의 기억에
 * 기대게 된다. 승인이 끝난 문서에만 붙이고, 잘못 눌렀을 때 되돌릴 수 있게 한다.
 */
export async function markPaperSignedAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireRole("HQ_ADMIN");
  const undo = String(formData.get("undo") ?? "") === "1";
  const tbmIds = formData.getAll("tbmIds").map(String).filter(Boolean);
  const patrolIds = formData.getAll("patrolIds").map(String).filter(Boolean);

  if (tbmIds.length + patrolIds.length === 0) {
    return { error: "표시할 문서를 선택해 주세요." };
  }

  const at = undo ? null : new Date();
  const by = undo ? null : user.id;
  const detail = undo ? "수기결재 확인 해제" : "수기결재 확인";

  const [tbmResult, patrolResult] = await prisma.$transaction([
    prisma.tbm.updateMany({
      // 승인이 끝난 문서만 대상이다. 결재 중인 것에 종이 서명이 있을 리 없다.
      where: { id: { in: tbmIds }, status: "APPROVED" },
      data: { paperSignedAt: at, paperSignedById: by },
    }),
    prisma.patrol.updateMany({
      where: { id: { in: patrolIds }, status: "APPROVED" },
      data: { paperSignedAt: at, paperSignedById: by },
    }),
  ]);

  const done = tbmResult.count + patrolResult.count;
  if (done === 0) {
    return { error: "처리할 수 있는 문서가 없습니다. 승인이 끝난 건만 표시됩니다." };
  }

  await prisma.auditLog.createMany({
    data: [
      ...tbmIds.map((id) => ({ tbmId: id, actorId: user.id, action: "PAPER", detail })),
      ...patrolIds.map((id) => ({
        patrolId: id,
        actorId: user.id,
        action: "PAPER",
        detail,
      })),
    ],
  });

  revalidatePath("/approved");
  revalidatePath("/dashboard");

  const skipped = tbmIds.length + patrolIds.length - done;
  return {
    error: null,
    message:
      skipped > 0
        ? `${done}건을 ${undo ? "해제" : "확인"}했습니다. ${skipped}건은 건너뛰었습니다.`
        : `${done}건을 ${undo ? "해제" : "확인"}했습니다.`,
  };
}
