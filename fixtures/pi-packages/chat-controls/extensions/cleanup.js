import { existsSync, writeFileSync } from 'node:fs';
// Acceptance only: keep SDK shutdown unsettled until the fixture releases it.
export default function(pi) {
  pi.on('input',async event=>{
    if(event.text==='chat-controls-fail-manual')throw new Error('Acceptance manual execution failed');
  });
  pi.on('session_shutdown',async()=>{
    if(!existsSync('/var/data/workspace/chat-controls-hold'))return;
    writeFileSync('/var/data/workspace/chat-controls-shutdown','waiting');
    while(existsSync('/var/data/workspace/chat-controls-hold'))await new Promise(resolve=>setTimeout(resolve,50));
  });
}
