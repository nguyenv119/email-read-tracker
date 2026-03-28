/**
 * OAuth token helpers.
 *
 * chrome.identity.getAuthToken is only available in the background service
 * worker. Content scripts must relay through the background via message-passing.
 *
 * Exports two functions:
 *  - getAuthTokenInBackground()  — call from background.ts
 *  - getAuthToken()              — call from content-script context (intercept.ts)
 */

/**
 * Background-side: wraps chrome.identity.getAuthToken in a Promise.
 * Must only be called from the service-worker context.
 *
 * @throws {Error} if the browser returns no token (user declined / not signed in)
 */
export function getAuthTokenInBackground(): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken(
      { interactive: true },
      (result: chrome.identity.GetAuthTokenResult) => {
        const token = result?.token;
        if (!token) {
          reject(new Error("Failed to obtain auth token from chrome.identity"));
          return;
        }
        resolve(token);
      }
    );
  });
}

/**
 * Content-script side: sends a GET_AUTH_TOKEN message to the background
 * service worker and resolves with the token it returns.
 *
 * @throws {Error} if the background returns no token
 */
export function getAuthToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!chrome.runtime?.id) {
      reject(
        new Error("Extension context invalidated — please refresh the page")
      );
      return;
    }
    chrome.runtime.sendMessage(
      { type: "GET_AUTH_TOKEN" },
      (response: { token?: string }) => {
        // Must access lastError before checking response to prevent Chrome from
        // logging an unchecked runtime error when the background returns nothing.
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message ?? "Runtime error in GET_AUTH_TOKEN"));
          return;
        }
        if (!response?.token) {
          reject(new Error("Failed to obtain auth token from background"));
          return;
        }
        resolve(response.token);
      }
    );
  });
}
