import { exec } from "child_process";
import { writeFileSync, unlinkSync } from "fs";

export const dynamic = "force-dynamic";

export async function POST() {
  const tmpFile = "/tmp/test-claude-api.txt";
  writeFileSync(tmpFile, "Say hello in exactly 5 words");

  const child = exec(`cat "${tmpFile}" | claude -p --model claude-opus-4-6`, {
    cwd: process.cwd(),
    env: { ...process.env },
    maxBuffer: 1024 * 1024,
  });

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      child.stdout?.on("data", (data: string) => {
        controller.enqueue(encoder.encode(`[stdout] ${data}`));
      });

      child.stderr?.on("data", (data: string) => {
        controller.enqueue(encoder.encode(`[stderr] ${data}`));
      });

      child.on("close", (code) => {
        try { unlinkSync(tmpFile); } catch {}
        controller.enqueue(encoder.encode(`\n[exit] code=${code}`));
        controller.close();
      });

      child.on("error", (err) => {
        controller.enqueue(encoder.encode(`\n[error] ${err.message}`));
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
