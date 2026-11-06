const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const stems=['all_course_report','kamakura_course_report','yokohama_course_report','course_report','kuramae_course_report'];
const read=(stem,month='11')=>{const html=fs.readFileSync(stem+'_2026_'+month+'.html','utf8');return {html,data:JSON.parse(html.match(/id="visitFollowupData">(.*?)<\/script>/s)[1])};};
test('published follow-up denominators, rates, maturity and store totals agree',()=>{
 for(const month of ['10','11']){
  const reports=stems.map(s=>read(s,month)),all=reports[0].data;
  for(const {html,data} of reports){
   assert.equal(data.cutoff,month==='10'?'2026-10-31':'2026-11-05');assert.equal(data.cohort_start,'2026-07-01');assert.equal((html.match(/id="visitFollowupSection"/g)||[]).length,1);
   assert.match(html,/追跡期間が異なります/);assert.match(html,/見学予定日ベース・実来店確認ではありません/);
   for(const row of data.months)for(const days of [30,90]){const v=row['days_'+days];assert.equal(v.eligible+v.pending,row.total_groups);assert.ok(v.converted<=v.eligible);assert.equal(v.rate,v.eligible?Math.round(v.converted/v.eligible*1000)/10:null);assert.equal(v.status,row.total_groups===0?'no_cohort':v.pending?'tracking':'complete');}
  }
  for(let i=0;i<all.months.length;i++)for(const days of [30,90])for(const k of ['eligible','converted','pending'])assert.equal(all.months[i]['days_'+days][k],reports.slice(1).reduce((n,r)=>n+r.data.months[i]['days_'+days][k],0));
 }
 const {data,html}=read('all_course_report');const october=data.months.find(x=>x.month==='2026-10');assert.deepEqual(october.days_30,{eligible:9,converted:3,pending:44,rate:33.3,status:'tracking'});
 assert.match(html,/3 \/ 9組/);assert.match(html,/44組/);
 const archive=read('all_course_report','10');assert.match(archive.html,/現在の取消状態による参考値/);assert.equal(archive.data.months.at(-1).days_30.eligible,0);assert.ok(!archive.data.months.some(x=>x.month==='2026-11'));
});
test('latest and November archive follow-up sections match and historical WEB orders remain intact',()=>{
 for(const stem of stems){const latest=fs.readFileSync(stem+'.html','utf8'),archive=fs.readFileSync(stem+'_2026_11.html','utf8');assert.equal(latest.match(/<!-- visit-followup:start -->.*?<!-- visit-followup:end -->/s)[0],archive.match(/<!-- visit-followup:start -->.*?<!-- visit-followup:end -->/s)[0]);}
 const latest=fs.readFileSync('all_course_report.html','utf8');const web=JSON.parse(latest.match(/id="webOrdersData">(.*?)<\/script>/s)[1]);assert.equal(web.through,'2026-11-05');assert.equal(web.confirmed,0);assert.equal(web.observed_on,'2026-11-06');
});
