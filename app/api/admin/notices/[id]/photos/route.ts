import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isAllowedImage, storeImage } from "@/lib/storage";
import type { Sharp } from "@/lib/pdf";

/**
 * 공지사항 사진을 받는다.
 *
 * TBM 사진 경로(app/api/tbm/[id]/photos/route.ts)와 줄이는 방식은 같지만
 * 검증이 없다 — 촬영 시각·좌표를 읽지 않고, 현장에서 찍었는지도 따지지 않는다.
 * 기숙사 정리정돈 사진에 "사업장에서 500m 밖" 경고는 뜻이 없다.
 *
 * 받는 쪽이 본사뿐이라 한 번에 여러 장을 허용한다.
 */

/** Vercel이 4.5MB에서 자르므로 그보다 낮게 막는다. */
const MAX_BYTES = 4 * 1024 * 1024;

/** 저장 크기. TBM 사진과 같게 맞춘다 — 장당 200KB 선으로 떨어진다. */
const STORE_MAX_PX = 1280;
const STORE_QUALITY = 80;

/** 공지 한 건에 붙일 수 있는 사진 수. 썸네일 3열이라 여섯 장이면 두 줄이다. */
const MAX_PHOTOS = 6;

/**
 * 저장용으로 줄인다. 줄이지 못하면 원본을 그대로 저장한다 — 사진을 못 올리는
 * 것보다는 낫다.
 */
async function shrink(
  sharp: Sharp | null,
  buf: Buffer,
  contentType: string,
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
      .toBuffer();
    if (out.length >= buf.length) return { body: buf, contentType };
    return { body: Buffer.from(out), contentType: "image/jpeg" };
  } catch {
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
  // 공지는 본사만 올린다. 화면 가드를 믿지 않고 여기서 다시 본다.
  if (session.user.role !== "HQ_ADMIN") {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  const { id: noticeId } = await params;

  const notice = await prisma.notice.findUnique({
    where: { id: noticeId },
    select: { id: true, _count: { select: { photos: true } } },
  });
  if (!notice) {
    return NextResponse.json({ error: "공지를 찾을 수 없습니다." }, { status: 404 });
  }

  let room = MAX_PHOTOS - notice._count.photos;
  if (room <= 0) {
    return NextResponse.json(
      { error: `사진은 공지당 ${MAX_PHOTOS}장까지 올릴 수 있습니다.` },
      { status: 400 },
    );
  }

  const form = await req.formData();
  const files = form.getAll("photos").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "사진이 없습니다." }, { status: 400 });
  }

  let sharp: Sharp | null = null;
  try {
    sharp = (await import("sharp")).default;
  } catch {
    // sharp가 없으면 원본을 그대로 저장한다. 용량만 커지고 기능은 돈다.
  }

  const saved: { id: string; url: string }[] = [];
  const failed: string[] = [];

  for (const file of files) {
    if (room <= 0) {
      failed.push(`${file.name}: 자리가 없습니다`);
      continue;
    }
    if (!isAllowedImage(file.type)) {
      failed.push(`${file.name}: 지원하지 않는 형식입니다`);
      continue;
    }
    if (file.size > MAX_BYTES) {
      failed.push(`${file.name}: 너무 큽니다`);
      continue;
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const small = await shrink(sharp, buf, file.type);
    const stored = await storeImage(`notice/${noticeId}`, small.body, small.contentType);

    const row = await prisma.noticePhoto.create({
      data: {
        noticeId,
        url: stored.url,
        pathname: stored.pathname,
        // 올린 순서대로 늘어놓는다.
        sort: MAX_PHOTOS - room,
      },
      select: { id: true, url: true },
    });
    saved.push(row);
    room -= 1;
  }

  if (saved.length === 0) {
    return NextResponse.json(
      { error: failed.join(" / ") || "사진을 저장하지 못했습니다." },
      { status: 400 },
    );
  }

  return NextResponse.json({ saved, failed });
}
