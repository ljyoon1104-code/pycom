import {test} from 'node:test';
import assert from 'node:assert/strict';
import {auditCase,compareCase,normalized,normalizeAddresses,normalizeTemporaryPath,reproducibleReport,resultHash,setElements} from './comparison.mjs';
const output=stdout=>({stdout,errorType:null,message:null,file:null,line:null,column:null,completion:'complete',files:{}});
const sample=(id,extra={})=>auditCase({id,category:'test',code:'test',input:[],files:[],...extra});
test('exact is the default and preserves whitespace and line order',()=>{
 const c=sample('plain');assert.equal(compareCase(c,output('a\nb\n'),output('a\nb\n')).classification,'exact');
 for(const text of ['b\na\n','a b\n','a\nb','a\nb \n'])assert.equal(compareCase(c,output('a\nb\n'),output(text)).classification,'interpreter-defect');
});
test('declared set order is consistently educational, even when raw order happens to agree',()=>{
 const c=sample('collection-set-order');for(const text of ["{'가', '나'}\n","{'나', '가'}\n"])assert.equal(compareCase(c,output("{'가', '나'}\n"),output(text)).classification,'educational-compatible');
});
test('different set member is still a defect',()=>assert.equal(compareCase(sample('collection-set-order'),output('{1, 2}\n'),output('{1, 3}\n')).classification,'interpreter-defect'));
test('quoted braces commas and escaped quotes are not set delimiters',()=>assert.deepEqual(setElements("{'a,b', '{x}', 'a\\\'b'}\n"),["'a,b'","'a\\\'b'","'{x}'"].sort()));
test('nested set, dict, tuple and list are never accepted as flat sets',()=>{for(const x of ['{{1}}\n',"{'a': 1}\n",'(1,2)\n','[1,2]\n'])assert.throws(()=>setElements(x));});
test('a VM that returns a list instead of a set is a defect, not a pass',()=>assert.equal(compareCase(sample('collection-set-order'),output('{1, 2}\n'),output('[1, 2]\n')).classification,'interpreter-defect'));
test('ordinary list tuple and dict order stay exact',()=>{for(const [a,b]of [['[1, 2]\n','[2, 1]\n'],['(1, 2)\n','(2, 1)\n'],["{'a': 1, 'b': 2}\n","{'b': 2, 'a': 1}\n"]])assert.equal(compareCase(sample('plain'),output(a),output(b)).classification,'interpreter-defect');});
test('object addresses normalize only declared standalone default repr lines',()=>{
 const c=sample('class-default-repr');assert.deepEqual(normalized(c,output('<__main__.A object at 0x123ABC>\n')),normalized(c,output('<__main__.A object at 0x987>\n')));
 assert.equal(normalized(sample('plain'),output('<__main__.A object at 0x123ABC>\n')).stdout,'<__main__.A object at 0x123ABC>\n');
});
test('class names and kinds cannot be hidden by the educational repr policy',()=>{
 const c=sample('class-default-repr',{policy:'educational-compatible'});
 assert.equal(compareCase(c,output('<__main__.A object at 0x123>\n'),output('<A 객체>\n')).classification,'educational-compatible');
 assert.equal(compareCase(c,output('<__main__.A object at 0x123>\n'),output('<B 객체>\n')).classification,'interpreter-defect');
});
test('hex values and address-like strings remain byte exact',()=>{for(const x of ['0x123abc\n','"0x123abc"\n',"'<__main__.A object at 0x123>'\n",'prefix <__main__.A object at 0x123>\n'])assert.equal(normalizeAddresses(x),x);});
test('repeated versus distinct object identities remain distinguishable',()=>{
 const same='<__main__.A object at 0x1>\n<__main__.A object at 0x1>\n',different='<__main__.A object at 0x1>\n<__main__.A object at 0x2>\n';
 assert.notEqual(normalizeAddresses(same),normalizeAddresses(different));
});
const errorAt=(root,file='helper.py')=>({ ...output(''),errorType:'ImportError',completion:'error',message:`cannot import name 'missing' from 'helper' (${root}\\${file})`,execution:{directory:root}});
test('only the exact owned temporary root in an import diagnostic is normalized',()=>{
 const c=sample('module-missing-member');assert.deepEqual(normalized(c,errorAt('C:\\audit\\one')),normalized(c,errorAt('C:\\audit\\two')));
});
test('different filenames and relative subpaths are not hidden',()=>{
 const c=sample('module-missing-member');assert.notDeepEqual(normalized(c,errorAt('C:\\audit\\one')),normalized(c,errorAt('C:\\audit\\two','other.py')));
});
test('ordinary path strings and stdout are never normalized',()=>{
 const text='C:\\audit\\one\\sample.txt';assert.equal(normalizeTemporaryPath(text,'C:\\audit\\one'),text);
 assert.equal(normalized(sample('module-missing-member'),{...errorAt('C:\\audit\\one'),stdout:text}).stdout,text);
});
test('similar root prefixes and traversal paths remain visible',()=>{
 const text=errorAt('C:\\audit\\one-other').message;assert.equal(normalizeTemporaryPath(text,'C:\\audit\\one'),text);
 const escape=errorAt('C:\\audit\\one','..\\secret.py').message;assert.equal(normalizeTemporaryPath(escape,'C:\\audit\\one'),escape);
});
test('error type, line and file mutations remain defects',()=>{
 const c=sample('plain'),base={...output(''),completion:'error',errorType:'ValueError',file:'main.py',line:2};
 for(const change of [{errorType:'TypeError'},{line:3},{file:'module.py'}])assert.equal(compareCase(c,base,{...base,...change}).classification,'interpreter-defect');
});
test('exception messages are preserved, with original educational language classification',()=>{
 const c=sample('plain'),base={...output(''),completion:'error',errorType:'ValueError',message:'invalid value'};
 const r=compareCase(c,base,{...base,message:'잘못된 값'});assert.equal(r.classification,'educational-compatible');assert.equal(r.normalizedCPython.message,'invalid value');assert.equal(r.normalizedVM.message,'잘못된 값');
});
test('student exceptions versus harness failures have distinct classifications',()=>{
 const c=sample('plain'),error={...output(''),completion:'error',errorType:'ValueError'};
 assert.equal(compareCase(c,error,error).classification,'exact');assert.equal(compareCase(c,{...error,completion:'harness-error'},error).classification,'audit-error');
});
test('reproducibility hashes exclude timings and owned root metadata, not substantive output',()=>{
 const c=sample('module-missing-member'),vm=errorAt('C:\\vm');
 const report=root=>{const cp=errorAt(root);return{total:1,counts:{'educational-compatible':1},categories:{test:1},environment:{time:Date.now()},results:[{...c,cpython:cp,learningVm:vm,...compareCase(c,cp,vm)}]};};
 assert.equal(resultHash(report('C:\\one')),resultHash(report('C:\\two')));
 const changed=report('C:\\two');changed.results[0].normalizedVM.stdout='defect';assert.notEqual(resultHash(report('C:\\one')),resultHash(changed));
 assert.ok(reproducibleReport(changed).results[0].cpython.message.includes('<TEMP_ROOT>'));
});
test('clock overrides are explicit and limited to the two date cases',()=>{
 assert.equal(auditCase({id:'standard-date-today'}).oracleDate,'2026-09-15');assert.equal(auditCase({id:'plain'}).oracleDate,undefined);
 assert.equal(auditCase({id:'standard-date-fixed',fixedClock:'2024-02-29T03:00:00Z'}).fixedClock,'2024-02-29T03:00:00Z');
});
