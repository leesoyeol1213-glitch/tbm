import { describe, expect, it } from "vitest";
import {
  BLOB_LIMIT_BYTES,
  DB_LIMIT_BYTES,
  capacityLabel,
  daysLeft,
  formatBytes,
  percent,
} from "@/lib/usage";

const MB = 1024 * 1024;
const GB = 1024 * MB;

describe("formatBytes", () => {
  it("작은 값은 KB로 보여 준다", () => {
    // MB로만 보여 주면 초기에는 전부 0.0MB라 늘어나는 것이 안 보인다.
    expect(formatBytes(0)).toBe("0KB");
    expect(formatBytes(180 * 1024)).toBe("180KB");
  });

  it("MB·GB로 올라간다", () => {
    expect(formatBytes(10.1 * MB)).toBe("10.1MB");
    expect(formatBytes(1.5 * GB)).toBe("1.50GB");
  });
});

describe("percent", () => {
  it("소수 한 자리까지 센다", () => {
    // 0%로 뭉개면 쓰고 있는지 아닌지 구분이 안 된다.
    expect(percent(3.7 * MB, GB)).toBeCloseTo(0.4, 1);
    expect(percent(256 * MB, 512 * MB)).toBe(50);
  });

  it("한도를 넘어도 100을 넘지 않는다", () => {
    expect(percent(2 * GB, GB)).toBe(100);
  });
});

describe("daysLeft", () => {
  it("최근 증가량으로 남은 날을 센다", () => {
    // 30일에 100MB씩 늘면 하루 약 3.33MB. 900MB가 남았으면 270일.
    expect(daysLeft(124 * MB, GB, 100 * MB)).toBe(270);
  });

  it("늘지 않으면 셀 수 없다", () => {
    expect(daysLeft(10 * MB, GB, 0)).toBeNull();
  });

  it("이미 한도를 넘었으면 0", () => {
    expect(daysLeft(2 * GB, GB, 100 * MB)).toBe(0);
  });
});

describe("무료 한도", () => {
  it("문서에 적은 값과 같다", () => {
    // DEPLOY.md 9절이 이 숫자를 기준으로 설명한다.
    expect(DB_LIMIT_BYTES).toBe(512 * MB);
    expect(BLOB_LIMIT_BYTES).toBe(GB);
  });
});

describe("capacityLabel", () => {
  it("가까우면 날로 센다", () => {
    expect(capacityLabel(45)).toBe("이대로면 약 45일치");
  });

  it("몇 달 뒤면 달로 센다", () => {
    expect(capacityLabel(270)).toBe("이대로면 약 9개월치");
  });

  it("몇 년 뒤면 자릿수를 세지 않는다", () => {
    // "33,913일치"는 맞는 숫자지만 아무 뜻도 전하지 못한다.
    expect(capacityLabel(33913)).toBe("몇 년 치 여유");
  });

  it("늘지 않으면 아무 말도 하지 않는다", () => {
    expect(capacityLabel(null)).toBeNull();
  });
});
