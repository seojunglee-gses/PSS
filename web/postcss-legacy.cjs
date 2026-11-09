const {transform,Features}=require('lightningcss');

// Retain normal Tailwind 4 layers; only older engines use the down-levelled copy.
function legacyCss(source,postcss){
 const root=postcss.parse(source),variables=new Map(),initials=new Map();
 root.walkAtRules('layer',rule=>{if(rule.params==='properties')rule.walkDecls(/^--/,decl=>initials.set(decl.prop,decl.value));});
 root.walkAtRules('property',rule=>{
  rule.walkDecls('initial-value',decl=>initials.set(rule.params,decl.value));
  rule.remove();
 });
 if(initials.size)root.prepend(postcss.rule({selector:'*,::before,::after',nodes:[...initials].map(([prop,value])=>postcss.decl({prop,value}))}));
 root.walkRules(rule=>{if(/:root|:host/.test(rule.selector))rule.walkDecls(/^--/,decl=>variables.set(decl.prop,decl.value));});
 root.walkAtRules('layer',rule=>{if(rule.nodes)rule.replaceWith(...rule.nodes);else rule.remove();});
 root.walkRules(rule=>{rule.selector=rule.selector.replace(/:where\(/g,':is(');});
 root.walkDecls(decl=>{
  // Chromium 81 lacks logical shorthands; both supported locales use LTR layout.
  const logical=/^(padding|margin|inset)-(inline|block)(?:-(start|end))?$/.exec(decl.prop);
  if(logical){
   const [,kind,axis,edge]=logical,sides=axis==='inline'?['left','right']:['top','bottom'];
   const values=postcss.list.space(decl.value);
   (edge?[edge==='start'?0:1]:[0,1]).forEach(index=>decl.cloneBefore({prop:kind==='inset'?sides[index]:`${kind}-${sides[index]}`,value:values[index]??values[0]}));
   decl.remove();return;
  }
  if(decl.prop==='inset'){
   const values=postcss.list.space(decl.value),[top,right=top,bottom=top,left=right]=values;
   ['top','right','bottom','left'].forEach((prop,index)=>decl.cloneBefore({prop,value:[top,right,bottom,left][index]}));decl.remove();return;
  }
  if(decl.prop==='gap')decl.cloneAfter({prop:'--ppss-gap',value:decl.value});
  if(decl.value.includes('color-mix(')){
   for(let i=0;i<5;i++){
    const next=decl.value.replace(/var\((--[\w-]+)\)/g,(match,key)=>variables.get(key)??match);
    if(next===decl.value)break;decl.value=next;
   }
  }
 });
 return transform({filename:'ppss-legacy.css',code:Buffer.from(root.toString()),targets:{chrome:81<<16},
  include:Features.Nesting|Features.MediaQueries|Features.Colors|Features.LogicalProperties,minify:true}).code.toString();
}
function plugin(){
 return {postcssPlugin:'ppss-legacy-css',OnceExit(root,{postcss}){
  if(!root.toString().includes('.workspace-shell')||root.nodes.some(node=>node.type==='comment'&&node.text==='PPSS legacy CSS fallback'))return;
  const fallback=postcss.atRule({name:'supports',params:'not (color: oklch(50% .1 260))'});
  fallback.append(postcss.parse(legacyCss(root.toString(),postcss)).nodes);
  root.append(postcss.comment({text:'PPSS legacy CSS fallback'}),fallback);
 }};
}
plugin.postcss=true;
plugin.legacyCss=legacyCss;
module.exports=plugin;
