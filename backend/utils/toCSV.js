export function convertToCSV(structured) {
  // Very simple CSV: flatten goals & bmps only for demo; can expand.
  const rows = [];
  rows.push('Section,ID,Field1,Field2,Field3');
  for (const g of structured.goals || []) {
    rows.push(['Goal', g.id, g.title.replace(/,/g,' '), g.status, ''].join(','));
  }
  for (const b of structured.bmps || []) {
    rows.push(['BMP', b.id, b.name.replace(/,/g,' '), b.category, ''].join(','));
  }
  return rows.join('\n');
}
