/* The unit cell shared by the quote's items table and the catalog picker, so
   both read the same: a data-entry `cell` select like Role, and — when a
   switch couldn't be converted — an amber badge under it, the same way the
   scenario columns show "Di plafon" under a price. */

import { Icon } from "./Icon";

export function UomCell({
  value,
  choices,
  label,
  readOnly,
  disabled,
  warning,
  onChange,
  onConfirm,
}: {
  value: string;
  choices: string[];
  /** Accessible name for the select, e.g. "Satuan Pulpen Hitam". */
  label: string;
  readOnly?: boolean;
  disabled?: boolean;
  /** Full explanation shown as the badge tooltip; null hides the badge. */
  warning: string | null;
  onChange: (uom: string) => void;
  /** Marks COGS and RRP as checked for the shown unit. Omit to hide the action. */
  onConfirm?: () => void;
}) {
  return (
    <>
      {readOnly || choices.length === 0 ? (
        <div className="nowrap">{value}</div>
      ) : (
        <select
          className="cell"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
        >
          {choices.map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>
      )}
      {warning && (
        <div className="cell-sub">
          <span className="badge amber uom-flag" title={warning}>Tanpa rasio</span>
          {onConfirm && (
            <button
              type="button"
              className="icon-btn xs"
              onClick={onConfirm}
              aria-label="Sudah dicek"
              title={`Sudah dicek: COGS dan RRP benar per ${value}`}
            >
              <Icon name="check" size={13} />
            </button>
          )}
        </div>
      )}
    </>
  );
}
