"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { kstDateOnly, timeLabel } from "@/lib/kst";
import { checkinWindowState, ensureTbm } from "@/lib/tbm";
import { loadPointByToken } from "@/lib/checkinPoint";

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
 * 처음 쓰는 기기에서는 휴대폰 뒤 4자리(없으면 사번)로 본인을 확인하고,
 * 확인되면 쿠키에 기억해 다음 날부터는 버튼 한 번으로 끝난다.
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
  const remembered = await rememberedWorkerId();
  if (remembered !== worker.id) {
    const last4 = worker.phone?.replace(/\D/g, "").slice(-4) ?? "";
    const expected = last4 || worker.empNo?.replace(/\s/g, "") || "";
    if (expected && verify.replace(/\s/g, "").toLowerCase() !== expected.toLowerCase()) {
      return {
        status: "error",
        message: last4
          ? "휴대폰 뒤 4자리가 일치하지 않습니다."
          : "사번이 일치하지 않습니다.",
      };
    }
  }

  // --- 체크인 가능 시간인지 (본인 사업장 기준) --------------------------
  const now = new Date();
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
  }

  await prisma.checkinPoint.update({
    where: { id: point.id },
    data: { lastUsedAt: now },
  });

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
