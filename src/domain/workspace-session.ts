import type { Session } from "./contracts";

export type Pane = "primary" | "secondary";

export type SessionAction =
  | { kind: "open"; path: string; pane?: Pane }
  | { kind: "open-split"; path: string }
  | { kind: "close"; path: string }
  | { kind: "toggle-split" }
  | { kind: "focus"; pane: Pane }
  | { kind: "cycle"; backward?: boolean }
  | { kind: "remap"; mapPath: (path: string) => string };

export function emptySession(): Session {
  return { tabs: [], primary: null, secondary: null, split: false };
}

export function normalizeSession(session: Session): Session {
  const tabs = [...new Set(session.tabs)];
  const duplicatePane =
    session.split &&
    session.secondary !== null &&
    session.secondary === session.primary;
  return !duplicatePane && tabs.length === session.tabs.length
    ? session
    : { ...session, tabs, secondary: duplicatePane ? null : session.secondary };
}

export function sessionFocusedPath(
  session: Session,
  focusedPane: Pane,
): string | null {
  return session[session.split ? focusedPane : "primary"];
}

export function transitionSession(
  input: Session,
  focusedPane: Pane,
  action: SessionAction,
): { session: Session; focusedPane: Pane } {
  const session = normalizeSession(input);
  const focus = session.split ? focusedPane : "primary";
  switch (action.kind) {
    case "open": {
      const target =
        session.primary === action.path
          ? "primary"
          : session.split && session.secondary === action.path
            ? "secondary"
            : (action.pane ?? focus);
      return {
        session: {
          ...session,
          tabs: session.tabs.includes(action.path)
            ? session.tabs
            : [...session.tabs, action.path],
          [target]: action.path,
          split: session.split || target === "secondary",
        },
        focusedPane: target,
      };
    }
    case "open-split": {
      const current = sessionFocusedPath(session, focus);
      const primary =
        current === action.path
          ? (session.tabs.find((path) => path !== action.path) ?? null)
          : current;
      return {
        session: {
          ...session,
          tabs: session.tabs.includes(action.path)
            ? session.tabs
            : [...session.tabs, action.path],
          primary,
          secondary: action.path,
          split: true,
        },
        focusedPane: "secondary",
      };
    }
    case "close": {
      const tabs = session.tabs.filter((path) => path !== action.path);
      const primary =
        session.primary === action.path
          ? (tabs.find(
              (path) => !session.split || path !== session.secondary,
            ) ?? null)
          : session.primary;
      const secondary =
        session.secondary === action.path
          ? (tabs.find((path) => path !== primary) ?? null)
          : session.secondary;
      return {
        session: { ...session, tabs, primary, secondary },
        focusedPane: focus,
      };
    }
    case "toggle-split": {
      const primary = session.split
        ? (session.primary ?? session.secondary ?? session.tabs[0] ?? null)
        : session.primary;
      const secondary = session.split
        ? session.secondary
        : session.secondary !== null && session.secondary !== session.primary
          ? session.secondary
          : (session.tabs.find((path) => path !== session.primary) ?? null);
      return {
        session: { ...session, primary, secondary, split: !session.split },
        focusedPane: "primary",
      };
    }
    case "focus":
      return {
        session,
        focusedPane: session.split ? action.pane : "primary",
      };
    case "cycle": {
      const index = session.tabs.indexOf(
        sessionFocusedPath(session, focus) ?? "",
      );
      const next =
        index < 0
          ? action.backward
            ? session.tabs.length - 1
            : 0
          : (index + (action.backward ? -1 : 1) + session.tabs.length) %
            session.tabs.length;
      const path = session.tabs[next];
      return path === undefined
        ? { session, focusedPane: focus }
        : transitionSession(session, focus, { kind: "open", path });
    }
    case "remap": {
      const primary =
        session.primary === null ? null : action.mapPath(session.primary);
      const secondary =
        session.secondary === null ? null : action.mapPath(session.secondary);
      const sameVisiblePath =
        session.split && secondary !== null && secondary === primary;
      return {
        session: {
          ...session,
          tabs: [...new Set(session.tabs.map(action.mapPath))],
          primary,
          secondary: sameVisiblePath ? null : secondary,
        },
        focusedPane: sameVisiblePath ? "primary" : focus,
      };
    }
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}
