import {pdfRoute} from './pdf-jobs.mjs';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd();
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.webp':'image/webp'};
http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');if(await pdfRoute(req,res,url))return;const name=url.pathname==='/data/cards.json'?'docs/cards.json':'public'+(url.pathname==='/'?'/index.html':decodeURIComponent(url.pathname));const file=path.resolve(root,name);if(!file.startsWith(root+path.sep))throw Error();res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404);res.end('Not found');}}).listen(4173,'127.0.0.1',()=>console.log('http://localhost:4173'));
