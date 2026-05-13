import { readFileSync, writeFileSync, existsSync } from "fs";
import { exec } from "child_process";
import { join } from "path";
import { tmpdir } from "os";
import { randomBytes } from "crypto";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { slug } = await request.json();
  if (!slug) {
    return Response.json({ error: "Missing slug" }, { status: 400 });
  }

  const root = join(process.cwd(), "..");
  const prepPath = join(root, "interview-prep", `${slug}.md`);

  if (!existsSync(prepPath)) {
    return Response.json({ error: "Prep doc not found" }, { status: 404 });
  }

  const prepDoc = readFileSync(prepPath, "utf-8");

  const notesMatch = prepDoc.match(/## Meeting Notes\n\n([\s\S]*?)(?=\n## |\n---\s*$|$)/);
  const meetingNotes = notesMatch ? notesMatch[1].trim() : "";

  if (!meetingNotes) {
    return Response.json({ error: "No meeting notes found. Save notes first." }, { status: 400 });
  }

  const prompt = `OUTPUT ONLY MARKDOWN. NO COMMENTARY. NO EXPLANATION.

You are a text transformer. You receive two inputs and produce one output.

INPUT 1 — MEETING NOTES (insider intel from recruiter conversations):
${meetingNotes}

INPUT 2 — CURRENT PREP DOCUMENT:
${prepDoc}

YOUR TASK:
Output a new version of the prep document that weaves the meeting notes intel into every section. Specifically:

- Company Quick Brief: add details from the notes (team size, interviewer names, process, timeline)
- Why This Role Fits You: sharpen talking points based on what the recruiter asked about
- Questions THEY Will Ask You: add new predicted questions based on recruiter concerns, with answer frameworks
- Salary Negotiation Prep: update with actual comp numbers from the notes
- Red Flag Watch: add any concerns that surfaced
- Pre-Interview Checklist: add items based on who you're meeting
- STAR+R Stories: reorder/annotate based on what the recruiter cared about

Mark all new content with "(per recruiter)" so the user sees what came from notes.
Keep the ## Meeting Notes section with the raw notes preserved.

IMPORTANT: Your output must be the COMPLETE markdown document starting with "# Interview Prep:" — every section, beginning to end. Do not skip sections. Do not add commentary before or after. Do not wrap in code fences. Just output the markdown.`;

  const tmpFile = join(tmpdir(), `prep-prompt-${randomBytes(4).toString("hex")}.txt`);
  writeFileSync(tmpFile, prompt);

  // Run synchronously with a promise — streaming wasn't working in Next.js dev
  const result = await new Promise<{ output: string; code: number }>((resolve) => {
    let output = "";
    const child = exec(`cat "${tmpFile}" | claude -p --model claude-opus-4-6 --permission-mode bypassPermissions`, {
      cwd: root,
      env: { ...process.env },
      maxBuffer: 1024 * 1024 * 10,
      timeout: 300000, // 5 min max
    });

    child.stdout?.on("data", (data: string) => {
      output += data;
    });

    child.stderr?.on("data", () => {
      // ignore stderr
    });

    child.on("close", (code) => {
      try { require("fs").unlinkSync(tmpFile); } catch {}
      resolve({ output, code: code ?? 1 });
    });

    child.on("error", () => {
      try { require("fs").unlinkSync(tmpFile); } catch {}
      resolve({ output: "", code: 1 });
    });
  });

  if (result.code === 0 && result.output.trim()) {
    // Strip code fences if Opus wrapped the output
    let cleaned = result.output.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:markdown|md)?\n?/, "").replace(/\n?```\s*$/, "");
    }

    if (cleaned.startsWith("#")) {
      // Add enhancement timestamp after the first ---
      const timestamp = `**Enhanced:** ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC via Opus 4.6`;
      const firstHr = cleaned.indexOf("\n---\n");
      if (firstHr !== -1) {
        cleaned = cleaned.slice(0, firstHr) + `\n${timestamp}` + cleaned.slice(firstHr);
      }
      writeFileSync(prepPath, cleaned + "\n");
      return Response.json({ ok: true, message: "Enhanced prep doc saved. Refresh to see changes." });
    }

    // If it still doesn't look like markdown, save anyway if it's substantial
    if (cleaned.length > 1000) {
      writeFileSync(prepPath, cleaned + "\n");
      return Response.json({ ok: true, message: "Enhanced prep doc saved (non-standard format). Refresh to see changes." });
    }

    return Response.json(
      { ok: false, message: `Output didn't look like a prep doc (${cleaned.length} chars). Original preserved.`, preview: cleaned.slice(0, 200) },
      { status: 500 }
    );
  }

  return Response.json(
    { ok: false, message: `Process exited with code ${result.code}. Original preserved.` },
    { status: 500 }
  );
}
