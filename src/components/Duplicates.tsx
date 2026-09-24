/* Duplicate-line notices for the quote editor: a standing banner over the
   items table, and a prompt when catalog picks match lines already there. */

import type { DuplicateGroup } from "@shared/duplicates";
import { Modal } from "./Modal";
import { Icon } from "./Icon";

/** "2 produk muncul lebih dari sekali", naming possible matches separately. */
const headline = (groups: DuplicateGroup[], tail: string) => {
  const exact = groups.filter((g) => !g.nameOnly).length;
  const maybe = groups.length - exact;
  return [exact && `${exact} produk ${tail}`, maybe && `${maybe} produk kemungkinan ${tail}`]
    .filter(Boolean)
    .join("; ");
};

const lineList = (g: DuplicateGroup, fresh?: Set<string>) =>
  g.lines
    .map((l) => (fresh?.has(l.id) ? `baru (${l.qty} ${l.uom})` : `baris ${l.lineNo} (${l.qty} ${l.uom})`))
    .join(", ");

function GroupRow({ group, fresh }: { group: DuplicateGroup; fresh?: Set<string> }) {
  return (
    <li>
      <strong>{group.name}</strong>
      {group.nameOnly && <span className="badge amber" style={{ marginLeft: 6 }}>kemungkinan</span>}
      {" — "}{lineList(group, fresh)}
      {group.nameOnly && (
        <div className="small">
          Nama sama, tapi ada baris tanpa kode barang. Cek apakah ini produk yang sama; kalau iya,
          hapus salah satu baris dan sesuaikan qty. Tidak digabung otomatis.
        </div>
      )}
      {!group.nameOnly && group.mixedUom && <div className="small">Satuan berbeda: baris dengan satuan lain tidak digabung, cek manual.</div>}
      {group.priceConflict && <div className="small">COGS/plafon/harga manual berbeda: yang dipakai baris pertama.</div>}
    </li>
  );
}

export function DuplicateBanner({
  groups,
  readOnly,
  onMerge,
}: {
  groups: DuplicateGroup[];
  readOnly: boolean;
  onMerge: () => void;
}) {
  if (!groups.length) return null;
  const mergeable = groups.some((g) => g.mergeable);
  return (
    <div className="notice warn dup-banner" role="status">
      <div className="row" style={{ alignItems: "flex-start", gap: 10 }}>
        <Icon name="alert" size={15} />
        <div className="grow">
          <div style={{ fontWeight: 600 }}>
            {headline(groups, "muncul lebih dari sekali")} di quotation ini
          </div>
          <ul className="dup-list">
            {groups.map((g) => <GroupRow key={g.key} group={g} />)}
          </ul>
        </div>
        {mergeable && !readOnly && (
          <button className="btn small" onClick={onMerge}>Gabungkan duplikat</button>
        )}
      </div>
    </div>
  );
}

export function DuplicateAddModal({
  groups,
  incomingIds,
  onMerge,
  onAddSeparate,
  onClose,
}: {
  groups: DuplicateGroup[];
  incomingIds: Set<string>;
  onMerge: () => void;
  onAddSeparate: () => void;
  onClose: () => void;
}) {
  const mergeable = groups.some((g) => g.mergeable);
  return (
    <Modal
      title="Produk sudah ada di quotation"
      sub={`Dari item yang kamu pilih, ${headline(groups, "sudah ada")} sebagai baris di quotation ini.`}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Batal</button>
          <button className={mergeable ? "btn" : "btn primary"} onClick={onAddSeparate}>
            Tambah sebagai baris terpisah
          </button>
          {mergeable && (
            <button className="btn primary" onClick={onMerge}>Gabungkan qty</button>
          )}
        </>
      }
    >
      <ul className="dup-list">
        {groups.map((g) => <GroupRow key={g.key} group={g} fresh={incomingIds} />)}
      </ul>
      <p className="muted small" style={{ marginTop: 12 }}>
        {mergeable
          ? "Gabungkan menjumlahkan qty ke baris yang sudah ada; COGS, plafon, peran, dan harga manual baris itu tidak berubah. "
          : ""}
        Item lain yang kamu pilih tetap ditambahkan seperti biasa.
      </p>
    </Modal>
  );
}
