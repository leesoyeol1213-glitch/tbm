"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

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

  async function upload(files: FileList) {
    setError(null);
    setDone(null);
    if (files.length > remaining) {
      setError(`${remaining}장까지만 더 올릴 수 있습니다.`);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setBusy(true);
    try {
      const body = new FormData();
      for (const file of Array.from(files)) body.append("photos", file);
      if (share) body.append("share", "1");

      const res = await fetch(`/api/tbm/${tbmId}/photos`, { method: "POST", body });
      const data: { error?: string; sharedWith?: string[] } = await res
        .json()
        .catch(() => ({}));

      if (!res.ok) {
        setError(data.error ?? "업로드에 실패했습니다.");
        return;
      }
      if (data.sharedWith && data.sharedWith.length > 0) {
        setDone(`${data.sharedWith.join(", ")}에도 함께 올렸습니다.`);
      } else if (share) {
        setDone(
          "공유할 곳이 없었습니다. 다른 법인의 오늘 TBM이 아직 없거나, 이미 승인됐거나, 사진이 다 찬 상태입니다.",
        );
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
