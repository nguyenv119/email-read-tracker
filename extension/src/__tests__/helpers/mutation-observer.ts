import { vi } from "vitest";

/**
 * Shared MutationObserver stub helpers used across checkmarks and intercept tests.
 *
 * These helpers replace the global MutationObserver with a controlled stub that
 * captures the callback, letting tests fire synthetic mutations and assert on the
 * resulting DOM changes without relying on the real browser observer.
 */

let capturedCallback: MutationCallback | null = null;
let OriginalMO: typeof MutationObserver;

export function setupMutationObserverStub(): void {
  capturedCallback = null;
  OriginalMO = window.MutationObserver;
  vi.stubGlobal(
    "MutationObserver",
    vi.fn(function (this: MutationObserver, cb: MutationCallback) {
      capturedCallback = cb;
      this.observe = vi.fn();
      this.disconnect = vi.fn();
      this.takeRecords = () => [];
    })
  );
}

export function teardownMutationObserverStub(): void {
  vi.stubGlobal("MutationObserver", OriginalMO);
}

/** Returns the captured MutationCallback, useful for sanity assertions in tests. */
export function getCapturedCallback(): MutationCallback | null {
  return capturedCallback;
}

export function fireMutation(addedNode: Node): void {
  capturedCallback!(
    [
      {
        type: "childList",
        addedNodes: [addedNode] as unknown as NodeList,
        removedNodes: [] as unknown as NodeList,
        target: document.body,
        previousSibling: null,
        nextSibling: null,
        attributeName: null,
        attributeNamespace: null,
        oldValue: null,
      } satisfies MutationRecord,
    ],
    {} as MutationObserver
  );
}
