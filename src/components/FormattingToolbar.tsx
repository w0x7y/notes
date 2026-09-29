import {
  Bold,
  Italic,
  Strikethrough,
  Heading2,
  List,
  ListTodo,
  Quote,
  Link,
  Code,
  Table2,
  Sigma,
} from "lucide-react";
import type { Format } from "../editor/CodeEditor";

const commands = [
  { format: "heading", label: "Heading", Icon: Heading2 },
  { format: "bold", label: "Bold (Ctrl+B)", Icon: Bold },
  { format: "italic", label: "Italic (Ctrl+I)", Icon: Italic },
  { format: "strike", label: "Strikethrough", Icon: Strikethrough },
  { format: "list", label: "Bullet list", Icon: List },
  { format: "task", label: "Task list", Icon: ListTodo },
  { format: "quote", label: "Quote", Icon: Quote },
  { format: "link", label: "Link", Icon: Link },
  { format: "code", label: "Inline code", Icon: Code },
  { format: "table", label: "Table", Icon: Table2 },
  { format: "math", label: "Math equation", Icon: Sigma },
] satisfies { format: Format; label: string; Icon: typeof Bold }[];

export function FormattingToolbar({
  onFormat,
}: {
  onFormat: (format: Format) => void;
}) {
  return (
    <div
      className="formatting-toolbar"
      role="toolbar"
      aria-label="Markdown formatting"
    >
      {commands.map(({ format, label, Icon }) => (
        <button
          key={format}
          className="icon-button"
          title={label}
          aria-label={label}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onFormat(format)}
        >
          <Icon size={16} />
        </button>
      ))}
    </div>
  );
}
