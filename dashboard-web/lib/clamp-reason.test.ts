import { describe, expect, test } from "vitest";
import { parseClampReason } from "./clamp-reason";

describe("parseClampReason", () => {
  test("location international", () => {
    expect(parseClampReason("location:onsite_international (-75)")).toEqual({
      factor: "location",
      detail: "onsite international",
    });
  });
  test("comp below floor", () => {
    expect(parseClampReason("comp:below_floor (-50)")).toEqual({
      factor: "comp",
      detail: "below floor",
    });
  });
  test("no colon → factor only", () => {
    expect(parseClampReason("disqualifier (-30)")).toEqual({ factor: "disqualifier", detail: "" });
  });
});
