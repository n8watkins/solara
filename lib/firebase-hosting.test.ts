import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface HostingHeader {
  key: string;
  value: string;
}

interface FirebaseConfig {
  hosting: {
    headers: Array<{
      source: string;
      headers: HostingHeader[];
    }>;
  };
}

describe("Firebase Hosting configuration", () => {
  it("allows every script origin required by Firebase Google sign-in", () => {
    const config = JSON.parse(
      readFileSync(new URL("../firebase.json", import.meta.url), "utf8"),
    ) as FirebaseConfig;
    const globalHeaders =
      config.hosting.headers.find((entry) => entry.source === "**")?.headers ??
      [];
    const contentSecurityPolicy = globalHeaders.find(
      (header) => header.key === "Content-Security-Policy",
    )?.value;

    expect(contentSecurityPolicy).toBeDefined();
    const scriptDirective = contentSecurityPolicy
      ?.split(";")
      .find((directive) => directive.trim().startsWith("script-src"));
    expect(scriptDirective).toContain("https://accounts.google.com");
    expect(scriptDirective).toContain("https://apis.google.com");
    expect(scriptDirective).toContain("https://www.gstatic.com");
  });
});
