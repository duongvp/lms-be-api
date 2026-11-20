import * as XLSX from 'xlsx-js-style';
import { json } from './salary-domain';
export const workbook = (sheets: Record<string, any[]>) => {
    const wb = XLSX.utils.book_new();
    for (const [name, rows] of Object.entries(sheets)) {
        const numeric = new Set(['amount', 'base', 'adjustment', 'paid', 'unpaid', 'total', 'actual_seconds', 'scheduled_seconds']);
        const flat = rows.map(r => Object.fromEntries(Object.entries(json(r)).map(([k, v]) => [k, numeric.has(k) && typeof v === 'string' && /^-?\d+(?:\.\d+)?$/.test(v) && Math.abs(Number(v)) < 1e15 ? Number(v) : v && typeof v === 'object' ? JSON.stringify(v) : v])));
        const sheet = XLSX.utils.json_to_sheet(flat);
        // Explicit string cells prevent user text being interpreted as spreadsheet formulas.
        for (const [key, cell] of Object.entries(sheet))
            if (!key.startsWith('!') && typeof (cell as any).v === 'string') {
                delete (cell as any).f;
                (cell as any).t = 's';
            }
        sheet['!cols'] = Object.keys(flat[0] ?? {}).map(() => ({ wch: 24 }));
        XLSX.utils.book_append_sheet(wb, sheet, name.slice(0, 31));
    }
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
};
