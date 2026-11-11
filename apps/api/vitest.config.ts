import fs from "node:fs";
import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// O binding [ai] do wrangler.toml exige sessão remota da Cloudflare; os testes usam uma cópia sem ele
// e simulam o modelo no próprio teste.
const base = fs.readFileSync(path.join(import.meta.dirname, "wrangler.toml"), "utf8");
fs.writeFileSync(path.join(import.meta.dirname, "wrangler.vitest.toml"), base.replace(/\[ai\]\s*\nbinding = "AI"\s*\n/, ""));

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
  return {
    plugins: [
      cloudflareTest({
        main: "./src/index.ts",
        wrangler: { configPath: "./wrangler.vitest.toml" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            ENVIRONMENT: "development",
            APP_URL: "http://localhost:8787",
            ADMIN_EMAILS: "boss@example.com",
          },
        },
      }),
    ],
    test: { setupFiles: ["./test/apply-migrations.ts"] },
  };
});
