import { createServer } from 'vite';
const server=await createServer({server:{host:'127.0.0.1',port:4193,strictPort:true},build:{emptyOutDir:false}});
await server.listen();console.log('http://127.0.0.1:4193/src/presence/index.html');
