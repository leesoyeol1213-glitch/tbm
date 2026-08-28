import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { canAccessSite, siteIdsFor } from "@/lib/authz";
import { buildTemplateWorkbook } from "@/lib/workerImport";

export async function GET(req: Request) {
  const session = await auth();
  const user = session?.user;
  if (!user?.id || user.role === "TEAM_LEAD") {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  const siteId = new URL(req.url).searchParams.get("site") ?? "";
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

  const teams = await prisma.team.findMany({
    where: { siteId: site.id, active: true },
    select: { name: true },
    orderBy: { name: "asc" },
  });

  const buf = await buildTemplateWorkbook(
    site.name,
    teams.map((t) => t.name),
  );

  // 한글 파일명은 RFC 5987 형식으로 넘겨야 브라우저가 제대로 받는다.
  const filename = `작업자명부_${site.name}.xlsx`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="worker-template.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "cache-control": "no-store",
    },
  });
}
