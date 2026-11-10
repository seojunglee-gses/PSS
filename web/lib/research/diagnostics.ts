// Classify locally; never log error text, source payloads, URLs or participant context.
export function answerFailureType(error:unknown):string {
 if(error instanceof SyntaxError)return 'invalid_json';
 if(error instanceof Error){
  if(/unsupported source reference/.test(error.message))return 'source_validation';
  if(/^The analysis response was invalid/.test(error.message))return 'response_validation';
  if(error.name==='AbortError'||error.name==='TimeoutError')return 'generation_timeout';
 }
 return 'generation_or_transport';
}
export function logAnswerFailure(failureType:string,researchWarning:boolean){console.warn(JSON.stringify({service:'analysis_answer',event:'failed',failureType,researchWarning}));}
