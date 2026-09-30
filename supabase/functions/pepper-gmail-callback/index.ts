import postgres from 'npm:postgres@3.4.7'
import {finishReadSource} from '../_shared/planning-source-runtime.ts'

const base=Deno.env.get('SUPABASE_URL')||''
const sql=postgres(Deno.env.get('SUPABASE_DB_URL')!,{ssl:Deno.env.get('PEPPER_DB_SSL')==='disable'?false:'require',prepare:false,max:1,idle_timeout:20,connect_timeout:10})
const config={clientId:Deno.env.get('GOOGLE_CLIENT_ID')||'',clientSecret:Deno.env.get('GOOGLE_CLIENT_SECRET')||'',callback:`${base}/functions/v1/pepper-gmail-callback`,appUrl:Deno.env.get('PEPPER_APP_URL')||'https://pepper-family-beta.vercel.app/pepper'}

Deno.serve(async(req:Request)=>{
  if(req.method!=='GET')return new Response('Method not allowed.',{status:405})
  try{return await finishReadSource(sql,req,config)}catch{
    return new Response('Connection could not be saved. Return to Pepper and reconnect.',{status:503,headers:{'Cache-Control':'no-store','Content-Type':'text/plain'}})
  }
})
