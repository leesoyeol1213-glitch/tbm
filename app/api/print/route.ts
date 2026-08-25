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
 * 서버리스 응답 크기 한도가 약 4.5MB다. 아래 화소로 줄여도 사진 두 장 든 TBM이
 * 건당 280KB쯤 되므로 12건이면 3.3MB, 한도까지 여유가 남는다. 한도를 꽉 채우면
 * 사진이 많은 달에 통째로 실패하는데, 그건 한 번 더 나눠 받는 것보다 나쁘다.
 */
const MAX_DOCS = 12;

/**
 * 합칠 때 사진을 줄일 화소와 품질.
 *
 * 지면에서 사진은 가로 8.8cm로 찍힌다. 800px면 약 230dpi로 인쇄에 충분하고,
 * 한 건씩 받을 때 쓰는 1041px(300dpi)보다 건당 150KB를 아낀다. 그만큼 한 번에
 * 더 많이 담을 수 있다.
 */
const PRINT_PHOTO_PX = 800;
const PRINT_PHOTO_QUALITY = 72;

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
    return NextResponse.json({ error: "내려받을 문서를 선택해 주세요." }, { status: 400 });
  }
  if (total > MAX_DOCS) {
    return NextResponse.json(
      { error: `한 번에 ${MAX_DOCS}건까지 합칠 수 있습니다. 나눠서 받아 주세요.` },
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
  merged.setTitle("가공사업부 안전관리 · 병합 문서");
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
    await add(
      await buildTbmPdf(loaded.data, {
        sharp,
        photoMaxPx: PRINT_PHOTO_PX,
        photoQuality: PRINT_PHOTO_QUALITY,
      }),
    );
  }

  // --- 안전(순찰)일지 -------------------------------------------------------
  if (patrolIds.length > 0) {
    const patrols = await prisma.patrol.findMany({
      where: { id: { in: patrolIds } },
      include: {
        plant: { select: { name: true } },
        author: { select: { name: true } },
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
      { error: "내려받을 수 있는 문서가 없습니다. 권한을 확인해 주세요." },
      { status: 403 },
    );
  }

  const out = await merged.save();
  const filename = `안전관리_${total}건.pdf`;
  return new NextResponse(new Uint8Array(out), {
    headers: {
      "content-type": "application/pdf",
      // 파일로 받아 두고 각자 인쇄한다. 브라우저 인쇄창을 띄우지 않는다.
      "content-disposition":
        `attachment; filename="merged.pdf"; ` +
        `filename*=UTF-8''${encodeURIComponent(filename)}`,
      "cache-control": "no-store",
    },
  });
}
