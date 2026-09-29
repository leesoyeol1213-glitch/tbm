"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

export default function SiteSwitcher({
  sites,
  currentId,
  extra,
}: {
  sites: { id: string; name: string; code?: string }[];
  currentId: string;
  /**
   * 사업장이 아닌 선택지. 지금은 계정 화면의 "본사·사업부"가 유일하다.
   *
   * 법인에 속하지 않는 자리(안전실장·본부장)를 사업장 탭마다 되풀이해 보여
   * 주는 대신 제 탭을 준다.
   */
  extra?: { value: string; label: string };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // 고를 것이 하나뿐이면 고르게 할 이유가 없다.
  if (sites.length + (extra ? 1 : 0) <= 1) return null;

  return (
    <select
      value={currentId}
      onChange={(e) => {
        const next = new URLSearchParams(searchParams.toString());
        next.set("site", e.target.value);
        router.push(`${pathname}?${next.toString()}`);
      }}
      className="field w-auto font-semibold"
      aria-label="사업장 선택"
    >
      {sites.map((s) => (
        <option key={s.id} value={s.id}>
          {s.code ? `${s.code} · ${s.name}` : s.name}
        </option>
      ))}
      {extra && <option value={extra.value}>{extra.label}</option>}
    </select>
  );
}
