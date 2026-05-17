import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { slug } = await request.json();
    if (!slug || typeof slug !== "string") {
      return Response.json({ error: "Missing slug" }, { status: 400 });
    }

    const contextPath = join(process.cwd(), "..", "config", "user-context.yaml");
    if (!existsSync(contextPath)) {
      return Response.json({ error: "user-context.yaml not found" }, { status: 500 });
    }

    let content = readFileSync(contextPath, "utf-8");
    const normalizedSlug = slug.toLowerCase().replace(/[^a-z0-9]/g, "");

    // Check if excluded_companies section exists
    if (content.includes("excluded_companies:")) {
      // Check if already excluded
      if (content.includes(`  - ${normalizedSlug}`)) {
        return Response.json({ ok: true, already: true });
      }
      // Append to existing list
      content = content.replace(
        /excluded_companies:\s*\n/,
        `excluded_companies:\n  - ${normalizedSlug}\n`
      );
    } else {
      // Add new section at the end
      content = content.trimEnd() + `\n\nexcluded_companies:\n  - ${normalizedSlug}\n`;
    }

    writeFileSync(contextPath, content);
    return Response.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
