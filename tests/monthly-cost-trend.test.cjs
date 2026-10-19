const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {buildCostConfig}=require('../assets/trend-granularity.js');
const read=name=>JSON.parse(fs.readFileSync(name+'.html','utf8').match(/const reportData\s*=\s*(\{.*?\});/s)[1]);
test('every report offers monthly cost in both selectors with a twelve-month series',()=>{
 for(const f of fs.readdirSync('.').filter(f=>f.endsWith('.html')&&f!=='index.html')){
  const html=fs.readFileSync(f,'utf8');const d=read(f.slice(0,-5));const t=d.monthly_cost_trend;
  assert.equal((html.match(/value="monthly_cost"/g)||[]).length,2,f);
  assert.equal(t.current_cost.length,12);assert.equal(t.previous_cost.length,12);
  assert.deepEqual(t.labels,d.monthly_trend.labels);
  assert.ok([...t.current_cost,...t.previous_cost].every(v=>v===null||(Number.isInteger(v)&&v>=0)));
 }
});
test('October uses the latest snapshot, September stays missing, and forecast months are not zero',()=>{
 const t=read('all_course_report').monthly_cost_trend;
 assert.equal(t.current_cost[5],4798848);
 assert.equal(t.current_cost[4],null);
 assert.ok(t.current_cost.slice(6).every(v=>v===null));
 assert.equal(t.current_meta[5].through,'2026-10-19');
 assert.equal(t.current_meta[5].provisional,true);
 const config=buildCostConfig(t);
 assert.equal(config.options.plugins.tooltip.callbacks.afterLabel({datasetIndex:0,dataIndex:5}),'2026-10（月途中：広告費は2026-10-19まで）・暫定額');
 assert.equal(config.data.datasets[0].spanGaps,false);
});
test('regional views do not allocate shared listing fees to a store',()=>{
 const all=read('all_course_report').monthly_cost_trend;
 const kanto=read('kamakura_course_report').monthly_cost_trend;
 const osaka=read('course_report').monthly_cost_trend;
 assert.equal(kanto.current_cost[5],3762670);assert.equal(osaka.current_cost[5],716178);
 assert.equal(all.current_cost[5]-kanto.current_cost[5]-osaka.current_cost[5],320000);
 for(const stem of ['yokohama_course_report','kuramae_course_report'])assert.deepEqual(read(stem).monthly_cost_trend.current_cost,kanto.current_cost);
 assert.equal(kanto.current_meta[5].provisional,false);
});
test('historical fiscal years are aligned and months beyond the selected report are empty',()=>{
 const jan=read('all_course_report_2026_01').monthly_cost_trend;
 assert.equal(jan.current_meta[0].month,'2025-05');
 assert.equal(jan.current_meta[8].month,'2026-01');
 assert.equal(jan.current_cost[8],9187324);
 assert.ok(jan.current_cost.slice(9).every(v=>v===null));
 assert.ok(jan.previous_cost.every(v=>v===null));
});
