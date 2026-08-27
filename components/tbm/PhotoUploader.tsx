"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * 올리기 전에 줄일 긴 변 화소. 서버가 저장하는 크기와 같게 맞춘다.
 * 어차피 서버에서 1280px로 줄이므로 미리 줄여 보내도 결과물은 같다.
 */
const MAX_PX = 1280;
const QUALITY = 0.8;

/**
 * 원본에서 떼어 보낼 앞부분 크기.
 *
 * EXIF(APP1)는 JPEG 규격상 한 조각이 64KB를 넘을 수 없고 파일 맨 앞에 온다.
 * 128KB면 촬영 시각·좌표가 확실히 들어온다.
 */
const EXIF_HEAD_BYTES = 128 * 1024;

/**
 * 한 번에 보낼 수 있는 바이트. Vercel이 4.5MB에서 자르므로 그보다 낮게 잡는다.
 * 여기 걸리면 사유 없이 실패하던 것을 미리 붙잡아 알려 준다.
 */
const SAFE_BYTES = 4 * 1024 * 1024;

type Prepared = { body: Blob; name: string; head: Blob | null };

/**
 * 브라우저에서 사진을 줄인다.
 *
 * 폰 원본은 한 장에 4~6MB인데 Vercel은 4.5MB 넘는 요청을 함수에 닿기도 전에
 * 잘라 버린다. 그래서 보내기 전에 줄여야 한다. canvas로 다시 그리면 EXIF가
 * 날아가므로 원본 앞부분을 따로 떼어 함께 보낸다 — 촬영 시각과 위치는 그것으로
 * 검증한다.
 *
 * 줄이지 못하면 원본을 그대로 돌려준다. HEIC처럼 브라우저가 못 읽는 형식이
 * 있기 때문이다.
 */
async function prepare(file: File): Promise<Prepared> {
  const asIs: Prepared = { body: file, name: file.name, head: null };
  if (typeof createImageBitmap !== "function") return asIs;

  let bitmap: ImageBitmap;
  try {
    // 방향은 손대지 않는다. EXIF를 그대로 붙여 보내고 서버가 세운다.
    bitmap = await createImageBitmap(file, { imageOrientation: "none" });
  } catch {
    return asIs;
  }

  try {
    const scale = Math.min(1, MAX_PX / Math.max(bitmap.width, bitmap.height));
    // 이미 작고 가벼우면 그대로 보낸다. 다시 그리면 화질만 깎인다.
    if (scale === 1 && file.size <= SAFE_BYTES / 2) return asIs;

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return asIs;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", QUALITY),
    );
    if (!blob || blob.size >= file.size) return asIs;

    return {
      body: blob,
      name: file.name.replace(/\.[^.]+$/, "") + ".jpg",
      head: file.slice(0, EXIF_HEAD_BYTES),
    };
  } finally {
    bitmap.close();
  }
}

export default function PhotoUploader({
  tbmId,
  remaining,
  shareSiteNames,
}: {
  tbmId: string;
  remaining: number;
  /** 같은 주소를 쓰는 다른 법인 이름. 비어 있으면 공유 선택지를 두지 않는다. */
  shareSiteNames: string[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // 한자리에서 합동으로 TBM을 하는 것이 이 현장의 기본이라 켜 둔 채로 시작한다.
  const [share, setShare] = useState(shareSiteNames.length > 0);

  /** 한 장씩 따로 보낸다. 본문 크기가 확실히 묶이고, 뒤엣것이 실패해도 앞엣것은 남는다. */
  async function send(file: File): Promise<{ sharedWith: string[] }> {
    const ready = await prepare(file);
    if (ready.body.size > SAFE_BYTES) {
      throw new Error(
        `${file.name} 사진이 너무 큽니다. 카메라에서 사진 크기를 한 단계 낮춰 다시 찍어 주세요.`,
      );
    }

    const body = new FormData();
    body.append("photos", ready.body, ready.name);
    // 사진 한 장에 조각 하나. 줄이지 못했더라도 빈 자리를 채워 순서를 맞춘다.
    body.append("exif", ready.head ?? new Blob([]), "exif.bin");
    if (share) body.append("share", "1");

    const res = await fetch(`/api/tbm/${tbmId}/photos`, { method: "POST", body });
    if (!res.ok) {
      // 413은 우리 코드가 아니라 서버 앞단이 자른 것이라 JSON이 오지 않는다.
      if (res.status === 413) {
        throw new Error(
          "사진 용량이 서버 한도를 넘었습니다. 카메라에서 사진 크기를 낮춰 다시 찍어 주세요.",
        );
      }
      const data: { error?: string } = await res.json().catch(() => ({}));
      throw new Error(data.error ?? `업로드에 실패했습니다. (오류 ${res.status})`);
    }
    const data: { sharedWith?: string[] } = await res.json().catch(() => ({}));
    return { sharedWith: data.sharedWith ?? [] };
  }

  async function upload(files: FileList) {
    setError(null);
    setDone(null);
    if (files.length > remaining) {
      setError(`${remaining}장까지만 더 올릴 수 있습니다.`);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    setBusy(true);
    const list = Array.from(files);
    const shared = new Set<string>();
    let uploaded = 0;

    try {
      for (const file of list) {
        const { sharedWith } = await send(file);
        uploaded += 1;
        for (const name of sharedWith) shared.add(name);
      }

      if (shared.size > 0) {
        setDone(`${[...shared].join(", ")}에도 함께 올렸습니다.`);
      } else if (share) {
        setDone(
          "공유할 곳이 없었습니다. 다른 법인의 오늘 TBM이 아직 없거나(첫 출석 전) 이미 승인된 상태입니다.",
        );
      }
    } catch (e) {
      const reason =
        e instanceof Error && e.message
          ? e.message
          : "네트워크 오류로 업로드하지 못했습니다.";
      // 앞 장이 이미 올라갔으면 그 사실을 함께 알려야 중복해서 다시 올리지 않는다.
      setError(uploaded > 0 ? `${uploaded}장은 올렸습니다. ${reason}` : reason);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    }
  }

  if (remaining <= 0) {
    return (
      <p className="text-xs text-slate-500">
        사진을 모두 올렸습니다. 바꾸려면 올린 사진을 지우고 다시 올려 주세요.
      </p>
    );
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        // capture 속성을 주지 않아야 갤러리 선택도 가능하다.
        onChange={(e) => e.target.files?.length && upload(e.target.files)}
        className="hidden"
        id={`photo-input-${tbmId}`}
      />

      {shareSiteNames.length > 0 && (
        <label className="mb-2 flex cursor-pointer items-start gap-2 rounded-lg bg-slate-50 px-3 py-2.5 ring-1 ring-slate-200">
          <input
            type="checkbox"
            checked={share}
            onChange={(e) => setShare(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 rounded border-slate-300 accent-slate-900"
          />
          <span className="min-w-0 text-sm">
            <span className="font-medium text-slate-800">
              같은 공장 법인에도 함께 올리기
            </span>
            <span className="block text-xs text-slate-500">
              {shareSiteNames.join(", ")} · 오늘 날짜 TBM에 같은 사진이 들어갑니다.
              합동으로 TBM을 한 경우에만 사용하세요.
            </span>
          </span>
        </label>
      )}

      <label
        htmlFor={`photo-input-${tbmId}`}
        className={`btn-primary w-full cursor-pointer ${busy ? "pointer-events-none opacity-50" : ""}`}
      >
        {busy ? "올리는 중…" : "현장 사진 촬영 / 선택"}
      </label>

      <p className="mt-2 text-xs text-slate-500">
        카메라로 바로 찍어 올리면 촬영 시각·위치가 함께 기록됩니다. 갤러리에서 고른
        사진도 원본이면 동일하게 검증됩니다. {remaining}장 더 올릴 수 있습니다.
      </p>

      {error && (
        <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800 ring-1 ring-rose-200">
          {error}
        </p>
      )}
      {done && (
        <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 ring-1 ring-emerald-200">
          {done}
        </p>
      )}
    </div>
  );
}
