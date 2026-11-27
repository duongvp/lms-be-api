import assert from 'node:assert/strict';

// Existing service unit fixtures model only their business tables. Add the
// infrastructure lock query while preserving every existing business stub.
export function withCalendarMutexMock<T extends object>(client:T):T {
  return new Proxy(client,{
    get(target:any,property){
      if(property==='$queryRaw') return async(query:any,...values:any[])=>{
        const text=typeof query==='string'?query:Array.isArray(query)?query.join('?'):query.sql;
        if(text.includes('calendar_approval_mutex')) {assert.match(text,/FOR UPDATE/);return [{id:1}];}
        if(typeof target.$queryRaw!=='function') throw new Error('Unexpected raw query in calendar fixture: '+text);
        return target.$queryRaw(query,...values);
      };
      return target[property];
    },
  });
}
