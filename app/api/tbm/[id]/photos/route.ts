import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { canEdit, type SessionUser } from "@/lib/authz";
import { readPhotoExif } from "@/lib/exif";
import { extractApp1, spliceApp1 } from "@/lib/jpegExif";
import { siblingSites } from "@/lib/siteGroup";
import { isAllowedImage, storeImage } from "@/lib/storage";
import type { Sharp } from "@/lib/pdf";
import { MAX_PHOTOS, checkPhoto, recomputeFlags } from "@/lib/tbm";

/**
 * 한 번에 보낼 수 있는 바이트.
 *
 * Vercel은 요청 본문이 4.5MB를 넘으면 함수까지 오지도 않고 413으로 자른다.
 * 우리가 15MB를 받겠다고 해봐야 소용이 없었다 — 폰 원본 한 장이 4~6MB라
 * 그대로 올리면 사유도 없이 실패한다. 그래서 브라우저에서 미리 줄여 보내고,
 * 여기서는 그보다 낮은 값으로 한 번 더 막는다.
 */
const MAX_BYTES = 4 * 1024 * 1024;

/**
 * 저장할 때 줄이는 긴 변 화소.
 *
 * 폰 원본은 한 장에 3~5MB인데 문서에 쓰이는 건 250pt(약 3.5cm) 크기다.
 * 원본을 그대로 쌓으면 무료 저장 용량이 한 달을 못 간다. 1280px면 PDF가
 * 필요한 1041px보다 여유가 있고, 화면에서 확대해 보호구 착용을 확인할
 * 정도는 된다. 장당 200KB 아래로 떨어져 열 배 넘게 오래 쓸 수 있다.
 */
const STORE_MAX_PX = 1280;
const STORE_QUALITY = 80;

/**
 * 저장용으로 사진을 줄인다. EXIF는 남긴다 — 촬영 시각과 GPS를 DB에 따로
 * 넣어 두긴 하지만, 파일 자체가 증거로 필요한 상황이 있다.
 *
 * 줄이지 못하면 원본을 그대로 저장한다. 사진을 못 올리는 것보다는 낫다.
 */
async function shrink(
  sharp: Sharp | null,
  buf: Buffer,
  contentType: string,
  note: (m: string) => void,
  /** 브라우저가 이미 줄여 보냈는지. 그렇다면 방향 보정이 아직 안 끝난 상태다. */
  preShrunk: boolean,
): Promise<{ body: Buffer; contentType: string }> {
  if (!sharp) return { body: buf, contentType };
  try {
    const out = await sharp(buf)
      // 세워 찍은 사진이 눕지 않도록 EXIF 방향을 먼저 적용한다.
      .rotate()
      .resize({
        width: STORE_MAX_PX,
        height: STORE_MAX_PX,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: STORE_QUALITY, mozjpeg: true })
      .withMetadata()
      .toBuffer();
    // 원본이 이미 더 작으면 굳이 바꾸지 않는다. 단 브라우저가 줄여 보낸 것은
    // 세워 찍은 사진이 아직 누워 있으므로, 크기와 무관하게 보정본을 써야 한다.
    if (!preShrunk && out.length >= buf.length) return { body: buf, contentType };
    return { body: Buffer.from(out), contentType: "image/jpeg" };
  } catch (e) {
    note(`photo-shrink-failed: ${(e as Error)?.message ?? e}`);
    return { body: buf, contentType };
  }
}

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
  // 브라우저가 사진을 줄여 보낼 때 원본 앞부분을 함께 보낸다. 줄인 파일에는
  // EXIF가 없어서 촬영 시각·좌표를 여기서 읽는다. 순서는 photos와 같다.
  const heads = form.getAll("exif").filter((f): f is File => f instanceof File);
  // 짝이 맞을 때만 쓴다. 하나라도 어긋나면 다른 사진의 촬영 시각·좌표가
  // 붙어 버리는데, 그건 사진이 없는 것보다 나쁘다.
  const headFor = (i: number): File | null => {
    if (heads.length !== files.length) return null;
    const h = heads[i];
    return h && h.size > 0 ? h : null;
  };

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
  const notes: string[] = [];

  // 사진을 줄여 저장하기 위한 것. 라우트 파일에서 불러야 배포본에서 올라온다.
  // 못 올라오면 원본이 그대로 저장된다(용량만 커지고 동작은 같다).
  let sharp: Sharp | null = null;
  try {
    sharp = (await import("sharp")).default;
  } catch (e) {
    notes.push(`sharp-load-failed: ${(e as Error)?.message ?? e}`);
  }

  for (const [index, file] of files.entries()) {
    if (!isAllowedImage(file.type)) {
      return NextResponse.json(
        { error: `지원하지 않는 형식입니다: ${file.type || "알 수 없음"}` },
        { status: 400 },
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        {
          error: `${file.name} 파일이 너무 큽니다. 카메라에서 사진 크기를 줄여 다시 찍어 주세요.`,
        },
        { status: 400 },
      );
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const part = headFor(index);
    const head = part ? Buffer.from(await part.arrayBuffer()) : null;

    // EXIF는 원본에서 읽는다. 브라우저가 줄여 보낸 경우 줄인 파일에는 없으므로
    // 함께 온 원본 머리 조각을 본다.
    const exif = await readPhotoExif(head ?? buf);
    const check = checkPhoto(exif, tbm.site, tbm.workDate);

    // 저장할 파일에도 원본 EXIF를 도로 끼운다. 사진 파일 자체가 증거로 필요한
    // 때가 있고, 방향 정보가 있어야 sharp가 눕은 사진을 세운다.
    const app1 = head ? extractApp1(head) : null;
    const withExif = app1 ? spliceApp1(buf, app1) : buf;

    const small = await shrink(
      sharp,
      withExif,
      file.type,
      (m) => notes.push(m),
      head !== null,
    );
    const stored = await storeImage(
      `tbm/${tbm.siteId}/${tbmId}`,
      small.body,
      small.contentType,
    );

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

  return NextResponse.json(
    { photos: created, sharedWith: [...sharedSiteNames] },
    // 축소 같은 부가 처리가 실패해도 사진은 올라간다. 조용히 묻히지 않게 남긴다.
    notes.length > 0
      ? {
          headers: {
            "x-photo-notes": encodeURIComponent(notes.join(" | ").slice(0, 400)),
          },
        }
      : undefined,
  );
}
