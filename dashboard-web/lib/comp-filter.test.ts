import { describe, expect, test } from "vitest";
import { passesCompFloor, isUnknownUnderFloor } from "./comp-filter";

describe("passesCompFloor", () => {
  test("no floor (0) lets everything through", () => {
    expect(passesCompFloor("$120K-$140K", 0)).toBe(true);
    expect(passesCompFloor("", 0)).toBe(true);
  });

  test("range whose midpoint meets the floor passes", () => {
    // midpoint $175K >= $150K
    expect(passesCompFloor("$150K-$200K", 150000)).toBe(true);
  });

  test("range whose midpoint is below the floor is filtered out", () => {
    // midpoint $130K < $200K
    expect(passesCompFloor("$120K-$140K", 200000)).toBe(false);
  });

  test("uses midpoint, not min (Fix D): $191K-$249K passes a $200K floor", () => {
    // min $191K < $200K but midpoint $220K >= $200K
    expect(passesCompFloor("$191K-$249K", 200000)).toBe(true);
  });

  test("unknown/unparseable comp stays VISIBLE under a floor (option 2)", () => {
    expect(passesCompFloor("", 200000)).toBe(true);
    expect(passesCompFloor("Not listed", 200000)).toBe(true);
    expect(passesCompFloor("competitive", 200000)).toBe(true);
  });
});

describe("isUnknownUnderFloor", () => {
  test("true only when a floor is active AND comp does not parse", () => {
    expect(isUnknownUnderFloor("", 200000)).toBe(true);
    expect(isUnknownUnderFloor("competitive", 200000)).toBe(true);
  });

  test("false when comp parses (it passed on merit, not on sufferance)", () => {
    expect(isUnknownUnderFloor("$220K-$260K", 200000)).toBe(false);
  });

  test("false when no floor is active (nothing to mark)", () => {
    expect(isUnknownUnderFloor("", 0)).toBe(false);
    expect(isUnknownUnderFloor("competitive", 0)).toBe(false);
  });
});
