import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {deploymentErrors} from "../../scripts/check-deployment.mjs";
const base={APP_MODE:"connected",APP_ORIGIN:"https://demo.example.invalid",SUPABASE_URL:"https://abcdefghijklmnopqrst.supabase.co",SUPABASE_PUBLISHABLE_KEY:"sb_publishable_fictional_key"};
test("PreviewをDBから分離し明示的なモードだけ受け入れる",()=>{
 assert.deepEqual(deploymentErrors({APP_MODE:"preview",VERCEL_ENV:"preview"}),[]);
 assert.ok(deploymentErrors({}).length);assert.ok(deploymentErrors({APP_MODE:"conected"}).length);
 assert.ok(deploymentErrors({...base,APP_MODE:"preview"}).length);assert.ok(deploymentErrors({...base,VERCEL_ENV:"preview"}).length);
 assert.deepEqual(deploymentErrors({...base,VERCEL_ENV:"production"}),[]);
});
test("公開HTTPS設定・公開鍵のみを許可し、管理鍵を拒否する",()=>{
 for(const origin of [undefined,"http://localhost:3000","https://demo.example.invalid/","https://demo.example.invalid/path","https://user:pass@demo.example.invalid"]){assert.ok(deploymentErrors({...base,APP_ORIGIN:origin}).length);}
 for(const url of [undefined,"http://127.0.0.1:54321","https://example.invalid","https://abcdefghijklmnopqrst.supabase.co/path"]){assert.ok(deploymentErrors({...base,SUPABASE_URL:url}).length);}
 for(const role of ["anon","service_role","authenticated"]){const key=`eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({role})).toString("base64url")}.fictional`;assert.equal(deploymentErrors({...base,SUPABASE_PUBLISHABLE_KEY:key}).length===0,role==="anon");}
 for(const key of [undefined,"sb_secret_fictional_key","invalid"]){assert.ok(deploymentErrors({...base,SUPABASE_PUBLISHABLE_KEY:key}).length);}
 for(const name of ["SUPABASE_SERVICE_ROLE_KEY","SUPABASE_SECRET_KEY","NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY","NEXT_PUBLIC_SUPABASE_SECRET_KEY"]){assert.ok(deploymentErrors({...base,[name]:"fictional-secret"}).length);}
});
test("検査失敗時は値を出力せず非0で停止する",()=>{
 const env={...process.env,...base,APP_ORIGIN:"fictional-private-value",SUPABASE_PUBLISHABLE_KEY:"fictional-secret-value"};
 const result=spawnSync(process.execPath,["scripts/check-deployment.mjs"],{env,encoding:"utf8"});assert.equal(result.status,1);assert.ok(result.stderr.includes("APP_ORIGIN"));assert.ok(!result.stderr.includes(env.APP_ORIGIN));assert.ok(!result.stderr.includes(env.SUPABASE_PUBLISHABLE_KEY));
});

test("認証Cookieは正規HTTPSでSecure、ローカルHTTPでは非Secure",async()=>{
 const {authCookieOptions}=await import("../../src/lib/supabase/config.ts");
 assert.deepEqual(authCookieOptions("https://demo.example.invalid"),{path:"/",sameSite:"lax",secure:true});
 assert.equal(authCookieOptions("http://127.0.0.1:3101").secure,false);
});
