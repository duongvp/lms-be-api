import ApiError from '../../utils/ApiError';
export const fail = (message: string, status = 400): never => { throw new ApiError(message, status); };
export const json = (v: any): any => JSON.parse(JSON.stringify(v, (_, x) => typeof x === 'bigint' ? String(x) : x));
export const text = (v: unknown, label: string, max = 500): string => {
    if (typeof v !== 'string' || !v.trim() || v.trim().length > max)
        return fail(`${label} không hợp lệ`);
    return v.trim();
};
export const id = (v: unknown): bigint => {
    if (!/^[1-9]\d{0,18}$/.test(String(v ?? '')))
        return fail('ID không hợp lệ');
    return BigInt(String(v));
};
export const numberId = (v: unknown): number => { const n = Number(id(v)); if (n > 4294967295)
    return fail('ID vượt giới hạn'); return n; };
export const integer = (v: unknown, label: string, min = 0, max = 100000): number => {
    const n = Number(v);
    if (v == null || v === '' || !Number.isInteger(n) || n < min || n > max)
        return fail(`${label} không hợp lệ`);
    return n;
};
export const choice = <T extends string>(v: unknown, values: readonly T[], label: string): T => values.includes(v as T) ? v as T : fail(`${label} không hợp lệ`);
export const day = (v: unknown): Date => {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v))
        return fail('Ngày phải là YYYY-MM-DD');
    const d = new Date(v + 'T00:00:00.000Z');
    if (!Number.isFinite(+d) || d.toISOString().slice(0, 10) !== v)
        return fail('Ngày không hợp lệ');
    return d;
};
export const page = (q: any) => ({ page: integer(q.page ?? 1, 'Trang', 1, 100000), limit: integer(q.limit ?? 25, 'Số dòng', 1, 100) });
export const paginate = (rows: any[], q: any, allowed: string[], fallback: string) => {
    const p = page(q), sort = choice(q.sort ?? fallback, allowed, 'Cột sắp xếp'), order = choice(q.order ?? 'asc', ['asc', 'desc'], 'Thứ tự');
    rows.sort((a, b) => { const x = a[sort], y = b[sort]; const n = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), 'vi', { numeric: true }); return (order === 'asc' ? n : -n) || String(a.id).localeCompare(String(b.id), undefined, { numeric: true }); });
    return { rows: rows.slice((p.page - 1) * p.limit, p.page * p.limit), pagination: { ...p, total: rows.length } };
};

export const intervalSeconds = (sessions: {start_time: Date; end_time: Date}[]) => {
    const intervals = sessions.map(s => [+s.start_time,+s.end_time]).filter(([a,b]) => Number.isFinite(a) && Number.isFinite(b) && b>a).sort((a,b)=>a[0]-b[0]);
    let total=0, start=0, end=0;
    for (const [a,b] of intervals) { if(a>end) { total+=end-start; start=a; end=b; } else end=Math.max(end,b); }
    return (total+end-start)/1000;
};


/** Strict overlap: touching endpoints are separate schedules. Examples are capped for exports/UI. */
export const scheduleOverlaps = (sessions: {id: number; start_time: Date; end_time: Date}[]) => {
    const sorted = sessions.filter(s => +s.end_time > +s.start_time).sort((a,b) => +a.start_time - +b.start_time || a.id-b.id);
    const ends = sorted.map(s => +s.end_time).sort((a,b) => a-b);
    const bound = (values: number[], value: number, inclusive: boolean) => {
        let lo=0,hi=values.length;
        while(lo<hi){const mid=(lo+hi)>>>1;if(values[mid]<value || (inclusive && values[mid]===value))lo=mid+1;else hi=mid;}
        return lo;
    };
    const starts=sorted.map(s=>+s.start_time),maxEnd:number[]=[];
    const build=(node:number,lo:number,hi:number):number => maxEnd[node]=hi-lo===1?+sorted[lo].end_time:Math.max(build(node*2,lo,(lo+hi)>>>1),build(node*2+1,(lo+hi)>>>1,hi));
    if(sorted.length)build(1,0,sorted.length);
    return new Map(sorted.map(s=>{
        const limit=bound(starts,+s.end_time,false),count=limit-bound(ends,+s.start_time,true)-1,calendar_ids:number[]=[];
        const visit=(node:number,lo:number,hi:number)=>{
            if(lo>=limit || maxEnd[node]<=+s.start_time || calendar_ids.length>=5)return;
            if(hi-lo===1){if(sorted[lo].id!==s.id)calendar_ids.push(sorted[lo].id);return;}
            const mid=(lo+hi)>>>1;visit(node*2,lo,mid);visit(node*2+1,mid,hi);
        };
        if(count>0)visit(1,0,sorted.length);
        return [s.id,{count,calendar_ids}] as const;
    }));
};
