import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { canEdit, type SessionUser } from "@/lib/authz";
import { readPhotoExif } from "@/lib/exif";
import { isAllowedImage, storeImage } from "@/lib/storage";
import { checkPhoto, recomputeFlags } from "@/lib/tbm";

const MAX_BYTES = 15 * 1024 * 1024; // 요즘 폰 사진 한 장 여유분
const MAX_FILES = 10;

export async function POST(
  req: Request,
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

  const { id: tbmId } = await params;

  const tbm = await prisma.tbm.findUnique({
    where: { id: tbmId },
    include: { site: true },
  });
  if (!tbm) {
    return NextResponse.json({ error: "TBM을 찾을 수 없습니다." }, { status: 404 });
  }

  const ledTeams = await prisma.team.findMany({
    where: { leaderId: user.id },
    select: { id: true },
  });
  if (!canEdit(user, tbm, ledTeams.map((t) => t.id))) {
    return NextResponse.json(
      { error: "이 기록에 사진을 올릴 권한이 없습니다." },
      { status: 403 },
    );
  }

  const form = await req.formData();
  const files = form.getAll("photos").filter((f): f is File => f instanceof File);

  if (files.length === 0) {
    return NextResponse.json({ error: "사진이 없습니다." }, { status: 400 });
  }
  if (files.length > MAX_FILES) {
    return NextResponse.json(
      { error: `한 번에 최대 ${MAX_FILES}장까지 올릴 수 있습니다.` },
      { status: 400 },
    );
  }

  const created: { id: string; url: string; warnings: string[] }[] = [];

  for (const file of files) {
    if (!isAllowedImage(file.type)) {
      return NextResponse.json(
        { error: `지원하지 않는 형식입니다: ${file.type || "알 수 없음"}` },
        { status: 400 },
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `${file.name} 파일이 너무 큽니다. (최대 15MB)` },
        { status: 400 },
      );
    }

    const buf = Buffer.from(await file.arrayBuffer());

    // 저장 전에 EXIF를 읽는다. 저장 과정에서 메타데이터가 깎이는 것을 피하기 위함.
    const exif = await readPhotoExif(buf);
    const check = checkPhoto(exif, tbm.site, tbm.workDate);

    const stored = await storeImage(`tbm/${tbm.siteId}/${tbmId}`, buf, file.type);

    const photo = await prisma.tbmPhoto.create({
      data: {
        tbmId,
        url: stored.url,
        pathname: stored.pathname,
        uploadedById: user.id,
        takenAt: exif.takenAt,
        lat: exif.lat,
        lng: exif.lng,
        distanceM: check.distanceM,
        hasExif: exif.hasExif,
        warnings: check.warnings,
      },
    });

    created.push({ id: photo.id, url: photo.url, warnings: check.warnings });
  }

  await prisma.auditLog.create({
    data: {
      tbmId,
      actorId: user.id,
      action: "PHOTO_ADD",
      detail: `${created.length}장`,
    },
  });
  await recomputeFlags(tbmId);

  return NextResponse.json({ photos: created });
}
