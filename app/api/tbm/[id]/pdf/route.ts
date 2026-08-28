import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canAccessSite, type SessionUser, siteIdsFor } from "@/lib/authz";
import { buildTbmPdf, type Sharp } from "@/lib/pdf";
import { loadTbmPdfData } from "@/lib/tbmPdfData";
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
    siteIds: await siteIdsFor({ id: session.user.id, siteId: session.user.siteId }),
  };

  const { id } = await params;

  const loaded = await loadTbmPdfData(id);
  if (!loaded) {
    return NextResponse.json({ error: "TBM을 찾을 수 없습니다." }, { status: 404 });
  }
  if (!canAccessSite(user, loaded.siteId)) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }
  if (loaded.data.status !== "APPROVED") {
    return NextResponse.json(
      { error: "결재가 완료된 기록만 내려받을 수 있습니다." },
      { status: 409 },
    );
  }

  const notes: string[] = [];

  // 사진을 줄여 넣기 위한 것. 라우트 파일에서 부를 때만 배포본에서 제대로 올라온다.
  // 못 올라와도 문서는 나온다(원본이 들어가 크기만 커진다).
  let sharp: Sharp | null = null;
  try {
    sharp = (await import("sharp")).default;
  } catch (e) {
    notes.push(`sharp-load-failed: ${(e as Error)?.message ?? e}`);
  }

  const pdf = await buildTbmPdf(loaded.data, {
    note: (m) => notes.push(m),
    sharp,
  });

  const filename = `TBM_${loaded.siteCode}_${loaded.data.teamName}_${ymd(loaded.data.workDate)}.pdf`;

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition":
        `attachment; filename="TBM_${loaded.siteCode}_${ymd(loaded.data.workDate)}.pdf"; ` +
        `filename*=UTF-8''${encodeURIComponent(filename)}`,
      "cache-control": "no-store",
      // 사진 축소 같은 부가 처리가 실패해도 문서는 나온다. 조용히 묻히지 않게 남긴다.
      ...(notes.length > 0
        ? { "x-pdf-notes": encodeURIComponent(notes.join(" | ").slice(0, 400)) }
        : {}),
    },
  });
}
