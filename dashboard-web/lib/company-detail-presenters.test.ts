import { describe, it, expect } from "vitest";

import {
  velocityBadge,
  archetypeLabel,
  yesNoLabel,
  fundingSubtitle,
  hasAnyEnrichment,
} from "./company-detail-presenters";

describe("velocityBadge", () => {
  it("maps each velocity bucket to a color + label", () => {
    expect(velocityBadge("on_fire")).toEqual({ color: "red", label: "ON FIRE" });
    expect(velocityBadge("hot")).toEqual({ color: "amber", label: "HOT" });
    expect(velocityBadge("warming")).toEqual({ color: "blue", label: "WARMING" });
    expect(velocityBadge("cold")).toBeNull();
  });
});

describe("archetypeLabel", () => {
  it("returns short display labels for known archetypes", () => {
    expect(archetypeLabel("gtm-engineering")).toBe("GTM Eng");
    expect(archetypeLabel("ai-operations")).toBe("AI Ops");
    expect(archetypeLabel("fde")).toBe("FDE");
    expect(archetypeLabel("web3-bd")).toBe("Web3 BD");
    expect(archetypeLabel("web3-bizops")).toBe("Web3 BizOps");
  });

  it("falls back to the raw id when unknown", () => {
    expect(archetypeLabel("something-new")).toBe("something-new");
  });
});

describe("yesNoLabel", () => {
  it("returns 'Yes' for true and 'No' for false", () => {
    expect(yesNoLabel(true)).toBe("Yes");
    expect(yesNoLabel(false)).toBe("No");
  });
});

describe("fundingSubtitle", () => {
  it("returns amount + date when both present", () => {
    expect(fundingSubtitle("$50M", "2026-05-12")).toBe("$50M raised · seen 2026-05-12");
  });

  it("returns just the amount when no date", () => {
    expect(fundingSubtitle("$50M", null)).toBe("$50M raised");
  });

  it("returns null when no funding info at all", () => {
    expect(fundingSubtitle(null, null)).toBeNull();
  });
});

describe("hasAnyEnrichment", () => {
  it("returns false when every summary field is empty", () => {
    expect(
      hasAnyEnrichment({
        green_flags: [],
        red_flags: [],
        team_context: [],
        company_stage: null,
        build_component: [],
        ai_signal: [],
      })
    ).toBe(false);
  });

  it("returns true when any field has content", () => {
    expect(
      hasAnyEnrichment({
        green_flags: [{ flag: "x", count: 1 }],
        red_flags: [],
        team_context: [],
        company_stage: null,
        build_component: [],
        ai_signal: [],
      })
    ).toBe(true);
  });
});
