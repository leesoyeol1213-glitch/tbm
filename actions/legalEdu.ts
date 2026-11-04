"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/authz";
import { kstDateOnly } from "@/lib/kst";
import { findPreset } from "@/lib/eduRoster";
import { newToken, sessionPhase } from "@/lib/legalEdu";

export type ActionResult = { error: string | null };

const OK: ActionResult = { error: null };

/**
 * 법정의무교육 회차를 연다(만든다).
 *
 * 만들기만 하고 스캔은 아직 받지 않는다. QR이 인쇄되어 돌아다니는 종이에
 * 있으므로, 교육을 시작할 때 본사가 따로 열어야 한다 — 열어 두지 않으면 교육
 * 시작 전에 찍은 시각이 시작 시각으로 남는다.
 */
export async function createLegalEduSessionAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireRole("HQ_ADMIN");

  const siteId = String(formData.get("siteId") ?? "");
  const preset = findPreset(String(formData.get("kind") ?? ""));
  const eduDateRaw = String(formData.get("eduDate") ?? "").trim();

  if (!siteId || !preset) return { error: "사업장과 교육을 골라 주세요." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eduDateRaw)) return { error: "교육일을 골라 주세요." };

  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { id: true, active: true },
  });
  if (!site?.active) return { error: "사업장을 찾지 못했습니다." };

  // 날짜는 KST 기준 날짜로 저장한다. 다른 날짜 필드와 같은 규칙이다.
  const eduDate = kstDateOnly(new Date(`${eduDateRaw}T00:00:00+09:00`));

  // 같은 법인·같은 교육·같은 날은 한 회차로 본다. 두 번 만들면 어느 쪽에
  // 찍혔는지 사람이 알 수 없다.
  const dup = await prisma.legalEduSession.findFirst({
    where: { siteId, kind: preset.kind, eduDate },
    select: { id: true },
  });
  if (dup) return { error: "그 법인에 같은 교육이 그날 이미 있습니다." };

  const contentsRaw = String(formData.get("contents") ?? "").trim();
  const contents =
    contentsRaw.length > 0 ? contentsRaw : preset.contents.join("\n");

  await prisma.legalEduSession.create({
    data: {
      siteId,
      kind: preset.kind,
      // 조문이 개정되어도 그날 기록은 그대로여야 하므로 베껴 둔다.
      title: preset.title,
      basis: preset.basis,
      place: String(formData.get("place") ?? "").trim() || null,
      instructor: String(formData.get("instructor") ?? "").trim() || null,
      contents,
      eduDate,
      token: newToken(randomUUID),
      createdById: user.id,
    },
  });

  revalidatePath("/legal-edu");
  return OK;
}

/** 스캔을 열거나 닫는다. 연 시각·닫은 시각이 그대로 기록에 남는다. */
export async function toggleLegalEduSessionAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  await requireRole("HQ_ADMIN");

  const id = String(formData.get("sessionId") ?? "");
  const want = String(formData.get("to") ?? "");

  const session = await prisma.legalEduSession.findUnique({
    where: { id },
    select: { id: true, openedAt: true, closedAt: true },
  });
  if (!session) return { error: "회차를 찾지 못했습니다." };

  const phase = sessionPhase(session);
  const now = new Date();

  if (want === "open") {
    if (phase === "OPEN") return OK;
    // 한 번 닫은 회차를 다시 열면 그 사이 비어 있던 시간이 기록에서 사라진다.
    // 다시 열어야 할 일이면 회차를 새로 만드는 쪽이 정직하다.
    if (phase === "CLOSED") {
      return { error: "마감한 회차는 다시 열 수 없습니다. 새 회차를 만들어 주세요." };
    }
    await prisma.legalEduSession.update({
      where: { id },
      data: { openedAt: now },
    });
  } else if (want === "close") {
    if (phase === "CLOSED") return OK;
    if (phase === "BEFORE") return { error: "아직 열지 않은 회차입니다." };
    await prisma.legalEduSession.update({
      where: { id },
      data: { closedAt: now },
    });
  } else {
    return { error: "알 수 없는 요청입니다." };
  }

  revalidatePath("/legal-edu");
  return OK;
}

/**
 * 회차를 지운다. 스캔 기록도 함께 사라지므로, 아직 아무도 찍지 않은 것만
 * 지울 수 있다. 찍힌 기록은 그 사람이 그 자리에 있었다는 증거다.
 */
export async function deleteLegalEduSessionAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  await requireRole("HQ_ADMIN");

  const id = String(formData.get("sessionId") ?? "");
  const session = await prisma.legalEduSession.findUnique({
    where: { id },
    select: { id: true, _count: { select: { scans: true } } },
  });
  if (!session) return { error: "회차를 찾지 못했습니다." };
  if (session._count.scans > 0) {
    return {
      error: `이미 ${session._count.scans}명이 찍었습니다. 지우지 않고 마감하세요.`,
    };
  }

  await prisma.legalEduSession.delete({ where: { id } });
  revalidatePath("/legal-edu");
  return OK;
}

/**
 * QR이 읽히지 않은 사람을 본사가 수기로 인정한다. 되돌리기도 같은 창구다.
 *
 * 마감한 회차에서도 할 수 있다. 빠진 사람은 보통 보관용을 뽑으려고 명부를 들여다볼
 * 때 눈에 띄는데, 그때는 이미 마감한 뒤다. 마감을 되돌려 열어 주는 길(그래서 그
 * 사이 시간이 기록에서 사라지는 길)보다, 수기 확인을 따로 남기는 쪽이 정직하다.
 *
 * 시작·종료 스캔 시각은 손대지 않는다. 본인이 한쪽만 찍었으면 그 값은 그대로 남고,
 * 빈 쪽만 출력물에서 회차 시각으로 메운다(lib/legalEdu.ts의 effectiveStay).
 */
export async function markLegalEduManualAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireRole("HQ_ADMIN");

  const sessionId = String(formData.get("sessionId") ?? "");
  const workerId = String(formData.get("workerId") ?? "");
  const want = String(formData.get("want") ?? "");
  const note = String(formData.get("manualNote") ?? "").trim() || null;

  if (!sessionId || !workerId) return { error: "회차와 근로자를 골라 주세요." };

  const session = await prisma.legalEduSession.findUnique({
    where: { id: sessionId },
    select: { id: true, siteId: true, openedAt: true },
  });
  if (!session) return { error: "회차를 찾지 못했습니다." };

  // 한 번도 열지 않은 회차는 참석을 인정할 근거가 없다. 수기 확인이 빌려 쓸
  // 시각 자체가 없으므로, 열지 않았다면 교육이 있었다고 말할 수 없다.
  if (!session.openedAt) {
    return { error: "아직 열지 않은 회차입니다. 교육을 시작한 뒤에 인정할 수 있습니다." };
  }

  const worker = await prisma.worker.findUnique({
    where: { id: workerId },
    select: { id: true, siteId: true, active: true },
  });
  if (!worker?.active) return { error: "근로자를 찾지 못했습니다." };
  // 다른 법인 사람을 이 회차에 넣으면 상시근로자 수 계산이 어긋난다.
  if (worker.siteId !== session.siteId) {
    return { error: "다른 사업장 근로자입니다." };
  }

  if (want === "unmark") {
    const scan = await prisma.legalEduScan.findUnique({
      where: { sessionId_workerId: { sessionId, workerId } },
      select: { id: true, startedAt: true, manualAt: true },
    });
    if (!scan?.manualAt) return OK;
    if (scan.startedAt) {
      // 본인이 찍은 기록은 남겨야 한다. 수기 표시만 걷어낸다.
      await prisma.legalEduScan.update({
        where: { id: scan.id },
        data: { manualAt: null, manualById: null, manualNote: null },
      });
    } else {
      // 수기 확인만으로 생긴 줄이라 표시를 걷으면 빈 줄이 된다. 줄째 지운다.
      await prisma.legalEduScan.delete({ where: { id: scan.id } });
    }
  } else {
    const now = new Date();
    await prisma.legalEduScan.upsert({
      where: { sessionId_workerId: { sessionId, workerId } },
      create: { sessionId, workerId, manualAt: now, manualById: user.id, manualNote: note },
      update: { manualAt: now, manualById: user.id, manualNote: note },
    });
  }

  revalidatePath("/legal-edu");
  return OK;
}
