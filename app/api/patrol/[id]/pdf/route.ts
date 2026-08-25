import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { canAccessSite, type SessionUser } from "@/lib/authz";
import { dateLabel } from "@/lib/kst";
import { buildPatrolPdf } from "@/lib/patrolPdf";

export const dynamic = "force-dynamic";

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
  const patrol = await prisma.patrol.findUnique({
    where: { id },
    include: {
      site: { select: { name: true, code: true } },
      author: { select: { name: true } },
      approver: { select: { name: true } },
      onBehalfOf: { select: { name: true } },
      rounds: { orderBy: { sort: "asc" } },
      checks: { orderBy: { sort: "asc" } },
    },
  });

  if (!patrol) {
    return NextResponse.json({ error: "순찰일지를 찾을 수 없습니다." }, { status: 404 });
  }
  if (!canAccessSite(user, patrol.siteId)) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  const pdf = await buildPatrolPdf({
    siteName: patrol.site.name,
    siteCode: patrol.site.code,
    patrolDate: patrol.patrolDate,
    startedAt: patrol.startedAt,
    endedAt: patrol.endedAt,
    weather: patrol.weather,
    patrollerName: patrol.patrollerName,
    remarks: patrol.remarks,
    status: patrol.status,
    authorName: patrol.author?.name ?? null,
    submittedAt: patrol.submittedAt,
    approverName: patrol.approver?.name ?? null,
    approvedAt: patrol.approvedAt,
    onBehalfOfName: patrol.onBehalfOf?.name ?? null,
    correctedAt: patrol.correctedAt,
    rounds: patrol.rounds.map((r) => ({
      place: r.place,
      content: r.content,
      state: r.state,
      note: r.note,
    })),
    checks: patrol.checks.map((c) => ({
      content: c.content,
      state: c.state,
      action: c.action,
    })),
  });

  // 한글 파일명은 RFC 5987 형식으로 넘겨야 브라우저가 제대로 받는다.
  const filename = `안전순찰일지_${patrol.site.name}_${dateLabel(patrol.patrolDate)}.pdf`;
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="patrol.pdf"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "cache-control": "no-store",
    },
  });
}
