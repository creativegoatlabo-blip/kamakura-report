const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = stem => JSON.parse(fs.readFileSync(stem + '_2026_10.html', 'utf8').match(/const reportData\s*=\s*(\{.*?\});/s)[1]);

test('October ledgers retain complete store splits and exact course denominators', () => {
  for (const [stem, sales, customers] of [['kamakura_course_report',27063362,320],['yokohama_course_report',7249990,101],['kuramae_course_report',7459396,70],['course_report',3829540,40]]) {
    const d = read(stem), m = d.ledger_sales;
    assert.equal(m.total_sales, sales);
    assert.equal(m.total_customers, customers);
    assert.equal(m.total_sales, m.bridal_sales + m.fashion_sales);
    assert.equal(m.total_customers, m.bridal_customers + m.fashion_customers);
    for (const prefix of ['total','bridal','fashion']) assert.equal(m[prefix+'_unit_price'], Math.round(m[prefix+'_sales']/m[prefix+'_customers']));
    for (const c of Object.values(d.course_sales)) assert.equal(c.unit_price, c.customers ? Math.round(c.sales/c.customers) : null);
    assert.equal(d.sales_trend.sales[5], sales);
    assert.equal(d.cost_roas.sales, sales);
    assert.equal(d.cost_roas.roas, null, 'regional shared spend cannot produce a store ROAS');
    const html = fs.readFileSync(stem + '_2026_10.html','utf8');
    assert.match(html,/id="ledgerSalesSection"/);
    assert.match(html,/id="courseUnitPriceSection"/);
    assert.ok(html.includes('¥'+sales.toLocaleString('en-US')));
  }
});

test('Repaired Osaka ledger completes the all-store aggregation', () => {
  const all = read('all_course_report');
  const stores = ['kamakura_course_report','yokohama_course_report','course_report','kuramae_course_report'].map(read);
  assert.equal(all.ledger_sales.total_sales,45602288);
  assert.equal(all.ledger_sales.total_customers,531);
  assert.equal(all.ledger_sales.total_unit_price,85880);
  for (const prefix of ['total','bridal','fashion']) {
    for (const suffix of ['sales','customers']) assert.equal(all.ledger_sales[prefix+'_'+suffix],stores.reduce((n,d)=>n+d.ledger_sales[prefix+'_'+suffix],0));
    assert.equal(all.ledger_sales[prefix+'_unit_price'],Math.round(all.ledger_sales[prefix+'_sales']/all.ledger_sales[prefix+'_customers']));
  }
  for (const [name,course] of Object.entries(all.course_sales)) {
    for (const metric of ['sales','customers']) assert.equal(course[metric],stores.reduce((n,d)=>n+d.course_sales[name][metric],0));
    assert.equal(course.unit_price,course.customers ? Math.round(course.sales/course.customers) : null);
  }
  assert.equal(all.cost_roas.sales,45602288);
  assert.equal(all.cost_roas.roas,45602288/7606041);
  assert.equal(all.cost_roas.roas_status,'provisional');
  for (const stem of ['all_course_report','course_report']) {
    const d=read(stem);
    assert.equal(d.sales_trend.sales[5],d.ledger_sales.total_sales);
    const latest=JSON.parse(fs.readFileSync(stem+'.html','utf8').match(/const reportData\s*=\s*(\{.*?\});/s)[1]);
    assert.equal(latest.sales_trend.sales[5],d.ledger_sales.total_sales);
    assert.ok(!/売上[^。]*未確定|大阪[^。]*売上[^。]*未確定/.test(d.meta.data_quality_note));
    assert.ok(!fs.readFileSync(stem+'_2026_10.html','utf8').includes('大阪の年間合計!C11が#REF!'));
  }
});

test('October cancellation changes reconcile to spend and preserve the WEB order block', () => {
  const d = read('all_course_report');
  assert.equal(d.new_monthly_trend.current_reservations[5],392);
  assert.equal(d.new_monthly_trend.current_bridal[5],159);
  assert.equal(d.new_monthly_trend.current_fashion[5],180);
  assert.equal(d.cost_roas.cost,7606041);
  assert.equal(d.cost_roas.cpa,47837);
  assert.equal(d.cost_roas.sources.reduce((n,s)=>n+s.amount,0),d.cost_roas.cost);
  const html = fs.readFileSync('all_course_report_2026_10.html','utf8');
  assert.match(html,/id="webOrdersSection"/);
  assert.match(html,/LINEヤフー広告費は含みません/);
  assert.equal((html.match(/id="dailyAcquisitionSection"/g)||[]).length,1);
});
