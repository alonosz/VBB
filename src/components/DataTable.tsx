interface DataTableProps {
  headers: string[];
  rows: Record<string, string>[];
  maxRows?: number;
  highlightColumn?: string | null;
}

export function DataTable({ headers, rows, maxRows, highlightColumn }: DataTableProps) {
  const shown = maxRows ? rows.slice(0, maxRows) : rows;

  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
      <table className="w-full min-w-max border-collapse text-left text-sm">
        <thead>
          <tr className="bg-[#f8f8fc]">
            {headers.map((h) => (
              <th
                key={h}
                className={
                  "whitespace-nowrap border-b border-[var(--border)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[#6b6d85] " +
                  (h === highlightColumn ? "bg-[var(--primary-soft)] text-[var(--primary)]" : "")
                }
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, i) => (
            <tr
              key={i}
              className="border-b border-[var(--border)] last:border-0 even:bg-[#fbfbfd]"
            >
              {headers.map((h) => (
                <td
                  key={h}
                  className={
                    "max-w-[220px] truncate whitespace-nowrap px-3 py-2 text-[#33344a] " +
                    (h === highlightColumn ? "bg-[var(--primary-soft)]/40" : "")
                  }
                  title={row[h]}
                >
                  {row[h] || <span className="text-[#c7c8d6]">—</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
