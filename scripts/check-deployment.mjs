// クラウドビルド専用。.envや鍵の値をログへ出力しない。
export function deploymentErrors(env) {
  const errors=[];
  for(const name of ["SUPABASE_SERVICE_ROLE_KEY","SUPABASE_SECRET_KEY","NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY","NEXT_PUBLIC_SUPABASE_SECRET_KEY"]){
    if(env[name])errors.push(`${name}はアプリのデプロイ環境に設定しないでください`);
  }
  if(!["preview","connected"].includes(env.APP_MODE))errors.push("APP_MODEはpreviewまたはconnectedを明示してください");
  if(env.APP_MODE==="preview"){
    if(env.SUPABASE_URL||env.SUPABASE_PUBLISHABLE_KEY)errors.push("previewモードにDB接続設定を含めないでください");
    return errors;
  }
  if(env.APP_MODE!=="connected")return errors;
  if(env.VERCEL_ENV==="preview")errors.push("Vercel PreviewはAPP_MODE=previewを使用してください");
  try{
    const origin=new URL(env.APP_ORIGIN);
    if(origin.protocol!=="https:"||origin.origin!==env.APP_ORIGIN)throw new Error();
  }catch{errors.push("APP_ORIGINは公開先のHTTPSオリジンを末尾スラッシュなしで設定してください");}
  try{
    const url=new URL(env.SUPABASE_URL);
    if(url.protocol!=="https:"||!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(env.SUPABASE_URL))throw new Error();
  }catch{errors.push("SUPABASE_URLはHosted SupabaseのHTTPSプロジェクトURLを設定してください");}
  const key=env.SUPABASE_PUBLISHABLE_KEY??"";
  let publicKey=/^sb_publishable_[A-Za-z0-9_-]+$/.test(key);
  if(!publicKey){
    try{
      const parts=key.split(".");const payload=JSON.parse(Buffer.from(parts[1],"base64url").toString("utf8"));
      publicKey=parts.length===3&&payload.role==="anon";
    }catch{publicKey=false;}
  }
  if(!publicKey)errors.push("SUPABASE_PUBLISHABLE_KEYはpublishableまたはanonキーを設定してください（管理鍵不可）");
  return errors;
}
if(import.meta.url===new URL(process.argv[1],"file:").href){
  const errors=deploymentErrors(process.env);
  if(errors.length){console.error("デプロイ設定を確認してください:\n"+errors.map(e=>`- ${e}`).join("\n"));process.exitCode=1;}
  else console.log("デプロイ設定の形式を確認しました。接続・権限・データの実機確認は公開手順に従ってください。");
}
