import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp, mkdir, copyFile, realpath, rm, writeFile} from 'node:fs/promises';
import {dirname, join, relative} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';

const require=createRequire(import.meta.url);
const {nodeFileTrace}=require('next/dist/compiled/@vercel/nft');
const {sync:glob}=require('next/dist/compiled/glob');
const config=require('../next.config.js');
const web=fileURLToPath(new URL('..',import.meta.url));

// CommonJS tests retain the entire installed dependency tree. Reproduce the
// native ESM import in Next's API output with ONLY the files shipped to Vercel.
test('deployed case-source PDF parser includes its dynamic worker and canvas dependencies',async()=>{
 const parserRoot=await realpath(join(web,'node_modules/pdf-parse'));
 const base=dirname(dirname(parserRoot));
 const entry=join(parserRoot,'dist/pdf-parse/esm/index.js');
 const traced=await nodeFileTrace([entry],{base});
 const files=new Set(traced.fileList);
 for(const pattern of config.experimental.outputFileTracingIncludes['/api/projects/case-sources']??[]){
  for(const file of glob(pattern,{cwd:web,nodir:true}))files.add(relative(base,await realpath(join(web,file))));
 }
 const output=await mkdtemp(join(tmpdir(),'pss-case-pdf-deploy-'));
 try{
  for(const file of files){
   assert.ok(!file.startsWith('..'),'Dependencies must stay within the deployment root');
   const target=join(output,file);await mkdir(dirname(target),{recursive:true});await copyFile(join(base,file),target);
  }
  let pdf='%PDF-1.4\n';const offsets=[0];
  const stream='BT /F1 12 Tf 72 720 Td (Vehicles retain restricted access.) Tj ET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  objects.forEach((object,i)=>{offsets.push(pdf.length);pdf+=`${i+1} 0 obj\n${object}\nendobj\n`;});
  const xref=pdf.length;pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const fixture=join(output,'fixture.pdf');await writeFile(fixture,pdf);
  const script=`
   import {readFileSync} from 'node:fs';
   import assert from 'node:assert/strict';
   const {PDFParse}=await import(${JSON.stringify(pathToFileURL(join(output,relative(base,entry))).href)});
   for(const path of process.argv.slice(1)){
    const parser=new PDFParse({data:readFileSync(path)});
    try{
     const result=await parser.getText();assert.ok(result.pages.length>0);
     assert.ok(result.pages.reduce((n,p)=>n+p.text.length,0)>0);
     if(path===${JSON.stringify(fixture)})assert.match(result.text,/Vehicles retain restricted access/);
     console.log(JSON.stringify({pages:result.pages.length,characters:result.pages.reduce((n,p)=>n+p.text.length,0)}));
    }finally{await parser.destroy();}
   }`;
  const env={...process.env};delete env.NODE_PATH;
  const result=execFileSync(process.execPath,['--input-type=module','-e',script,fixture,...(process.env.PSS_CASE_PDF?[process.env.PSS_CASE_PDF]:[])],{cwd:output,env,encoding:'utf8',timeout:60000});
  console.log(result.trim());
 }finally{await rm(output,{recursive:true,force:true});}
});
