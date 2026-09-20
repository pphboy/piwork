import { randomUUID } from "node:crypto";
import { CoreStore, type ManagedUserRecord } from "@piwork/core-store";
import { hashPassword } from "./password.js";
import { InputValidationError } from "../input-validation.js";

export class AdministrationPermissionError extends Error {
  constructor() {
    super("administrator permission is required");
    this.name = "AdministrationPermissionError";
  }
}

export class DuplicateAccountError extends Error {
  constructor(readonly account: string) {
    super(`account ${account} already exists`);
    this.name = "DuplicateAccountError";
  }
}

export class UserNotFoundError extends Error {
  constructor(readonly userId: string) {
    super(`user ${userId} was not found`);
    this.name = "UserNotFoundError";
  }
}

export interface AdministrationActor {
  readonly userId: string;
  readonly role: "admin" | "user";
}

export class UserAdministrationService {
  constructor(
    private readonly store: CoreStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createUser(
    actor: AdministrationActor,
    input: { readonly account: string; readonly password: string; readonly role?: "admin" | "user" },
  ): Promise<ManagedUserRecord> {
    assertAdministrator(actor);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(input.account)) {
      throw new InputValidationError("account must be a valid identifier");
    }
    const now = this.now().toISOString();
    const record = {
      id: `user-${randomUUID()}`,
      account: input.account,
      passwordDigest: await hashPassword(input.password),
      role: input.role ?? "user",
      enabled: true,
      createdAt: now,
      updatedAt: now,
    } as const;
    try {
      this.store.createManagedUser(record);
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed: users\.account/.test(error.message)) {
        throw new DuplicateAccountError(input.account);
      }
      throw error;
    }
    const { passwordDigest: _, ...user } = record;
    return user;
  }

  listUsers(actor: AdministrationActor): ManagedUserRecord[] {
    assertAdministrator(actor);
    return this.store.listManagedUsers();
  }

  setEnabled(actor: AdministrationActor, userId: string, enabled: boolean): void {
    assertAdministrator(actor);
    if (!this.store.setUserEnabled(userId, enabled, this.now().toISOString())) throw new UserNotFoundError(userId);
  }

  async resetPassword(actor: AdministrationActor, userId: string, password: string): Promise<void> {
    assertAdministrator(actor);
    const digest = await hashPassword(password);
    if (!this.store.resetUserPassword(userId, digest, this.now().toISOString())) throw new UserNotFoundError(userId);
  }
}

function assertAdministrator(actor: AdministrationActor): void {
  if (actor.role !== "admin") throw new AdministrationPermissionError();
}
