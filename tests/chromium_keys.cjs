/* Trusted keyboard input through Chromium DevTools; fixture-only, loopback only.
 * Uses Node 18 built-ins, including a minimal uncompressed local WebSocket client. */
const fs = require('node:fs');
const http = require('node:http');
const crypto = require('node:crypto');
(async () => {
    const [profile, action] = process.argv.slice(2);
    const port = fs.readFileSync(`${profile}/DevToolsActivePort`, 'utf8').split('\n')[0];
    if (!/^\d+$/.test(port)) throw Error('Invalid debugging port');
    const pages = await new Promise((resolve,reject)=>http.get(`http://127.0.0.1:${port}/json/list`, response=>{
        let body=''; response.on('data',chunk=>body+=chunk); response.on('end',()=>resolve(JSON.parse(body)));
    }).on('error',reject));
    const page = pages.find(page => new URL(page.url).pathname === '/fixture');
    if (!page || new URL(page.webSocketDebuggerUrl).hostname !== '127.0.0.1') throw Error('Missing local fixture');
    const url = new URL(page.webSocketDebuggerUrl);
    const socket = await new Promise((resolve,reject)=>{
        const request = http.request({hostname:url.hostname, port:url.port, path:url.pathname,
            headers:{Connection:'Upgrade',Upgrade:'websocket','Sec-WebSocket-Version':'13',
                'Sec-WebSocket-Key':crypto.randomBytes(16).toString('base64')}});
        request.on('upgrade',(_,socket)=>resolve(socket)); request.on('error',reject); request.end();
    });
    let next=0, buffer=Buffer.alloc(0);
    const pending=new Map();
    socket.on('data',chunk=>{
        buffer=Buffer.concat([buffer,chunk]);
        while(buffer.length>=2) {
            let length=buffer[1]&127, offset=2;
            if(length===126) {if(buffer.length<4)return; length=buffer.readUInt16BE(2); offset=4;}
            if(length===127) {if(buffer.length<10)return; length=Number(buffer.readBigUInt64BE(2)); offset=10;}
            if(buffer.length<offset+length)return;
            const opcode=buffer[0]&15, body=buffer.subarray(offset,offset+length);
            buffer=buffer.subarray(offset+length);
            if(opcode!==1)continue;
            const message=JSON.parse(body.toString()), waiter=pending.get(message.id);
            if(waiter) {pending.delete(message.id); message.error ? waiter.reject(Error('Keyboard rejected')) : waiter.resolve();}
        }
    });
    const command=params=>new Promise((resolve,reject)=>{
        const id=++next; pending.set(id,{resolve,reject});
        const data=Buffer.from(JSON.stringify({id,method:'Input.dispatchKeyEvent',params}));
        const header=Buffer.alloc(data.length<126 ? 2 : 4), mask=crypto.randomBytes(4);
        header[0]=0x81; header[1]=0x80|(data.length<126 ? data.length : 126);
        if(data.length>=126)header.writeUInt16BE(data.length,2);
        for(let i=0;i<data.length;i++)data[i]^=mask[i%4];
        socket.write(Buffer.concat([header,mask,data]));
    });
    const key = action==='rust' ? {key:'r',code:'KeyR',windowsVirtualKeyCode:82,text:'r'} : {key:'Home',code:'Home',windowsVirtualKeyCode:36};
    await command({type:'keyDown',...key});
    await command({type:'keyUp',...key,text:undefined});
    socket.destroy();
})().catch(()=>{console.error('Local fixture keyboard input failed');process.exit(1);});
