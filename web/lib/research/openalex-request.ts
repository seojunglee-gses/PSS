import {createHash,randomUUID} from 'node:crypto';
export const OPENALEX_BUSY_MESSAGE='연구논문 검색 요청이 많아 잠시 제한되었습니다. 잠시 후 다시 시도해 주세요.';
const BUSY=OPENALEX_BUSY_MESSAGE;
const CONNECTION='연구논문 검색에 연결하지 못했거나 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.';
const sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
const setting=(name:string,fallback:number,min:number,max:number)=>{const n=Number(process.env[name]);return Number.isFinite(n)&&n>=min&&n<=max?n:fallback};
export const openAlexPolicy=()=>({concurrency:Math.floor(setting('OPENALEX_MAX_CONCURRENT',2,1,8)),interval:setting('OPENALEX_MIN_INTERVAL_MS',350,100,60000),budget:setting('OPENALEX_REQUEST_BUDGET_MS',30000,1000,60000)});
let active=0,nextStart=0,cooldown=0;
const queue:(()=>void)[]=[];
let alarm:ReturnType<typeof setTimeout>|undefined;
function pump(){
 if(alarm){clearTimeout(alarm);alarm=undefined;}
 if(!queue.length||active>=openAlexPolicy().concurrency)return;
 const wait=Math.max(nextStart,cooldown)-Date.now();
 if(wait>0){alarm=setTimeout(pump,Math.min(wait,60000));return;}
 active++;nextStart=Date.now()+openAlexPolicy().interval;queue.shift()!();pump();
}
async function localSlot(deadline:number):Promise<()=>void>{
 if(queue.length>=100){openAlexDiagnostic({event:'queue_rejected',failureType:'queue_full'});throw Error(BUSY);}
 return new Promise((resolve,reject)=>{
  const admit=()=>{clearTimeout(timer);resolve(()=>{active--;pump()})};
  const timer=setTimeout(()=>{const i=queue.indexOf(admit);if(i>=0){queue.splice(i,1);openAlexDiagnostic({event:'queue_rejected',failureType:'queue_timeout'});reject(Error(BUSY));pump()}},Math.max(0,deadline-Date.now()));
  queue.push(admit);pump();
 });
}
export function retryAfterMs(value:string|null,now=Date.now()):number|undefined{
 if(!value)return;
 if(/^\d+(?:\.\d+)?$/.test(value.trim()))return Number.isFinite(Number(value)*1000)?Number(value)*1000:undefined;
 const date=Date.parse(value);if(Number.isFinite(date))return Math.max(0,date-now);
}
export function retryDelayMs(value:string|null,attempt:number,random= Math.random):number{return retryAfterMs(value)??500*2**attempt+Math.floor(random()*250);}
function sharedConfig(){
 const url=process.env.OPENALEX_REDIS_REST_URL,token=process.env.OPENALEX_REDIS_REST_TOKEN;
 if(!url&&!token)return;
 if(!url||!token)throw Error(BUSY);
 try{const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.search||parsed.hash)throw Error();}catch{throw Error(BUSY)}
 return {url,token};
}
async function redis(command:unknown[],config:{url:string;token:string}){
 const response=await fetch(config.url,{method:'POST',headers:{Authorization:`Bearer ${config.token}`,'Content-Type':'application/json'},body:JSON.stringify(command),signal:AbortSignal.timeout(2000)});
 if(!response.ok)throw Error(BUSY);
 const data=await response.json();if(data.error)throw Error(BUSY);return data.result;
}
// Redis TIME avoids instance clock skew; leases bound concurrency after a crashed worker.
const ADMIT=`local t=redis.call('TIME');local now=t[1]*1000+math.floor(t[2]/1000);redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',now);local next=tonumber(redis.call('GET',KEYS[2]) or '0');if next>now then return next-now end;if redis.call('ZCARD',KEYS[1])>=tonumber(ARGV[2]) then return 100 end;redis.call('ZADD',KEYS[1],now+15000,ARGV[1]);redis.call('PEXPIRE',KEYS[1],20000);redis.call('SET',KEYS[2],now+tonumber(ARGV[3]),'PX',tonumber(ARGV[3])+60000);return 0`;
const COOL=`local t=redis.call('TIME');local untilAt=t[1]*1000+math.floor(t[2]/1000)+tonumber(ARGV[1]);local old=tonumber(redis.call('GET',KEYS[1]) or '0');if untilAt>old then redis.call('SET',KEYS[1],untilAt,'PX',tonumber(ARGV[1])+60000) end;return 0`;
const sharedKeys=()=>{const key=createHash('sha256').update(process.env.OPENALEX_LIMITER_SCOPE??'shared-account').digest('hex').slice(0,24);return [`{ppss-openalex-${key}}:leases`,`{ppss-openalex-${key}}:next`]};
async function sharedSlot(deadline:number,config:ReturnType<typeof sharedConfig>){
 if(!config)return async()=>{};
 const id=randomUUID(),keys=sharedKeys(),policy=openAlexPolicy();
 while(Date.now()<deadline){
  const result=await redis(['EVAL',ADMIT,2,...keys,id,policy.concurrency,policy.interval],config);
  if(typeof result!=='number'||!Number.isFinite(result))throw Error(BUSY);
  const wait=result;
  if(wait===0)return async()=>{await redis(['ZREM',keys[0],id],config)};
  if(!Number.isFinite(wait)||wait<0||wait>=deadline-Date.now())throw Error(BUSY);
  await sleep(Math.min(wait,250));
 }
 throw Error(BUSY);
}
function safeHeaders(response:Response){
 const values:Record<string,string>={};
 for(const name of ['x-request-id','request-id','x-ratelimit-limit','x-ratelimit-remaining','x-ratelimit-reset','retry-after']){
  const value=response.headers.get(name);
  if(value&&![process.env.OPENALEX_API_KEY,process.env.OPENALEX_REDIS_REST_TOKEN].some(secret=>secret&&value.includes(secret))&&value.length<=128&&(name.includes('request-id')?/^[A-Za-z0-9_.:-]+$/.test(value):(/^[0-9]+(?:\.[0-9]+)?(?:ms|s|m|h)?$/.test(value)||Number.isFinite(Date.parse(value)))))values[name]=value;
 }
 return values;
}
export function openAlexDiagnostic(event:Record<string,unknown>){console.info(JSON.stringify({service:'openalex',status:null,durationMs:0,retries:0,cache:false,apiKeyConfigured:!!process.env.OPENALEX_API_KEY,...event}));}
let warnedLocal=false;
export async function openAlexRequest(url:URL):Promise<Response>{
 const start=Date.now(),deadline=start+openAlexPolicy().budget,config=sharedConfig();
 if(!config&&!warnedLocal){warnedLocal=true;openAlexDiagnostic({event:'local_limiter_only',limiter:'local',sharedLimitGuaranteed:false});}
 let retries=0;
 for(let attempt=0;attempt<3;attempt++){
  if(Date.now()>=deadline)throw Error(BUSY);
  const release=await localSlot(deadline);
  let sharedRelease:(()=>Promise<void>)|undefined;
  let response:Response;
  const attemptStart=Date.now();
  try{
   sharedRelease=await sharedSlot(deadline,config);
   const remaining=deadline-Date.now();if(remaining<=0)throw Error(BUSY);
   response=await fetch(url,{signal:AbortSignal.timeout(Math.max(1,Math.min(12000,remaining))),headers:{Accept:'application/json'}});
   openAlexDiagnostic({event:'http',status:response.status,durationMs:Date.now()-attemptStart,totalMs:Date.now()-start,retries,cache:false,apiKeyConfigured:!!process.env.OPENALEX_API_KEY,limiter:config?'redis':'local',headers:safeHeaders(response)});
   if(response.status===429){
    const delay=retryDelayMs(response.headers.get('retry-after'),attempt);
    cooldown=Math.max(cooldown,Date.now()+delay);
    if(config)await redis(['EVAL',COOL,1,sharedKeys()[1],Math.ceil(delay)],config);
   }
  }catch{
   openAlexDiagnostic({event:'request_failed',failureType:'transport_or_limiter',durationMs:Date.now()-start,retries,apiKeyConfigured:!!process.env.OPENALEX_API_KEY,limiter:config?'redis':'local'});
   throw Error(CONNECTION);
  }finally{
   if(sharedRelease)try{await sharedRelease()}catch{openAlexDiagnostic({event:'lease_release_failed',failureType:'coordination'});}
   release();
  }
  if(response.status!==429||attempt===2)return response;
  // Never retry before Retry-After; a wait beyond our total budget fails promptly.
  const wait=Math.max(0,cooldown-Date.now());
  if(wait>=deadline-Date.now())return response;
  await response.body?.cancel();await sleep(wait);retries++;
 }
 throw Error(BUSY);
}
