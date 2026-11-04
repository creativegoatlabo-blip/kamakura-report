const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const stems=['all_course_report','kamakura_course_report','yokohama_course_report','course_report','kuramae_course_report'];
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').match(/const reportData\s*=\s*(\{.*?\});/s)[1]);
test('daily acquisition reports reconcile across days, courses, stores and monthly totals',()=>{
 for(const [month,days,bridal,total,spend] of [['10',31,160,394,7286041],['11',3,24,56,1026034]]){
  const docs=stems.map(s=>read(`daily/2026_${month}/${s}.html`)),all=docs[0];
  assert.equal(all.daily.length,days);assert.equal(all.summary.bridal,bridal);assert.equal(all.summary.active_total,total);assert.equal(Math.round(all.spend),spend);assert.equal(all.cpa,all.spend/bridal);
  for(const d of docs)for(const row of d.daily){assert.equal(row.active_total,row.bridal+row.fashion+row.tour+row.other);assert.equal(row.received_total,row.active_total+row.canceled);assert.equal(row.active_total,Object.values(row.courses).reduce((a,b)=>a+b,0));assert.equal(row.cpa,row.spend!==null&&row.bridal?row.spend/row.bridal:null)}
  for(let i=0;i<days;i++)for(const k of ['bridal','fashion','tour','other','active_total','canceled'])assert.equal(all.daily[i][k],docs.slice(1).reduce((a,d)=>a+d.daily[i][k],0));
  if(month==='10'){const m=read('all_course_report.html');assert.equal(m.new_monthly_trend.current_bridal[5],bridal);assert.equal(m.new_monthly_trend.current_reservations[5],total);assert.equal(m.cost_roas.ad_spend,spend)}
  for(const stem of stems){const p=`daily/2026_${month}/${stem}.html`,html=fs.readFileSync(p,'utf8');for(const [,href] of html.matchAll(/href="([^"]+)"/g))assert.ok(fs.existsSync(path.resolve(path.dirname(p),href)),href);assert.doesNotMatch(html,/mailto:|予約番号|お名前|ふりがな|\/Users\//)}
 }
});
