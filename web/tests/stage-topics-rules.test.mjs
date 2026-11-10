import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,getDoc,setDoc} from 'firebase/firestore';

test('derived topics are API-only and private research-source rules remain unchanged (isolated emulator)',async()=>{
 const env=await initializeTestEnvironment({projectId:'demo-pss-topic-continuity',firestore:{host:'127.0.0.1',port:8080,rules:readFileSync(new URL('../firestore.rules',import.meta.url),'utf8')}});
 try{
  const original={logs:[{id:'source-id',sender:'user',text:'모의 주민 발언'}],completed:true};
  await env.withSecurityRulesDisabled(async context=>{
   const db=context.firestore();
   await setDoc(doc(db,'ppssProjects/p'),{projectAdmin:'admin@example.test'});
   await setDoc(doc(db,'users/alice/projectMemberships/p'),{role:'participant'});
   await setDoc(doc(db,'users/bob/projectMemberships/p'),{role:'participant'});
   await setDoc(doc(db,'users_p/alice/steps/problem'),original);
   await setDoc(doc(db,'ppssDerivedStageTopics/private-fixture'),{userId:'alice',projectId:'p',topics:[]});
  });
  for(const uid of ['alice','bob']){
   const db=env.authenticatedContext(uid).firestore();
   await assertFails(getDoc(doc(db,'ppssDerivedStageTopics/private-fixture')));
   await assertFails(setDoc(doc(db,'ppssDerivedStageTopics/forged'),{userId:uid,topics:[]}));
  }
  const owner=env.authenticatedContext('alice').firestore(),other=env.authenticatedContext('bob').firestore();
  const snapshot=await assertSucceeds(getDoc(doc(owner,'users_p/alice/steps/problem')));assert.deepEqual(snapshot.data(),original);
  await assertFails(getDoc(doc(other,'users_p/alice/steps/problem')));
 }finally{await env.cleanup();}
});
