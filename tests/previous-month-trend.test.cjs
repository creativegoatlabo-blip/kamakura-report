const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const {buildIntervalConfig}=require('../assets/trend-granularity.js');
const read=month=>JSON.parse(fs.readFileSync('all_course_report_2026_'+month+'.html','utf8').match(/const reportData\s*=\s*(\{.*?\});/s)[1]).daily_trend;
const sum=a=>a.reduce((s,x)=>s+(x??0),0);
test('daily comparison changes actual values as well as labels',()=>{
 const d=read('10');const yoy=buildIntervalConfig(d,'daily','new_reservations','yoy');const mom=buildIntervalConfig(d,'daily','new_reservations','mom');
 assert.deepEqual(mom.data.datasets[0].data,yoy.data.datasets[0].data);
 assert.deepEqual(mom.data.datasets[1].data,read('09').current_new_reservations.slice(0,19));
 assert.notDeepEqual(mom.data.datasets[1].data,yoy.data.datasets[1].data);
 assert.match(mom.data.datasets[1].label,/前月/);assert.match(yoy.data.datasets[1].label,/前年/);
});
test('weekly partial period compares matching days of previous month',()=>{
 const d=read('10');const c=buildIntervalConfig(d,'weekly','new_reservations','mom');
 assert.equal(c.data.datasets[1].data[3],read('09').current_new_reservations[18]);
 assert.equal(sum(c.data.datasets[1].data),sum(read('09').current_new_reservations.slice(0,19)));
 assert.match(c.options.plugins.tooltip.callbacks.afterTitle([{dataIndex:3}]),/2026-09-19〜2026-09-19/);
});
test('shorter months stay null and January correctly crosses years',()=>{
 const march=read('03');assert.equal(march.previous_month,'2026-02');
 assert.ok(march.previous_month_reservations.slice(28).every(x=>x===null));
 assert.equal(buildIntervalConfig(march,'daily','reservations','mom').data.datasets[1].data[30],null);
 assert.equal(read('01').previous_month,'2025-12');
 assert.equal(read('01').previous_month_dates[0],'2025-12-01');
});
test('all reports and four reservation metrics support both comparison modes',()=>{
 for(const f of fs.readdirSync('.').filter(x=>x.endsWith('.html')&&x!=='index.html')){
  const d=JSON.parse(fs.readFileSync(f,'utf8').match(/const reportData\s*=\s*(\{.*?\});/s)[1]).daily_trend;
  for(const mode of ['reservations','new_reservations','bridal_fashion','new_bridal_fashion'])for(const comparison of ['yoy','mom']){
   const day=buildIntervalConfig(d,'daily',mode,comparison),week=buildIntervalConfig(d,'weekly',mode,comparison);
   day.data.datasets.forEach((ds,i)=>assert.equal(sum(ds.data),sum(week.data.datasets[i].data),f));
  }
 }
});
