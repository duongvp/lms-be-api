import { AsyncLocalStorage } from 'node:async_hooks';
import { Prisma } from '@prisma/client';
import basePrisma from './prisma';

// Calendar operations invoked by approve share its transaction. Unrelated modules
// keep using the normal Prisma client; no global transaction monkey patch.
const context = new AsyncLocalStorage<Prisma.TransactionClient>();
export const currentCalendarTransaction=()=>context.getStore();
export const inCalendarTransaction = <T>(tx: Prisma.TransactionClient, work: () => Promise<T>) => context.run(tx, work);
export async function runCalendarWrite<T>(work:()=>Promise<T>, options?:any):Promise<T> {
  if(context.getStore()) return work();
  return basePrisma.$transaction(async tx=>{
    const lock=await tx.$queryRaw<any[]>`SELECT id FROM calendar_approval_mutex WHERE id=1 FOR UPDATE`;
    if(lock.length!==1) throw new Error("Thiếu khóa giao dịch lịch. Kiểm tra migration workflow.");
    return inCalendarTransaction(tx,work);
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,maxWait:15_000,timeout:180_000,...options});
}
const calendarPrisma = new Proxy(basePrisma, {
  get(target, property) {
    const tx = context.getStore();
    if (property === '$transaction') return async (work: any, options?:any) => {
      if (typeof work !== 'function') throw new Error('Calendar transaction requires callback form');
      return tx ? work(tx) : runCalendarWrite(()=>work(context.getStore()!),options);
    };
    const owner: any = tx || target;
    const value = owner[property];
    return typeof value === 'function' ? value.bind(owner) : value;
  },
});
export default calendarPrisma;

// Only the outer user command publishes an official-change activity. Nested
// commands and approval applies are already inside a transaction and publish
// their own single workflow result instead.
type WriteObserver=(tx:Prisma.TransactionClient,action:string,actor:any,before:any[],after:any[],payload:any)=>Promise<void>;
let writeObserver:WriteObserver|undefined;
export const setCalendarWriteObserver=(observer:WriteObserver)=>{writeObserver=observer;};
export function runObservedCalendarWrite<T>(action:string,args:any[],work:()=>Promise<T>):Promise<T> {
  if(context.getStore()) return work();
  return runCalendarWrite(async()=>{
    const tx=context.getStore()!;
    const actor=[...args].reverse().find(arg=>arg&&typeof arg==='object'&&Number.isInteger(arg.userId)&&typeof arg.username==='string');
    const first=args[0];
    const ids=typeof first==='number'?[first]:Array.isArray(first?.ids)?first.ids.map(Number):first?.first_id?[Number(first.first_id),Number(first.second_id)]:Array.isArray(first?.updates)?first.updates.map((v:any)=>Number(v.id)):[];
    const validIds=[...new Set<number>(ids.filter((id:number)=>Number.isInteger(id)&&id>0))];
    let before=actor&&validIds.length?await tx.$queryRaw<any[]>(Prisma.sql`SELECT * FROM calendar WHERE id IN (${Prisma.join(validIds)}) ORDER BY id`):[];
    if(before.length===1&&action==='rescheduleSession'&&(args[1]?.mode||args[1]?.update_mode)==='following') {
      const source=before[0];
      before=await tx.$queryRaw<any[]>`SELECT * FROM calendar WHERE code=${source.code} AND system_type=${source.system_type} AND deleted_at IS NULL AND start_time>=${source.start_time} ORDER BY start_time,id`;
    }
    const result=await work();
    if(actor&&writeObserver) {
      const records=new Map<number,any>();
      const collect=(value:any)=>{if(!value||typeof value!=='object')return;if(value.id&&value.code&&value.start_time)records.set(Number(value.id),value);if(Array.isArray(value))value.forEach(collect);else Object.values(value).forEach(collect);};
      collect(result);
      if(!records.size&&validIds.length) {const rows=await tx.$queryRaw<any[]>(Prisma.sql`SELECT * FROM calendar WHERE id IN (${Prisma.join(validIds)}) ORDER BY id`);rows.forEach(row=>records.set(Number(row.id),row));}
      if(before.length||records.size) await writeObserver(tx,action,actor,before.filter(row=>records.has(Number(row.id))),[...records.values()],typeof first==='number'?args[1]:first);
    }
    return result;
  });
}
