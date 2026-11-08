export interface StartupShellInput {
  logoUrl: string;
  message: string;
  error?: string;
  pending?: boolean;
  retry?: { label: string; action: string };
  home?: { label: string; href: string };
  cold?: boolean;
}
export function startupShell(input: StartupShellInput): string;
