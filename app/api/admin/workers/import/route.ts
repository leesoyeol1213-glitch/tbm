import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { canAccessSite, siteIdsFor } from "@/lib/authz";
import { parseWorkerFile, type ParsedRow } from "@/lib/workerImport";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 2000;

export type ImportAction = "create" | "update" | "error";

export type ImportRow = {
  line: number;
  name: string;
  empNo: string;
  teamName: string;
  phone: string;
  action: ImportAction;
  errors: string[];
};

export type ImportResponse = {
  fatal?: string;
  applied: boolean;
  summary: {
    total: number;
    create: number;
    update: number;
    error: number;
    newTeams: string[];
    deactivate: number;
  };
  rows: ImportRow[];
};

const norm = (s: string) => s.trim().toLowerCase();

export async function POST(req: Request) {
  const session = await auth();
  const user = session?.user;
  if (!user?.id || user.role === "TEAM_LEAD") {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  const form = await req.formData();
  const file = form.get("file");
  const siteId = String(form.get("siteId") ?? "");
  const createTeams = String(form.get("createTeams") ?? "") === "1";
  const deactivateMissing = String(form.get("deactivateMissing") ?? "") === "1";
  const dryRun = String(form.get("dryRun") ?? "1") === "1";

  const site = await prisma.site.findUnique({ where: { id: siteId } });
  if (!site) return NextResponse.json({ error: "사업장을 찾을 수 없습니다." }, { status: 404 });
  // 겸임 사업장까지 봐야 한다. 한 사람이 여러 법인을 맡는 곳이다.
  const scope = {
    id: user.id,
    name: user.name ?? "",
    role: user.role,
    siteId: user.siteId,
    siteIds: await siteIdsFor({ id: user.id, siteId: user.siteId }),
  };
  if (!canAccessSite(scope, site.id)) {
    return NextResponse.json({ error: "권한이 없는 사업장입니다." }, { status: 403 });
  }

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "파일이 없습니다." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "파일이 너무 큽니다. (최대 5MB)" }, { status: 400 });
  }

  const parsed = await parseWorkerFile(
    Buffer.from(await file.arrayBuffer()),
    file.name,
  );

  const empty: ImportResponse["summary"] = {
    total: 0,
    create: 0,
    update: 0,
    error: 0,
    newTeams: [],
    deactivate: 0,
  };

  if (parsed.fatal) {
    return NextResponse.json<ImportResponse>({
      fatal: parsed.fatal,
      applied: false,
      summary: empty,
      rows: [],
    });
  }
  if (parsed.rows.length > MAX_ROWS) {
    return NextResponse.json<ImportResponse>({
      fatal: `한 번에 최대 ${MAX_ROWS}명까지 올릴 수 있습니다. (읽은 줄 ${parsed.rows.length})`,
      applied: false,
      summary: empty,
      rows: [],
    });
  }

  // --- 현재 상태 읽기 ------------------------------------------------------
  const [teams, workers] = await Promise.all([
    prisma.team.findMany({ where: { siteId }, select: { id: true, name: true } }),
    prisma.worker.findMany({
      where: { siteId },
      select: { id: true, name: true, empNo: true, active: true },
    }),
  ]);

  const teamByName = new Map(teams.map((t) => [norm(t.name), t]));
  const byEmpNo = new Map(
    workers.filter((w) => w.empNo).map((w) => [norm(w.empNo!), w]),
  );
  const nameCounts = new Map<string, number>();
  for (const w of workers) {
    nameCounts.set(norm(w.name), (nameCounts.get(norm(w.name)) ?? 0) + 1);
  }
  const byName = new Map(workers.map((w) => [norm(w.name), w]));

  // --- 한 줄씩 판정 --------------------------------------------------------
  const newTeamNames = new Set<string>();
  const rows: ImportRow[] = [];
  /** 실제 반영할 작업 목록 */
  const plan: { row: ParsedRow; existingId: string | null; teamName: string }[] = [];
  const touchedIds = new Set<string>();

  for (const row of parsed.rows) {
    const errors = [...row.errors];
    const { name, empNo, teamName } = row.data;

    // 기존 인원 찾기
    let existingId: string | null = null;
    if (empNo) {
      existingId = byEmpNo.get(norm(empNo))?.id ?? null;
    } else if (name) {
      const count = nameCounts.get(norm(name)) ?? 0;
      if (count === 1) existingId = byName.get(norm(name))?.id ?? null;
      else if (count > 1) {
        errors.push(
          `같은 이름이 이미 ${count}명 있어 누구인지 알 수 없습니다. 사번을 채워 주세요.`,
        );
      }
    }

    // 팀 확인
    if (teamName) {
      if (!teamByName.has(norm(teamName))) {
        if (createTeams) newTeamNames.add(teamName.trim());
        else errors.push(`등록되지 않은 팀입니다: ${teamName}`);
      }
    } else {
      errors.push("팀이 비어 있습니다. QR 출석이 기록되지 않습니다.");
    }

    const action: ImportAction =
      errors.length > 0 ? "error" : existingId ? "update" : "create";

    rows.push({
      line: row.line,
      name,
      empNo,
      teamName,
      phone: row.data.phone,
      action,
      errors,
    });

    if (action !== "error") {
      plan.push({ row, existingId, teamName });
      if (existingId) touchedIds.add(existingId);
    }
  }

  const summary: ImportResponse["summary"] = {
    total: rows.length,
    create: rows.filter((r) => r.action === "create").length,
    update: rows.filter((r) => r.action === "update").length,
    error: rows.filter((r) => r.action === "error").length,
    newTeams: [...newTeamNames],
    deactivate: deactivateMissing
      ? workers.filter((w) => w.active && !touchedIds.has(w.id)).length
      : 0,
  };

  // --- 미리보기면 여기서 끝 -------------------------------------------------
  if (dryRun) {
    return NextResponse.json<ImportResponse>({ applied: false, summary, rows });
  }

  if (summary.create + summary.update === 0) {
    return NextResponse.json<ImportResponse>({
      fatal: "반영할 인원이 없습니다. 오류를 먼저 고쳐 주세요.",
      applied: false,
      summary,
      rows,
    });
  }

  // --- 실제 반영 -----------------------------------------------------------
  for (const teamName of newTeamNames) {
    const created = await prisma.team.create({ data: { siteId, name: teamName } });
    teamByName.set(norm(created.name), { id: created.id, name: created.name });
  }

  for (const item of plan) {
    const { name, empNo, phone, birthMmdd, jobTitle, company } = item.row.data;
    const teamId = item.teamName ? (teamByName.get(norm(item.teamName))?.id ?? null) : null;

    const data = {
      name,
      empNo: empNo || null,
      phone: phone || null,
      birthMmdd: birthMmdd || null,
      jobTitle: jobTitle || null,
      company: company || null,
      teamId,
      active: true,
    };

    if (item.existingId) {
      await prisma.worker.update({ where: { id: item.existingId }, data });
    } else {
      const created = await prisma.worker.create({ data: { siteId, ...data } });
      touchedIds.add(created.id);
    }
  }

  if (deactivateMissing) {
    await prisma.worker.updateMany({
      where: { siteId, active: true, id: { notIn: [...touchedIds] } },
      data: { active: false },
    });
  }

  return NextResponse.json<ImportResponse>({ applied: true, summary, rows });
}
