export function Table({ columns, rows, rowKey = "id", empty, onRowClick, caption = "Records", minWidth }) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const columnCount = columns.length + (onRowClick ? 1 : 0);
  return (
    <div className="max-w-full overflow-x-auto" role="region" aria-label={caption} tabIndex={0}>
      <table className="w-full text-left" style={{ minWidth: minWidth ?? (columnCount >= 6 ? 760 : columnCount === 5 ? 640 : 360) }}>
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-surface-container-low">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={`h-table-row-dense px-space-base py-space-sm font-label-sm text-label-sm text-on-surface-variant font-semibold border-b border-outline-variant ${column.align === "right" ? "text-right" : ""}`}
              >
                {column.header}
              </th>
            ))}
            {onRowClick ? <th scope="col" className="w-20 px-space-base border-b border-outline-variant"><span className="sr-only">Actions</span></th> : null}
          </tr>
        </thead>
        <tbody>
          {safeRows.length === 0 ? (
            <tr>
              <td colSpan={columnCount} className="px-space-base py-space-3xl">
                {empty}
              </td>
            </tr>
          ) : (
            safeRows.map((row, index) => (
              <tr
                key={row?.[rowKey] ?? `row-${index}`}
                onClick={onRowClick ? (event) => {
                  if (!event.target.closest("a,button,input,select,textarea")) onRowClick(row);
                } : undefined}
                className={`h-table-row-default border-b border-outline-variant last:border-0 hover:bg-surface ${onRowClick ? "cursor-pointer" : ""}`}
              >
                {columns.map((column) => (
                  <td key={column.key} className={`px-space-base py-space-sm font-body-sm text-body-sm text-on-surface [overflow-wrap:anywhere] ${column.align === "right" ? "text-right tabular-nums" : ""}`}>
                    {column.render ? column.render(row) : row[column.key]}
                  </td>
                ))}
                {onRowClick ? <td className="px-space-base py-space-xs text-right"><button type="button" onClick={() => onRowClick(row)} aria-label={`View ${row.name || row.sku || `record ${row?.[rowKey] ?? index + 1}`}`} className="min-h-9 rounded px-space-sm text-sm font-medium text-secondary hover:bg-primary-container active:bg-primary-fixed">View</button></td> : null}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
