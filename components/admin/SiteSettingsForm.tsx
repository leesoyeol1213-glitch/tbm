"use client";

import { useActionState } from "react";
import type { Site } from "@prisma/client";
import { updateSiteAction, type ActionResult } from "@/actions/admin";
import { minuteLabel } from "@/lib/kst";
import AddressFields from "@/components/admin/AddressFields";

const IDLE: ActionResult = { error: null };

export default function SiteSettingsForm({ site }: { site: Site }) {
  const [state, action, pending] = useActionState(
    async (_prev: ActionResult, formData: FormData) => updateSiteAction(formData),
    IDLE,
  );

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="siteId" value={site.id} />

      <div>
        <label className="label" htmlFor="name">
          사업장명
        </label>
        <input id="name" name="name" defaultValue={site.name} className="field" />
      </div>

      <fieldset>
        <legend className="label">위치 검증</legend>
        <p className="mb-3 text-xs text-slate-500">
          사업장 좌표를 넣으면 사진의 GPS와 대조해 현장 밖에서 찍은 사진을 잡아냅니다.
        </p>
        <AddressFields
          defaultAddress={site.address ?? ""}
          defaultLat={site.lat === null ? "" : String(site.lat)}
          defaultLng={site.lng === null ? "" : String(site.lng)}
          showGeofence
          defaultGeofence={site.geofenceM}
        />
      </fieldset>

      <fieldset>
        <legend className="label">시간 설정</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <TimeField
            name="dueMinute"
            label="TBM 상신 마감"
            value={site.dueMinute}
            hint="이 시각 이후 상신은 '지연 상신'으로 표시됩니다."
          />
          <TimeField
            name="lateAfterMinute"
            label="지각 기준"
            value={site.lateAfterMinute}
            hint="이 시각 이후 QR 체크인은 지각으로 기록됩니다."
          />
          <TimeField
            name="checkinFrom"
            label="체크인 시작"
            value={site.checkinFrom}
            hint="이 시각 전에는 QR을 찍어도 받지 않습니다."
          />
          <TimeField
            name="checkinUntil"
            label="체크인 마감"
            value={site.checkinUntil}
            hint="이 시각 이후에는 QR 체크인이 닫힙니다."
          />
        </div>
      </fieldset>

      {state.error && (
        <p className="rounded-lg bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-800 ring-1 ring-rose-200">
          {state.error}
        </p>
      )}
      {state.ok && !state.error && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2.5 text-sm font-medium text-emerald-800 ring-1 ring-emerald-200">
          저장되었습니다.
        </p>
      )}

      <button type="submit" disabled={pending} className="btn-primary">
        {pending ? "저장 중…" : "설정 저장"}
      </button>
    </form>
  );
}

function TimeField({
  name,
  label,
  value,
  hint,
}: {
  name: string;
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <div>
      <label className="label" htmlFor={name}>
        {label}
      </label>
      <input
        id={name}
        name={name}
        type="time"
        defaultValue={minuteLabel(value)}
        className="field"
      />
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </div>
  );
}
