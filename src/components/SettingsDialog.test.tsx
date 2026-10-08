import { useState } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  localStorage.clear();
});

async function settings() {
  const { files } = await import("../platform");
  const listFonts = vi.spyOn(files, "listFonts");
  const { SettingsDialog } = await import("./SettingsDialog");
  return { SettingsDialog, listFonts };
}

it("shows registered app shortcuts together with editor search and link hints", async () => {
  const { SettingsDialog, listFonts } = await settings();
  listFonts.mockResolvedValue([]);
  render(<SettingsDialog onClose={vi.fn()} initialSection="Shortcuts" />);
  const { workspaceShortcuts } = await import("../domain/workspace-commands");
  for (const { label, shortcut } of workspaceShortcuts) {
    const definition = screen.getByText(label).closest("div")!;
    expect(within(definition).getByText(shortcut!)).toBeInTheDocument();
  }
  expect(screen.getByText("Ctrl K")).toBeInTheDocument();
  expect(screen.getByText("Ctrl Shift N")).toBeInTheDocument();
  expect(screen.getByText("Ctrl Shift D")).toBeInTheDocument();
  expect(screen.getByText("Ctrl Shift P")).toBeInTheDocument();
  expect(screen.getByText("Ctrl F")).toBeInTheDocument();
  expect(screen.getByText("F3 / Shift F3")).toBeInTheDocument();
  expect(screen.getByText("[[")).toBeInTheDocument();
  expect(
    screen.getByText("Complete a note or heading link"),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/switch to Edit to search the whole note/),
  ).toBeInTheDocument();
  await waitFor(() => expect(listFonts).toHaveBeenCalledOnce());
});

it("shares in-flight font discovery after closing and reopening settings", async () => {
  const { SettingsDialog, listFonts } = await settings();
  let resolve!: (families: string[]) => void;
  listFonts.mockReturnValue(
    new Promise<string[]>((done) => {
      resolve = done;
    }),
  );
  function Harness() {
    const [open, setOpen] = useState(true);
    return open ? (
      <SettingsDialog onClose={() => setOpen(false)} />
    ) : (
      <button onClick={() => setOpen(true)}>Open settings</button>
    );
  }
  const user = userEvent.setup();
  render(<Harness />);
  expect(screen.getByRole("button", { name: "UI font family" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Open settings" }));
  expect(listFonts).toHaveBeenCalledOnce();
  await act(async () =>
    resolve(["Installed Hebrew Font", "Installed Mono Font"]),
  );
  expect(screen.getByRole("button", { name: "UI font family" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "UI font family" }));
  expect(
    screen.getByRole("menuitemradio", { name: "Installed Hebrew Font" }),
  ).toBeInTheDocument();
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await user.click(screen.getByRole("button", { name: "Open settings" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "UI font family" }),
    ).toBeEnabled(),
  );
  expect(listFonts).toHaveBeenCalledOnce();
});

it("allows retry after failed font discovery and populates the actual font picker", async () => {
  const { SettingsDialog, listFonts } = await settings();
  listFonts.mockRejectedValueOnce(new Error("Fontconfig unavailable"));
  listFonts.mockResolvedValueOnce(["Recovered Font"]);
  const user = userEvent.setup();
  render(<SettingsDialog onClose={vi.fn()} />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Fontconfig unavailable",
  );
  await user.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() =>
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
  );
  expect(listFonts).toHaveBeenCalledTimes(2);
  await user.click(screen.getByRole("button", { name: "UI font family" }));
  expect(
    screen.getByRole("menuitemradio", { name: "Recovered Font" }),
  ).toBeInTheDocument();
});
