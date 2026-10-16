import {spawnSync} from 'node:child_process';
const git = process.env.ZENDO_GIT || 'C:/Users/dr571/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/git/cmd/git.exe';
const r=spawnSync(git,['credential','fill'],{input:'protocol=https\nhost=github.com\n\n',encoding:'utf8',windowsHide:true,env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'never'}});
const token=r.stdout?.match(/^password=(.+)$/m)?.[1]?.trim();
if(!token)throw Error('No stored GitHub sign-in available.');
const headers={Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
const user=await fetch('https://api.github.com/user',{headers});
console.log(JSON.stringify({status:user.status,login:(await user.json()).login,scopes:user.headers.get('x-oauth-scopes')}));

if(process.argv.includes('--create')) {
 for(const [name,isPrivate] of [['zendo-og1-ranked-study',false],['zendo-og1-ranked-responses',true]]) {
  let response=await fetch('https://api.github.com/repos/danajarutar/'+name,{headers});
  if(response.status===404) response=await fetch('https://api.github.com/user/repos',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({name,private:isPrivate,auto_init:true,description:isPrivate?'Encrypted data for the separate Zendo ranked-operations experiment.':'Independent Zendo ranked-operations experiment; the original OG1 study is unchanged.'})});
  const repo=await response.json();
  if(!response.ok||repo.private!==isPrivate)throw Error('Repository setup failed: '+name+' '+response.status);
  console.log(repo.html_url+' private='+repo.private);
 }
}
if(process.argv.includes('--pages')) {
 let response=await fetch('https://api.github.com/repos/danajarutar/zendo-og1-ranked-study/pages',{headers});
 if(response.status===404) response=await fetch('https://api.github.com/repos/danajarutar/zendo-og1-ranked-study/pages',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({source:{branch:'main',path:'/'},build_type:'legacy'})});
 if(!response.ok)throw Error('Pages setup failed '+response.status);
 console.log('Ranked GitHub Pages enabled.');
}
