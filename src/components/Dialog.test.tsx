// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Dialog } from "./Dialog";

afterEach(cleanup);

it("names each dialog and focuses its first field after opening", () => {
  render(
    <Dialog title="Rename note" onClose={vi.fn()}>
      <input aria-label="New filename" />
    </Dialog>,
  );
  const dialog = screen.getByRole("dialog", { name: "Rename note" });
  expect(dialog.hasAttribute("open")).toBe(true);
  expect(document.activeElement).toBe(
    screen.getByRole("textbox", { name: "New filename" }),
  );
});

it("protects busy dialogs from dismissal and allows Escape for ordinary dialogs", () => {
  const onClose = vi.fn();
  const { rerender } = render(
    <Dialog title="Deleting folder" onClose={onClose} dismissible={false} busy>
      <span>Saving…</span>
    </Dialog>,
  );
  fireEvent(
    screen.getByRole("dialog", { name: "Deleting folder" }),
    new Event("cancel", { cancelable: true }),
  );
  expect(onClose).not.toHaveBeenCalled();
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Close dialog" })
      .disabled,
  ).toBe(true);
  rerender(
    <Dialog title="Delete folder" onClose={onClose}>
      <span>Confirm</span>
    </Dialog>,
  );
  fireEvent(
    screen.getByRole("dialog", { name: "Delete folder" }),
    new Event("cancel", { cancelable: true }),
  );
  expect(onClose).toHaveBeenCalledOnce();
});
