import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import vue from "eslint-plugin-vue";
import globals from "globals";
import vueParser from "vue-eslint-parser";

const commonRules = {
  "no-debugger": "error",
  "no-console": ["error", { allow: ["warn", "error"] }],
  "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
};

export default [
  { ignores: ["dist/**", "node_modules/**", "coverage/**", "playwright-report/**", "test-results/**"] },
  {
    files: ["**/*.ts"],
    plugins: { "@typescript-eslint": tseslint },
    languageOptions: { parser: tsParser, globals: { ...globals.browser, ...globals.node } },
    rules: commonRules,
  },
  {
    files: ["**/*.vue"],
    plugins: { vue, "@typescript-eslint": tseslint },
    languageOptions: {
      parser: vueParser,
      parserOptions: { parser: tsParser, ecmaVersion: "latest", sourceType: "module", extraFileExtensions: [".vue"] },
      globals: globals.browser,
    },
    processor: vue.processors[".vue"],
    rules: { ...commonRules, ...vue.configs.base.rules },
  },
];
