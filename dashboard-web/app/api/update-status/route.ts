import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { url, status, company, title } = await request.json();
    if (!url || !status) {
      return Response.json({ error: "Missing url or status" }, { status: 400 });
    }

    const appPath = join(process.cwd(), "..", "data", "applications.md");

    // Create applications.md if it doesn't exist
    if (!existsSync(appPath)) {
      writeFileSync(
        appPath,
        "# Applications Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|------|---------|------|-------|--------|-----|--------|-------|\n"
      );
    }

    const content = readFileSync(appPath, "utf-8");
    const lines = content.split("\n");

    // Try to find existing row by company + role
    let updated = false;
    const companyLower = (company || "").toLowerCase().trim();
    const titleLower = (title || "").toLowerCase().trim();

    for (let i = 2; i < lines.length; i++) {
      if (!lines[i].startsWith("|")) continue;
      const cols = lines[i].split("|").map((c) => c.trim());
      if (cols.length < 8) continue;

      const rowCompany = (cols[3] || "").toLowerCase().trim();
      const rowRole = (cols[4] || "").toLowerCase().trim();

      if (
        rowCompany &&
        companyLower &&
        (rowCompany === companyLower ||
          rowCompany.includes(companyLower.slice(0, 10)) ||
          companyLower.includes(rowRole.slice(0, 10))) &&
        (rowRole.includes(titleLower.slice(0, 15)) || titleLower.includes(rowRole.slice(0, 15)))
      ) {
        cols[6] = ` ${status} `;
        lines[i] = "| " + cols.filter(Boolean).join(" | ") + " |";
        updated = true;
        break;
      }
    }

    if (updated) {
      writeFileSync(appPath, lines.join("\n"));
    } else if (status !== "Discovered") {
      // Upsert: add new row for roles not already tracked
      // Only persist non-Discovered statuses (no point tracking "Discovered" in the tracker)
      const dataRows = lines.filter((l) => l.startsWith("| 0") || l.match(/^\| \d/));
      const nextNum = String(dataRows.length + 1).padStart(3, "0");
      const today = new Date().toISOString().slice(0, 10);
      const newRow = `| ${nextNum} | ${today} | ${company || "Unknown"} | ${title || "Unknown"} | —/5 | ${status} | — | — | |`;

      // Find the last data row and append after it
      let insertIdx = lines.length;
      for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].startsWith("|") && lines[i].match(/\d/)) {
          insertIdx = i + 1;
          break;
        }
      }
      lines.splice(insertIdx, 0, newRow);
      writeFileSync(appPath, lines.join("\n"));
      updated = true;
    }

    return Response.json({ ok: true, updated });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "unknown" },
      { status: 500 }
    );
  }
}
