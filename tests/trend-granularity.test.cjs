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
    assert.equal(cfg.data.labels.length,4);
    assert.match(cfg.data.labels[3], /途中/);
    assert.equal(cfg.data.datasets[0].data[3],d.current_new_reservations[18]);
    assert.equal(cfg.data.datasets[1].data[3],d.previous_new_reservations[18]);
    assert.equal(sum(cfg.data.datasets[0].data),244);
    assert.equal(buildIntervalConfig(d,'daily','new_reservations').data.labels.length,19);
    assert.ok(d.current_new_reservations.slice(19).every(v => v === null));
});

test('booked-date metrics include the entire month and retain their cancellation definitions', () => {
    const d = data.daily_trend;
    assert.equal(buildIntervalConfig(d,'daily','reservations').data.labels.length,31);
    const weekly = buildIntervalConfig(d,'weekly','reservations');
    assert.equal(sum(weekly.data.datasets[0].data),362);
    const split = buildIntervalConfig(d,'weekly','bridal_fashion');
    assert.equal(sum(split.data.datasets[0].data),131);
    assert.equal(sum(split.data.datasets[2].data),121);
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
    for (const k of Object.keys(stores[0]).filter(k => k.startsWith('current_') || k.startsWith('previous_') && k !== 'previous_year')) {
        for (let i=0;i<31;i++) {
            const values=stores.map(s=>s[k][i]);
            assert.equal(data.daily_trend[k][i],values.every(v=>v===null)?null:sum(values));
        }
    }
});
