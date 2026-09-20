import { hash } from "@node-rs/argon2";

export function assertValidPassword(password: string): void {
  if (password.length < 12) throw new Error("password must contain at least 12 characters");
}

export async function hashPassword(password: string): Promise<string> {
  assertValidPassword(password);
  return hash(password, {
    algorithm: 2,
    memoryCost: 65_536,
    timeCost: 3,
    parallelism: 1,
    outputLen: 32,
  });
}
