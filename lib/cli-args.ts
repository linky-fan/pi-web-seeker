const PACKAGE_SPEC_RE = /^[A-Za-z0-9@][A-Za-z0-9._@/:-]*$/;
const TEMPLATE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Values passed positionally to a CLI must not start with "-": npx would treat them
 * as options instead of the intended argument (e.g. `skills add -g`).
 */
export function isSafeCliArgument(value: string): boolean {
  return value.length > 0 && !value.startsWith("-") && !/[\x00-\x1f\x7f]/.test(value);
}

/** A skills package spec such as `owner/repo@skill`. */
export function isSafePackageSpec(value: string): boolean {
  return value.length <= 200 && isSafeCliArgument(value) && PACKAGE_SPEC_RE.test(value);
}

/** A template name that is resolved to a file under the bundled templates directory. */
export function isSafeTemplateName(value: string): boolean {
  return value.length <= 64 && TEMPLATE_NAME_RE.test(value);
}