import { describe, expect, test } from "vitest";
import { getCompFloorUsd, formatCompFloorString } from "./comp-floor";

describe("getCompFloorUsd", () => {
  test("returns the canonical floor from user-context.yaml", () => {
    const floor = getCompFloorUsd();
    expect(typeof floor).toBe("number");
    expect(floor).toBeGreaterThan(0);
  });
});

describe("formatCompFloorString", () => {
  test("200000 → '$200K'", () => {
    expect(formatCompFloorString(200000)).toBe("$200K");
  });
  test("150000 → '$150K'", () => {
    expect(formatCompFloorString(150000)).toBe("$150K");
  });
  test("250000 → '$250K'", () => {
    expect(formatCompFloorString(250000)).toBe("$250K");
  });
  test("199500 → '$199.5K' (non-multiple-of-1000 keeps fractional K)", () => {
    expect(formatCompFloorString(199500)).toBe("$199.5K");
  });
});
