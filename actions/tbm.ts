"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { AttendanceState } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  canApprove,
  canEdit,
  isCorrection,
  isDelegatedApproval,
  requireUser,
  type SessionUser,
} from "@/lib/authz";
import { ensureTbm, recomputeFlags } from "@/lib/tbm";
import { kstDateOnly, kstMinuteOfDay, parseYmd } from "@/lib/kst";

async function ledTeamIds(userId: string): Promise<string[]> {
  const teams = await prisma.team.findMany({
    where: { leaderId: userId },
    select: { id: true },
  });
  return teams.map((t) => t.id);
}

/** 편집 권한을 확인하고 TBM을 반환한다. */
async function loadEditable(user: SessionUser, tbmId: string) {
  const tbm = await prisma.tbm.findUnique({ where: { id: tbmId } });
  if (!tbm) throw new Error("TBM을 찾을 수 없습니다.");
  if (!canEdit(user, tbm, await ledTeamIds(user.id))) {
    throw new Error("이 기록을 수정할 권한이 없습니다.");
  }
  return tbm;
}

function refresh(tbmId: string) {
  revalidatePath(`/tbm/${tbmId}`);
  revalidatePath("/tbm");
  revalidatePath("/dashboard");
}

/** 팀장이 직접 오늘(또는 지정일) TBM을 연다. 이미 있으면 그 건으로 이동. */
export async function openTbmAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const teamId = String(formData.get("teamId") ?? "");
  const dateStr = String(formData.get("workDate") ?? "");
  if (!teamId) throw new Error("팀을 선택해 주세요.");

  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team) throw new Error("팀을 찾을 수 없습니다.");
  if (user.role !== "HQ_ADMIN" && user.siteId !== team.siteId) {
    throw new Error("다른 사업장의 팀입니다.");
  }

  const workDate = dateStr ? parseYmd(dateStr) : kstDateOnly();
  const tbm = await ensureTbm(teamId, workDate, { actorId: user.id });

  refresh(tbm.id);
  redirect(`/tbm/${tbm.id}`);
}

type HazardInput = { hazard: string; control: string };

function parseHazards(raw: string): HazardInput[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((h) => ({
        hazard: String((h as HazardInput)?.hazard ?? "").trim(),
        control: String((h as HazardInput)?.control ?? "").trim(),
      }))
      .filter((h) => h.hazard.length > 0);
  } catch {
    return [];
  }
}

/** 본문 저장 (상신 전까지 몇 번이든 가능) */
export async function saveTbmAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const tbmId = String(formData.get("tbmId") ?? "");
  const tbm = await loadEditable(user, tbmId);

  const workDescription = String(formData.get("workDescription") ?? "").trim();
  const remarks = String(formData.get("remarks") ?? "").trim();
  const weather = String(formData.get("weather") ?? "").trim();
  const heldAtRaw = String(formData.get("heldAt") ?? "").trim(); // "HH:mm"
  const doneIds = new Set(formData.getAll("eduDone").map(String));
  const hazards = parseHazards(String(formData.get("hazards") ?? "[]"));

  // "HH:mm" (KST) → 작업일 기준 절대 시각
  let heldAt: Date | null = null;
  if (/^\d{2}:\d{2}$/.test(heldAtRaw)) {
    const [h, m] = heldAtRaw.split(":").map(Number);
    heldAt = new Date(tbm.workDate.getTime() + (h * 60 + m - 9 * 60) * 60_000);
  }

  const eduItems = await prisma.tbmEduItem.findMany({
    where: { tbmId },
    select: { id: true },
  });

  await prisma.$transaction([
    prisma.tbm.update({
      where: { id: tbmId },
      data: {
        workDescription,
        remarks: remarks || null,
        weather: weather || null,
        heldAt,
        // 반려된 건을 고치면 다시 작성중으로 되돌린다.
        status: tbm.status === "REJECTED" ? "DRAFT" : tbm.status,
        // 승인된 건을 고치는 것은 정정이다. 승인 자체는 그대로 두고 흔적을 남긴다.
        ...(isCorrection(tbm) ? { correctedAt: new Date() } : {}),
      },
    }),
    ...eduItems.map((e) =>
      prisma.tbmEduItem.update({
        where: { id: e.id },
        data: { done: doneIds.has(e.id) },
      }),
    ),
    prisma.hazardItem.deleteMany({ where: { tbmId } }),
    prisma.hazardItem.createMany({
      data: hazards.map((h, sort) => ({ tbmId, ...h, sort })),
    }),
    prisma.auditLog.create({
      data: {
        tbmId,
        actorId: user.id,
        action: isCorrection(tbm) ? "CORRECT" : "UPDATE",
        detail: isCorrection(tbm) ? "승인 후 정정" : null,
      },
    }),
  ]);

  refresh(tbmId);
}

/** 화면에 메시지를 띄워야 하는 액션들의 반환 형태 */
export type ActionResult = { error: string | null; message?: string };

/** 결재 상신 */
export async function submitTbmAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const tbmId = String(formData.get("tbmId") ?? "");

  try {
    const tbm = await loadEditable(user, tbmId);

    // 본사는 승인된 건도 정정할 수 있다. 그 건을 다시 상신해 승인을 지우지 않도록 막는다.
    if (tbm.status === "APPROVED") {
      return { error: "이미 승인된 기록입니다. 정정은 내용을 고치면 그대로 반영됩니다." };
    }

    const [photoCount, attendanceCount] = await Promise.all([
      prisma.tbmPhoto.count({ where: { tbmId } }),
      prisma.tbmAttendance.count({ where: { tbmId, state: { not: "ABSENT" } } }),
    ]);

    if (!tbm.workDescription.trim()) return { error: "작업 내용을 입력해 주세요." };
    if (photoCount === 0) return { error: "현장 사진을 최소 1장 올려 주세요." };
    if (attendanceCount === 0) {
      return { error: "참석자가 한 명도 기록되지 않았습니다." };
    }

    await prisma.tbm.update({
      where: { id: tbmId },
      data: {
        status: "SUBMITTED",
        submittedAt: new Date(),
        // 자동 생성 건이라 작성자가 비어 있으면 상신하는 사람이 작성자가 된다.
        authorId: tbm.authorId ?? user.id,
        rejectReason: null,
        checkinOpen: false,
        logs: { create: { actorId: user.id, action: "SUBMIT" } },
      },
    });

    await recomputeFlags(tbmId);
    refresh(tbmId);
    return { error: null };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "상신에 실패했습니다." };
  }
}

export async function approveTbmAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const tbmId = String(formData.get("tbmId") ?? "");

  const tbm = await prisma.tbm.findUnique({ where: { id: tbmId } });
  if (!tbm) return { error: "TBM을 찾을 수 없습니다." };
  if (!canApprove(user, tbm)) return { error: "결재 권한이 없습니다." };

  // 본사가 누른 결재는 그 법인 대표를 대신한 대결이다. 누구를 대신했는지 남긴다.
  // 대표 계정이 아직 없는 법인이면 대신할 사람이 없으므로 본사 명의 그대로 남는다.
  const onBehalfOfId = isDelegatedApproval(user)
    ? (
        await prisma.user.findFirst({
          where: { role: "CEO", siteId: tbm.siteId, active: true },
          select: { id: true },
          orderBy: { createdAt: "asc" },
        })
      )?.id ?? null
    : null;

  await prisma.tbm.update({
    where: { id: tbmId },
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

  refresh(tbmId);
  return { error: null };
}

/** 법인별로 대결을 받을 대표를 찾는다. 대표 계정이 없는 법인은 null. */
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
 * 대표가 매일 결재하지 못하고 월·분기 단위로 몰아서 결재하는 경우를 위한 것이다.
 * 승인 시각은 실제로 누른 지금으로 남는다 — 작업일에 맞춰 소급해 찍으면 그 문서는
 * 기록이 아니라 만들어 낸 것이 된다. 작업일과 승인일이 떨어져 있는 것은 그대로 보인다.
 */
export async function approveManyAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const ids = formData.getAll("tbmIds").map(String).filter(Boolean);
  if (ids.length === 0) return { error: "승인할 기록을 선택해 주세요." };

  const targets = await prisma.tbm.findMany({
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
    ...[...bySite].map(([siteId, tbmIds]) =>
      prisma.tbm.updateMany({
        // 그 사이 다른 사람이 손댔을 수 있으므로 상태를 다시 확인하고 바꾼다.
        where: { id: { in: tbmIds }, status: "SUBMITTED" },
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
        tbmId: t.id,
        actorId: user.id,
        action: "APPROVE",
        detail: delegates.get(t.siteId) ? "대결 · 일괄 승인" : "일괄 승인",
      })),
    }),
  ]);

  revalidatePath("/approvals");
  revalidatePath("/tbm");
  revalidatePath("/dashboard");

  const skipped = ids.length - allowed.length;
  return {
    error: null,
    message:
      `${allowed.length}건을 승인했습니다.` +
      (skipped > 0 ? ` ${skipped}건은 이미 처리되었거나 권한이 없어 건너뛰었습니다.` : ""),
  };
}

export async function rejectTbmAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const tbmId = String(formData.get("tbmId") ?? "");
  const reason = String(formData.get("rejectReason") ?? "").trim();
  if (!reason) return { error: "반려 사유를 입력해 주세요." };

  const tbm = await prisma.tbm.findUnique({ where: { id: tbmId } });
  if (!tbm) return { error: "TBM을 찾을 수 없습니다." };
  if (!canApprove(user, tbm)) return { error: "결재 권한이 없습니다." };

  await prisma.tbm.update({
    where: { id: tbmId },
    data: {
      status: "REJECTED",
      approverId: user.id,
      approvedAt: null,
      // 승인이 아니므로 대결 표시는 남기지 않는다.
      onBehalfOfId: null,
      rejectReason: reason,
      checkinOpen: true,
      logs: { create: { actorId: user.id, action: "REJECT", detail: reason } },
    },
  });

  refresh(tbmId);
  return { error: null };
}

/** 팀장이 명단에서 직접 출결을 바꾼다 (QR을 못 찍은 경우 보정) */
export async function setAttendanceAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const tbmId = String(formData.get("tbmId") ?? "");
  const workerId = String(formData.get("workerId") ?? "");
  const state = String(formData.get("state") ?? "") as AttendanceState;
  const note = String(formData.get("note") ?? "").trim();

  await loadEditable(user, tbmId);
  if (!["PRESENT", "ABSENT", "LATE"].includes(state)) {
    throw new Error("잘못된 출결 상태입니다.");
  }

  await prisma.tbmAttendance.upsert({
    where: { tbmId_workerId: { tbmId, workerId } },
    update: { state, note: note || null, method: "MANUAL" },
    create: {
      tbmId,
      workerId,
      state,
      note: note || null,
      method: "MANUAL",
      checkedInAt: new Date(),
    },
  });

  await prisma.auditLog.create({
    data: { tbmId, actorId: user.id, action: "ATTENDANCE", detail: `${workerId} → ${state}` },
  });

  refresh(tbmId);
}

export async function deletePhotoAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const photoId = String(formData.get("photoId") ?? "");

  const photo = await prisma.tbmPhoto.findUnique({ where: { id: photoId } });
  if (!photo) throw new Error("사진을 찾을 수 없습니다.");
  await loadEditable(user, photo.tbmId);

  await prisma.tbmPhoto.delete({ where: { id: photoId } });
  await prisma.auditLog.create({
    data: { tbmId: photo.tbmId, actorId: user.id, action: "PHOTO_DELETE" },
  });
  await recomputeFlags(photo.tbmId);

  refresh(photo.tbmId);
}

/** 출석 체크인 창을 수동으로 열고 닫는다. */
export async function toggleCheckinAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const tbmId = String(formData.get("tbmId") ?? "");
  const tbm = await loadEditable(user, tbmId);

  await prisma.tbm.update({
    where: { id: tbmId },
    data: { checkinOpen: !tbm.checkinOpen },
  });

  refresh(tbmId);
}

/** 지금이 마감 시각을 지났는지 (화면 안내용) */
export async function isPastDue(siteId: string): Promise<boolean> {
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { dueMinute: true },
  });
  if (!site) return false;
  return kstMinuteOfDay(new Date()) > site.dueMinute;
}
