import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { canEdit, type SessionUser } from "@/lib/authz";
import { readPhotoExif } from "@/lib/exif";
import { siblingSites } from "@/lib/siteGroup";
import { isAllowedImage, storeImage } from "@/lib/storage";
import { MAX_PHOTOS, checkPhoto, recomputeFlags } from "@/lib/tbm";

const MAX_BYTES = 15 * 1024 * 1024; // 요즘 폰 사진 한 장 여유분

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
  // 한 번에 몇 장을 올리든, 이미 올린 것과 합쳐 상한을 넘지 못한다.
  const already = await prisma.tbmPhoto.count({ where: { tbmId } });
  if (already + files.length > MAX_PHOTOS) {
    return NextResponse.json(
      {
        error:
          already >= MAX_PHOTOS
            ? `사진은 최대 ${MAX_PHOTOS}장입니다. 바꾸려면 올려둔 사진을 지우고 다시 올려 주세요.`
            : `사진은 최대 ${MAX_PHOTOS}장입니다. 지금 ${already}장이라 ${MAX_PHOTOS - already}장 더 올릴 수 있습니다.`,
      },
      { status: 400 },
    );
  }

  // 같은 주소를 쓰는 법인들에 함께 올릴지. 한 공장에서 합동으로 TBM을 하는 경우다.
  // 이미 승인된 문서는 건드리지 않는다 — 승인 뒤에 사진이 붙으면 정정 이력 없이
  // 내용이 바뀌는 셈이 된다.
  const wantShare = String(form.get("share") ?? "") === "1";
  const targets: {
    tbmId: string;
    site: typeof tbm.site;
    workDate: Date;
    room: number;
  }[] = [];

  if (wantShare) {
    const siblings = await siblingSites(tbm.site);
    if (siblings.length > 0) {
      const rows = await prisma.tbm.findMany({
        where: {
          siteId: { in: siblings.map((s) => s.id) },
          workDate: tbm.workDate,
          status: { not: "APPROVED" },
        },
        include: { site: true, _count: { select: { photos: true } } },
      });
      for (const t of rows) {
        const room = MAX_PHOTOS - t._count.photos;
        if (room > 0) targets.push({ tbmId: t.id, site: t.site, workDate: t.workDate, room });
      }
    }
  }

  const created: { id: string; url: string; warnings: string[] }[] = [];
  const sharedTbmIds = new Set<string>();
  const sharedSiteNames = new Set<string>();

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

    // 사본은 파일을 다시 저장하지 않고 같은 blob을 가리킨다. 위치 검증만
    // 각 법인의 사업장 좌표로 다시 계산한다(같은 주소라도 허용 반경이 다를 수 있다).
    const copyIds: string[] = [];
    for (const t of targets) {
      if (t.room <= 0) continue;
      const c = checkPhoto(exif, t.site, t.workDate);
      const copy = await prisma.tbmPhoto.create({
        data: {
          tbmId: t.tbmId,
          url: stored.url,
          pathname: stored.pathname,
          uploadedById: user.id,
          takenAt: exif.takenAt,
          lat: exif.lat,
          lng: exif.lng,
          distanceM: c.distanceM,
          hasExif: exif.hasExif,
          warnings: c.warnings,
        },
      });
      copyIds.push(copy.id);
      t.room -= 1;
      sharedTbmIds.add(t.tbmId);
      sharedSiteNames.add(t.site.name);
    }

    // 사본이 실제로 생겼을 때만 묶음 표시를 남긴다. 표시가 있으면 화면에서
    // "몇 개 법인 공용"인지 알려 줄 수 있다.
    if (copyIds.length > 0) {
      await prisma.tbmPhoto.updateMany({
        where: { id: { in: [photo.id, ...copyIds] } },
        data: { sharedGroupId: randomUUID() },
      });
    }
  }

  await prisma.auditLog.create({
    data: {
      tbmId,
      actorId: user.id,
      action: "PHOTO_ADD",
      detail:
        sharedSiteNames.size > 0
          ? `${created.length}장 (${sharedSiteNames.size}개 법인에 함께 올림)`
          : `${created.length}장`,
    },
  });
  await recomputeFlags(tbmId);

  // 사본을 받은 법인 쪽에도 누가 언제 올렸는지 남긴다. 자기 기록에 남의 손이
  // 닿은 것이므로 흔적 없이 지나가면 안 된다.
  for (const id of sharedTbmIds) {
    await prisma.auditLog.create({
      data: {
        tbmId: id,
        actorId: user.id,
        action: "PHOTO_ADD",
        detail: `${created.length}장 (${tbm.site.name} 합동 TBM에서 공유)`,
      },
    });
    await recomputeFlags(id);
  }

  return NextResponse.json({
    photos: created,
    sharedWith: [...sharedSiteNames],
  });
}
