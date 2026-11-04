import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { builtinModules } from "node:module";

const desktopOnlyModules = [
  ...new Set([
    "electron",
    ...builtinModules.flatMap((name) => [name, name.startsWith("node:") ? name : `node:${name}`]),
  ]),
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["**/*.{ts,tsx,mts}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
    },
  },
  {
    files: [
      "app/**/*.{ts,tsx,js,jsx}",
      "components/**/*.{ts,tsx,js,jsx}",
      "features/**/*.{ts,tsx,cjs}",
      "platform/**/*.{ts,tsx,cjs}",
      "core/**/*.{ts,tsx,cjs}",
    ],
    ignores: ["**/*.test.*"],
    rules: {
      "no-restricted-imports": ["error", ...desktopOnlyModules],
      "no-restricted-modules": ["error", ...desktopOnlyModules],
    },
  },
  {
    files: ["electron/**/*.cjs", "core/**/*.cjs", "features/**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
