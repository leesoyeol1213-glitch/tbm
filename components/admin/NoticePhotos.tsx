"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SAFE_BYTES, prepareImage } from "@/lib/imageShrink";
import { deleteNoticePhotoAction } from "@/actions/notice";
import DeleteButton from "@/components/admin/DeleteButton";

/**
 * 공지에 사진을 붙이고 뗀다.
 *
 * 줄이는 일은 lib/imageShrink.ts 가 한다 — TBM 현장 사진과 같은 함수다.
 * 다만 EXIF 조각은 보내지 않는다. 기숙사 사진에 촬영 시각·좌표 판정은 뜻이
 * 없고, 안 보내면 요청 바이트도 그만큼 줄어든다.
 */
export default function NoticePhotos({
  noticeId,
  photos,
  max,
}: {
  noticeId: string;
  photos: { id: string; url: string }[];
  max: number;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const room = max - photos.length;

  async function send(files: File[]) {
    const body = new FormData();
    for (const file of files) {
      // EXIF는 떼어 보내지 않는다.
      const ready = await prepareImage(file, { withExifHead: false });
      if (ready.body.size > SAFE_BYTES) {
        throw new Error(`${file.name} 사진이 너무 큽니다.`);
      }
      body.append("photos", ready.body, ready.name);
    }

    const res = await fetch(`/api/admin/notices/${noticeId}/photos`, {
      method: "POST",
      body,
    });
    if (!res.ok) {
      if (res.status === 413) throw new Error("사진 용량이 서버 한도를 넘었습니다.");
      const data: unknown = await res.json().catch(() => null);
      const msg = (data as { error?: string } | null)?.error;
      throw new Error(msg ?? "사진을 올리지 못했습니다.");
    }
    const data: unknown = await res.json();
    const failed = (data as { failed?: string[] }).failed ?? [];
    if (failed.length > 0) setError(failed.join(" / "));
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])].slice(0, Math.max(0, room));
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await send(files);
      router.refresh();
    } catch (err) {
      setError((err as Error)?.message ?? "사진을 올리지 못했습니다.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="mt-3">
      <p className="label">
        사진 <span className="font-normal text-slate-400">{photos.length} / {max}</span>
      </p>

      {photos.length > 0 && (
        <ul className="mt-1.5 grid grid-cols-3 gap-2 sm:grid-cols-6">
          {photos.map((p) => (
            <li key={p.id}>
              <a href={p.url} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.url}
                  alt=""
                  loading="lazy"
                  className="aspect-square w-full rounded-md object-cover ring-1 ring-slate-200"
                />
              </a>
              <DeleteButton
                action={deleteNoticePhotoAction}
                fields={{ photoId: p.id }}
                question="이 사진을 지웁니다. 파일까지 지워집니다."
              />
            </li>
          ))}
        </ul>
      )}

      {room > 0 ? (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={onPick}
            disabled={busy}
            className="mt-2 block w-full text-sm text-slate-600"
          />
          {busy && <p className="mt-1.5 text-xs text-slate-500">올리는 중…</p>}
        </>
      ) : (
        <p className="mt-2 text-xs text-slate-500">
          자리가 찼습니다. 지우고 다시 올려 주세요.
        </p>
      )}

      {error && (
        <p className="mt-1.5 text-xs font-medium text-rose-700">{error}</p>
      )}
    </div>
  );
}
