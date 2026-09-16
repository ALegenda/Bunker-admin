import {readJson} from './read-json.mjs';
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
const root=process.cwd(),jobs=path.join(root,'tmp/pdf-jobs');
let active=null;
const uuid=/^[a-f0-9-]{36}$/;
export async function pdfRoute(req,res,url){
 const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 if(url.pathname==='/api/pdf/build'&&req.method==='POST'){
  if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`){send(403,{error:'Недопустимый источник запроса.'});return true;}
  if(active){send(409,{error:'Предыдущая сборка ещё выполняется.',jobId:active});return true;}
  let payload;try{payload=await readJson(req);}catch(e){send(e.message==='too-large'?413:400,{error:e.message==='too-large'?'Черновик слишком большой для пробной сборки.':'Не удалось прочитать черновик.'});return true;}
  if(!Array.isArray(payload.cards)||payload.cards.length>1000||payload.cards.some(c=>!c||typeof c.id!=='string'||typeof c.name!=='string'||typeof c.description!=='string'||typeof c.image!=='string'||c.description.length>100000)||new Set(payload.cards.map(c=>c.id)).size!==payload.cards.length){send(400,{error:'Некорректные данные карточек.'});return true;}
  const mode=payload.mode||'reference-template';
  if(!['reference-template','word-preview'].includes(mode)){send(400,{error:'Неизвестный режим сборки.'});return true;}
  const id=randomUUID(),dir=path.join(jobs,id);active=id;await mkdir(dir,{recursive:true});await writeFile(path.join(dir,'input.json'),JSON.stringify(payload));await writeFile(path.join(dir,'status.json'),JSON.stringify({status:'running',mode,createdAt:new Date().toISOString()}));
  active=id;const python=path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3');
  const child=spawn(python,[path.join(root,mode==='reference-template'?'scripts/build-template-pdf.py':'scripts/build-source-pdf.py'),path.join(dir,'input.json'),dir],{cwd:root,stdio:['ignore','ignore','pipe']});let log='';child.stderr.on('data',d=>{log=(log+d).slice(-20000);});
  child.on('error',async err=>{await writeFile(path.join(dir,'result.json'),JSON.stringify({status:'failed',error:'Не удалось запустить генератор PDF.'}));if(active===id)active=null;});
  child.on('close',async code=>{if(code!==0){try{await readFile(path.join(dir,'result.json'));}catch{await writeFile(path.join(dir,'result.json'),JSON.stringify({status:'failed',error:'Сборка прервалась. Попробуйте ещё раз.'}));}}await writeFile(path.join(dir,'worker.log'),log);if(active===id)active=null;});
  send(202,{jobId:id,status:'running'});return true;
 }
 const match=url.pathname.match(/^\/api\/pdf\/jobs\/([^/]+)(\/file)?$/);
 if(match&&req.method==='GET'){
  const [,id,file]=match;if(!uuid.test(id)){send(404,{error:'Сборка не найдена.'});return true;}const dir=path.join(jobs,id);
  try{
   let result;try{result=JSON.parse(await readFile(path.join(dir,'result.json'),'utf8'));}catch{result=JSON.parse(await readFile(path.join(dir,'status.json'),'utf8'));if(result.status==='running'&&active!==id)result={status:'failed',error:'Сборка была прервана перезапуском сервера.'};}
   if(file){if(result.status!=='ready'){send(409,{error:'PDF ещё не готов.'});return true;}const pdf=await readFile(path.join(dir,'rules-preview.pdf'));res.writeHead(200,{'Content-Type':'application/pdf','Content-Disposition':'inline; filename="bunker-review.pdf"','Cache-Control':'no-store'});res.end(pdf);}else send(200,{...result,jobId:id,url:result.status==='ready'?`/api/pdf/jobs/${id}/file`:undefined});
  }catch{send(404,{error:'Сборка не найдена.'});}return true;
 }
 return false;
}
