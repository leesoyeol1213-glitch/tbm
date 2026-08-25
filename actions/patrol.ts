"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  canApprove,
  isCorrection,
  isDelegatedApproval,
  requireUser,
  type SessionUser,
} from "@/lib/authz";
import { canEditPatrol, ensurePatrol, isPatrolState } from "@/lib/patrol";
import { kstDateOnly, parseYmd } from "@/lib/kst";

export type ActionResult = { error: string | null; message?: string };

/** 편집 권한을 확인하고 순찰일지를 반환한다. */
async function loadEditable(user: SessionUser, patrolId: string) {
  const patrol = await prisma.patrol.findUnique({ where: { id: patrolId } });
  if (!patrol) throw new Error("순찰일지를 찾을 수 없습니다.");
  if (!canEditPatrol(user, patrol)) {
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

/** 안전관리자가 그날 순찰일지를 연다. 이미 있으면 그 건으로 이동. */
export async function openPatrolAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const siteId = String(formData.get("siteId") ?? "");
  const dateStr = String(formData.get("patrolDate") ?? "");

  if (!siteId) throw new Error("사업장을 선택해 주세요.");
  if (!canEditPatrol(user, { siteId, status: "DRAFT" })) {
    throw new Error("순찰일지를 작성할 권한이 없습니다.");
  }

  const patrolDate = dateStr ? parseYmd(dateStr) : kstDateOnly();
  const patrol = await ensurePatrol(siteId, patrolDate, {
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
        ...(isCorrection(patrol) ? { correctedAt: new Date() } : {}),
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
        action: isCorrection(patrol) ? "CORRECT" : "UPDATE",
      },
    }),
  ]);

  refresh(patrolId);
}

/** 결재 상신 */
export async function submitPatrolAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const patrolId = String(formData.get("patrolId") ?? "");

  try {
    const patrol = await loadEditable(user, patrolId);

    if (patrol.status === "APPROVED") {
      return {
        error: "이미 승인된 기록입니다. 정정은 내용을 고치면 그대로 반영됩니다.",
      };
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

/** 결재 승인 */
export async function approvePatrolAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const patrolId = String(formData.get("patrolId") ?? "");

  const patrol = await prisma.patrol.findUnique({ where: { id: patrolId } });
  if (!patrol) return { error: "순찰일지를 찾을 수 없습니다." };
  if (!canApprove(user, patrol)) return { error: "결재 권한이 없습니다." };

  // 본사가 누른 결재는 그 법인 대표를 대신한 대결이다. 누구를 대신했는지 남긴다.
  const onBehalfOfId = isDelegatedApproval(user)
    ? (
        await prisma.user.findFirst({
          where: { role: "CEO", siteId: patrol.siteId, active: true },
          select: { id: true },
          orderBy: { createdAt: "asc" },
        })
      )?.id ?? null
    : null;

  await prisma.patrol.update({
    where: { id: patrolId },
    data: {
      status: "APPROVED",
      approverId: user.id,
      approvedAt: new Date(),
      rejectReason: null,
      onBehalfOfId,
      logs: {
        create: {
          actorId: user.id,
          action: "APPROVE",
          detail: onBehalfOfId ? "대결" : null,
        },
      },
    },
  });

  refresh(patrolId);
  return { error: null };
}

/** 결재 반려 */
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
  if (!canApprove(user, patrol)) return { error: "결재 권한이 없습니다." };

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

async function delegateBySite(siteIds: string[]): Promise<Map<string, string>> {
  const ceos = await prisma.user.findMany({
    where: { role: "CEO", siteId: { in: siteIds }, active: true },
    select: { id: true, siteId: true },
    orderBy: { createdAt: "asc" },
  });
  const map = new Map<string, string>();
  for (const c of ceos) {
    // 한 법인에 대표가 여럿이면 먼저 만든 계정을 쓴다.
    if (c.siteId && !map.has(c.siteId)) map.set(c.siteId, c.id);
  }
  return map;
}

/**
 * 여러 건을 한 번에 승인한다.
 *
 * 대표가 매일 결재하지 못하고 월·분기 단위로 몰아서 결재하는 경우를 위한 것으로
 * TBM 일괄 승인과 같은 규칙이다. 승인 시각은 소급하지 않고 실제로 누른 지금으로
 * 남는다 — 순찰일에 맞춰 찍으면 그 문서는 사후 작성과 구분되지 않는다.
 */
export async function approveManyPatrolsAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const ids = formData.getAll("patrolIds").map(String).filter(Boolean);
  if (ids.length === 0) return { error: "승인할 기록을 선택해 주세요." };

  const targets = await prisma.patrol.findMany({
    where: { id: { in: ids }, status: "SUBMITTED" },
    select: { id: true, siteId: true, status: true },
  });

  const allowed = targets.filter((t) => canApprove(user, t));
  if (allowed.length === 0) {
    return { error: "승인할 수 있는 기록이 없습니다. 권한과 상태를 확인해 주세요." };
  }

  const delegates = isDelegatedApproval(user)
    ? await delegateBySite([...new Set(allowed.map((t) => t.siteId))])
    : new Map<string, string>();

  const approvedAt = new Date();

  // 법인마다 대결 상대가 달라 법인 단위로 나눠 갱신한다.
  const bySite = new Map<string, string[]>();
  for (const t of allowed) {
    bySite.set(t.siteId, [...(bySite.get(t.siteId) ?? []), t.id]);
  }

  await prisma.$transaction([
    ...[...bySite].map(([siteId, patrolIds]) =>
      prisma.patrol.updateMany({
        // 그 사이 다른 사람이 손댔을 수 있으므로 상태를 다시 확인하고 바꾼다.
        where: { id: { in: patrolIds }, status: "SUBMITTED" },
        data: {
          status: "APPROVED",
          approverId: user.id,
          approvedAt,
          rejectReason: null,
          onBehalfOfId: delegates.get(siteId) ?? null,
        },
      }),
    ),
    prisma.auditLog.createMany({
      data: allowed.map((t) => ({
        patrolId: t.id,
        actorId: user.id,
        action: "APPROVE",
        detail: delegates.get(t.siteId) ? "대결 · 일괄 승인" : "일괄 승인",
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
        ? `${allowed.length}건을 승인했습니다. ${skipped}건은 건너뛰었습니다.`
        : `${allowed.length}건을 승인했습니다.`,
  };
}
