import assert from "node:assert/strict";
import test from "node:test";
import {
  BrowserMutationProtector,
  browserSessionCookie,
  CsrfRejectedError,
  OriginRejectedError,
  redactDiagnostics,
  redactUrl,
} from "./browser-security.js";

test("browser cookie is Secure, HttpOnly, strict same-site, and scoped to the deployment", () => {
  const cookie = browserSessionCookie("opaque token", { maxAgeSeconds: 86_400 });
  assert.match(cookie, /^piwork_session=opaque%20token;/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /Max-Age=86400/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
});

test("forged origins and missing, changed, or cross-session CSRF tokens are rejected", () => {
  const protector = new BrowserMutationProtector(["https://core.example:8443"], Buffer.alloc(32, 7));
  const token = protector.issueCsrfToken("login-session-1");

  assert.doesNotThrow(() => protector.authorize({
    origin: "https://core.example:8443",
    sessionId: "login-session-1",
    csrfToken: token,
  }));
  assert.throws(() => protector.authorize({
    origin: "https://attacker.example",
    sessionId: "login-session-1",
    csrfToken: token,
  }), OriginRejectedError);
  assert.throws(() => protector.authorize({
    sessionId: "login-session-1",
    csrfToken: token,
  }), OriginRejectedError);
  assert.throws(() => protector.authorize({
    origin: "https://core.example:8443",
    sessionId: "login-session-1",
  }), CsrfRejectedError);
  assert.throws(() => protector.authorize({
    origin: "https://core.example:8443",
    sessionId: "login-session-2",
    csrfToken: token,
  }), CsrfRejectedError);
  assert.throws(() => protector.authorize({
    origin: "https://core.example:8443",
    sessionId: "login-session-1",
    csrfToken: `${token}changed`,
  }), CsrfRejectedError);
});

test("diagnostic structures redact credentials recursively without hiding ordinary fields", () => {
  const redacted = redactDiagnostics({
    account: "alice",
    password: "secret-password",
    headers: { authorization: "Bearer abc", "x-request-id": "request-1" },
    model: { apiKey: "model-key", provider: "fixture" },
    values: [{ csrfToken: "csrf-secret-value" }, { status: "failed" }],
  });
  assert.deepEqual(redacted, {
    account: "alice",
    password: "[REDACTED]",
    headers: { authorization: "[REDACTED]", "x-request-id": "request-1" },
    model: { apiKey: "[REDACTED]", provider: "fixture" },
    values: [{ csrfToken: "[REDACTED]" }, { status: "failed" }],
  });
  const serialized = JSON.stringify(redacted);
  for (const secret of ["secret-password", "Bearer abc", "model-key", "csrf-secret-value"]) {
    assert.doesNotMatch(serialized, new RegExp(secret));
  }
});

test("sensitive query values are redacted in absolute and relative diagnostic URLs", () => {
  assert.equal(
    redactUrl("https://core.example/api?work=one&token=abc&model_secret=xyz"),
    "https://core.example/api?work=one&token=%5BREDACTED%5D&model_secret=%5BREDACTED%5D",
  );
  assert.equal(
    redactUrl("/api?account=alice&csrf_token=abc"),
    "/api?account=alice&csrf_token=%5BREDACTED%5D",
  );
});
