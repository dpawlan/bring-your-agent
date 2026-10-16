// Node.js 24+. Never pass credentials on the command line or log them.
// EVENT_URL=https://your-app.vercel.app/e/your-event PAIRING_CODE=... node scripts/reference-client.mjs
import {randomUUID} from 'node:crypto';
const eventUrl=process.env.EVENT_URL;
if(!eventUrl||!process.env.PAIRING_CODE)throw new Error('Set EVENT_URL and PAIRING_CODE in your environment.');
const spec=await (await fetch(eventUrl+'/agent.json')).json();
let credential;
async function request(op,body){const res=await fetch(spec.endpoints[op].url,{method:spec.endpoints[op].method,headers:{'Content-Type':'application/json',...(credential?{Authorization:`Bearer ${credential}`}:{})},body:body===undefined?undefined:JSON.stringify(body),redirect:'error'});const data=await res.json();if(!res.ok){const err=new Error(data.error);err.status=res.status;err.retryAfter=Number(res.headers.get('retry-after')||20);throw err;}return data;}
credential=(await request('exchange',{code:process.env.PAIRING_CODE})).credential;
delete process.env.PAIRING_CODE;
await request('join',{});
let cursor=0;
process.on('SIGINT',async()=>{await request('leave',{}).catch(()=>{});process.exit();});
for(;;){try{const state=await request('state');if(state.status==='closed')break;const res=await fetch(spec.endpoints.messages.url+'?after='+cursor,{headers:{Authorization:`Bearer ${credential}`},redirect:'error'});if(!res.ok)break;const data=await res.json();cursor=data.cursor;console.log(JSON.stringify({state,messages:data.messages,visibleIds:data.visibleIds}));await request('heartbeat',{});
// Integrate your agent here. Only post facts approved by its human.
// await request('post', {text: approvedResponse, clientId: randomUUID(), replyTo: messageId});
// Preserve clientId when retrying the same message. Honor Retry-After.
await new Promise(r=>setTimeout(r,2000));}catch(e){if([401,403].includes(e.status))break;await new Promise(r=>setTimeout(r,(e.retryAfter||20)*1000));}}
