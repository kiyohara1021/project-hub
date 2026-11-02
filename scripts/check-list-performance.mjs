import {spawn,execFileSync} from "node:child_process";
import {setTimeout as delay} from "node:timers/promises";
import {access} from "node:fs/promises";
import {createServer} from "node:net";
import {createRequire} from "node:module";
import {randomUUID} from "node:crypto";
import {request} from "@playwright/test";
import {localSettings,adminClient,login,checked,demoPassword} from "./local-supabase.mjs";
import {localSql} from "./local-sql.mjs";

const origin="http://127.0.0.1:3104",warmup=5,samples=50,goalMs=1000;
const require=createRequire(import.meta.url);
let server,context,service,wid,interrupted=false;
const abort=new AbortController();
for(const signal of ["SIGINT","SIGTERM"])process.once(signal,()=>{interrupted=true;abort.abort();});
function ensureRunning(){if(interrupted)throw new Error("INTERRUPTED");}
async function portAvailable(){
  await new Promise((resolve,reject)=>{
    const probe=createServer();probe.once("error",()=>reject(new Error("PORT_3104_IN_USE")));
    probe.listen(3104,"127.0.0.1",()=>probe.close(resolve));
  });
}
async function start(settings){
  await access(new URL("../.next/BUILD_ID",import.meta.url));
  await portAvailable();
  // CLIでlocalhost検証済みの値だけを子プロセスへ渡す。既存.envの接続先を使用しない。
  server=spawn(process.execPath,[require.resolve("next/dist/bin/next"),"start","--hostname","127.0.0.1","--port","3104"],{
    cwd:new URL("..",import.meta.url),stdio:"ignore",env:{...process.env,APP_MODE:"connected",APP_ORIGIN:origin,SUPABASE_URL:settings.API_URL,SUPABASE_PUBLISHABLE_KEY:settings.ANON_KEY},
  });
  for(let i=0;i<100;i++){
    ensureRunning();if(server.exitCode!==null)throw new Error("SERVER_START_FAILED");
    try{const response=await fetch(`${origin}/login`,{signal:AbortSignal.timeout(1000)});if(response.ok)return;}catch{ /* 起動待ち */ }
    await delay(100,undefined,{signal:abort.signal});
  }
  throw new Error("SERVER_START_TIMEOUT");
}
function percentile(sorted,p){return sorted[Math.ceil(sorted.length*p)-1];}
async function list(path,expected,hasNext){
  ensureRunning();const start=performance.now();const response=await context.get(path,{timeout:15000});
  if(response.status()!==200)throw new Error("API_RESPONSE_FAILED");
  const result=await response.json();const elapsed=performance.now()-start;
  if(!Array.isArray(result.data)||result.data.length!==expected||(hasNext?(typeof result.nextCursor!=="string"||!result.nextCursor):result.nextCursor!==null))throw new Error("API_PAGE_INVALID");
  return elapsed;
}
async function cleanup(){
  const errors=[];
  if(context)try{await context.dispose();}catch{errors.push("CLIENT_CLEANUP_FAILED");}
  if(server){
    const stopped=new Promise(resolve=>server.once("exit",resolve));
    if(server.exitCode===null&&server.signalCode===null){server.kill("SIGTERM");await Promise.race([stopped,delay(3000)]);if(server.exitCode===null&&server.signalCode===null){server.kill("SIGKILL");await stopped;}}
  }
  if(wid&&service){
    for(const table of ["issues","tasks","projects","memberships","activity_logs"]){
      const result=await service.from(table).delete().eq("workspace_id",wid);if(result.error)errors.push("FIXTURE_CLEANUP_FAILED");
    }
    if((await service.from("workspaces").delete().eq("id",wid)).error)errors.push("WORKSPACE_CLEANUP_FAILED");
    const remaining=await service.from("workspaces").select("id").eq("id",wid);if(remaining.error||remaining.data.length)errors.push("CLEANUP_NOT_VERIFIED");
  }
  if(errors.length)throw new Error(errors[0]);
}
let failure,stage="local-settings";
try{
  const settings=localSettings();service=adminClient(settings);
  stage="server-start";await start(settings);
  stage="fixture-owner-login";const owner=await login(settings,"admin");
  stage="fixture-workspace";wid=checked(await owner.client.rpc("create_workspace",{p_name:"一覧性能検証の架空ワークスペース"}));
  const projects=Array.from({length:100},(_,i)=>({id:randomUUID(),workspace_id:wid,name:`一覧性能検証の架空プロジェクト${String(i+1).padStart(3,"0")}`,status:"active"}));
  stage="fixture-projects";checked(await service.from("projects").insert(projects));
  const tasks=Array.from({length:1000},(_,i)=>({workspace_id:wid,project_id:projects[i<901?0:i-900].id,title:`一覧性能検証の架空タスク${i+1}`,status:"todo",position:i*1024}));
  stage="fixture-tasks";for(let i=0;i<tasks.length;i+=100){ensureRunning();checked(await service.from("tasks").insert(tasks.slice(i,i+100)));}
  for(const [table,count]of [["projects",100],["tasks",1000]]){
    const result=await service.from(table).select("id",{count:"exact",head:true}).eq("workspace_id",wid);checked(result);if(result.count!==count)throw new Error("FIXTURE_COUNT_INVALID");
  }
  stage="http-login";context=await request.newContext({baseURL:origin});
  const auth=await context.post("/auth/login",{headers:{origin},form:{email:"admin@example.invalid",password:demoPassword},maxRedirects:0});
  if(auth.status()!==303||auth.headers().location!==`${origin}/workspaces`)throw new Error("LOGIN_FAILED");
  stage="measurement";const results=[];
  for(const limit of [25,100])for(const resource of ["projects","tasks"]){
    const path=`/api/v1/workspaces/${wid}/projects${resource==="tasks"?`/${projects[0].id}/tasks`:""}?limit=${limit}`;
    for(let i=0;i<warmup;i++)await list(path,limit,(resource==="tasks"?901:100)>limit);
    const times=[];for(let i=0;i<samples;i++)times.push(await list(path,limit,(resource==="tasks"?901:100)>limit));times.sort((a,b)=>a-b);
    const round=value=>Number(value.toFixed(2));const p95=percentile(times,.95);
    results.push({resource,limit,samples,failures:0,minMs:round(times[0]),p50Ms:round(percentile(times,.5)),p95Ms:round(p95),maxMs:round(times.at(-1)),goalPassed:p95<=goalMs});
  }
  const report={measuredAt:new Date().toISOString(),sha:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),node:process.version,postgres:localSql("show server_version"),mode:"local production build, concurrency 1, no throttling",projects:100,tasks:1000,denseProjectTasks:901,warmupPerCondition:warmup,goalP95Ms:goalMs,results};
  // fixture削除が成功するまで成功結果を出力しない。
  stage="cleanup";await cleanup();wid=undefined;server=undefined;context=undefined;
  console.log(JSON.stringify({...report,cleanupVerified:true},null,2));
  if(results.some(result=>!result.goalPassed))process.exitCode=1;
}catch(error){
  failure=error;process.exitCode=1;
}finally{
  if(wid||server||context)try{await cleanup();}catch{failure=new Error("CLEANUP_FAILED");process.exitCode=1;}
  // SDKエラー・HTTP応答・本文・資格情報を丸ごとログに出さない。
  if(failure)console.error(`一覧API検証に失敗しました（${stage}）。ローカルDB、ビルド、ポート3104とfixtureの削除状況を確認してください。`);
}
