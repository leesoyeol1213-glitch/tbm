"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

export default function SiteSwitcher({
  sites,
  currentId,
}: {
  sites: { id: string; name: string; code?: string }[];
  currentId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (sites.length <= 1) return null;

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
    </select>
  );
}
