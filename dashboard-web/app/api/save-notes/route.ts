import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { slug, notes } = await request.json();
    if (!slug || typeof notes !== "string") {
      return Response.json({ error: "Missing slug or notes" }, { status: 400 });
    }

    const dir = join(process.cwd(), "..", "interview-prep");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const prepPath = join(dir, `${slug}.md`);
    if (!existsSync(prepPath)) {
      return Response.json({ error: "Prep doc not found" }, { status: 404 });
    }

    let content = readFileSync(prepPath, "utf-8");

    // Check if Meeting Notes section already exists
    const notesHeader = "## Meeting Notes";
    if (content.includes(notesHeader)) {
      // Replace existing meeting notes section
      // Find the section start and the next ## heading (or end of file)
      const start = content.indexOf(notesHeader);
      const afterHeader = start + notesHeader.length;
      const nextSection = content.indexOf("\n## ", afterHeader);
      const end = nextSection !== -1 ? nextSection : content.length;

      content =
        content.slice(0, afterHeader) +
        "\n\n" +
        notes.trim() +
        "\n\n" +
        content.slice(end);
    } else {
      // Insert Meeting Notes section right after the first --- (after header metadata)
      const firstHr = content.indexOf("\n---\n");
      if (firstHr !== -1) {
        const insertAt = firstHr + 5;
        content =
          content.slice(0, insertAt) +
          "\n" +
          notesHeader +
          "\n\n" +
          notes.trim() +
          "\n\n---\n" +
          content.slice(insertAt);
      } else {
        // Fallback: append at end
        content += "\n\n" + notesHeader + "\n\n" + notes.trim() + "\n";
      }
    }

    writeFileSync(prepPath, content);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "unknown" },
      { status: 500 }
    );
  }
}
