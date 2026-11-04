import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(path.join(process.env.PSS_TEST_BUILD,'loader.js'));
const {analyzeUpload,uploadBytes}=require('./lib/spatial/upload-analysis.js');
const {zipSync,strToU8}=require('fflate');
const point=(coordinates,crs)=>({type:'Feature',properties:{name:'자료 이름'},geometry:{type:'Point',coordinates},...(crs?{crs:{type:'name',properties:{name:crs}}}:{})});
const bytes=value=>Buffer.from(JSON.stringify(value));
function pointZip(x,y,prj){
 const shp=Buffer.alloc(128);shp.writeInt32BE(9994,0);shp.writeInt32BE(64,24);shp.writeInt32LE(1000,28);shp.writeInt32LE(1,32);
 for(const [at,value] of [[36,x],[44,y],[52,x],[60,y]])shp.writeDoubleLE(value,at);
 shp.writeInt32BE(1,100);shp.writeInt32BE(10,104);shp.writeInt32LE(1,108);shp.writeDoubleLE(x,112);shp.writeDoubleLE(y,120);
 const dbf=Buffer.alloc(77);dbf[0]=3;dbf.writeUInt32LE(1,4);dbf.writeUInt16LE(65,8);dbf.writeUInt16LE(11,10);dbf.write('NAME',32);dbf[43]=67;dbf[48]=10;dbf[64]=13;dbf[65]=32;dbf.write('Park      ',66);dbf[76]=26;
 return zipSync({'folder/SITE.SHP':shp,'folder/SITE.DBF':dbf,...(prj?{'folder/SITE.PRJ':strToU8(prj)}:{}),'folder/SITE.CPG':strToU8('UTF-8')});
}
test('GeoJSON geographic coordinates are detected without asking for CRS; original bytes and properties are preserved',async()=>{
 const original=bytes(point([127.01,37.5]));const before=original.toString();const result=await analyzeUpload(original,'geojson');
 assert.equal(result.needsCrs,false);assert.equal(result.sourceCrs,'EPSG:4326');assert.equal(result.featureCount,1);assert.equal(result.geometryType,'point');assert.deepEqual(result.extent,[127.01,37.5,127.01,37.5]);assert.equal(result.data.features[0].properties.name,'자료 이름');assert.equal(original.toString(),before);
 assert.equal(result.data.features[0].properties.display_name,'자료 이름');assert.equal(JSON.parse(before).properties.display_name,undefined);
});
test('Korean projected CRS conversions match independent projection origins',async()=>{
 for(const [crs,position,expected] of [['EPSG:5186',[200000,600000],[127,38]],['EPSG:5179',[1000000,2000000],[127.5,38]],['EPSG:3857',[0,0],[0,0]]]){
  const result=await analyzeUpload(bytes(point(position,crs)),'json');assert.equal(result.sourceCrs,crs);assert.equal(result.webCrs,'EPSG:4326');const actual=result.data.features[0].geometry.coordinates;
  expected.forEach((v,i)=>assert.ok(Math.abs(actual[i]-v)<1e-7));
 }
});
test('ambiguous projected coordinates require manual CRS and never guess between Korean projections',async()=>{
 const data=bytes(point([200000,600000]));assert.equal((await analyzeUpload(data,'json')).needsCrs,true);
 assert.equal((await analyzeUpload(data,'json','EPSG:5186')).needsCrs,false);
 await assert.rejects(analyzeUpload(bytes(point([200000,600000],'EPSG:5186')),'json','EPSG:5179'),/crsMismatch/);
 assert.equal((await analyzeUpload(bytes(point([200000,600000],'EPSG:9999')),'json')).needsCrs,true);
});
test('CSV recognizes each latitude/longitude alias and preserves nonspatial archives',async()=>{
 for(const [x,y] of [['longitude','latitude'],['lon','lat'],['lng','lat'],['경도','위도']]){
  const result=await analyzeUpload(Buffer.from(`${x},${y},이름\n127,37,공원`),'csv');assert.equal(result.sourceCrs,'EPSG:4326');assert.deepEqual(result.data.features[0].geometry.coordinates,[127,37]);assert.equal(result.data.features[0].properties.이름,'공원');
 }
 const projected=Buffer.from('x,y\n200000,600000');assert.equal((await analyzeUpload(projected,'csv')).needsCrs,true);assert.equal((await analyzeUpload(projected,'csv','EPSG:5186')).sourceCrs,'EPSG:5186');
 const table=await analyzeUpload(Buffer.from('지역,인구\n중앙동,123'),'csv');assert.equal(table.data,null);assert.equal(table.featureCount,1);assert.equal(table.needsCrs,false);
});
test('Shapefile ZIP reads matching components and PRJ, preserves DBF attributes and normalizes projected geometry',async()=>{
 const prj='PROJCS["KGD2002 / Central Belt 2010",GEOGCS["KGD2002",DATUM["Geocentric datum of Korea",SPHEROID["GRS 1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",38],PARAMETER["central_meridian",127],PARAMETER["scale_factor",1],PARAMETER["false_easting",200000],PARAMETER["false_northing",600000],UNIT["metre",1],AUTHORITY["EPSG","5186"]]';
 const result=await analyzeUpload(pointZip(200000,600000,prj),'zip');assert.equal(result.needsCrs,false);assert.match(result.sourceCrs,/5186/);assert.equal(result.data.features[0].properties.NAME,'Park');const [x,y]=result.data.features[0].geometry.coordinates;assert.ok(Math.abs(x-127)<1e-7);assert.ok(Math.abs(y-38)<1e-7);
 assert.equal((await analyzeUpload(pointZip(127,37),'zip')).needsCrs,true);assert.equal((await analyzeUpload(pointZip(200000,600000),'zip','EPSG:5186')).needsCrs,false);
});
test('invalid uploads, missing components, oversized ZIP expansion and incompatible geometry fail before persistence',async()=>{
 for(const payload of [{fileName:'a.shp',data:'eA=='},{fileName:'../a.json',data:'eA=='},{fileName:'a.json',data:'!'}])assert.throws(()=>uploadBytes(payload));
 await assert.rejects(analyzeUpload(zipSync({'a.shp':new Uint8Array(1)}),'zip'),/missingDbf/);
 await assert.rejects(analyzeUpload(zipSync({'a.shp':new Uint8Array(1),'b.shp':new Uint8Array(1)}),'zip'),/oneShapefile/);
 await assert.rejects(analyzeUpload(zipSync({'bomb.txt':new Uint8Array(24*1024*1024+1)}),'zip'),/zipSize/);
 await assert.rejects(analyzeUpload(bytes(point([127,37])),'json',undefined,'project_boundary'));
 await assert.rejects(analyzeUpload(Buffer.from('longitude,latitude\n127,'),'csv'));
});
