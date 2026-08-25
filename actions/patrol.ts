"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser, type SessionUser } from "@/lib/authz";
import {
  canApprovePatrol,
  canEditPatrol,
  canReviewPatrol,
  delegateTarget,
  ensurePatrol,
  isPatrolCorrection,
  isPatrolDelegated,
  isPatrolState,
  managedPlantIds,
} from "@/lib/patrol";
import { kstDateOnly, parseYmd } from "@/lib/kst";

export type ActionResult = { error: string | null; message?: string };

/** 편집 권한을 확인하고 순찰일지를 반환한다. */
async function loadEditable(user: SessionUser, patrolId: string) {
  const patrol = await prisma.patrol.findUnique({ where: { id: patrolId } });
  if (!patrol) throw new Error("순찰일지를 찾을 수 없습니다.");
  if (!canEditPatrol(user, patrol, await managedPlantIds(user))) {
    throw new Error("이 기록을 수정할 권한이 없습니다.");
  }
  return patrol;
}

function refresh(patrolId: string) {
  revalidatePath(`/patrol/${patrolId}`);
  revalidatePath("/patrol");
  revalidatePath("/approvals");
  revalidatePath("/dashboard");
}

/** "HH:mm"(KST) → 순찰일 기준 절대 시각 */
function toKstTime(base: Date, raw: string): Date | null {
  if (!/^\d{2}:\d{2}$/.test(raw)) return null;
  const [h, m] = raw.split(":").map(Number);
  return new Date(base.getTime() + (h * 60 + m - 9 * 60) * 60_000);
}

/** 담당자가 그날 순찰일지를 연다. 이미 있으면 그 건으로 이동. */
export async function openPatrolAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const plantId = String(formData.get("plantId") ?? "");
  const dateStr = String(formData.get("patrolDate") ?? "");

  if (!plantId) throw new Error("공장을 선택해 주세요.");
  if (!canEditPatrol(user, { plantId, status: "DRAFT" }, await managedPlantIds(user))) {
    throw new Error("이 공장의 순찰일지를 작성할 권한이 없습니다.");
  }

  const patrolDate = dateStr ? parseYmd(dateStr) : kstDateOnly();
  const patrol = await ensurePatrol(plantId, patrolDate, {
    actorId: user.id,
    patrollerName: user.name,
  });

  refresh(patrol.id);
  redirect(`/patrol/${patrol.id}`);
}

type RoundInput = { place: string; content: string; state: string; note: string };

function parseRounds(raw: string): RoundInput[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((r) => {
        const v = r as Partial<RoundInput>;
        const state = String(v?.state ?? "");
        return {
          place: String(v?.place ?? "").trim(),
          content: String(v?.content ?? "").trim(),
          state: isPatrolState(state) ? state : "GOOD",
          note: String(v?.note ?? "").trim(),
        };
      })
      // 장소와 내용이 모두 비면 빈 줄이므로 버린다.
      .filter((r) => r.place.length > 0 || r.content.length > 0);
  } catch {
    return [];
  }
}

/** 내용 저장. 승인된 건을 고치면 정정으로 기록한다. */
export async function savePatrolAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const patrolId = String(formData.get("patrolId") ?? "");
  const patrol = await loadEditable(user, patrolId);

  const patrollerName = String(formData.get("patrollerName") ?? "").trim();
  const weather = String(formData.get("weather") ?? "").trim();
  const remarks = String(formData.get("remarks") ?? "").trim();
  const startedAt = toKstTime(
    patrol.patrolDate,
    String(formData.get("startedAt") ?? "").trim(),
  );
  const endedAt = toKstTime(
    patrol.patrolDate,
    String(formData.get("endedAt") ?? "").trim(),
  );
  const rounds = parseRounds(String(formData.get("rounds") ?? "[]"));

  // 점검항목은 줄마다 판정과 조치사항이 따로 넘어온다.
  const checks = await prisma.patrolCheck.findMany({
    where: { patrolId },
    select: { id: true },
  });

  await prisma.$transaction([
    prisma.patrol.update({
      where: { id: patrolId },
      data: {
        patrollerName,
        weather: weather || null,
        remarks: remarks || null,
        startedAt,
        endedAt,
        // 반려된 건을 고치면 다시 작성중으로 되돌린다.
        status: patrol.status === "REJECTED" ? "DRAFT" : patrol.status,
        // 승인된 건을 고치는 것은 정정이다. 승인 자체는 두고 흔적을 남긴다.
        ...(isPatrolCorrection(patrol) ? { correctedAt: new Date() } : {}),
      },
    }),
    ...checks.map((c) => {
      const rawState = String(formData.get(`state_${c.id}`) ?? "GOOD");
      return prisma.patrolCheck.update({
        where: { id: c.id },
        data: {
          state: isPatrolState(rawState) ? rawState : "GOOD",
          action: String(formData.get(`action_${c.id}`) ?? "").trim() || null,
        },
      });
    }),
    prisma.patrolRound.deleteMany({ where: { patrolId } }),
    ...rounds.map((r, i) =>
      prisma.patrolRound.create({
        data: {
          patrolId,
          place: r.place,
          content: r.content,
          state: isPatrolState(r.state) ? r.state : "GOOD",
          note: r.note || null,
          sort: i,
        },
      }),
    ),
    prisma.auditLog.create({
      data: {
        patrolId,
        actorId: user.id,
        action: isPatrolCorrection(patrol) ? "CORRECT" : "UPDATE",
      },
    }),
  ]);

  refresh(patrolId);
}

/** 결재 상신 — 안전실장 앞으로 올린다. */
export async function submitPatrolAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const patrolId = String(formData.get("patrolId") ?? "");

  try {
    const patrol = await loadEditable(user, patrolId);

    if (patrol.status !== "DRAFT" && patrol.status !== "REJECTED") {
      return { error: "이미 결재가 진행 중이거나 끝난 기록입니다." };
    }
    if (!patrol.patrollerName.trim()) return { error: "순찰자를 입력해 주세요." };

    const [roundCount, badWithoutAction] = await Promise.all([
      prisma.patrolRound.count({ where: { patrolId } }),
      // 불량인데 조치사항이 비면 무엇을 했는지 알 수 없는 기록이 된다.
      prisma.patrolCheck.count({
        where: { patrolId, state: "BAD", OR: [{ action: null }, { action: "" }] },
      }),
    ]);

    if (roundCount === 0) return { error: "순찰사항을 최소 한 줄 적어 주세요." };
    if (badWithoutAction > 0) {
      return {
        error: `불량으로 표시한 항목 ${badWithoutAction}건에 조치사항이 비어 있습니다.`,
      };
    }

    await prisma.patrol.update({
      where: { id: patrolId },
      data: {
        status: "SUBMITTED",
        submittedAt: new Date(),
        authorId: patrol.authorId ?? user.id,
        rejectReason: null,
        logs: { create: { actorId: user.id, action: "SUBMIT" } },
      },
    });

    refresh(patrolId);
    return { error: null };
  } catch (e) {
    return { error: (e as Error)?.message ?? "상신하지 못했습니다." };
  }
}

/** 1차 결재 — 안전실장 승인. 본부장 앞으로 넘어간다. */
export async function reviewPatrolAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const patrolId = String(formData.get("patrolId") ?? "");

  const patrol = await prisma.patrol.findUnique({ where: { id: patrolId } });
  if (!patrol) return { error: "순찰일지를 찾을 수 없습니다." };
  if (!canReviewPatrol(user, patrol)) return { error: "안전실장 결재 권한이 없습니다." };

  const onBehalf = isPatrolDelegated(user) ? await delegateTarget("SAFETY_DIRECTOR") : null;

  await prisma.patrol.update({
    where: { id: patrolId },
    data: {
      status: "REVIEWED",
      reviewerId: user.id,
      reviewedAt: new Date(),
      reviewOnBehalfId: onBehalf,
      rejectReason: null,
      logs: {
        create: {
          actorId: user.id,
          action: "REVIEW",
          detail: onBehalf ? "안전실장 대결" : "안전실장 결재",
        },
      },
    },
  });

  refresh(patrolId);
  return { error: null };
}

/** 최종 결재 — 본부장 승인 */
export async function approvePatrolAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const patrolId = String(formData.get("patrolId") ?? "");

  const patrol = await prisma.patrol.findUnique({ where: { id: patrolId } });
  if (!patrol) return { error: "순찰일지를 찾을 수 없습니다." };
  if (!canApprovePatrol(user, patrol)) return { error: "본부장 결재 권한이 없습니다." };

  const onBehalf = isPatrolDelegated(user) ? await delegateTarget("DIVISION_HEAD") : null;

  await prisma.patrol.update({
    where: { id: patrolId },
    data: {
      status: "APPROVED",
      approverId: user.id,
      approvedAt: new Date(),
      onBehalfOfId: onBehalf,
      rejectReason: null,
      logs: {
        create: {
          actorId: user.id,
          action: "APPROVE",
          detail: onBehalf ? "본부장 대결" : "본부장 결재",
        },
      },
    },
  });

  refresh(patrolId);
  return { error: null };
}

/**
 * 반려. 어느 단계에서 반려하든 작성자에게 되돌린다.
 * 안전실장이 반려한 것을 본부장 단계로 넘겨 둘 이유가 없다.
 */
export async function rejectPatrolAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const patrolId = String(formData.get("patrolId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();

  if (!reason) return { error: "반려 사유를 적어 주세요." };

  const patrol = await prisma.patrol.findUnique({ where: { id: patrolId } });
  if (!patrol) return { error: "순찰일지를 찾을 수 없습니다." };
  if (!canReviewPatrol(user, patrol) && !canApprovePatrol(user, patrol)) {
    return { error: "결재 권한이 없습니다." };
  }

  await prisma.patrol.update({
    where: { id: patrolId },
    data: {
      status: "REJECTED",
      rejectReason: reason,
      reviewerId: null,
      reviewedAt: null,
      reviewOnBehalfId: null,
      approverId: null,
      approvedAt: null,
      onBehalfOfId: null,
      logs: { create: { actorId: user.id, action: "REJECT", detail: reason } },
    },
  });

  refresh(patrolId);
  return { error: null };
}

/**
 * 여러 건을 한 번에 결재한다.
 *
 * 작성자는 매일 올리고 결재자는 월·분기에 몰아서 넘기는 방식을 위한 것이다.
 * 단계에 맞는 건만 처리한다 — 안전실장이 누르면 상신된 건이, 본부장이 누르면
 * 안전실장을 거친 건이 넘어간다. 승인 시각은 소급하지 않고 실제로 누른 지금으로
 * 남는다. 순찰일에 맞춰 찍으면 그 문서는 사후 작성과 구분되지 않는다.
 */
export async function approveManyPatrolsAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const stage = String(formData.get("stage") ?? "");
  const ids = formData.getAll("patrolIds").map(String).filter(Boolean);

  if (stage !== "review" && stage !== "approve") return { error: "결재 단계가 잘못됐습니다." };
  if (ids.length === 0) return { error: "결재할 기록을 선택해 주세요." };

  const wantStatus = stage === "review" ? "SUBMITTED" : "REVIEWED";
  const targets = await prisma.patrol.findMany({
    where: { id: { in: ids }, status: wantStatus },
    select: { id: true, plantId: true, status: true },
  });

  const allowed = targets.filter((t) =>
    stage === "review" ? canReviewPatrol(user, t) : canApprovePatrol(user, t),
  );
  if (allowed.length === 0) {
    return { error: "결재할 수 있는 기록이 없습니다. 권한과 상태를 확인해 주세요." };
  }

  const now = new Date();
  const onBehalf = isPatrolDelegated(user)
    ? await delegateTarget(stage === "review" ? "SAFETY_DIRECTOR" : "DIVISION_HEAD")
    : null;
  const allowedIds = allowed.map((t) => t.id);

  await prisma.$transaction([
    prisma.patrol.updateMany({
      // 그 사이 다른 사람이 손댔을 수 있으므로 상태를 다시 확인하고 바꾼다.
      where: { id: { in: allowedIds }, status: wantStatus },
      data:
        stage === "review"
          ? {
              status: "REVIEWED",
              reviewerId: user.id,
              reviewedAt: now,
              reviewOnBehalfId: onBehalf,
              rejectReason: null,
            }
          : {
              status: "APPROVED",
              approverId: user.id,
              approvedAt: now,
              onBehalfOfId: onBehalf,
              rejectReason: null,
            },
    }),
    prisma.auditLog.createMany({
      data: allowedIds.map((id) => ({
        patrolId: id,
        actorId: user.id,
        action: stage === "review" ? "REVIEW" : "APPROVE",
        detail: `${stage === "review" ? "안전실장" : "본부장"}${
          onBehalf ? " 대결" : ""
        } · 일괄 결재`,
      })),
    }),
  ]);

  revalidatePath("/approvals");
  revalidatePath("/patrol");
  revalidatePath("/dashboard");

  const skipped = ids.length - allowed.length;
  return {
    error: null,
    message:
      skipped > 0
        ? `${allowed.length}건을 결재했습니다. ${skipped}건은 건너뛰었습니다.`
        : `${allowed.length}건을 결재했습니다.`,
  };
}
