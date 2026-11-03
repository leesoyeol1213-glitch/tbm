"use server";

import { prisma } from "@/lib/db";
import { timeLabel } from "@/lib/kst";
import { minutesLabel, scanStep, sessionPhase, stayMinutes } from "@/lib/legalEdu";
import {
  needsVerify,
  shouldStampVerified,
  verifyExpectation,
  verifyMatches,
} from "@/lib/workerVerify";
import { rememberedWorkerId, setRememberedWorker } from "@/actions/checkin";

export type ScanResult =
  | { status: "idle" }
  | { status: "error"; message: string }
  | {
      status: "done";
      workerName: string;
      /** 이번에 찍은 것이 시작인지 종료인지 */
      step: "START" | "END";
      at: string;
      /** 종료를 찍었으면 체류시간 */
      stayLabel: string | null;
      /** 이미 찍혀 있어 아무것도 바뀌지 않은 경우 */
      already: boolean;
    };

/**
 * 법정의무교육 QR 스캔 → 본인 확인 → 시작 또는 종료 기록.
 *
 * 첫 스캔을 시작으로, 다음 스캔을 종료로 **자동 판정하지 않는다.** 교육 중에
 * 실수로 한 번 더 찍으면 그 시각이 퇴장으로 남아 체류시간이 몇 분으로 줄어
 * 버린다. 화면이 지금 차례를 보여 주고, 사람이 그 단추를 눌러 찍는다. 그래서
 * 폼이 보내 온 step과 서버가 판정한 차례가 맞는지 확인한다.
 */
export async function legalEduScanAction(
  _prev: ScanResult,
  formData: FormData,
): Promise<ScanResult> {
  const token = String(formData.get("token") ?? "");
  const workerId = String(formData.get("workerId") ?? "");
  const wanted = String(formData.get("step") ?? "");
  const verify = String(formData.get("verify") ?? "").trim();

  const session = await prisma.legalEduSession.findUnique({
    where: { token },
    select: {
      id: true,
      siteId: true,
      title: true,
      openedAt: true,
      closedAt: true,
    },
  });
  if (!session) {
    return { status: "error", message: "사용할 수 없는 QR입니다. 관리자에게 문의해 주세요." };
  }

  const phase = sessionPhase(session);
  if (phase === "BEFORE") {
    return { status: "error", message: "아직 교육이 시작되지 않았습니다. 잠시 기다려 주세요." };
  }
  if (phase === "CLOSED") {
    return { status: "error", message: "이 교육은 마감되었습니다. 관리자에게 알려 주세요." };
  }

  const worker = await prisma.worker.findUnique({
    where: { id: workerId },
    select: {
      id: true,
      name: true,
      siteId: true,
      active: true,
      birthMmdd: true,
      verifiedAt: true,
    },
  });
  // 교육은 법인 단위 의무라, 다른 법인 사람이 그 자리에 섞여 찍히면 그 법인의
  // 기록이 아니게 된다.
  if (!worker?.active || worker.siteId !== session.siteId) {
    return { status: "error", message: "이 교육의 명부에서 찾을 수 없습니다." };
  }

  // --- 본인 확인 (TBM 체크인과 같은 규칙) ------------------------------
  const now = new Date();
  const remembered = await rememberedWorkerId();
  const mustVerify = remembered !== worker.id && needsVerify(worker, now);
  let justVerified = false;

  if (mustVerify) {
    const { kind, expected } = verifyExpectation(worker);
    if (!verifyMatches(kind, expected, verify)) {
      return {
        status: "error",
        message: "생년월일이 일치하지 않습니다. 태어난 월일 네 자리를 넣어 주세요.",
      };
    }
    justVerified = true;
  }
  if (
    shouldStampVerified({
      justVerified,
      rememberedThisWorker: remembered === worker.id,
      worker,
    })
  ) {
    await prisma.worker.update({ where: { id: worker.id }, data: { verifiedAt: now } });
  }

  // --- 시작인가 종료인가 ------------------------------------------------
  const existing = await prisma.legalEduScan.findUnique({
    where: { sessionId_workerId: { sessionId: session.id, workerId: worker.id } },
    select: { startedAt: true, endedAt: true },
  });
  const step = scanStep(existing);

  if (step === "DONE") {
    await setRememberedWorker(worker.id);
    return {
      status: "done",
      workerName: worker.name,
      step: "END",
      at: timeLabel(existing!.endedAt!),
      stayLabel: minutesLabel(stayMinutes(existing!)),
      already: true,
    };
  }

  // 화면이 보여 준 차례와 다르면 그 사이 누가 찍은 것이다. 엉뚱한 칸에
  // 시각을 넣지 않고 다시 보게 한다.
  if (wanted !== step) {
    return {
      status: "error",
      message: "화면을 새로 고친 뒤 다시 찍어 주세요.",
    };
  }

  if (step === "START") {
    await prisma.legalEduScan.upsert({
      where: { sessionId_workerId: { sessionId: session.id, workerId: worker.id } },
      create: { sessionId: session.id, workerId: worker.id, startedAt: now },
      update: { startedAt: now },
    });
    await setRememberedWorker(worker.id);
    return {
      status: "done",
      workerName: worker.name,
      step: "START",
      at: timeLabel(now),
      stayLabel: null,
      already: false,
    };
  }

  // step === "END"
  const updated = await prisma.legalEduScan.update({
    where: { sessionId_workerId: { sessionId: session.id, workerId: worker.id } },
    data: { endedAt: now },
    select: { startedAt: true, endedAt: true },
  });
  await setRememberedWorker(worker.id);
  return {
    status: "done",
    workerName: worker.name,
    step: "END",
    at: timeLabel(now),
    stayLabel: minutesLabel(stayMinutes(updated)),
    already: false,
  };
}
