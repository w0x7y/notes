import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { TabBar, tabId, tabPanelId } from "./TabBar";

const originalPaths = ["First.md", "Second.md", "שלישי.md"];
function Harness({ onClose = () => {} }: { onClose?: (path: string) => void }) {
  const [paths, setPaths] = useState(originalPaths);
  const [active, setActive] = useState(originalPaths[0] ?? null);
  return (
    <>
      <TabBar
        workspaceId="work"
        paths={paths}
        focusedPath={active}
        entries={[]}
        appearances={{}}
        onOpen={setActive}
        onClose={(path) => {
          onClose(path);
          setPaths((previous) => previous.filter((item) => item !== path));
          if (active === path)
            setActive(
              paths[paths.indexOf(path) + 1] ??
                paths[paths.indexOf(path) - 1] ??
                null,
            );
        }}
        leading={null}
        actions={null}
      />
      {paths.map((path) => (
        <section
          key={path}
          role="tabpanel"
          hidden={path !== active}
          id={tabPanelId("work", path)}
          aria-labelledby={tabId("work", path)}
        />
      ))}
    </>
  );
}

it("uses one keyboard stop and links every tab to its named panel", () => {
  render(<Harness />);
  const tabs = screen.getAllByRole("tab");
  expect(tabs.map((tab) => tab.getAttribute("aria-label"))).toEqual(
    originalPaths,
  );
  expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
  expect(screen.getByRole("tablist").children).toHaveLength(3);
  for (const tab of tabs) {
    expect(tab.parentElement).toBe(screen.getByRole("tablist"));
    const panel = document.getElementById(
      tab.getAttribute("aria-controls") ?? "",
    );
    expect(panel?.getAttribute("role")).toBe("tabpanel");
    expect(panel?.getAttribute("aria-labelledby")).toBe(tab.id);
  }
});

it("selects and focuses tabs with arrows, Home and End, including wraparound", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  await user.tab();
  expect(screen.getByRole("tab", { name: "First.md" })).toHaveFocus();
  await user.keyboard("{ArrowLeft}");
  expect(screen.getByRole("tab", { name: "שלישי.md" })).toHaveFocus();
  expect(screen.getByRole("tab", { selected: true })).toHaveAccessibleName(
    "שלישי.md",
  );
  await user.keyboard("{Home}{ArrowRight}");
  expect(screen.getByRole("tab", { name: "Second.md" })).toHaveFocus();
  await user.keyboard("{End}{ArrowRight}");
  expect(screen.getByRole("tab", { name: "First.md" })).toHaveFocus();
});

it("closes with Delete and restores focus to the remaining neighbor", async () => {
  const user = userEvent.setup();
  const closed = vi.fn();
  render(<Harness onClose={closed} />);
  await user.tab();
  await user.keyboard("{Delete}");
  expect(closed).toHaveBeenCalledWith("First.md");
  expect(
    screen.queryByRole("tab", { name: "First.md" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Second.md" })).toHaveFocus();
});

it("routes pointer close and middle click through the same save-before-close callback", () => {
  const closed = vi.fn();
  render(<Harness onClose={closed} />);
  fireEvent.click(screen.getByRole("button", { name: "Close First.md" }));
  fireEvent(
    screen.getByRole("tab", { name: "Second.md" }),
    new MouseEvent("auxclick", { bubbles: true, button: 1 }),
  );
  expect(closed.mock.calls).toEqual([["First.md"], ["Second.md"]]);
});
