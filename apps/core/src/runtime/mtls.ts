import { randomBytes, X509Certificate } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export interface InstallationAuthority {
  readonly certificatePath: string;
  readonly privateKeyPath: string;
}

export interface GenerationTlsIdentity {
  readonly caCertificatePath: string;
  readonly serverCertificatePath: string;
  readonly serverPrivateKeyPath: string;
  readonly clientCertificatePath: string;
  readonly clientPrivateKeyPath: string;
  readonly serverName: string;
  readonly clientCommonName: string;
  readonly serviceClientCertificatePath: string;
  readonly serviceClientPrivateKeyPath: string;
  readonly serviceClientCommonName: string;
}

export interface CoreServiceTlsIdentity {
  readonly caCertificatePath: string;
  readonly serverCertificatePath: string;
  readonly serverPrivateKeyPath: string;
  readonly serverName: string;
}

export function ensureInstallationAuthority(runtimeDirectory: string, installationId: string): InstallationAuthority {
  const directory = join(runtimeDirectory, "pki");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const certificatePath = join(directory, "installation-ca.crt");
  const privateKeyPath = join(directory, "installation-ca.key");
  if (existsSync(certificatePath) || existsSync(privateKeyPath)) {
    requireRegular(certificatePath);
    requireRegular(privateKeyPath);
    chmodSync(certificatePath, 0o600);
    chmodSync(privateKeyPath, 0o600);
    return { certificatePath, privateKeyPath };
  }
  const suffix = temporarySuffix();
  const temporaryCertificate = `${certificatePath}.${suffix}`;
  const temporaryKey = `${privateKeyPath}.${suffix}`;
  try {
    openssl([
      "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-days", "3650",
      "-subj", `/CN=piwork-installation-${safeName(installationId)}`,
      "-addext", "basicConstraints=critical,CA:TRUE,pathlen:0",
      "-addext", "keyUsage=critical,keyCertSign,cRLSign",
      "-keyout", temporaryKey, "-out", temporaryCertificate,
    ]);
    chmodSync(temporaryKey, 0o600);
    chmodSync(temporaryCertificate, 0o600);
    renameSync(temporaryKey, privateKeyPath);
    renameSync(temporaryCertificate, certificatePath);
  } finally {
    rmSync(temporaryKey, { force: true });
    rmSync(temporaryCertificate, { force: true });
  }
  return { certificatePath, privateKeyPath };
}

export function ensureGenerationTlsIdentity(input: {
  readonly runtimeDirectory: string;
  readonly installationId: string;
  readonly workId: string;
  readonly generation: number;
  readonly instanceId?: string;
}): GenerationTlsIdentity {
  const instanceId = input.instanceId ?? "agent-test";
  const authority = ensureInstallationAuthority(input.runtimeDirectory, input.installationId);
  const directory = join(input.runtimeDirectory, input.workId, `tls-generation-${input.generation}`);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const serverName = `agent.g${input.generation}.${input.workId}.piwork`;
  const clientCommonName = `core.g${input.generation}.${input.workId}.piwork`;
  // The complete scoped identity is carried in the URI SAN. OpenSSL limits a
  // Common Name to 64 bytes, which is too short for Work and instance UUIDs.
  const serviceClientCommonName = "agent-service-client";
  const paths = {
    serverCertificatePath: join(directory, "agent-server.crt"),
    serverPrivateKeyPath: join(directory, "agent-server.key"),
    clientCertificatePath: join(directory, "core-client.crt"),
    clientPrivateKeyPath: join(directory, "core-client.key"),
    serviceClientCertificatePath: join(directory, "agent-service-client.crt"),
    serviceClientPrivateKeyPath: join(directory, "agent-service-client.key"),
  };
  const present = Object.values(paths).filter(existsSync).length;
  if (present !== 0 && present !== Object.keys(paths).length) {
    throw new Error("generation TLS identity is incomplete");
  }
  if (present === Object.keys(paths).length) {
    const ca = new X509Certificate(readTlsFile(authority.certificatePath));
    const server = new X509Certificate(readTlsFile(paths.serverCertificatePath));
    const client = new X509Certificate(readTlsFile(paths.clientCertificatePath));
    const serviceClient = new X509Certificate(readTlsFile(paths.serviceClientCertificatePath));
    const valid = certificateIsCurrent(server) && certificateIsCurrent(client)
      && certificateIsCurrent(serviceClient)
      && certificateIsTrusted(server, ca) && certificateIsTrusted(client, ca) && certificateIsTrusted(serviceClient, ca)
      && server.checkHost(serverName) !== undefined
      && client.subject.includes(`CN=${clientCommonName}`)
      && serviceClient.subject.includes(`CN=${serviceClientCommonName}`);
    if (!valid) for (const path of Object.values(paths)) rmSync(path, { force: true });
  }
  if (!existsSync(paths.serverCertificatePath)) {
    issueCertificate({
      authority,
      certificatePath: paths.serverCertificatePath,
      privateKeyPath: paths.serverPrivateKeyPath,
      commonName: serverName,
      extension: `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:${serverName},URI:spiffe://piwork/work/${input.workId}/generation/${input.generation}/agent\n`,
    });
    issueCertificate({
      authority,
      certificatePath: paths.serviceClientCertificatePath,
      privateKeyPath: paths.serviceClientPrivateKeyPath,
      commonName: serviceClientCommonName,
      extension: `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=clientAuth\nsubjectAltName=URI:spiffe://piwork/installation/${input.installationId}/work/${input.workId}/generation/${input.generation}/instance/${instanceId}/role/agent-service-client\n`,
    });
    issueCertificate({
      authority,
      certificatePath: paths.clientCertificatePath,
      privateKeyPath: paths.clientPrivateKeyPath,
      commonName: clientCommonName,
      extension: `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=clientAuth\nsubjectAltName=DNS:${clientCommonName},URI:spiffe://piwork/work/${input.workId}/generation/${input.generation}/core\n`,
    });
  }
  for (const path of Object.values(paths)) requireRegular(path);
  chmodSync(paths.clientPrivateKeyPath, 0o600);
  chmodSync(paths.clientCertificatePath, 0o600);
  // These three files are mounted read-only into a fixed numeric container
  // user. Their enclosing generation directory remains 0700 on the host.
  chmodSync(authority.certificatePath, 0o644);
  chmodSync(paths.serverPrivateKeyPath, 0o644);
  chmodSync(paths.serverCertificatePath, 0o644);
  chmodSync(paths.serviceClientPrivateKeyPath, 0o644);
  chmodSync(paths.serviceClientCertificatePath, 0o644);
  return { caCertificatePath: authority.certificatePath, ...paths, serverName, clientCommonName, serviceClientCommonName };
}

export function ensureCoreServiceTlsIdentity(runtimeDirectory: string, installationId: string): CoreServiceTlsIdentity {
  const authority = ensureInstallationAuthority(runtimeDirectory, installationId);
  const directory = join(runtimeDirectory, "pki");
  const serverName = "piwork-core";
  const serverCertificatePath = join(directory, "core-service-server.crt");
  const serverPrivateKeyPath = join(directory, "core-service-server.key");
  if (existsSync(serverCertificatePath) !== existsSync(serverPrivateKeyPath)) throw new Error("Core service TLS identity is incomplete");
  if (!existsSync(serverCertificatePath)) issueCertificate({
    authority,
    certificatePath: serverCertificatePath,
    privateKeyPath: serverPrivateKeyPath,
    commonName: serverName,
    extension: `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:${serverName}\n`,
  });
  chmodSync(authority.certificatePath, 0o644);
  chmodSync(serverCertificatePath, 0o600);
  chmodSync(serverPrivateKeyPath, 0o600);
  return { caCertificatePath: authority.certificatePath, serverCertificatePath, serverPrivateKeyPath, serverName };
}

export function readTlsFile(path: string, maximumBytes = 1024 * 1024): Buffer {
  requireRegular(path);
  const value = readFileSync(path);
  if (value.length === 0 || value.length > maximumBytes) throw new Error("TLS material has an invalid size");
  return value;
}

export function certificateIsCurrent(certificate: X509Certificate, now = new Date(), minimumRemainingMs = 60_000): boolean {
  const validFrom = Date.parse(certificate.validFrom);
  const validTo = Date.parse(certificate.validTo);
  return Number.isFinite(validFrom) && Number.isFinite(validTo)
    && validFrom <= now.getTime()
    && validTo - now.getTime() > minimumRemainingMs;
}

export function certificateIsTrusted(certificate: X509Certificate, authority: X509Certificate): boolean {
  return certificate.issuer === authority.subject && certificate.verify(authority.publicKey);
}

function issueCertificate(input: {
  readonly authority: InstallationAuthority;
  readonly certificatePath: string;
  readonly privateKeyPath: string;
  readonly commonName: string;
  readonly extension: string;
}): void {
  const suffix = temporarySuffix();
  const requestPath = join(dirname(input.certificatePath), `.request.${suffix}.csr`);
  const extensionPath = `${input.certificatePath}.${suffix}.ext`;
  const temporaryCertificate = `${input.certificatePath}.${suffix}`;
  const temporaryKey = `${input.privateKeyPath}.${suffix}`;
  try {
    writeFileSync(extensionPath, input.extension, { encoding: "utf8", flag: "wx", mode: 0o600 });
    openssl([
      "req", "-new", "-newkey", "rsa:2048", "-nodes", "-sha256",
      "-subj", `/CN=${input.commonName}`,
      "-keyout", temporaryKey, "-out", requestPath,
    ]);
    openssl([
      "x509", "-req", "-sha256", "-days", "30", "-in", requestPath,
      "-CA", input.authority.certificatePath, "-CAkey", input.authority.privateKeyPath,
      "-set_serial", `0x${randomBytes(16).toString("hex")}`,
      "-extfile", extensionPath, "-out", temporaryCertificate,
    ]);
    chmodSync(temporaryKey, 0o600);
    chmodSync(temporaryCertificate, 0o600);
    renameSync(temporaryKey, input.privateKeyPath);
    renameSync(temporaryCertificate, input.certificatePath);
  } finally {
    rmSync(requestPath, { force: true });
    rmSync(extensionPath, { force: true });
    rmSync(temporaryCertificate, { force: true });
    rmSync(temporaryKey, { force: true });
  }
}

function openssl(args: readonly string[]): void {
  try {
    execFileSync("openssl", [...args], { stdio: "ignore", timeout: 15_000 });
  } catch {
    throw new Error("failed to generate internal TLS identity");
  }
}

function requireRegular(path: string): void {
  const information = lstatSync(path);
  if (information.isSymbolicLink() || !information.isFile()) throw new Error("TLS material is not a regular file");
}

function temporarySuffix(): string {
  return `${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 128);
}
