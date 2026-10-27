const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {buckets, buildIntervalConfig} = require('../assets/trend-granularity.js');
const read = stem => JSON.parse(fs.readFileSync(stem + '_2026_10.html', 'utf8').match(/const reportData\s*=\s*(\{.*?\});/s)[1]);
const data = read('all_course_report');
const sum = values => values.reduce((a,b) => a + (b ?? 0), 0);

test('weekly boundaries are Monday-Sunday, clipped to the report month', () => {
    assert.deepEqual(buckets(data.daily_trend, 'weekly').map(g => [g[0]+1,g.at(-1)+1]), [[1,4],[5,11],[12,18],[19,25],[26,31]]);
    const feb = {dates:Array.from({length:29}, (_,i) => `2024-02-${String(i+1).padStart(2,'0')}`)};
    assert.deepEqual(buckets(feb, 'weekly').map(g => [g[0]+1,g.at(-1)+1]), [[1,4],[5,11],[12,18],[19,25],[26,29]]);
});

test('accepted bookings exclude unobserved days and compare identical partial-week dates', () => {
    const d = data.daily_trend;
    const cfg = buildIntervalConfig(d,'weekly','new_reservations');
    assert.equal(cfg.data.labels.length,5);
    assert.match(cfg.data.labels[4], /途中/);
    assert.equal(cfg.data.datasets[0].data[4],d.current_new_reservations[25]);
    assert.equal(cfg.data.datasets[1].data[4],d.previous_new_reservations[25]);
    assert.equal(sum(cfg.data.datasets[0].data),338);
    assert.equal(buildIntervalConfig(d,'daily','new_reservations').data.labels.length,26);
    assert.ok(d.current_new_reservations.slice(26).every(v => v === null));
});

test('booked-date metrics include the entire month and retain their cancellation definitions', () => {
    const d = data.daily_trend;
    assert.equal(buildIntervalConfig(d,'daily','reservations').data.labels.length,31);
    const weekly = buildIntervalConfig(d,'weekly','reservations');
    assert.equal(sum(weekly.data.datasets[0].data),413);
    const split = buildIntervalConfig(d,'weekly','bridal_fashion');
    assert.equal(sum(split.data.datasets[0].data),144);
    assert.equal(sum(split.data.datasets[2].data),142);
});

test('daily and weekly totals reconcile to the existing October monthly counts for all stores', () => {
    for (const stem of ['all_course_report','kamakura_course_report','yokohama_course_report','course_report','kuramae_course_report']) {
        const r=read(stem);
        for (const period of ['daily','weekly']) {
            for (const [mode,source] of [['reservations','monthly_trend'],['new_reservations','new_monthly_trend']]) {
                assert.equal(sum(buildIntervalConfig(r.daily_trend,period,mode).data.datasets[0].data),r[source].current_reservations[5]);
            }
            for (const [mode,source] of [['bridal_fashion','monthly_trend'],['new_bridal_fashion','new_monthly_trend']]) {
                const cfg=buildIntervalConfig(r.daily_trend,period,mode);
                assert.equal(sum(cfg.data.datasets[0].data),r[source].current_bridal[5]);
                assert.equal(sum(cfg.data.datasets[2].data),r[source].current_fashion[5]);
            }
        }
    }
});

test('Kuramae pre-opening comparison stays missing rather than becoming zero', () => {
    const d=read('kuramae_course_report').daily_trend;
    for (const mode of ['new_reservations','reservations','bridal_fashion','new_bridal_fashion']) {
        const cfg=buildIntervalConfig(d,'weekly',mode);
        assert.ok(cfg.data.datasets[1].data.every(v=>v===null));
    }
});

test('all-store daily counts equal the store totals, including missing periods', () => {
    const stores=['kamakura_course_report','yokohama_course_report','course_report','kuramae_course_report'].map(x=>read(x).daily_trend);
    for (const k of Object.keys(stores[0]).filter(k => (k.startsWith('current_') || k.startsWith('previous_')) && Array.isArray(stores[0][k]) && !k.endsWith('_dates'))) {
        for (let i=0;i<31;i++) {
            const values=stores.map(s=>s[k][i]);
            assert.equal(data.daily_trend[k][i],values.every(v=>v===null)?null:sum(values));
        }
    }
});

test('every report period has complete daily counts and weekly sums without boundary overlap', () => {
    const files=fs.readdirSync('.').filter(name=>name.endsWith('.html')&&name!=='index.html');
    assert.equal(files.length,49);
    for (const filename of files) {
        const html=fs.readFileSync(filename,'utf8');
        const r=JSON.parse(html.match(/const reportData\s*=\s*(\{.*?\});/s)[1]);
        const d=r.daily_trend;
        assert.ok(d,filename);
        const [year,month]=d.month.split('-').map(Number);
        assert.equal(d.dates.length,new Date(Date.UTC(year,month,0)).getUTCDate(),filename);
        assert.equal(new Set(d.dates).size,d.dates.length);
        const groups=buckets(d,'weekly');
        assert.deepEqual(groups.flat(),d.dates.map((_,i)=>i));
        for (const mode of ['reservations','new_reservations','bridal_fashion','new_bridal_fashion']) {
            const day=buildIntervalConfig(d,'daily',mode);
            const week=buildIntervalConfig(d,'weekly',mode);
            day.data.datasets.forEach((ds,i)=>assert.equal(sum(ds.data),sum(week.data.datasets[i].data),filename+':'+mode));
        }
        for (const [key,value] of Object.entries(d.reconciliation||{})) {
            assert.equal(sum(d['current_'+key]),value.daily_total,filename);
        }
        assert.match(html,/id="trendSelectorPeriod"/);
        assert.match(html,/id="cpaTrendSelectorPeriod"/);
    }
});

test('historical all-store daily series equal the sum of applicable stores', () => {
    for (let month=1;month<=9;month++) {
        const suffix=`_2026_${String(month).padStart(2,'0')}.html`;
        const readFile=stem=>JSON.parse(fs.readFileSync(stem+suffix,'utf8').match(/const reportData\s*=\s*(\{.*?\});/s)[1]).daily_trend;
        const all=readFile('all_course_report');
        const stems=['kamakura_course_report','yokohama_course_report','course_report'];
        if (month>=7) stems.push('kuramae_course_report');
        const stores=stems.map(readFile);
        // Before the Kuramae archive starts, future Kuramae bookings may already be accepted.
        for (const key of ['current_reservations','current_bridal','current_fashion','previous_reservations','previous_bridal','previous_fashion']) {
            all[key].forEach((v,i)=>assert.equal(v,sum(stores.map(s=>s[key][i])),month+':'+key));
        }
        if(month>=7) for(const key of ['current_new_reservations','current_new_bridal','current_new_fashion']) {
            all[key].forEach((v,i)=>assert.equal(v,sum(stores.map(s=>s[key][i])),month+':'+key));
        }
    }
});
