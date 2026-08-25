import { NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { canAccessSite, type SessionUser } from "@/lib/authz";
import { canViewPatrols } from "@/lib/patrolRules";
import { buildTbmPdf, type Sharp } from "@/lib/pdf";
import { buildPatrolPdf } from "@/lib/patrolPdf";
import { loadTbmPdfData } from "@/lib/tbmPdfData";

export const dynamic = "force-dynamic";

/**
 * 한 번에 합칠 수 있는 문서 수.
 *
 * 서버리스 응답에 크기 한도가 있어 무한정 합칠 수 없다. 사진이 든 TBM은 한 건에
 * 1MB를 넘기도 해서, 여유를 두고 끊는다. 넘으면 나눠서 인쇄하라고 알려 준다.
 */
const MAX_DOCS = 20;

export async function POST(req: Request) {
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

  const form = await req.formData();
  const tbmIds = form.getAll("tbmIds").map(String).filter(Boolean);
  const patrolIds = canViewPatrols(user)
    ? form.getAll("patrolIds").map(String).filter(Boolean)
    : [];

  const total = tbmIds.length + patrolIds.length;
  if (total === 0) {
    return NextResponse.json({ error: "인쇄할 문서를 선택해 주세요." }, { status: 400 });
  }
  if (total > MAX_DOCS) {
    return NextResponse.json(
      { error: `한 번에 ${MAX_DOCS}건까지 인쇄할 수 있습니다. 나눠서 인쇄해 주세요.` },
      { status: 400 },
    );
  }

  // 사진 축소용. 라우트에서 불러야 서버리스에서 모듈이 올라온다(lib/pdf 주석 참고).
  let sharp: Sharp | null = null;
  try {
    sharp = (await import("sharp")).default;
  } catch {
    sharp = null;
  }

  const merged = await PDFDocument.create();
  merged.setTitle("가공사업부 안전관리 · 일괄 인쇄");
  merged.setCreator("가공사업부 안전관리 시스템");

  const add = async (bytes: Uint8Array) => {
    const doc = await PDFDocument.load(bytes);
    const pages = await merged.copyPages(doc, doc.getPageIndices());
    for (const p of pages) merged.addPage(p);
  };

  // --- TBM -----------------------------------------------------------------
  for (const id of tbmIds) {
    const loaded = await loadTbmPdfData(id);
    if (!loaded) continue;
    if (!canAccessSite(user, loaded.siteId)) continue;
    await add(await buildTbmPdf(loaded.data, { sharp }));
  }

  // --- 안전(순찰)일지 -------------------------------------------------------
  if (patrolIds.length > 0) {
    const patrols = await prisma.patrol.findMany({
      where: { id: { in: patrolIds } },
      include: {
        plant: { select: { name: true } },
        author: { select: { name: true } },
        reviewer: { select: { name: true } },
        reviewOnBehalf: { select: { name: true } },
        approver: { select: { name: true } },
        onBehalfOf: { select: { name: true } },
        rounds: { orderBy: { sort: "asc" } },
        checks: { orderBy: { sort: "asc" } },
      },
      orderBy: [{ patrolDate: "asc" }, { plant: { sort: "asc" } }],
    });

    for (const patrol of patrols) {
      const pdf = await buildPatrolPdf({
        plantName: patrol.plant.name,
        patrolDate: patrol.patrolDate,
        startedAt: patrol.startedAt,
        endedAt: patrol.endedAt,
        weather: patrol.weather,
        patrollerName: patrol.patrollerName,
        remarks: patrol.remarks,
        status: patrol.status,
        authorName: patrol.author?.name ?? null,
        submittedAt: patrol.submittedAt,
        reviewerName: patrol.reviewer?.name ?? null,
        reviewedAt: patrol.reviewedAt,
        reviewOnBehalfName: patrol.reviewOnBehalf?.name ?? null,
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
      await add(pdf);
    }
  }

  if (merged.getPageCount() === 0) {
    return NextResponse.json(
      { error: "인쇄할 수 있는 문서가 없습니다. 권한을 확인해 주세요." },
      { status: 403 },
    );
  }

  const out = await merged.save();
  const filename = `안전관리_일괄인쇄_${total}건.pdf`;
  return new NextResponse(new Uint8Array(out), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="print.pdf"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "cache-control": "no-store",
    },
  });
}
