import { hash } from "@node-rs/argon2";
import { InputValidationError } from "../input-validation.js";

export function assertValidPassword(password: string): void {
  if (password.length < 12) throw new InputValidationError("password must contain at least 12 characters");
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
