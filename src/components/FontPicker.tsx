import { MenuButton } from "./PopupMenu";
import { fontOptions } from "./font-options";

export function FontPicker({
  label,
  value,
  families,
  fallback,
  loading,
  onChange,
}: {
  label: string;
  value: string;
  families: string[];
  fallback: "mono" | "sans";
  loading: boolean;
  onChange: (value: string) => void;
}) {
  const options = fontOptions(families, value, fallback);
  const selected = options.find((option) => option.value === value)!;
  return (
    <MenuButton
      label={label}
      className="font-picker"
      disabled={loading}
      menuClassName="font-picker-menu"
      actions={options.map((option) => ({
        id: `font:${option.value}`,
        label: option.label,
        fontFamily: option.fontFamily,
        selected: option.value === value,
        onSelect: () => onChange(option.value),
      }))}
    >
      <span style={{ fontFamily: selected.fontFamily }}>
        {loading ? "Loading fonts…" : selected.label}
      </span>
    </MenuButton>
  );
}
