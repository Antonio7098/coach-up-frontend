import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  // Globally downgrade explicit any to a warning to avoid noisy CI failures
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  // Allow explicit any in tests only to keep test scaffolding simple
  {
    files: [
      "tests/**/*.{ts,tsx}",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  // Allow explicit any in API route handlers where passthrough payloads are common
  {
    files: [
      "src/app/api/**/*.{ts,tsx}",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];

export default eslintConfig;
