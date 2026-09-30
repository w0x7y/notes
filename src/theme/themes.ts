import type { Preferences } from "../domain/preferences";

export type ThemeId = Preferences["theme"];
type ThemeColors = {
  editor: string;
  sidebar: string;
  text: string;
  bright: string;
  muted: string;
  border: string;
  "border-strong": string;
  selection: string;
  hover: string;
  accent: string;
  "accent-soft": string;
  "accent-hover": string;
  "accent-ink": string;
  success: string;
  warning: string;
  danger: string;
  "warning-soft": string;
  "danger-soft": string;
  "syntax-heading": string;
  "syntax-keyword": string;
  "syntax-string": string;
  "syntax-number": string;
  "syntax-comment": string;
  "syntax-link": string;
  "syntax-meta": string;
};
export type Theme = { name: string; description: string; colors: ThemeColors };

function colors(
  base: Pick<
    ThemeColors,
    | "editor"
    | "sidebar"
    | "text"
    | "bright"
    | "muted"
    | "border"
    | "border-strong"
    | "selection"
    | "hover"
    | "accent"
    | "accent-hover"
  >,
  syntax: Partial<ThemeColors> = {},
): ThemeColors {
  return {
    ...base,
    "accent-soft": base.selection,
    "accent-ink": base.sidebar,
    success: "#A6C69F",
    warning: "#E8C17E",
    danger: "#EB9994",
    "warning-soft": "#332D22",
    "danger-soft": "#352624",
    "syntax-heading": base.accent,
    "syntax-keyword": base.accent,
    "syntax-string": "#A6C69F",
    "syntax-number": "#D5AB92",
    "syntax-comment": base.muted,
    "syntax-link": base.accent,
    "syntax-meta": base.muted,
    ...syntax,
  };
}

export const themes = {
  "graphite-amber": {
    name: "Graphite + amber",
    description: "Warm graphite, amber ink. The Notes signature.",
    colors: colors({
      sidebar: "#191816",
      editor: "#23211F",
      text: "#CEC8BE",
      bright: "#E8E1D5",
      muted: "#AAA295",
      border: "#302D28",
      "border-strong": "#514A3E",
      selection: "#373027",
      hover: "#302B24",
      accent: "#E7B76E",
      "accent-hover": "#F0C787",
    }),
  },
  "ink-jade": {
    name: "Ink + jade",
    description: "Deep ink with a clear jade accent.",
    colors: colors(
      {
        sidebar: "#161D1B",
        editor: "#202925",
        text: "#CBD9D0",
        bright: "#E2EBE5",
        muted: "#A2B6AA",
        border: "#2E3932",
        "border-strong": "#495C50",
        selection: "#2A3C34",
        hover: "#29362F",
        accent: "#6DC8A7",
        "accent-hover": "#8BD8BB",
      },
      {
        "syntax-number": "#D9BE8A",
        "warning-soft": "#332F23",
        "danger-soft": "#362628",
      },
    ),
  },
  "midnight-ice": {
    name: "Midnight + ice",
    description: "Midnight navy with cool ice blue.",
    colors: colors(
      {
        sidebar: "#151C2A",
        editor: "#1D2737",
        text: "#CAD5E4",
        bright: "#E2EAF4",
        muted: "#A2B2C8",
        border: "#2B3648",
        "border-strong": "#46556D",
        selection: "#2B3B50",
        hover: "#293548",
        accent: "#81B9E7",
        "accent-hover": "#A0CEF1",
      },
      {
        "syntax-keyword": "#B8ADDF",
        "syntax-number": "#D6B48A",
        "warning-soft": "#332F29",
        "danger-soft": "#362B32",
      },
    ),
  },
  "charcoal-coral": {
    name: "Charcoal + coral",
    description: "Soft charcoal with warm coral.",
    colors: colors(
      {
        sidebar: "#1E1A1D",
        editor: "#282325",
        text: "#DDCBC7",
        bright: "#F0E2DF",
        muted: "#C0A8A4",
        border: "#3B3031",
        "border-strong": "#61484A",
        selection: "#44302D",
        hover: "#392C2C",
        accent: "#EE947F",
        "accent-hover": "#F5AF9F",
      },
      {
        danger: "#F0B0B5",
        "syntax-number": "#E5C88E",
        "danger-soft": "#3E2630",
      },
    ),
  },
  "forest-moss": {
    name: "Forest + moss",
    description: "Dark forest and a muted moss accent.",
    colors: colors(
      {
        sidebar: "#191E18",
        editor: "#232820",
        text: "#CFD7C5",
        bright: "#E8EBDF",
        muted: "#ADB89F",
        border: "#323A2B",
        "border-strong": "#515E43",
        selection: "#343D29",
        hover: "#2D3426",
        accent: "#B7C979",
        "accent-hover": "#CDDA98",
      },
      {
        success: "#8CC7B6",
        "syntax-string": "#8CC7B6",
        "syntax-number": "#D5B18D",
      },
    ),
  },
  "one-dark-pro": {
    name: "One Dark Pro",
    description: "The original Notes palette.",
    colors: colors(
      {
        sidebar: "#21252B",
        editor: "#282C34",
        text: "#ABB2BF",
        bright: "#D7DAE0",
        muted: "#A0A8B7",
        border: "#181A1F",
        "border-strong": "#4B5263",
        selection: "#2C313A",
        hover: "#323842",
        accent: "#61AFEF",
        "accent-hover": "#7FC0F5",
      },
      {
        success: "#98C379",
        warning: "#E5C07B",
        danger: "#E06C75",
        "syntax-heading": "#E06C75",
        "syntax-keyword": "#C678DD",
        "syntax-string": "#98C379",
        "syntax-number": "#D19A66",
        "syntax-comment": "#A0A8B7",
        "syntax-meta": "#C678DD",
        "warning-soft": "#33312C",
        "danger-soft": "#35282E",
      },
    ),
  },
} satisfies Record<ThemeId, Theme>;

/** Update CSS once, keeping editor state and user-authored content intact. */
export function applyTheme(
  id: ThemeId,
  root: HTMLElement = document.documentElement,
): void {
  for (const [token, value] of Object.entries(themes[id].colors))
    root.style.setProperty(`--${token}`, value);
  root.dataset.theme = id;
}
