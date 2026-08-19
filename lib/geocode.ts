/**
 * 주소 → 좌표 변환.
 *
 * KAKAO_REST_API_KEY가 있으면 카카오 로컬 API를 쓴다. 한국 도로명·지번 주소와
 * 공장 이름 같은 장소명까지 잡아 주므로 훨씬 정확하다.
 * 키가 없으면 OpenStreetMap(Nominatim)으로 넘어간다. 키 없이 바로 쓸 수 있지만
 * 국내 주소 적중률이 떨어진다.
 *
 * 주의: 입력한 주소가 외부 서비스로 전송된다.
 */

export type GeocodeHit = {
  /** 표시용 주소 */
  label: string;
  /** 도로명 주소 (있으면) */
  road: string | null;
  lat: number;
  lng: number;
};

export type GeocodeResult = {
  hits: GeocodeHit[];
  provider: "kakao" | "osm";
  error: string | null;
};

const UA = "TBM-Safety-Log/1.0 (site geocoding for internal admin)";

type KakaoAddressDoc = {
  address_name: string;
  x: string;
  y: string;
  road_address?: { address_name: string } | null;
};

type KakaoKeywordDoc = {
  place_name: string;
  address_name: string;
  road_address_name?: string;
  x: string;
  y: string;
};

async function kakao(query: string, key: string): Promise<GeocodeHit[]> {
  const headers = { Authorization: `KakaoAK ${key}` };

  // 1) 주소 검색
  const addrRes = await fetch(
    `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(query)}&size=5`,
    { headers, cache: "no-store" },
  );
  if (addrRes.ok) {
    const json = (await addrRes.json()) as { documents?: KakaoAddressDoc[] };
    const hits = (json.documents ?? []).map((d) => ({
      label: d.road_address?.address_name || d.address_name,
      road: d.road_address?.address_name ?? null,
      lat: Number(d.y),
      lng: Number(d.x),
    }));
    if (hits.length > 0) return hits;
  }

  // 2) 주소로 못 찾으면 장소명(공장 이름 등)으로 다시 시도
  const kwRes = await fetch(
    `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(query)}&size=5`,
    { headers, cache: "no-store" },
  );
  if (!kwRes.ok) {
    if (kwRes.status === 401) throw new Error("카카오 API 키가 올바르지 않습니다.");
    throw new Error(`카카오 API 오류 (${kwRes.status})`);
  }
  const json = (await kwRes.json()) as { documents?: KakaoKeywordDoc[] };
  return (json.documents ?? []).map((d) => ({
    label: `${d.place_name} — ${d.road_address_name || d.address_name}`,
    road: d.road_address_name || null,
    lat: Number(d.y),
    lng: Number(d.x),
  }));
}

type OsmDoc = { display_name: string; lat: string; lon: string };

async function osm(query: string): Promise<GeocodeHit[]> {
  const url =
    `https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=kr` +
    `&accept-language=ko&q=${encodeURIComponent(query)}`;

  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "ko" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`주소 검색 서비스 오류 (${res.status})`);

  const json = (await res.json()) as OsmDoc[];
  return json.map((d) => ({
    label: d.display_name,
    road: null,
    lat: Number(d.lat),
    lng: Number(d.lon),
  }));
}

export async function geocode(query: string): Promise<GeocodeResult> {
  const q = query.trim();
  const key = process.env.KAKAO_REST_API_KEY?.trim();
  const provider = key ? "kakao" : "osm";

  if (q.length < 2) {
    return { hits: [], provider, error: "주소를 2글자 이상 입력해 주세요." };
  }

  try {
    const hits = key ? await kakao(q, key) : await osm(q);
    const valid = hits.filter(
      (h) => Number.isFinite(h.lat) && Number.isFinite(h.lng),
    );

    if (valid.length === 0) {
      return {
        hits: [],
        provider,
        error: key
          ? "일치하는 주소를 찾지 못했습니다. 도로명 주소로 다시 시도해 보세요."
          : "찾지 못했습니다. 지금은 카카오 API 키가 없어 OpenStreetMap을 쓰는데, " +
            "국내 도로명 주소는 대부분 못 찾습니다. KAKAO_REST_API_KEY를 설정하거나, " +
            "지도 앱에서 좌표를 확인해 아래에 직접 넣어 주세요.",
      };
    }
    return { hits: valid, provider, error: null };
  } catch (e) {
    return {
      hits: [],
      provider,
      error: e instanceof Error ? e.message : "주소를 찾는 중 오류가 발생했습니다.",
    };
  }
}
