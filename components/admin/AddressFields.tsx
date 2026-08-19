"use client";

import { useState } from "react";
import type { GeocodeHit, GeocodeResult } from "@/lib/geocode";

/**
 * 주소 입력칸 + "좌표 찾기" 버튼 + 위도/경도 입력칸.
 * 주소를 넣고 버튼을 누르면 좌표가 자동으로 채워진다. 직접 입력도 된다.
 */
export default function AddressFields({
  defaultAddress = "",
  defaultLat = "",
  defaultLng = "",
  showGeofence = false,
  defaultGeofence = 500,
}: {
  defaultAddress?: string;
  defaultLat?: string;
  defaultLng?: string;
  showGeofence?: boolean;
  defaultGeofence?: number;
}) {
  const [address, setAddress] = useState(defaultAddress);
  const [lat, setLat] = useState(defaultLat);
  const [lng, setLng] = useState(defaultLng);

  const [hits, setHits] = useState<GeocodeHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  async function search() {
    if (!address.trim()) {
      setMessage("주소를 먼저 입력해 주세요.");
      return;
    }
    setBusy(true);
    setMessage(null);
    setHits(null);
    setPicked(null);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(address)}`);
      const data: GeocodeResult & { error?: string } = await res.json();

      if (!res.ok) {
        setMessage(data.error ?? "주소를 찾지 못했습니다.");
        return;
      }
      if (data.error || data.hits.length === 0) {
        setMessage(data.error ?? "일치하는 주소가 없습니다.");
        return;
      }

      if (data.hits.length === 1) {
        apply(data.hits[0]);
      } else {
        setHits(data.hits);
      }
    } catch {
      setMessage("주소 검색에 실패했습니다. 네트워크를 확인해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  function apply(hit: GeocodeHit) {
    setLat(hit.lat.toFixed(6));
    setLng(hit.lng.toFixed(6));
    if (hit.road) setAddress(hit.road);
    setPicked(hit.label);
    setHits(null);
    setMessage(null);
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="label" htmlFor="address">
          주소
        </label>
        <div className="flex gap-2">
          <input
            id="address"
            name="address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="도로명 주소 또는 공장 이름"
            className="field flex-1"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                // 주소칸에서 엔터를 쳐도 폼이 제출되지 않도록 막고 검색만 한다.
                e.preventDefault();
                void search();
              }
            }}
          />
          <button
            type="button"
            onClick={search}
            disabled={busy}
            className="btn-secondary shrink-0"
          >
            {busy ? "찾는 중…" : "좌표 찾기"}
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          주소를 넣고 버튼을 누르면 위도·경도가 자동으로 채워집니다. 지도 앱에서 현장을
          길게 눌러 나온 좌표를 아래에 직접 넣어도 됩니다.
        </p>
      </div>

      {hits && hits.length > 0 && (
        <div className="overflow-hidden rounded-lg ring-1 ring-slate-200">
          <p className="bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600">
            어느 곳인가요? ({hits.length}건)
          </p>
          <ul className="divide-y divide-slate-100">
            {hits.map((h, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => apply(h)}
                  className="w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50"
                >
                  {h.label}
                  <span className="block text-xs text-slate-400">
                    {h.lat.toFixed(6)}, {h.lng.toFixed(6)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {message && (
        <p className="rounded-lg bg-amber-50 px-3 py-2.5 text-sm font-medium text-amber-800 ring-1 ring-amber-200">
          {message}
        </p>
      )}
      {picked && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2.5 text-sm font-medium text-emerald-800 ring-1 ring-emerald-200">
          좌표를 찾았습니다: {picked}
        </p>
      )}

      <div>
        <span className="label">좌표</span>
        <div className={`grid gap-3 ${showGeofence ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
          <input
            name="lat"
            value={lat}
            onChange={(e) => setLat(e.target.value)}
            placeholder="위도 (예: 37.199600)"
            inputMode="decimal"
            className="field"
          />
          <input
            name="lng"
            value={lng}
            onChange={(e) => setLng(e.target.value)}
            placeholder="경도 (예: 126.831400)"
            inputMode="decimal"
            className="field"
          />
          {showGeofence && (
            <input
              name="geofenceM"
              defaultValue={defaultGeofence}
              placeholder="허용 반경(m)"
              inputMode="numeric"
              className="field"
            />
          )}
        </div>
        <p className="mt-1 text-xs text-slate-500">
          좌표가 비어 있으면 사진 위치 검증이 동작하지 않습니다. 직접 고쳐 넣어도 됩니다.
        </p>
      </div>
    </div>
  );
}
