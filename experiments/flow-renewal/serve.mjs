// Read-only dev serving without HMR, so unrelated app edits do not invalidate
// a fixed-time experiment. No proxy and no model service are used by this page.
import {createServer} from 'vite';
const server=await createServer({configFile:false,root:new URL('../../',import.meta.url).pathname,server:{host:'127.0.0.1',port:4192,strictPort:true,hmr:false,watch:null}});
await server.listen();console.log('Flow renewal comparison: http://127.0.0.1:4192/src/renewed-flow/preview.html');
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await server.close();process.exit(0);});
