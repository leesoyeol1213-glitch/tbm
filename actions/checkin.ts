"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { kstDateOnly, timeLabel } from "@/lib/kst";
import { checkinWindowState, ensureTbm } from "@/lib/tbm";
import { loadPointByToken } from "@/lib/checkinPoint";
import { needsVerify, verifyExpectation, verifyMatches } from "@/lib/workerVerify";

const COOKIE_NAME = "tbm_worker";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export type CheckinResult =
  | { status: "idle" }
  | { status: "error"; message: string }
  | {
      status: "done";
      workerName: string;
      siteName: string;
      teamName: string;
      late: boolean;
      at: string;
      already: boolean;
    };

/** 이 기기에 기억된 작업자 id */
export async function rememberedWorkerId(): Promise<string | null> {
  const store = await cookies();
  return store.get(COOKIE_NAME)?.value ?? null;
}

export async function forgetWorkerAction(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
  revalidatePath("/c", "layout");
}

/**
 * 고정 QR 스캔 → 본인 확인 → 출석 기록.
 *
 * 처음 한 번은 생년월일 네 자리로 본인을 확인하고, 확인되면 반기 동안 다시
 * 묻지 않는다. 이 기기도 함께 기억해 다음부터는 이름을 찾을 필요도 없다.
 *
 * 공용 지문인식기처럼 여러 법인이 같은 QR을 쓰는 경우, 명부는 담당 사업장 전체에서
 * 찾지만 출결·마감 규칙은 **본인이 속한 사업장** 기준으로 적용한다.
 */
export async function checkinAction(
  _prev: CheckinResult,
  formData: FormData,
): Promise<CheckinResult> {
  const token = String(formData.get("token") ?? "");
  const workerId = String(formData.get("workerId") ?? "");
  const verify = String(formData.get("verify") ?? "").trim();

  const loaded = await loadPointByToken(token);
  if (!loaded || !loaded.point.active || loaded.siteIds.length === 0) {
    return { status: "error", message: "사용할 수 없는 QR입니다. 관리자에게 문의해 주세요." };
  }
  const { point, siteIds } = loaded;

  const worker = await prisma.worker.findUnique({
    where: { id: workerId },
    include: { team: true, site: true },
  });
  if (!worker || !worker.active || !siteIds.includes(worker.siteId)) {
    return { status: "error", message: "작업자 정보를 찾을 수 없습니다." };
  }
  if (!worker.teamId || !worker.team) {
    return {
      status: "error",
      message: `${worker.name} 님은 소속 팀이 지정되지 않았습니다. 관리자에게 문의해 주세요.`,
    };
  }

  // --- 본인 확인 --------------------------------------------------------
  // 이 기기를 기억하고 있거나, 반기 안에 확인을 마친 사람이면 묻지 않는다.
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

  // --- 체크인 가능 시간인지 (본인 사업장 기준) --------------------------
  const window = checkinWindowState(worker.site, now);
  if (!window.open) {
    return { status: "error", message: window.reason ?? "지금은 출석 체크를 할 수 없습니다." };
  }

  // --- 그날 TBM 확보 (첫 체크인이면 템플릿으로 자동 생성) --------------
  const workDate = kstDateOnly(now);
  const tbm = await ensureTbm(worker.teamId, workDate, { autoCreated: true });

  if (!tbm.checkinOpen) {
    return {
      status: "error",
      message: "오늘 출석 체크가 마감되었습니다. 팀장에게 알려 주세요.",
    };
  }

  const state = window.late ? "LATE" : "PRESENT";

  const existing = await prisma.tbmAttendance.findUnique({
    where: { tbmId_workerId: { tbmId: tbm.id, workerId: worker.id } },
  });

  if (!existing) {
    try {
      await prisma.tbmAttendance.create({
        data: {
          tbmId: tbm.id,
          workerId: worker.id,
          state,
          method: "QR",
          pointId: point.id,
          checkedInAt: now,
        },
      });
      await prisma.auditLog.create({
        data: {
          tbmId: tbm.id,
          action: "CHECKIN",
          detail: `${worker.name} (${point.name})`,
        },
      });
    } catch {
      // QR을 연달아 두 번 찍으면 위 조회를 둘 다 통과한 뒤 (tbmId, workerId)에서
      // 부딪힌다. 먼저 들어간 기록이 맞으므로 조용히 넘어간다 — 작업자에게는
      // 이미 찍힌 것으로 보이면 된다.
    }
  }

  await prisma.checkinPoint.update({
    where: { id: point.id },
    data: { lastUsedAt: now },
  });

  // 확인 시각은 실제로 생년월일을 맞춘 때만 새로 찍는다. 출석할 때마다
  // 갱신하면 기간이 끝없이 밀려 반기라는 말이 무의미해진다.
  if (justVerified) {
    await prisma.worker.update({
      where: { id: worker.id },
      data: { verifiedAt: now },
    });
  }

  // 다음부터는 본인 확인 없이 바로 찍을 수 있게 이 기기를 기억한다.
  const store = await cookies();
  store.set(COOKIE_NAME, worker.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });

  revalidatePath(`/tbm/${tbm.id}`);

  return {
    status: "done",
    workerName: worker.name,
    siteName: worker.site.name,
    teamName: worker.team.name,
    late: (existing?.state ?? state) === "LATE",
    at: timeLabel(existing?.checkedInAt ?? now),
    already: Boolean(existing),
  };
}
