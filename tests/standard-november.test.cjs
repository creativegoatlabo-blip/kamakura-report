const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {buildMediaConfig}=require('../assets/trend-granularity.js');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').match(/const reportData\s*=\s*(\{.*?\});/s)[1]);
const stems=['all_course_report','kamakura_course_report','yokohama_course_report','course_report','kuramae_course_report'];
const sum=a=>a.reduce((s,v)=>s+(v??0),0);
test('the standard latest URLs are November and keep October archives',()=>{
 for(const stem of stems){
  const html=fs.readFileSync(stem+'.html','utf8'),d=read(stem+'.html');
  assert.equal(d.daily_trend.month,'2026-11');assert.equal(d.daily_trend.accepted_through,'2026-11-03');assert.deepEqual(d,read(stem+'_2026_11.html'));assert.equal(read(stem+'_2026_10.html').daily_trend.month,'2026-10');
  assert.match(html,/<h1[^>]*>2026年11月/);assert.match(html,/id="dailyAcquisitionSection"/);assert.match(html,/<option value="ad_spend">/);assert.match(html,/<option value="ad_cpa">/);
  assert.equal(d.new_monthly_trend.current_reservations[6],sum(d.daily_trend.current_new_reservations));
 }
 const all=read('all_course_report.html');assert.equal(all.cost_roas.cost,null);assert.equal(all.cost_roas.cpa,null);assert.equal(all.new_monthly_trend.current_bridal[6],24);assert.equal(all.new_monthly_trend.current_reservations[6],56);
});
test('weekly CPA uses total spend divided by total bookings and excludes unobserved days',()=>{
 const d=read('all_course_report.html');
 const day=buildMediaConfig(d,'daily','ad_spend'),week=buildMediaConfig(d,'weekly','ad_spend');assert.equal(day.data.labels.length,3);assert.deepEqual(week.data.labels,['11/01','11/02〜11/03']);assert.ok(Math.abs(sum(day.data.datasets[0].data)-sum(week.data.datasets[0].data))<0.000001);
 const cpa=buildMediaConfig(d,'weekly','ad_cpa');assert.equal(cpa.data.datasets[0].data[1],(d.daily_media.current_spend[1]+d.daily_media.current_spend[2])/16);
 const mom=buildMediaConfig(d,'weekly','ad_cpa','mom');assert.equal(mom.data.datasets[1].data[1],sum(d.daily_media.previous_month_spend.slice(1,3))/sum(d.daily_media.previous_month_bridal.slice(1,3)));
 assert.ok(day.data.datasets[1].data.every(v=>v===null));
 const missing=structuredClone(d);missing.daily_media.current_spend[1]=null;assert.equal(buildMediaConfig(missing,'weekly','ad_cpa').data.datasets[0].data[1],null);
 const zero=structuredClone(d);zero.daily_media.current_bridal[0]=0;assert.equal(buildMediaConfig(zero,'daily','ad_cpa').data.datasets[0].data[0],null);
});
test('regional CPA uses all three Kanto stores without allocating spend to individual stores',()=>{
 const d=read('kamakura_course_report.html'),y=read('yokohama_course_report.html'),k=read('kuramae_course_report.html');assert.deepEqual(d.daily_media,y.daily_media);assert.deepEqual(d.daily_media,k.daily_media);assert.equal(sum(d.daily_media.current_bridal),23);
 assert.equal(sum(read('all_course_report.html').daily_media.current_bridal),sum(d.daily_media.current_bridal)+sum(read('course_report.html').daily_media.current_bridal));
});
test('all month and store navigation targets exist and selected month matches the report',()=>{
 for(const f of fs.readdirSync('.').filter(f=>f.endsWith('.html')&&f!=='index.html')){
  const html=fs.readFileSync(f,'utf8'),d=read(f);let selectedMonths=0;
  for(const [,attrs,label] of html.matchAll(/<option\s+([^>]+)>([^<]+)<\/option>/g)){
   const url=attrs.match(/value="([^"]+\.html)"/);if(url)assert.ok(fs.existsSync(url[1]),f+':'+url[1]);
   if(attrs.includes('selected')&&/^2026年\d+月$/.test(label)){selectedMonths++;assert.equal(Number(label.match(/年(\d+)/)[1]),Number(d.daily_trend.month.slice(5)),f)}
  }
  assert.equal(selectedMonths,1,f);
 }
});
