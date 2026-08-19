"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export default function PhotoUploader({
  tbmId,
  remaining,
}: {
  tbmId: string;
  remaining: number;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(files: FileList) {
    setError(null);
    if (files.length > remaining) {
      setError(`${remaining}장까지만 더 올릴 수 있습니다.`);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setBusy(true);
    try {
      const body = new FormData();
      for (const file of Array.from(files)) body.append("photos", file);

      const res = await fetch(`/api/tbm/${tbmId}/photos`, { method: "POST", body });
      const data: { error?: string } = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error ?? "업로드에 실패했습니다.");
        return;
      }
      router.refresh();
    } catch {
      setError("네트워크 오류로 업로드하지 못했습니다.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
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
    </div>
  );
}
