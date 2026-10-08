import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);

// jsdom implements dialog elements but does not implement their modal methods.
Object.defineProperties(HTMLDialogElement.prototype, {
  showModal: {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.open = true;
    },
  },
  close: {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event("close"));
    },
  },
});

// Popover placement and scrolling need a browser layout engine. Keep the real
// menu components mounted in DOM tests while supplying jsdom's missing APIs.
for (const method of ["showPopover", "hidePopover"] as const) {
  if (typeof HTMLElement.prototype[method] !== "function") {
    Object.defineProperty(HTMLElement.prototype, method, {
      configurable: true,
      value(this: HTMLElement) {
        this.style.display = method === "showPopover" ? "block" : "none";
      },
    });
  }
}
if (typeof HTMLElement.prototype.scrollIntoView !== "function") {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value() {},
  });
}
