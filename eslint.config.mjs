import { fixupConfigRules } from "@eslint/compat";
import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const eslintConfig = [
  // Next 16.2 still includes plugins that use rule-context APIs removed in ESLint 10.
  // Keep the official compatibility shim until those plugins support ESLint 10 natively.
  ...fixupConfigRules([...coreWebVitals, ...typescript]),
  {
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
];

export default eslintConfig;
