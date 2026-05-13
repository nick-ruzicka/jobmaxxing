import { writeFileSync, unlinkSync } from "fs";
import { exec } from "child_process";
import { join } from "path";
import { tmpdir } from "os";
import { randomBytes } from "crypto";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { company, role, url } = await request.json();
  if (!company) {
    return Response.json({ error: "Missing company" }, { status: 400 });
  }

  const root = join(process.cwd(), "..");

  const prompt = [
    `Generate an interview prep document for ${company}${role ? ` - ${role}` : ""}.`,
    url ? `JD URL: ${url}` : "",
    `Read modes/_shared.md, modes/_profile.md, cv.md, and interview-prep/story-bank.md for context.`,
    `Save the output to interview-prep/${company.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${(role || "role").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.md`,
    `Follow the structure in any existing interview-prep/*.md files as a template.`,
  ]
    .filter(Boolean)
    .join(" ");

  const tmpFile = join(tmpdir(), `prep-gen-${randomBytes(4).toString("hex")}.txt`);
  writeFileSync(tmpFile, prompt);

  const cmd = `cat "${tmpFile}" | claude -p --permission-mode bypassPermissions`;
  const child = exec(cmd, {
    cwd: root,
    env: { ...process.env },
    maxBuffer: 1024 * 1024 * 10,
  });

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      child.stdout?.on("data", (data: string) => {
        controller.enqueue(encoder.encode(data));
      });

      child.stderr?.on("data", (data: string) => {
        controller.enqueue(encoder.encode(`[info] ${data}`));
      });

      child.on("close", (code) => {
        try { unlinkSync(tmpFile); } catch {}
        controller.enqueue(
          encoder.encode(
            code === 0
              ? "\n\nPrep doc generated. Refresh the page to see it."
              : `\n\nProcess exited with code ${code}`
          )
        );
        controller.close();
      });

      child.on("error", (err) => {
        try { unlinkSync(tmpFile); } catch {}
        controller.enqueue(encoder.encode(`\nError: ${err.message}`));
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
    },
  });
}
