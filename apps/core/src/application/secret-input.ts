import { readFileSync } from "node:fs";

export interface SecretInputOptions {
  readonly stdin: NodeJS.ReadStream;
  readonly stdout: NodeJS.WriteStream;
  readonly stdinMode: boolean;
  readonly prompt: string;
}

export async function readSecretInput(options: SecretInputOptions): Promise<string> {
  const value = options.stdinMode
    ? readFileSync(0, "utf8").replace(/[\r\n]+$/, "")
    : await readHiddenLine(options.stdin, options.stdout, options.prompt);
  if (value.length === 0) throw new Error("secret value must not be empty");
  return value;
}

async function readHiddenLine(
  input: NodeJS.ReadStream,
  output: NodeJS.WriteStream,
  prompt: string,
): Promise<string> {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") {
    throw new Error("interactive secret input requires a terminal; use the documented stdin option");
  }
  output.write(prompt);
  input.setRawMode(true);
  input.resume();
  input.setEncoding("utf8");
  let value = "";
  try {
    return await new Promise<string>((resolve, reject) => {
      const onData = (chunk: string) => {
        for (const character of chunk) {
          if (character === "\r" || character === "\n") {
            cleanup();
            output.write("\n");
            resolve(value);
          } else if (character === "\u0003") {
            cleanup();
            output.write("\n");
            reject(new Error("secret input cancelled"));
          } else if (character === "\u007f" || character === "\b") {
            value = value.slice(0, -1);
          } else if (character >= " ") {
            value += character;
          }
        }
      };
      const onEnd = () => {
        cleanup();
        reject(new Error("secret input ended before a value was submitted"));
      };
      const cleanup = () => {
        input.off("data", onData);
        input.off("end", onEnd);
      };
      input.on("data", onData);
      input.once("end", onEnd);
    });
  } finally {
    input.setRawMode(false);
    input.pause();
  }
}
