import '@testing-library/jest-dom/vitest'

// React Router's data navigation creates a jsdom AbortSignal while Node's
// built-in Request validates against a different realm. Keep navigation tests
// deterministic by letting Request create its own compatible signal.
const NativeRequest = globalThis.Request
if (NativeRequest) {
  globalThis.Request = class CompatibleRequest extends NativeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(input, init?.signal ? { ...init, signal: undefined } : init)
    }
  }
}
