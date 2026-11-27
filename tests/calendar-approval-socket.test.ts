import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {io as connect} from 'socket.io-client';
import prisma from '../src/lib/prisma';
import {attachCalendarApprovalSocket,CALENDAR_WORKFLOW_SOCKET_EVENT,CALENDAR_WORKFLOW_SOCKET_NAMESPACE} from '../src/modules/calendar-approvals/calendar-approval.socket';
const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function until(fn:()=>boolean){for(let i=0;i<100;i++){if(fn())return;await pause(10);}throw Error('Socket condition not reached');}
test('workflow socket targets individual recipients, read sync and out-of-order committed rows',async()=>{
 const http=createServer();const original=prisma.$queryRaw;
 const state:Record<number,{total:bigint;unread:bigint;latest:bigint|null}>={1:{total:0n,unread:0n,latest:null},2:{total:0n,unread:0n,latest:null}};
 (prisma as any).$queryRaw=async(_query:any,userId:number)=>[state[userId]];
 const realtime=attachCalendarApprovalSocket(http,{authenticate:async token=>{if(!['1','2'].includes(token))throw Error('Denied');return {expiresAt:Date.now()+60000,userId:Number(token),workflowAccess:true};},intervalMs:10});
 await new Promise<void>(r=>http.listen(0,'127.0.0.1',r));
 const url=`http://127.0.0.1:${(http.address() as any).port}${CALENDAR_WORKFLOW_SOCKET_NAMESPACE}`;
 const one=connect(url,{auth:{token:'1'},autoConnect:false,transports:['websocket']}),two=connect(url,{auth:{token:'2'},autoConnect:false,transports:['websocket']});
 let first=0,second=0;
 one.on(CALENDAR_WORKFLOW_SOCKET_EVENT,(...args:any[])=>{assert.deepEqual(args,[]);first++;});
 two.on(CALENDAR_WORKFLOW_SOCKET_EVENT,(...args:any[])=>{assert.deepEqual(args,[]);second++;});
 try{
  one.connect();two.connect();await until(()=>first===1&&second===1);
  state[1]={total:1n,unread:1n,latest:9n};await until(()=>first===2);await pause(40);assert.equal(second,1);
  state[1]={total:2n,unread:2n,latest:9n};await until(()=>first===3);assert.equal(second,1,'an earlier ID committing later must still invalidate only its recipient');
  state[1].unread=0n;await until(()=>first===4);
  const denied=connect(url,{auth:{token:'invalid'},autoConnect:false,transports:['websocket'],reconnection:false});
  try {const error=new Promise(r=>denied.once('connect_error',r));denied.connect();await error;assert.equal(denied.connected,false);}finally{denied.disconnect();}
 }finally{one.disconnect();two.disconnect();await new Promise<void>(r=>realtime.io.close(()=>r()));prisma.$queryRaw=original;}
});


test('expired LMS notification socket is disconnected without further requests',async()=>{
 const http=createServer();
 const realtime=attachCalendarApprovalSocket(http,{authenticate:async()=>({expiresAt:Date.now()+200,userId:1,workflowAccess:true}),intervalMs:60000});
 await new Promise<void>(r=>http.listen(0,'127.0.0.1',r));
 const client=connect(`http://127.0.0.1:${(http.address() as any).port}${CALENDAR_WORKFLOW_SOCKET_NAMESPACE}`,{auth:{token:'short-lived'},autoConnect:false,transports:['websocket'],reconnection:false});
 try {const disconnected=new Promise(r=>client.once('disconnect',r));client.connect();await disconnected;assert.equal(client.connected,false);}
 finally{client.disconnect();await new Promise<void>(r=>realtime.io.close(()=>r()));}
});
