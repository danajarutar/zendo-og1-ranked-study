import { cp, readFile, readdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, relative } from "node:path";
const kind=process.argv[2];
if(!['production','synthetic','review'].includes(kind)) throw new Error('Choose exactly one publication: production, synthetic or review.');
const root=fileURLToPath(new URL('../',import.meta.url));
const source=resolve(root,`.wrangler/builds/${kind}`), checkout=resolve(root,'.wrangler/pages-publish');
const destination=resolve(checkout,kind==='production'?'.':kind==='synthetic'?'test':'review');
const git=(...args)=>execFileSync('git',['-C',checkout,...args],{encoding:'utf8',windowsHide:true,env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'never'},stdio:['ignore','pipe','pipe']}).trim();
if(git('remote','get-url','origin')!=='https://github.com/danajarutar/zendo-og1-ranked-study.git') throw new Error('Unexpected publishing repository.');
if(git('status','--porcelain')) throw new Error('Publishing checkout has uncommitted changes; inspect them first.');
git('pull','--ff-only');
const manifest=JSON.parse(await readFile(resolve(source,'release.json'),'utf8'));
if(manifest.kind!==kind) throw new Error('Build environment does not match publication.');
if(kind==='production') {
  const proof=JSON.parse(await readFile(resolve(root,'test-results/production-readiness-report.json'),'utf8'));
  if(proof.environment!=='production'||proof.exact_recovered_checkpoints!==proof.exported_checkpoints||proof.exported_checkpoints<118) throw new Error('Production archive verification must pass before publishing.');
}
const staged=[];
async function copyTree(dir) {
  for(const entry of await readdir(dir,{withFileTypes:true})) {
    const full=resolve(dir,entry.name);
    if(entry.isDirectory()) {await copyTree(full);continue;}
    if(!/\.(html|js|css|png|webp|jpg|jpeg|svg|ico|json)$/.test(entry.name)) throw new Error(`Unexpected public asset: ${entry.name}`);
    if(entry.name.endsWith('.json')&&entry.name!=='release.json') throw new Error('Only the public release manifest may be JSON.');
    const target=resolve(destination,relative(source,full));
    await cp(full,target,{recursive:false}); staged.push(relative(checkout,target));
  }
}
await copyTree(source);
await writeFile(resolve(checkout,'.nojekyll'),'');staged.push('.nojekyll');
// Keep old hashed assets for already-open sessions. Never delete other builds.
git('add','--',...staged);
if(git('diff','--cached','--name-only')) {
  git('-c','user.name=danajarutar','-c','user.email=54892327+danajarutar@users.noreply.github.com','commit','-m',`Publish OG1 ${kind} release ${manifest.release}`);
  git('push','origin','main');
}
console.log(`${kind}: ${git('rev-parse','HEAD')}`);
