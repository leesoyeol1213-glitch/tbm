"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { canAccessSite, requireRole, type SessionUser } from "@/lib/authz";
import { setPointCoverage } from "@/lib/checkinPoint";
import {
  judgeTeamDelete,
  judgeUserDelete,
  judgeWorkerDelete,
  splitInactiveForDelete,
  summarizeBulkDelete,
} from "@/lib/deletion";

export type ActionResult = { error: string | null; ok?: boolean; message?: string };

const OK: ActionResult = { error: null, ok: true };

/** "HH:mm" → 자정 기준 분 */
function toMinute(raw: string, fallback: number): number {
  const m = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return fallback;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return v >= 0 && v < 24 * 60 ? v : fallback;
}

function num(raw: FormDataEntryValue | null): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

async function assertSite(user: SessionUser, siteId: string) {
  if (!canAccessSite(user, siteId)) throw new Error("권한이 없는 사업장입니다.");
}

// ---------------------------------------------------------------------------
// 사업장 생성 / 삭제
// ---------------------------------------------------------------------------

export async function createSiteAction(formData: FormData): Promise<ActionResult> {
  await requireRole("HQ_ADMIN");

  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  const name = String(formData.get("name") ?? "").trim();
  if (!code) return { error: "사업장 코드를 입력해 주세요." };
  if (!name) return { error: "사업장 이름을 입력해 주세요." };
  if (!/^[A-Z0-9-]{1,20}$/.test(code)) {
    return { error: "사업장 코드는 영문 대문자·숫자·하이픈만 쓸 수 있습니다." };
  }

  const exists = await prisma.site.findUnique({ where: { code } });
  if (exists) return { error: `이미 쓰이고 있는 코드입니다: ${code}` };

  await prisma.site.create({
    data: {
      code,
      name,
      address: String(formData.get("address") ?? "").trim() || null,
      lat: num(formData.get("lat")),
      lng: num(formData.get("lng")),
    },
  });

  revalidatePath("/admin/sites");
  return OK;
}

/**
 * 사업장을 통째로 지운다. TBM·사진·팀·작업자·QR이 모두 함께 사라진다.
 *
 * 소속 계정은 스키마상 siteId만 비워지므로(SetNull) 본사 계정처럼 보이는 사고를
 * 막기 위해 여기서 명시적으로 함께 지운다.
 */
export async function deleteSiteAction(formData: FormData): Promise<ActionResult> {
  await requireRole("HQ_ADMIN");

  const siteId = String(formData.get("siteId") ?? "");
  const confirm = String(formData.get("confirmName") ?? "").trim();

  const site = await prisma.site.findUnique({ where: { id: siteId } });
  if (!site) return { error: "사업장을 찾을 수 없습니다." };
  if (confirm !== site.name) {
    return { error: `확인을 위해 사업장 이름 "${site.name}" 을 정확히 입력해 주세요.` };
  }

  await prisma.$transaction([
    prisma.user.deleteMany({ where: { siteId, role: { not: "HQ_ADMIN" } } }),
    prisma.site.delete({ where: { id: siteId } }),
  ]);

  revalidatePath("/admin/sites");
  revalidatePath("/dashboard");
  return OK;
}

// ---------------------------------------------------------------------------
// 사업장 설정
// ---------------------------------------------------------------------------

export async function updateSiteAction(formData: FormData): Promise<ActionResult> {
  const user = await requireRole("SITE_MANAGER", "HQ_ADMIN");
  const siteId = String(formData.get("siteId") ?? "");
  await assertSite(user, siteId);

  const current = await prisma.site.findUnique({ where: { id: siteId } });
  if (!current) return { error: "사업장을 찾을 수 없습니다." };

  const dueMinute = toMinute(String(formData.get("dueMinute") ?? ""), current.dueMinute);
  const checkinFrom = toMinute(String(formData.get("checkinFrom") ?? ""), current.checkinFrom);
  const checkinUntil = toMinute(
    String(formData.get("checkinUntil") ?? ""),
    current.checkinUntil,
  );
  const lateAfterMinute = toMinute(
    String(formData.get("lateAfterMinute") ?? ""),
    current.lateAfterMinute,
  );

  if (checkinFrom >= checkinUntil) {
    return { error: "체크인 시작 시각이 마감 시각보다 늦습니다." };
  }

  await prisma.site.update({
    where: { id: siteId },
    data: {
      name: String(formData.get("name") ?? current.name).trim() || current.name,
      address: String(formData.get("address") ?? "").trim() || null,
      lat: num(formData.get("lat")),
      lng: num(formData.get("lng")),
      geofenceM: num(formData.get("geofenceM")) ?? current.geofenceM,
      dueMinute,
      checkinFrom,
      checkinUntil,
      lateAfterMinute,
    },
  });

  revalidatePath("/admin");
  return OK;
}

// ---------------------------------------------------------------------------
// 출석 QR 지점
// ---------------------------------------------------------------------------

export async function createPointAction(formData: FormData): Promise<ActionResult> {
  const user = await requireRole("SITE_MANAGER", "HQ_ADMIN");
  const siteId = String(formData.get("siteId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  await assertSite(user, siteId);

  if (!name) return { error: "지점 이름을 입력해 주세요." };

  await prisma.checkinPoint.create({ data: { siteId, name } });
  revalidatePath("/admin/qr");
  return OK;
}

/**
 * 이 QR이 출석을 받아 줄 사업장을 지정한다.
 * 사업장 경계를 넘는 설정이라 본사 관리자만 바꿀 수 있다.
 */
export async function setPointCoverageAction(formData: FormData): Promise<ActionResult> {
  await requireRole("HQ_ADMIN");

  const pointId = String(formData.get("pointId") ?? "");
  const siteIds = formData.getAll("siteIds").map(String).filter(Boolean);

  const point = await prisma.checkinPoint.findUnique({ where: { id: pointId } });
  if (!point) return { error: "QR 지점을 찾을 수 없습니다." };

  const valid = await prisma.site.findMany({
    where: { id: { in: siteIds }, active: true },
    select: { id: true },
  });

  await setPointCoverage(pointId, point.siteId, valid.map((s) => s.id));

  revalidatePath("/admin/qr");
  return OK;
}

/**
 * QR 지점을 지운다. 출석 기록에는 지점 id만 문자열로 남아 있어 기록이 사라지지는
 * 않지만, 인쇄해 둔 QR은 즉시 못 쓰게 된다.
 */
export async function deletePointAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireRole("SITE_MANAGER", "HQ_ADMIN");
  const pointId = String(formData.get("pointId") ?? "");

  const point = await prisma.checkinPoint.findUnique({ where: { id: pointId } });
  if (!point) return { error: "QR 지점을 찾을 수 없습니다." };
  if (!canAccessSite(user, point.siteId)) return { error: "권한이 없습니다." };

  await prisma.checkinPoint.delete({ where: { id: pointId } });
  revalidatePath("/admin/qr");

  return { error: null, ok: true, message: `"${point.name}" QR을 삭제했습니다.` };
}

export async function togglePointAction(formData: FormData): Promise<void> {
  const user = await requireRole("SITE_MANAGER", "HQ_ADMIN");
  const pointId = String(formData.get("pointId") ?? "");

  const point = await prisma.checkinPoint.findUnique({ where: { id: pointId } });
  if (!point) return;
  await assertSite(user, point.siteId);

  await prisma.checkinPoint.update({
    where: { id: pointId },
    data: { active: !point.active },
  });
  revalidatePath("/admin/qr");
}

// ---------------------------------------------------------------------------
// 교육 템플릿
// ---------------------------------------------------------------------------

type Line = { a: string; b: string };

function parseLines(raw: string): Line[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x) => ({
        a: String((x as Line)?.a ?? "").trim(),
        b: String((x as Line)?.b ?? "").trim(),
      }))
      .filter((x) => x.a.length > 0);
  } catch {
    return [];
  }
}

export async function saveTemplateAction(formData: FormData): Promise<ActionResult> {
  const user = await requireRole("SITE_MANAGER", "HQ_ADMIN");
  const templateId = String(formData.get("templateId") ?? "");

  const template = await prisma.tbmTemplate.findUnique({ where: { id: templateId } });
  if (!template) return { error: "템플릿을 찾을 수 없습니다." };

  // 전사 공통 템플릿은 본사만 고칠 수 있다.
  if (template.siteId === null) {
    if (user.role !== "HQ_ADMIN") {
      return { error: "전사 공통 템플릿은 본사 관리자만 수정할 수 있습니다." };
    }
  } else {
    await assertSite(user, template.siteId);
  }

  const name = String(formData.get("name") ?? "").trim() || template.name;
  const workDescription = String(formData.get("workDescription") ?? "").trim();
  const eduItems = parseLines(String(formData.get("eduItems") ?? "[]"));
  const hazards = parseLines(String(formData.get("hazards") ?? "[]"));

  if (eduItems.length === 0) {
    return { error: "교육 항목을 최소 1개 이상 입력해 주세요." };
  }

  await prisma.$transaction([
    prisma.tbmTemplate.update({
      where: { id: templateId },
      data: { name, workDescription: workDescription || null },
    }),
    prisma.templateEduItem.deleteMany({ where: { templateId } }),
    prisma.templateEduItem.createMany({
      data: eduItems.map((e, sort) => ({ templateId, content: e.a, sort })),
    }),
    prisma.templateHazard.deleteMany({ where: { templateId } }),
    prisma.templateHazard.createMany({
      data: hazards.map((h, sort) => ({
        templateId,
        hazard: h.a,
        control: h.b,
        sort,
      })),
    }),
  ]);

  revalidatePath("/admin/template");
  return OK;
}

/** 사업장 전용 템플릿을 전사 공통본에서 복제해 만든다. */
export async function forkTemplateAction(formData: FormData): Promise<ActionResult> {
  const user = await requireRole("SITE_MANAGER", "HQ_ADMIN");
  const siteId = String(formData.get("siteId") ?? "");
  await assertSite(user, siteId);

  const existing = await prisma.tbmTemplate.findFirst({
    where: { siteId, active: true },
  });
  if (existing) return { error: "이미 이 사업장 전용 템플릿이 있습니다." };

  const base = await prisma.tbmTemplate.findFirst({
    where: { siteId: null, active: true },
    include: { eduItems: true, hazards: true },
    orderBy: { createdAt: "asc" },
  });

  const site = await prisma.site.findUnique({ where: { id: siteId } });

  await prisma.tbmTemplate.create({
    data: {
      siteId,
      name: `${site?.name ?? "사업장"} 전용 양식`,
      workDescription: base?.workDescription ?? null,
      eduItems: {
        create: base?.eduItems.map((e) => ({ content: e.content, sort: e.sort })) ?? [],
      },
      hazards: {
        create:
          base?.hazards.map((h) => ({
            hazard: h.hazard,
            control: h.control,
            sort: h.sort,
          })) ?? [],
      },
    },
  });

  revalidatePath("/admin/template");
  return OK;
}

// ---------------------------------------------------------------------------
// 작업자 명부
// ---------------------------------------------------------------------------

export async function saveWorkerAction(formData: FormData): Promise<ActionResult> {
  const user = await requireRole("SITE_MANAGER", "HQ_ADMIN");
  const workerId = String(formData.get("workerId") ?? "");
  const siteId = String(formData.get("siteId") ?? "");
  await assertSite(user, siteId);

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "이름을 입력해 주세요." };

  const teamId = String(formData.get("teamId") ?? "").trim() || null;
  const empNo = String(formData.get("empNo") ?? "").trim() || null;
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const jobTitle = String(formData.get("jobTitle") ?? "").trim() || null;

  if (teamId) {
    const team = await prisma.team.findUnique({ where: { id: teamId } });
    if (!team || team.siteId !== siteId) return { error: "잘못된 팀입니다." };
  }

  try {
    if (workerId) {
      const worker = await prisma.worker.findUnique({ where: { id: workerId } });
      if (!worker) return { error: "작업자를 찾을 수 없습니다." };
      await assertSite(user, worker.siteId);
      await prisma.worker.update({
        where: { id: workerId },
        data: { name, teamId, empNo, phone, jobTitle },
      });
    } else {
      await prisma.worker.create({
        data: { siteId, name, teamId, empNo, phone, jobTitle },
      });
    }
  } catch {
    return { error: "같은 사번이 이미 등록되어 있습니다." };
  }

  revalidatePath("/admin/workers");
  return OK;
}

/**
 * 작업자를 완전히 지운다.
 * 출석 기록이 남아 있으면 지우지 않는다 — 안전 기록은 보존 대상이라
 * 과거 TBM에서 참석자가 사라지면 안 된다. 그런 경우 비활성화를 쓴다.
 */
export async function deleteWorkerAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireRole("SITE_MANAGER", "HQ_ADMIN");
  const workerId = String(formData.get("workerId") ?? "");

  const worker = await prisma.worker.findUnique({
    where: { id: workerId },
    include: { _count: { select: { attendances: true } } },
  });
  if (!worker) return { error: "작업자를 찾을 수 없습니다." };
  if (!canAccessSite(user, worker.siteId)) return { error: "권한이 없습니다." };

  const verdict = judgeWorkerDelete(worker.name, worker._count);
  if (!verdict.allowed) return { error: verdict.reason };

  await prisma.worker.delete({ where: { id: workerId } });
  revalidatePath("/admin/workers");
  return { error: null, ok: true, message: `${worker.name} 님을 삭제했습니다.` };
}

/** 비활성 상태이면서 출석 기록이 없는 인원을 한 번에 지운다. */
export async function deleteInactiveWorkersAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireRole("SITE_MANAGER", "HQ_ADMIN");
  const siteId = String(formData.get("siteId") ?? "");
  if (!canAccessSite(user, siteId)) return { error: "권한이 없습니다." };

  const targets = await prisma.worker.findMany({
    where: { siteId, active: false },
    include: { _count: { select: { attendances: true } } },
  });

  const { deletable, kept } = splitInactiveForDelete(targets);

  if (deletable.length === 0) {
    return {
      error:
        targets.length === 0
          ? "비활성 인원이 없습니다."
          : `비활성 ${targets.length}명 모두 출석 기록이 있어 삭제할 수 없습니다.`,
    };
  }

  await prisma.worker.deleteMany({ where: { id: { in: deletable.map((w) => w.id) } } });
  revalidatePath("/admin/workers");

  return {
    error: null,
    ok: true,
    message: summarizeBulkDelete(deletable.length, kept.length),
  };
}

export async function toggleWorkerAction(formData: FormData): Promise<void> {
  const user = await requireRole("SITE_MANAGER", "HQ_ADMIN");
  const workerId = String(formData.get("workerId") ?? "");

  const worker = await prisma.worker.findUnique({ where: { id: workerId } });
  if (!worker) return;
  await assertSite(user, worker.siteId);

  await prisma.worker.update({
    where: { id: workerId },
    data: { active: !worker.active },
  });
  revalidatePath("/admin/workers");
}

// ---------------------------------------------------------------------------
// 작업팀
// ---------------------------------------------------------------------------

export async function saveTeamAction(formData: FormData): Promise<ActionResult> {
  const user = await requireRole("SITE_MANAGER", "HQ_ADMIN");
  const siteId = String(formData.get("siteId") ?? "");
  const teamId = String(formData.get("teamId") ?? "");
  await assertSite(user, siteId);

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "팀 이름을 입력해 주세요." };

  const company = String(formData.get("company") ?? "").trim() || null;
  const leaderId = String(formData.get("leaderId") ?? "").trim() || null;

  if (leaderId) {
    const leader = await prisma.user.findUnique({ where: { id: leaderId } });
    if (!leader || (leader.siteId !== siteId && leader.role !== "HQ_ADMIN")) {
      return { error: "이 사업장 소속 계정이 아닙니다." };
    }
  }

  const duplicate = await prisma.team.findFirst({
    where: { siteId, name, ...(teamId ? { id: { not: teamId } } : {}) },
  });
  if (duplicate) return { error: `같은 이름의 팀이 이미 있습니다: ${name}` };

  if (teamId) {
    const team = await prisma.team.findUnique({ where: { id: teamId } });
    if (!team) return { error: "팀을 찾을 수 없습니다." };
    await assertSite(user, team.siteId);
    await prisma.team.update({ where: { id: teamId }, data: { name, company, leaderId } });
  } else {
    await prisma.team.create({ data: { siteId, name, company, leaderId } });
  }

  revalidatePath("/admin/teams");
  return OK;
}

/**
 * 팀을 완전히 지운다.
 * TBM 기록이 있으면 지우지 않는다 — 팀을 지우면 그 팀의 TBM 기록이 통째로
 * 함께 사라지기 때문이다(스키마상 cascade). 그런 경우 비활성화를 쓴다.
 */
export async function deleteTeamAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireRole("SITE_MANAGER", "HQ_ADMIN");
  const teamId = String(formData.get("teamId") ?? "");

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: { _count: { select: { tbms: true, workers: true } } },
  });
  if (!team) return { error: "팀을 찾을 수 없습니다." };
  if (!canAccessSite(user, team.siteId)) return { error: "권한이 없습니다." };

  const verdict = judgeTeamDelete(team.name, team._count);
  if (!verdict.allowed) return { error: verdict.reason };

  await prisma.team.delete({ where: { id: teamId } });
  revalidatePath("/admin/teams");
  revalidatePath("/admin/workers");

  return {
    error: null,
    ok: true,
    message: `"${team.name}" 팀을 삭제했습니다.${verdict.note ? ` ${verdict.note}` : ""}`,
  };
}

export async function toggleTeamAction(formData: FormData): Promise<void> {
  const user = await requireRole("SITE_MANAGER", "HQ_ADMIN");
  const teamId = String(formData.get("teamId") ?? "");

  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team) return;
  await assertSite(user, team.siteId);

  await prisma.team.update({ where: { id: teamId }, data: { active: !team.active } });
  revalidatePath("/admin/teams");
}

// ---------------------------------------------------------------------------
// 로그인 계정
// ---------------------------------------------------------------------------

/**
 * 로그인 아이디 규칙.
 * 한글·영문·숫자와 . _ - 만 받는다. 공백과 @는 막는다 — 공백은 화면에서 보이지 않아
 * 로그인이 왜 안 되는지 알기 어렵고, @는 이메일로 착각하게 만든다.
 */
const USERNAME_RE = /^[가-힣a-zA-Z0-9._-]{2,32}$/;

/**
 * 계정을 만들고 손댈 수 있는 범위.
 * 사업장 관리자는 자기 사업장의 팀장 계정만 다룰 수 있다. 법인 대표 계정은
 * 본사만 만든다 — 작성자가 자기 결재자를 만들거나 잠글 수 있으면 결재선이 무너진다.
 */
function canCreateRole(user: SessionUser, role: Role, siteId: string | null): boolean {
  if (user.role === "HQ_ADMIN") return true;
  return role === "TEAM_LEAD" && siteId === user.siteId;
}

export async function createUserAction(formData: FormData): Promise<ActionResult> {
  const user = await requireRole("SITE_MANAGER", "HQ_ADMIN");

  const username = String(formData.get("username") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const role = String(formData.get("role") ?? "") as Role;
  const siteId = role === "HQ_ADMIN" ? null : String(formData.get("siteId") ?? "").trim() || null;

  if (!USERNAME_RE.test(username)) {
    return {
      error:
        "아이디는 2~32자의 한글·영문·숫자와 . _ - 만 쓸 수 있습니다. " +
        "공백과 @는 넣을 수 없습니다.",
    };
  }
  if (!name) return { error: "이름을 입력해 주세요." };
  if (password.length < 8) return { error: "비밀번호는 8자 이상이어야 합니다." };
  if (!["HQ_ADMIN", "SITE_MANAGER", "CEO", "TEAM_LEAD"].includes(role)) {
    return { error: "역할을 선택해 주세요." };
  }
  if (role !== "HQ_ADMIN" && !siteId) return { error: "사업장을 선택해 주세요." };
  if (!canCreateRole(user, role, siteId)) {
    return { error: "이 역할의 계정을 만들 권한이 없습니다." };
  }

  const exists = await prisma.user.findUnique({ where: { username } });
  if (exists) {
    // 동명이인이 흔하므로 어떻게 빠져나갈지까지 알려 준다.
    return {
      error:
        `이미 쓰고 있는 아이디입니다: ${username}. ` +
        `동명이인이면 뒤에 사업장이나 팀을 붙여 구분하세요 (예: ${username}.진천)`,
    };
  }

  await prisma.user.create({
    data: {
      username,
      name,
      role,
      siteId,
      phone: String(formData.get("phone") ?? "").trim() || null,
      passwordHash: await bcrypt.hash(password, 10),
    },
  });

  revalidatePath("/admin/users");
  return OK;
}

export async function resetPasswordAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireRole("SITE_MANAGER", "HQ_ADMIN");
  const userId = String(formData.get("userId") ?? "");
  const password = String(formData.get("password") ?? "");

  if (password.length < 8) return { error: "비밀번호는 8자 이상이어야 합니다." };

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) return { error: "계정을 찾을 수 없습니다." };
  if (!canCreateRole(actor, target.role, target.siteId)) {
    return { error: "이 계정의 비밀번호를 바꿀 권한이 없습니다." };
  }

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await bcrypt.hash(password, 10) },
  });

  revalidatePath("/admin/users");
  return OK;
}

export async function toggleUserAction(formData: FormData): Promise<void> {
  const actor = await requireRole("SITE_MANAGER", "HQ_ADMIN");
  const userId = String(formData.get("userId") ?? "");

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) return;
  // 자기 자신은 잠글 수 없다.
  if (target.id === actor.id) return;
  if (!canCreateRole(actor, target.role, target.siteId)) return;

  await prisma.user.update({ where: { id: userId }, data: { active: !target.active } });
  revalidatePath("/admin/users");
}

/**
 * 계정을 완전히 지운다.
 * 잘못 만든 계정이나 한 번도 쓰지 않은 계정을 정리하는 용도다.
 * 기록이 붙어 있으면 지우지 않는다 — 과거 문서에서 작성자·결재자가 비워지기 때문이다.
 */
export async function deleteUserAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireRole("SITE_MANAGER", "HQ_ADMIN");
  const userId = String(formData.get("userId") ?? "");

  const target = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      _count: {
        select: {
          ledTeams: true,
          authoredTbms: true,
          approvedTbms: true,
          auditLogs: true,
        },
      },
    },
  });
  if (!target) return { error: "계정을 찾을 수 없습니다." };
  // 자기 자신은 지울 수 없다. 관리자가 스스로를 잠가 버리는 것을 막는다.
  if (target.id === actor.id) return { error: "본인 계정은 지울 수 없습니다." };
  if (!canCreateRole(actor, target.role, target.siteId)) {
    return { error: "이 계정을 지울 권한이 없습니다." };
  }

  const verdict = judgeUserDelete(target.name, target._count);
  if (!verdict.allowed) return { error: verdict.reason };

  await prisma.user.delete({ where: { id: userId } });
  revalidatePath("/admin/users");
  revalidatePath("/admin/teams");

  return {
    error: null,
    ok: true,
    message: `${target.name}(${target.username}) 계정을 삭제했습니다.`,
  };
}
