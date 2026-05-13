"use client";

/**
 * Storybook-style interactive demo for the DropdownPill primitive.
 * Embedded into /design-system so the pill can be visually verified
 * (open/close, toggle, chevron rotation, multi vs close-on-select).
 */

import { useState } from "react";
import { DropdownPill, type DropdownPillOption } from "@/components/ui";

const LOCATION_OPTIONS: DropdownPillOption[] = [
  { id: "boston", label: "Boston area", count: 19 },
  { id: "seattle", label: "Seattle area", count: 3 },
  { id: "sf", label: "SF Bay Area", count: 14 },
  { id: "austin", label: "Austin", count: 5 },
  { id: "chicago", label: "Chicago", count: 1 },
];

const TIER_OPTIONS: DropdownPillOption[] = [
  { id: "tier-1", label: "Tier 1 — built for me", count: 8 },
  { id: "tier-2", label: "Tier 2 — strong fit", count: 23 },
  { id: "tier-3", label: "Tier 3 — adjacent" },
];

export function DropdownPillDemo() {
  const [locActive, setLocActive] = useState<string[]>(["seattle"]);
  const [tierActive, setTierActive] = useState<string[]>([]);

  const locOptions = LOCATION_OPTIONS.map((o) => ({ ...o, active: locActive.includes(o.id) }));
  const tierOptions = TIER_OPTIONS.map((o) => ({ ...o, active: tierActive.includes(o.id) }));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <DropdownPill
        label="More locations"
        count={locActive.length}
        options={locOptions}
        onChange={setLocActive}
        align="left"
      />
      <DropdownPill
        label="Tier"
        count={tierActive.length}
        options={tierOptions}
        onChange={setTierActive}
        align="left"
        closeOnSelect
      />
      <DropdownPill
        label="Right-aligned"
        options={locOptions}
        onChange={setLocActive}
        align="right"
      />
    </div>
  );
}
