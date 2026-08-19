import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { canAccessSite, type SessionUser } from "@/lib/authz";
import { describeFlags } from "@/lib/tbm";
import { buildTbmPdf } from "@/lib/pdf";
import { ymd } from "@/lib/kst";

// 사진을 받아 PDF에 넣느라 시간이 좀 걸린다.
export const maxDuration = 60;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  const user: SessionUser = {
    id: session.user.id,
    name: session.user.name ?? "",
    role: session.user.role,
    siteId: session.user.siteId,
  };

  const { id } = await params;

  const tbm = await prisma.tbm.findUnique({
    where: { id },
    include: {
      site: true,
      team: { select: { name: true } },
      author: { select: { name: true } },
      approver: { select: { name: true } },
      eduItems: { orderBy: { sort: "asc" } },
      hazards: { orderBy: { sort: "asc" } },
      photos: { orderBy: { uploadedAt: "asc" } },
      attendances: {
        include: { worker: { select: { name: true, empNo: true } } },
      },
    },
  });

  if (!tbm) {
    return NextResponse.json({ error: "TBM을 찾을 수 없습니다." }, { status: 404 });
  }
  if (!canAccessSite(user, tbm.siteId)) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }
  if (tbm.status !== "APPROVED") {
    return NextResponse.json(
      { error: "결재가 완료된 기록만 내려받을 수 있습니다." },
      { status: 409 },
    );
  }

  // 명부 전체를 기준으로 출결을 채운다. 기록이 없는 사람도 문서에 남아야 한다.
  const workers = await prisma.worker.findMany({
    where: { teamId: tbm.teamId },
    select: { id: true, name: true, empNo: true },
    orderBy: [{ empNo: { sort: "asc", nulls: "last" } }, { name: "asc" }],
  });
  const byWorker = new Map(tbm.attendances.map((a) => [a.workerId, a]));

  const pdf = await buildTbmPdf({
    siteName: tbm.site.name,
    siteCode: tbm.site.code,
    teamName: tbm.team.name,
    workDate: tbm.workDate,
    heldAt: tbm.heldAt,
    weather: tbm.weather,
    status: tbm.status,
    workDescription: tbm.workDescription,
    remarks: tbm.remarks,
    authorName: tbm.author?.name ?? null,
    submittedAt: tbm.submittedAt,
    approverName: tbm.approver?.name ?? null,
    approvedAt: tbm.approvedAt,
    eduItems: tbm.eduItems.map((e) => ({ content: e.content, done: e.done })),
    hazards: tbm.hazards.map((h) => ({ hazard: h.hazard, control: h.control })),
    attendances: workers.map((w) => {
      const a = byWorker.get(w.id);
      return {
        empNo: w.empNo,
        name: w.name,
        state: a?.state ?? null,
        method: a?.method ?? null,
        checkedInAt: a?.checkedInAt ?? null,
      };
    }),
    photos: tbm.photos.map((p) => ({
      url: p.url,
      takenAt: p.takenAt,
      distanceM: p.distanceM,
      warnings: p.warnings,
    })),
    flags: describeFlags(tbm, tbm.site).map((f) => ({
      label: f.label,
      detail: f.detail,
    })),
  });

  const filename = `TBM_${tbm.site.code}_${tbm.team.name}_${ymd(tbm.workDate)}.pdf`;

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition":
        `attachment; filename="TBM_${tbm.site.code}_${ymd(tbm.workDate)}.pdf"; ` +
        `filename*=UTF-8''${encodeURIComponent(filename)}`,
      "cache-control": "no-store",
    },
  });
}
