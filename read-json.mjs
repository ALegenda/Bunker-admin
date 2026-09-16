export async function readJson(request,limit=12*1024*1024){
 const chunks=[];let size=0;
 for await(const chunk of request){size+=chunk.length;if(size>limit)throw new Error('too-large');chunks.push(chunk);}
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
}
