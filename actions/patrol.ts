"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser, type SessionUser } from "@/lib/authz";
import {
  canApprovePatrol,
  canEditPatrol,
  delegateTarget,
  ensurePatrol,
  isPatrolCorrection,
  isPatrolDelegated,
  isPatrolState,
  managedPlantIds,
  pickPatrolTemplate,
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

/**
 * 내용 저장. 승인된 건을 고치면 정정으로 기록한다.
 *
 * 상신도 이 액션을 지난다. 예전에는 저장과 상신이 서로 다른 폼이라, 적어 놓고
 * 저장을 안 누른 채 상신하면 적은 내용이 통째로 사라졌다. 실제로 그런 일지가
 * 있었다 — 시간·날씨·특이사항이 빈 채 결재까지 올라갔다.
 */
export async function savePatrolAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
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

  // 상신까지 한 번에. 저장이 끝난 뒤라 방금 적은 내용으로 검사한다.
  if (String(formData.get("intent") ?? "") === "submit") {
    return submitSaved(user.id, patrolId);
  }

  refresh(patrolId);
  return { error: null };
}

/**
 * 점검표를 이 일지에 다시 불러온다.
 *
 * 점검표는 일지를 여는 순간 한 번 복사되고 그 뒤로는 따라가지 않는다. 결재가 끝난
 * 문서가 점검표를 고칠 때마다 조용히 바뀌면 그 기록은 아무것도 증명하지 못하기
 * 때문이다. 다만 아직 상신 전인 일지에는 새 점검표를 끌어올 길이 있어야 한다.
 *
 * 이미 적어 둔 판정과 조치사항은 지키고, 점검항목의 구성만 점검표에 맞춘다.
 * 항목 내용이 그대로인 줄은 그 줄의 판정을 그대로 옮긴다.
 */
export async function reloadTemplateAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const patrolId = String(formData.get("patrolId") ?? "");

  try {
    const patrol = await loadEditable(user, patrolId);
    if (patrol.status !== "DRAFT" && patrol.status !== "REJECTED") {
      return { error: "상신 전인 일지에만 다시 불러올 수 있습니다." };
    }

    const template = await pickPatrolTemplate(patrol.plantId);
    if (!template) return { error: "적용할 점검표가 없습니다." };

    const [checks, rounds] = await Promise.all([
      prisma.patrolCheck.findMany({ where: { patrolId }, orderBy: { sort: "asc" } }),
      prisma.patrolRound.findMany({ where: { patrolId }, orderBy: { sort: "asc" } }),
    ]);

    // 내용이 같은 항목은 판정과 조치사항을 그대로 가져온다.
    const kept = new Map(checks.map((c) => [c.content, c]));

    await prisma.$transaction([
      prisma.patrolCheck.deleteMany({ where: { patrolId } }),
      prisma.patrolCheck.createMany({
        data: template.items.map((i, sort) => {
          const before = kept.get(i.content);
          return {
            patrolId,
            content: i.content,
            sort,
            state: before?.state ?? "GOOD",
            // 적어 둔 것이 있으면 그것을 두고, 비어 있을 때만 기본값을 채운다.
            action: before?.action || i.defaultAction || null,
          };
        }),
      }),
      // 순찰 경로는 점검표에 적힌 것이 있을 때만 갈아끼운다.
      ...(template.rounds.length > 0
        ? [
            prisma.patrolRound.deleteMany({ where: { patrolId } }),
            prisma.patrolRound.createMany({
              data: template.rounds.map((r, sort) => ({
                patrolId,
                place: r.place,
                content: r.content,
                sort,
                // 같은 장소·내용을 이미 판정해 뒀으면 그 판정을 지킨다.
                state:
                  rounds.find((x) => x.place === r.place && x.content === r.content)
                    ?.state ?? "GOOD",
              })),
            }),
          ]
        : []),
      prisma.patrol.update({
        where: { id: patrolId },
        data: {
          patrollerName: template.patrollerName?.trim() || patrol.patrollerName,
        },
      }),
      prisma.auditLog.create({
        data: {
          patrolId,
          actorId: user.id,
          action: "RELOAD",
          detail: `점검표 "${template.name}" 다시 적용`,
        },
      }),
    ]);

    refresh(patrolId);
    return { error: null, message: "점검표를 다시 불러왔습니다." };
  } catch (e) {
    return { error: (e as Error)?.message ?? "불러오지 못했습니다." };
  }
}

/** 결재 상신 — 안전실장 앞으로 올린다. */
/** 저장이 끝난 일지를 결재로 올린다. */
async function submitSaved(userId: string, patrolId: string): Promise<ActionResult> {
  try {
    const patrol = await prisma.patrol.findUnique({ where: { id: patrolId } });
    if (!patrol) return { error: "일지를 찾을 수 없습니다." };

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
        authorId: patrol.authorId ?? userId,
        rejectReason: null,
        logs: { create: { actorId: userId, action: "SUBMIT" } },
      },
    });

    refresh(patrolId);
    return { error: null };
  } catch (e) {
    return { error: (e as Error)?.message ?? "상신하지 못했습니다." };
  }
}

/** 결재 승인 — 안전실장(또는 대결하는 본사) */
export async function approvePatrolAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const patrolId = String(formData.get("patrolId") ?? "");

  const patrol = await prisma.patrol.findUnique({ where: { id: patrolId } });
  if (!patrol) return { error: "순찰일지를 찾을 수 없습니다." };
  if (!canApprovePatrol(user, patrol)) return { error: "결재 권한이 없습니다." };

  const onBehalf = isPatrolDelegated(user) ? await delegateTarget("SAFETY_DIRECTOR") : null;

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
          detail: onBehalf ? "안전실장 대결" : "안전실장 결재",
        },
      },
    },
  });

  refresh(patrolId);
  return { error: null };
}

/** 반려. 작성자에게 되돌린다. */
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
  if (!canApprovePatrol(user, patrol)) return { error: "결재 권한이 없습니다." };

  await prisma.patrol.update({
    where: { id: patrolId },
    data: {
      status: "REJECTED",
      rejectReason: reason,
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
 * 승인 시각은 소급하지 않고 실제로 누른 지금으로 남는다 — 순찰일에 맞춰 찍으면
 * 그 문서는 사후 작성과 구분되지 않는다.
 */
export async function approveManyPatrolsAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const ids = formData.getAll("patrolIds").map(String).filter(Boolean);
  if (ids.length === 0) return { error: "결재할 기록을 선택해 주세요." };

  const targets = await prisma.patrol.findMany({
    where: { id: { in: ids }, status: "SUBMITTED" },
    select: { id: true, plantId: true, status: true },
  });

  const allowed = targets.filter((t) => canApprovePatrol(user, t));
  if (allowed.length === 0) {
    return { error: "결재할 수 있는 기록이 없습니다. 권한과 상태를 확인해 주세요." };
  }

  const onBehalf = isPatrolDelegated(user)
    ? await delegateTarget("SAFETY_DIRECTOR")
    : null;
  const allowedIds = allowed.map((t) => t.id);

  await prisma.$transaction([
    prisma.patrol.updateMany({
      // 그 사이 다른 사람이 손댔을 수 있으므로 상태를 다시 확인하고 바꾼다.
      where: { id: { in: allowedIds }, status: "SUBMITTED" },
      data: {
        status: "APPROVED",
        approverId: user.id,
        approvedAt: new Date(),
        onBehalfOfId: onBehalf,
        rejectReason: null,
      },
    }),
    prisma.auditLog.createMany({
      data: allowedIds.map((id) => ({
        patrolId: id,
        actorId: user.id,
        action: "APPROVE",
        detail: onBehalf ? "안전실장 대결 · 일괄 결재" : "안전실장 · 일괄 결재",
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
