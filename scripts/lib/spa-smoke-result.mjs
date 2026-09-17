/** A reachable URL alone is not evidence that a routed SPA page loaded. */
export function assessSpaSmoke(result) {
  const failures = [];
  const pathname = (value) => {
    try { return new URL(value).pathname; } catch { return null; }
  };
  if (pathname(result.urlAfterRoot) !== result.expectedHome) failures.push("Root did not land on the role home");
  if (pathname(result.urlAfterHome) !== result.expectedHome) failures.push("Direct role home did not remain on its exact path");
  if (result.forbiddenAdminBlocked !== true) failures.push("Admin route guard failed");
  if (result.dispatchBlocked !== true) failures.push("Dispatch route guard failed");
  if (result.homeSurface?.ready !== true) failures.push("Role home did not render ready main content");
  if (result.apiSmoke?.ok !== true || !(result.apiSmoke.status >= 200 && result.apiSmoke.status < 300)) {
    failures.push("Role API smoke failed");
  }
  if (!Array.isArray(result.browserErrors) || result.browserErrors.length) failures.push("Browser error evidence is missing or contains errors");
  if (!Array.isArray(result.failedApiResponses) || result.failedApiResponses.length) failures.push("API response evidence is missing or contains failures");
  return { ok: failures.length === 0, failures };
}
