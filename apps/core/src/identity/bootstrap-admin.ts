import { randomUUID } from "node:crypto";
import { CoreStore } from "@piwork/core-store";
import { hashPassword } from "./password.js";
import { InputValidationError } from "../input-validation.js";

export interface BootstrapLogger {
  info(message: string, fields: Readonly<Record<string, string>>): void;
}

export interface BootstrapAdministratorOptions {
  readonly store: CoreStore;
  readonly account: string;
  readonly password: string;
  readonly now?: string;
  readonly logger?: BootstrapLogger;
}

export interface BootstrapAdministratorResult {
  readonly userId: string;
  readonly account: string;
}

const ACCOUNT = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

export async function bootstrapAdministrator(
  options: BootstrapAdministratorOptions,
): Promise<BootstrapAdministratorResult> {
  if (!ACCOUNT.test(options.account)) throw new InputValidationError("account must be a valid identifier");
  const passwordDigest = await hashPassword(options.password);
  const userId = `user-${randomUUID()}`;
  options.store.createInitialAdministrator({
    id: userId,
    account: options.account,
    passwordDigest,
    now: options.now ?? new Date().toISOString(),
  });
  options.logger?.info("initial administrator created", { userId, account: options.account });
  return { userId, account: options.account };
}
