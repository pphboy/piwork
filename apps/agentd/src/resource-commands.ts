import { readFileSync } from "node:fs";
import type { ResourceLoader } from "@earendil-works/pi-coding-agent";
import { WEB_SLASH_COMMANDS, type SlashCommand } from "@piwork/contracts";
import { RunModelError } from "./run-models.js";

export function parseResourceCommand(prompt: string): { token: string; text: string } {
  const match = /^\/([^\s/\\\u0000-\u001f]+)(?:\s([\s\S]*))?$/.exec(prompt.trimStart());
  if (!match) throw new RunModelError("SLASH_COMMAND_UNKNOWN", "Choose an available Skill or prompt command, or send this as text.");
  return { token: match[1]!, text: `/${match[1]}${match[2] === undefined ? "" : ` ${match[2]}`}` };
}

export function requireResourceCommand(commands: readonly SlashCommand[], prompt: string): SlashCommand {
  const { token } = parseResourceCommand(prompt);
  if ((WEB_SLASH_COMMANDS as readonly string[]).includes(token)) throw new RunModelError("SLASH_COMMAND_UNSUPPORTED", "This command opens a Desktop control and cannot run through the model.");
  const command = commands.find(value => value.command === `/${token}`);
  if (!command) throw new RunModelError("SLASH_COMMAND_UNKNOWN", "This resource command is not available in the active Work. Choose a command or send this as text.");
  return command;
}

export function validateLoadedResourceCommand(loader: ResourceLoader, command: SlashCommand): void {
  try {
    if (loader.getExtensions().extensions.some(extension => extension.commands.has(command.command.slice(1)))) throw new Error();
    if (command.kind === "skill") {
      const skill = loader.getSkills().skills.find(value => value.name === command.name);
      if (!skill) throw new Error();
      readFileSync(skill.filePath, "utf8");
    } else if (!loader.getPrompts().prompts.some(value => value.name === command.name)) {
      throw new Error();
    }
  } catch { throw new RunModelError("SLASH_COMMAND_UNAVAILABLE", "The accepted resource command could not be loaded. The message was not sent as plain text."); }
}
