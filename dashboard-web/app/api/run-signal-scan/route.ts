import { exec } from "child_process";
import { join } from "path";

export const dynamic = "force-dynamic";

export async function POST() {
  const root = join(process.cwd(), "..");
  const cmd = `node ${join(root, "scripts", "scan-signals.mjs")}`;

  const child = exec(cmd, { cwd: root, env: { ...process.env } });

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      child.stdout?.on("data", (chunk: string) => {
        controller.enqueue(encoder.encode(chunk));
      });

      child.stderr?.on("data", (chunk: string) => {
        controller.enqueue(encoder.encode(chunk));
      });

      child.on("close", (code) => {
        controller.enqueue(
          encoder.encode(`\nProcess exited with code ${code}\n`)
        );
        controller.close();
      });

      child.on("error", (err) => {
        controller.enqueue(encoder.encode(`\nError: ${err.message}\n`));
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
