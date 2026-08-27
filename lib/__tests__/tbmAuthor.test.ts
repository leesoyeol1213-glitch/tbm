import { describe, expect, it } from "vitest";
import { DOC_PHOTOS, submitAuthorId } from "@/lib/tbm";

const LEADER = "user-옛팀장";
const SUBMITTER = "user-임태규";

describe("submitAuthorId", () => {
  it("자동 생성 건은 처음 상신한 사람이 작성자가 된다", () => {
    // 자동 생성 때 넣어 둔 팀장은 잠정값이다. 실제로 쓴 사람으로 확정한다.
    const tbm = { autoCreated: true, submittedAt: null, authorId: LEADER };
    expect(submitAuthorId(tbm, SUBMITTER)).toBe(SUBMITTER);
  });

  it("자동 생성 건에 작성자가 비어 있어도 상신한 사람이 된다", () => {
    const tbm = { autoCreated: true, submittedAt: null, authorId: null };
    expect(submitAuthorId(tbm, SUBMITTER)).toBe(SUBMITTER);
  });

  it("반려 뒤 다시 올릴 때는 작성자를 바꾸지 않는다", () => {
    // 정정하는 사람이 작성자를 가로채면 누가 쓴 문서인지 흐려진다.
    const tbm = {
      autoCreated: true,
      submittedAt: new Date("2026-08-26T00:05:00Z"),
      authorId: "user-강호영",
    };
    expect(submitAuthorId(tbm, "user-본사")).toBe("user-강호영");
  });

  it("직접 만든 건은 만든 사람이 작성자로 남는다", () => {
    const tbm = { autoCreated: false, submittedAt: null, authorId: "user-박태완" };
    expect(submitAuthorId(tbm, SUBMITTER)).toBe("user-박태완");
  });

  it("직접 만든 건에 작성자가 없으면 상신한 사람이 된다", () => {
    const tbm = { autoCreated: false, submittedAt: null, authorId: null };
    expect(submitAuthorId(tbm, SUBMITTER)).toBe(SUBMITTER);
  });
});

describe("DOC_PHOTOS", () => {
  it("종이 양식의 사진 칸 수와 같다", () => {
    // PDF는 한 줄에 두 장을 그린다. 기본값이 이보다 크면 문서가 길어진다.
    expect(DOC_PHOTOS).toBe(2);
  });
});
