import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { canEdit, type SessionUser, siteIdsFor } from "@/lib/authz";
import { readPhotoExif } from "@/lib/exif";
import { extractApp1, spliceApp1 } from "@/lib/jpegExif";
import { siblingSites } from "@/lib/siteGroup";
import { isAllowedImage, storeImage } from "@/lib/storage";
import type { Sharp } from "@/lib/pdf";
import {
  DOC_PHOTOS,
  MAX_OWN_PHOTOS,
  checkPhoto,
  ensureTbm,
  recomputeFlags,
} from "@/lib/tbm";

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
    siteIds: await siteIdsFor({ id: session.user.id, siteId: session.user.siteId }),
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
  // 상한은 직접 올린 사진으로만 센다. 옆 법인에서 받은 사본은 자리를 먹지 않는다.
  const already = await prisma.tbmPhoto.count({
    where: { tbmId, sharedFromSiteId: null },
  });
  if (already + files.length > MAX_OWN_PHOTOS) {
    return NextResponse.json(
      {
        error:
          already >= MAX_OWN_PHOTOS
            ? `직접 올리는 사진은 최대 ${MAX_OWN_PHOTOS}장입니다. 바꾸려면 올려둔 사진을 지우고 다시 올려 주세요.`
            : `직접 올리는 사진은 최대 ${MAX_OWN_PHOTOS}장입니다. 지금 ${already}장이라 ${MAX_OWN_PHOTOS - already}장 더 올릴 수 있습니다.`,
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
    // 위치 검증만 다시 하므로 좌표와 이름이면 된다.
    site: { id: string; name: string; lat: number | null; lng: number | null; geofenceM: number };
    workDate: Date;
    /** 문서에 자동으로 실을 수 있는 남은 자리. 0 이하면 참고용으로만 붙는다. */
    docRoom: number;
  }[] = [];
  /** 팀이 없어 일지를 만들 수 없었던 법인. 사람에게 알려 줘야 한다. */
  const noTeam: string[] = [];

  if (wantShare) {
    for (const sibling of await siblingSites(tbm.site)) {
      const teams = await prisma.team.findMany({
        where: { siteId: sibling.id, active: true },
        select: { id: true },
      });
      if (teams.length === 0) {
        noTeam.push(sibling.name);
        continue;
      }

      for (const team of teams) {
        // 아직 아무도 출석을 찍지 않아 일지가 없으면 만들어서라도 붙인다.
        // 어차피 그날 아침에 생길 일지이고, 사진이 안 넘어가는 편이 더 나쁘다.
        const target = await ensureTbm(team.id, tbm.workDate, { autoCreated: true });
        const already = await prisma.tbmPhoto.count({
          where: { tbmId: target.id, included: true },
        });
        targets.push({
          tbmId: target.id,
          site: sibling,
          workDate: target.workDate,
          // 이미 승인된 문서는 내용이 바뀌면 안 된다. 사진은 붙이되 참고용으로만
          // 두어 결재가 끝난 PDF는 그대로 남게 한다.
          docRoom: target.status === "APPROVED" ? 0 : DOC_PHOTOS - already,
        });
      }
    }
  }

  // 문서에는 먼저 들어온 순으로 DOC_PHOTOS 장까지만 자동으로 싣는다.
  // 넘치는 사진은 화면에 참고용으로 남고, 상신 전에 사람이 바꿔 끼울 수 있다.
  let docRoom =
    DOC_PHOTOS - (await prisma.tbmPhoto.count({ where: { tbmId, included: true } }));

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

    // 자리가 없으면 받은 사진을 하나 내리고 자기 사진을 넣는다. 우리 일지에는
    // 우리가 찍은 사진이 실려야 한다 — 옆 법인 사진에 밀려 빠지면 왜 안 들어갔는지
    // 알기 어렵다. 내려간 사진은 화면에 참고용으로 남는다.
    if (docRoom <= 0) {
      const bump = await prisma.tbmPhoto.findFirst({
        where: { tbmId, included: true, sharedFromSiteId: { not: null } },
        orderBy: { uploadedAt: "desc" },
        select: { id: true },
      });
      if (bump) {
        await prisma.tbmPhoto.update({
          where: { id: bump.id },
          data: { included: false },
        });
        docRoom = 1;
      }
    }

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
        included: docRoom > 0,
      },
    });
    if (docRoom > 0) docRoom -= 1;

    created.push({ id: photo.id, url: photo.url, warnings: check.warnings });

    // 사본은 파일을 다시 저장하지 않고 같은 blob을 가리킨다. 위치 검증만
    // 각 법인의 사업장 좌표로 다시 계산한다(같은 주소라도 허용 반경이 다를 수 있다).
    const copyIds: string[] = [];
    for (const t of targets) {
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
          sharedFromSiteId: tbm.siteId,
          included: t.docRoom > 0,
        },
      });
      copyIds.push(copy.id);
      if (t.docRoom > 0) t.docRoom -= 1;
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
    { photos: created, sharedWith: [...sharedSiteNames], noTeam },
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
